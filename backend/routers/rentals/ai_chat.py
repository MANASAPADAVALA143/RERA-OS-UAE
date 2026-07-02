"""
AI Chat endpoint for rental portfolio insights.

Endpoint: POST /api/rentals/ai/chat
Auth: JWT token (extracts tenant_id from token, never trusts request body)
Rate limit: 20 requests per user per hour (in-memory counter)

Data flow:
1. User sends: { "message": "What is our occupancy rate?" }
2. Extract tenant_id from JWT token (secure)
3. Call get_rental_context(tenant_id, optional company_id)
4. Build prompt with real data context
5. Send to Bedrock (Claude or Nova Lite)
6. Return response to user

Data retention: OFF (Bedrock does not retain prompts/outputs by default)
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models.audit_log import AuditLog
from models.rentals.models import RentalCompany, RentalUnit, RentalInvoice
from services.auth_service import get_current_tenant
from services.llm_client import invoke_narrative

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rentals/ai", tags=["rental-ai"])

# In-memory rate limiting: {user_id: [(timestamp, count_in_window), ...]}
_rate_limit_cache: dict[str, list[tuple[float, int]]] = {}
RATE_LIMIT_REQUESTS = 20
RATE_LIMIT_WINDOW = 3600  # 1 hour


class ChatRequest(BaseModel):
    message: str
    company_id: Optional[str] = None  # Optional: scope to specific company


class ChatResponse(BaseModel):
    reply: str
    source: str  # "claude", "nova", or "fallback"


def get_rental_context(tenant_id: str, company_id: Optional[str], db: Session) -> dict:
    """
    Fetch real rental data for the tenant (and optional company).

    Returns aggregated metrics for LLM context:
    {
        "occupancy_rate": 93.5,
        "occupied_units": 29,
        "vacant_units": 2,
        "rent_collected_this_month": 145000,
        "gross_potential_rent": 155000,
        "vacancy_loss": 10000,
        "arrears_total": 5000,
        "noi_this_month": 95000,
        "company_name": "ABC LLC" or "All Companies"
    }
    """
    try:
        query = db.query(RentalCompany).filter(RentalCompany.tenant_id == tenant_id)

        if company_id:
            query = query.filter(RentalCompany.id == company_id)

        companies = query.all()

        if not companies:
            return {
                "occupancy_rate": 0,
                "occupied_units": 0,
                "vacant_units": 0,
                "rent_collected_this_month": 0,
                "gross_potential_rent": 0,
                "vacancy_loss": 0,
                "arrears_total": 0,
                "noi_this_month": 0,
                "company_name": "No data",
            }

        # Aggregate across all matched companies
        total_units = sum(c.total_units or 0 for c in companies)
        total_vacant = sum(c.vacant_units or 0 for c in companies)
        total_occupied = total_units - total_vacant
        total_rent_collected = sum(c.collected_this_month or 0 for c in companies)
        total_gross_rent = sum(c.gross_potential_rent or 0 for c in companies)
        total_noi = sum(c.noi_this_month or 0 for c in companies)
        total_arrears = sum(c.arrears_total or 0 for c in companies)
        total_vacancy_loss = total_gross_rent - total_rent_collected

        occupancy_rate = (total_occupied / total_units * 100) if total_units > 0 else 0

        company_name = companies[0].company_name if len(companies) == 1 else f"{len(companies)} companies"

        return {
            "occupancy_rate": round(occupancy_rate, 1),
            "occupied_units": total_occupied,
            "vacant_units": total_vacant,
            "rent_collected_this_month": total_rent_collected,
            "gross_potential_rent": total_gross_rent,
            "vacancy_loss": total_vacancy_loss,
            "arrears_total": total_arrears,
            "noi_this_month": total_noi,
            "company_name": company_name,
        }
    except Exception as e:
        logger.exception("Error fetching rental context")
        return {
            "occupancy_rate": 0,
            "occupied_units": 0,
            "vacant_units": 0,
            "rent_collected_this_month": 0,
            "gross_potential_rent": 0,
            "vacancy_loss": 0,
            "arrears_total": 0,
            "noi_this_month": 0,
            "company_name": "Error retrieving data",
        }


def check_rate_limit(user_id: str) -> bool:
    """
    Check if user has exceeded rate limit (20 requests per hour).
    Returns True if under limit, False if rate limit exceeded.
    """
    now = time.time()

    if user_id not in _rate_limit_cache:
        _rate_limit_cache[user_id] = [(now, 1)]
        return True

    # Remove old entries outside the 1-hour window
    _rate_limit_cache[user_id] = [
        (ts, count) for ts, count in _rate_limit_cache[user_id]
        if now - ts < RATE_LIMIT_WINDOW
    ]

    # Count requests in current window
    request_count = sum(count for _, count in _rate_limit_cache[user_id])

    if request_count >= RATE_LIMIT_REQUESTS:
        return False

    # Record this request
    _rate_limit_cache[user_id].append((now, 1))
    return True


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
    current_tenant: dict = Depends(get_current_tenant),
) -> ChatResponse:
    """
    Chat endpoint for rental portfolio AI insights.

    Extracts tenant_id from JWT (never trusts request body).
    Fetches real rental data, builds context, sends to Bedrock.

    Returns: { "reply": "...", "source": "claude" or "nova" or "fallback" }
    """
    tenant_id = current_tenant.get("tenant_id")
    user_id = current_tenant.get("user_id")

    if not tenant_id or not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    # Rate limiting
    if not check_rate_limit(user_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: max {RATE_LIMIT_REQUESTS} requests per hour",
        )

    # Get real rental context
    context = get_rental_context(tenant_id, req.company_id, db)

    # Build system prompt
    system_prompt = """You are a financial assistant for a real estate portfolio management app.
Your role is to analyze portfolio data and provide actionable insights.

CRITICAL RULES:
1. Only use the data provided below to answer questions
2. If required data is missing, say "I don't have that data available"
3. Never estimate, guess, or make up numbers
4. Be concise and specific with dollar figures and percentages
5. Format currency as USD (e.g., $145,000)
6. Focus on actionable insights, not just raw data"""

    # Build user message with context
    user_message = f"""Here is the current rental portfolio data for {context['company_name']}:

- Occupancy Rate: {context['occupancy_rate']}%
- Occupied Units: {context['occupied_units']}
- Vacant Units: {context['vacant_units']}
- Rent Collected This Month: ${context['rent_collected_this_month']:,.0f}
- Gross Potential Rent: ${context['gross_potential_rent']:,.0f}
- Vacancy Loss: ${context['vacancy_loss']:,.0f}
- Arrears Outstanding: ${context['arrears_total']:,.0f}
- NOI This Month: ${context['noi_this_month']:,.0f}

User question: {req.message}"""

    # Send to Bedrock
    logger.info(
        "Chat request from user %s (tenant %s): %s",
        user_id, tenant_id, req.message[:100]
    )

    result = invoke_narrative(
        prompt=user_message,
        task_type="chat_query",
        max_tokens=500,
    )

    ai_model = result.get("model", "")
    # Derive a short human-readable source label for the response payload
    if "haiku" in ai_model.lower():
        source = "claude-haiku"
    elif "sonnet" in ai_model.lower():
        source = "claude-sonnet"
    elif "nova" in ai_model.lower():
        source = "nova"
    else:
        source = "fallback"

    # Write audit log — single row insert, negligible latency
    try:
        db.add(AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            action="ai_rental_chat",
            endpoint="/api/rentals/ai/chat",
            success=result["success"],
            ai_model=ai_model or None,
            purpose="rental_chat_query",
        ))
        db.commit()
    except Exception:
        logger.exception("Failed to write AI audit log for user %s", user_id)
        # Never let audit-log failure block the AI response

    if not result["success"]:
        logger.warning("LLM call failed: %s", result.get("error"))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI assistant temporarily unavailable",
        )

    logger.info(
        "Chat response for user %s: %d chars, model=%s",
        user_id, len(result["text"]), ai_model,
    )

    return ChatResponse(reply=result["text"], source=source)
