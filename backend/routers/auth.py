import threading
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_role
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
