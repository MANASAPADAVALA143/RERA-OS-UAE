from fastapi import APIRouter
from pydantic import BaseModel

from config import settings

router = APIRouter(prefix="/api/propdev", tags=["propdev-ai"])


class DealMetrics(BaseModel):
    totalRevenue: float
    totalCost: float
    netProfit: float
    grossMargin: float
    totalLots: int
    soldLots: int
    breakEvenLots: int
    annualInterest: float
    partnerCount: int


class AdvisorResponse(BaseModel):
    advice: str
    source: str


def _rule_based_advice(m: DealMetrics) -> str:
    lines: list[str] = []

    margin = m.grossMargin
    unsold = m.totalLots - m.soldLots
    be_gap = m.breakEvenLots - m.soldLots

    # Margin insight
    if margin >= 40:
        lines.append(
            f"Strong margin at {margin:.1f}% — net profit of ${m.netProfit:,.0f}. "
            "Consider banking early gains by pricing premium blocks at the upper end."
        )
    elif margin >= 20:
        lines.append(
            f"Healthy margin at {margin:.1f}%, but headroom is limited. "
            "Tighten cost tracking on remaining {unsold} lots to protect the bottom line."
        )
    else:
        lines.append(
            f"Margin at {margin:.1f}% is below target. "
            "Prioritise selling contracted lots quickly and audit soft-cost overruns."
        )

    # Break-even insight
    if be_gap <= 0:
        lines.append("Break-even already achieved — all future sales are pure profit return.")
    elif be_gap <= 10:
        lines.append(
            f"Break-even within reach at {be_gap} more lots. "
            "Converting just a few contracted lots to sold would cross the threshold."
        )
    else:
        lines.append(
            f"Break-even requires {be_gap} more lot sales from the current {m.soldLots} sold. "
            "Prioritise the contracted pipeline and consider short-term incentives to accelerate closings."
        )

    # Interest load insight
    if m.annualInterest > 0:
        interest_pct = (m.annualInterest / m.totalRevenue * 100) if m.totalRevenue > 0 else 0
        if interest_pct > 10:
            lines.append(
                f"Annual interest of ${m.annualInterest:,.0f} ({interest_pct:.1f}% of revenue) is elevated. "
                "Accelerating sales velocity would reduce the carry period and interest drag."
            )
        elif interest_pct > 5:
            lines.append(
                f"Interest carry at {interest_pct:.1f}% of revenue is manageable, "
                "but review refinancing options if project duration extends beyond 12 months."
            )

    return "  ".join(lines[:3])


def _anthropic_advice(m: DealMetrics) -> str:
    import json
    import urllib.request

    prompt = (
        "You are a real estate financial advisor. Analyze this deal P&L and give "
        "3 concise strategic recommendations (max 120 words total, plain English, no markdown):\n\n"
        + json.dumps(m.model_dump())
    )
    payload = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 200,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return data["content"][0]["text"].strip()


@router.post("/deal-advisor", response_model=AdvisorResponse)
def deal_advisor(metrics: DealMetrics):
    if settings.anthropic_api_key:
        try:
            text = _anthropic_advice(metrics)
            return AdvisorResponse(advice=text, source="claude")
        except Exception:
            pass
    advice = _rule_based_advice(metrics)
    return AdvisorResponse(advice=advice, source="rules")
