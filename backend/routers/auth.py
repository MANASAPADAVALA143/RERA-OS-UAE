import threading
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings
from database import get_db, set_rls_tenant
from middleware.auth import CurrentUser, get_current_user, require_role
from models.audit_log import AuditLog
from models.tenancy import Tenant, TenantUser, UserRole, UserStatus
from services.local_auth import (
    DEMO_EMAIL,
    DEMO_PASSWORD,
    create_access_token,
    hash_password,
    new_local_user_id,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_login_attempts: dict = defaultdict(list)
_login_lock = threading.Lock()

def _check_login_rate(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = datetime.utcnow()
    cutoff = now - timedelta(minutes=1)
    with _login_lock:
        _login_attempts[ip] = [t for t in _login_attempts[ip] if t > cutoff]
        if len(_login_attempts[ip]) >= 5:
            raise HTTPException(status_code=429, detail="Too many login attempts. Wait 1 minute.")
        _login_attempts[ip].append(now)

INVITE_ROLES = {"owner", "admin", "cfo", "controller", "analyst", "viewer"}


class RegisterTenantRequest(BaseModel):
    company_name: str = Field(min_length=1, max_length=255)
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class InviteUserRequest(BaseModel):
    email: EmailStr
    role: str
    password: str | None = Field(default=None, min_length=8)


class AuthMeResponse(BaseModel):
    user_id: str
    email: str
    tenant_id: str
    company_name: str
    role: str
    status: str
    subscription_tier: str
    ai_narrative_enabled: bool


@router.get("/config")
def auth_config():
    return {
        "auth_mode": settings.effective_auth_mode,
    }


@router.post("/login")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    _check_login_rate(request)
    if settings.effective_auth_mode != "local":
        raise HTTPException(status_code=400, detail="Use Supabase sign-in for this deployment")

    user = db.query(TenantUser).filter(TenantUser.email == body.email).first()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.status == UserStatus.disabled:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token(user.supabase_user_id, user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.supabase_user_id,
        "email": user.email,
    }


def _register_local(body: RegisterTenantRequest, db: Session):
    existing = db.query(TenantUser).filter(TenantUser.email == body.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    tenant = Tenant(company_name=body.company_name)
    db.add(tenant)
    db.flush()

    user_id = new_local_user_id()
    tenant_user = TenantUser(
        tenant_id=tenant.id,
        supabase_user_id=user_id,
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        role=UserRole.owner,
        status=UserStatus.active,
        joined_at=datetime.now(timezone.utc),
    )
    db.add(tenant_user)
    db.commit()
    db.refresh(tenant)

    token = create_access_token(user_id, body.email)
    return {
        "tenant_id": str(tenant.id),
        "user_id": user_id,
        "email": body.email,
        "role": "owner",
        "access_token": token,
        "message": "Tenant registered.",
    }


def _supabase_admin_headers():
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


def _register_supabase(body: RegisterTenantRequest, db: Session):
    existing = db.query(TenantUser).filter(TenantUser.email == body.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=_supabase_admin_headers(),
            json={
                "email": body.email,
                "password": body.password,
                "email_confirm": True,
                "user_metadata": {"full_name": body.full_name},
            },
        )
        if resp.status_code >= 400:
            raise HTTPException(status_code=400, detail=resp.text)
        user_id = resp.json()["id"]

    # Use Supabase UUID as tenants.id so that tenant_id is the same value
    # everywhere — r_companies.tenant_id FK is satisfied, and SQL INSERTs
    # using the Supabase UUID just work without a separate lookup.
    tenant = Tenant(id=uuid.UUID(user_id), company_name=body.company_name)
    db.add(tenant)
    db.flush()

    db.add(
        TenantUser(
            tenant_id=tenant.id,
            supabase_user_id=user_id,
            email=body.email,
            full_name=body.full_name,
            role=UserRole.owner,
            status=UserStatus.active,
            joined_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return {
        "tenant_id": str(tenant.id),
        "user_id": user_id,
        "email": body.email,
        "role": "owner",
        "message": "Tenant registered. Sign in with your credentials.",
    }


@router.post("/register-tenant")
def register_tenant(body: RegisterTenantRequest, db: Session = Depends(get_db)):
    if settings.effective_auth_mode == "local":
        return _register_local(body, db)
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return _register_supabase(body, db)


@router.post("/invite-user")
def invite_user(
    body: InviteUserRequest,
    current_user: CurrentUser = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    if body.role not in INVITE_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")

    existing = db.query(TenantUser).filter(TenantUser.email == body.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")

    if settings.effective_auth_mode == "local":
        if not body.password:
            raise HTTPException(status_code=400, detail="password required for local mode invites")
        user_id = new_local_user_id()
        db.add(
            TenantUser(
                tenant_id=current_user.tenant_id,
                supabase_user_id=user_id,
                email=body.email,
                password_hash=hash_password(body.password),
                role=UserRole(body.role),
                status=UserStatus.active,
                joined_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
        return {"message": f"User {body.email} added", "role": body.role}

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{settings.supabase_url}/auth/v1/invite",
            headers=_supabase_admin_headers(),
            json={"email": body.email},
        )
        if resp.status_code >= 400:
            raise HTTPException(status_code=400, detail=resp.text)
        invite_data = resp.json()
        user_id = invite_data.get("id") or invite_data.get("user", {}).get("id")

    if not user_id:
        raise HTTPException(status_code=500, detail="Failed to create invite user")

    db.add(
        TenantUser(
            tenant_id=current_user.tenant_id,
            supabase_user_id=user_id,
            email=body.email,
            role=UserRole(body.role),
            status=UserStatus.invited,
            invited_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return {"message": f"Invitation sent to {body.email}", "role": body.role}


@router.get("/me", response_model=AuthMeResponse)
def get_me(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tenant_user = (
        db.query(TenantUser)
        .filter(TenantUser.supabase_user_id == current_user.user_id)
        .first()
    )
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()

    return AuthMeResponse(
        user_id=current_user.user_id,
        email=current_user.email,
        tenant_id=str(current_user.tenant_id),
        company_name=tenant.company_name if tenant else "",
        role=current_user.role.value,
        status=tenant_user.status.value if tenant_user else "active",
        subscription_tier=tenant.subscription_tier.value if tenant else "trial",
        ai_narrative_enabled=tenant.ai_narrative_enabled if tenant else True,
    )


class ProvisionClientRequest(BaseModel):
    company_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8)
    initial_companies: list[str] = []


@router.post("/admin/provision-client")
def provision_client(
    body: ProvisionClientRequest,
    current_user: CurrentUser = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    """Admin endpoint: create a new client tenant + optionally seed companies.
    Returns tenant_id so you can run the SQL INSERT for r_companies."""
    if settings.effective_auth_mode == "local":
        result = _register_local(
            RegisterTenantRequest(
                company_name=body.company_name,
                full_name=body.email.split("@")[0].title(),
                email=body.email,
                password=body.password,
            ),
            db,
        )
    else:
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise HTTPException(status_code=503, detail="Supabase not configured")
        result = _register_supabase(
            RegisterTenantRequest(
                company_name=body.company_name,
                full_name=body.email.split("@")[0].title(),
                email=body.email,
                password=body.password,
            ),
            db,
        )

    tenant_id = result["tenant_id"]

    # Seed initial companies if provided
    if body.initial_companies:
        from models.rentals.models import RentalCompany
        for name in body.initial_companies:
            if name.strip():
                db.add(RentalCompany(
                    tenant_id=uuid.UUID(tenant_id),
                    company_name=name.strip(),
                    created_by=current_user.email,
                ))
        db.commit()

    return {
        **result,
        "companies_created": len(body.initial_companies),
        "sql_insert_example": (
            f"INSERT INTO r_companies (company_name, status, tenant_id, created_by) VALUES\n"
            + ",\n".join(
                f"  ('Company Name', 'active', '{tenant_id}', 'admin')"
                for _ in range(1)
            )
            + ";"
        ),
    }


class TenantDeleteResponse(BaseModel):
    tenant_id: str
    deleted_rows: dict[str, int]
    message: str


# ── FK-safe delete order ───────────────────────────────────────────────────────
# Tables are ordered deepest-child first so no FK constraint is violated.
# All tables except tenants/tenant_users carry tenant_id (RLS enforced).
# r_financial_uploads: no FK to tenants, but has ON DELETE CASCADE from r_companies,
#   so it is automatically deleted when r_companies rows are removed.
# capital_risk_events: association table (vendor_id, project_id, tenant_id).
_TENANT_TABLES_IN_ORDER: list[str] = [
    # ── Rental deepest leaves ────────────────────────────────────────────────
    "r_collections",            # child of r_invoices
    "r_invoices",               # child of r_leases, r_units
    "r_leases",                 # child of r_units, r_tenants
    "r_unit_inspection_checklist",
    "r_unit_inspection_photos",
    "r_unit_inspections",       # child of r_units
    "r_tenants",                # child of r_units
    "r_expenses",               # child of r_properties, r_companies
    "r_ownership",              # child of r_companies
    # r_financial_uploads cascades from r_companies (ON DELETE CASCADE FK)
    "r_units",                  # child of r_properties, r_companies
    "r_properties",             # child of r_companies
    "r_companies",
    "r_maintenance_requests",
    "r_receivables",
    "r_payables",
    # ── Construction / real-estate leaves ────────────────────────────────────
    "work_log_notes",           # child of work_log_entries
    "work_log_images",          # child of work_log_entries
    "daily_progress_photos",    # child of daily_progress_photo_entries
    "change_order_task_lines",  # child of change_orders
    "debt_drawdowns",           # child of financing_facilities
    "pay_applications",         # child of cost_trades
    "work_log_entries",
    "daily_progress_photo_entries",
    "change_orders",
    "cost_trades",
    "project_expenses",
    "permits",
    "inspections",
    "quality_checks",
    "schedule_tasks",
    "compliance_docs",
    "project_financial_snapshots",
    "project_roi_assumptions",
    "financing_facilities",
    "loans",
    # association table — references vendor_contractors + projects
    "capital_risk_events",
    "vendor_contractors",
    "projects",
    "entities",
    "litigation_claims",
    "tax_events",
    "land_parcels",
    "market_comps",
    # ── Old REIT / rental schema ─────────────────────────────────────────────
    "leases",                   # child of units (old schema)
    "units",                    # old reit rental units
    "rental_properties",
    "reit_assets",
    # ── New REIT module ──────────────────────────────────────────────────────
    "reit_units",               # child of reit_properties
    "reit_properties",          # child of reit_companies
    "reit_operating_expenses",
    "reit_loans",
    "reit_ownership",
    "reit_cash_flow_weeks",
    "reit_companies",
    # ── PropDev ─────────────────────────────────────────────────────────────
    "propdev_capital_calls",    # child of propdev_lots, propdev_companies
    "propdev_partners",
    "propdev_expenses",
    "propdev_lots",
    "propdev_companies",
    "propdev_loans",
    # ── Audit (delete before tenant row so FK is satisfied) ──────────────────
    "audit_logs",
]


@router.delete("/admin/tenant/{tenant_id}", response_model=TenantDeleteResponse)
def delete_tenant(
    tenant_id: str,
    current_user: CurrentUser = Depends(require_role("platform_admin")),
    db: Session = Depends(get_db),
):
    """
    Permanently delete a tenant and ALL of its data.

    Gate: platform_admin role only (must be set manually in DB — cannot
    be assigned via the invite-user endpoint).

    Safety:
    - Verify target tenant exists before touching anything.
    - Set Postgres RLS context to target tenant before issuing deletes.
    - Wrap the entire operation in a single transaction.
    - Return a table-by-table row-count summary for the audit trail.
    - Log the operation to audit_logs BEFORE committing (using caller's tenant_id).

    NEVER call this against AKK's tenant or any live LLC tenant without
    confirming on a disposable test tenant first.
    """
    try:
        target_id = uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid tenant_id UUID format")

    # tenants is excluded from RLS — query it directly
    target_tenant = db.query(Tenant).filter(Tenant.id == target_id).first()
    if not target_tenant:
        raise HTTPException(status_code=404, detail=f"Tenant {tenant_id} not found")

    deleted_rows: dict[str, int] = {}

    # Set Postgres RLS context to the target tenant so that all DELETEs below
    # are scoped through the tenant_isolation policy.  The caller's context was
    # already set by get_current_user(); we override it here for the delete pass.
    set_rls_tenant(db, tenant_id)

    for table in _TENANT_TABLES_IN_ORDER:
        # Verify the table actually exists (gracefully skip if a table hasn't
        # been created yet in this deployment, e.g. on a fresh staging DB).
        exists = db.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = :tbl"
            ),
            {"tbl": table},
        ).fetchone()
        if not exists:
            deleted_rows[table] = 0
            continue

        result = db.execute(
            text(f"DELETE FROM {table} WHERE tenant_id = :tid"),  # noqa: S608
            {"tid": target_id},
        )
        deleted_rows[table] = result.rowcount

    # tenant_users and tenants are excluded from RLS — delete them directly.
    tu_result = db.execute(
        text("DELETE FROM tenant_users WHERE tenant_id = :tid"),
        {"tid": target_id},
    )
    deleted_rows["tenant_users"] = tu_result.rowcount

    t_result = db.execute(
        text("DELETE FROM tenants WHERE id = :tid"),
        {"tid": target_id},
    )
    deleted_rows["tenants"] = t_result.rowcount

    # Audit the deletion itself — use the caller's tenant_id, not the deleted one.
    db.add(AuditLog(
        tenant_id=current_user.tenant_id,
        user_id=current_user.user_id,
        action="tenant_deletion",
        endpoint=f"/api/auth/admin/tenant/{tenant_id}",
        success=True,
        purpose=f"deleted_tenant:{tenant_id}",
    ))

    db.commit()

    return TenantDeleteResponse(
        tenant_id=tenant_id,
        deleted_rows=deleted_rows,
        message=f"Tenant '{target_tenant.company_name}' and all associated data deleted.",
    )


@router.get("/team")
def list_team(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    users = (
        db.query(TenantUser)
        .filter(TenantUser.tenant_id == current_user.tenant_id)
        .order_by(TenantUser.created_at)
        .all()
    )
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "role": u.role.value,
            "status": u.status.value,
            "invited_at": u.invited_at.isoformat() if u.invited_at else None,
            "joined_at": u.joined_at.isoformat() if u.joined_at else None,
        }
        for u in users
    ]
