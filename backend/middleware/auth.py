import uuid as _uuid
from datetime import datetime, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from config import settings
from database import get_db, set_rls_tenant
from models.tenancy import Tenant, TenantUser, UserRole, UserStatus
from services.local_auth import decode_local_token

WRITE_ROLES = {UserRole.owner, UserRole.admin, UserRole.cfo, UserRole.controller}


class CurrentUser:
    def __init__(self, user_id: str, tenant_id, role: UserRole, email: str):
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.role = role
        self.email = email

    def to_dict(self):
        return {
            "user_id": self.user_id,
            "tenant_id": str(self.tenant_id),
            "role": self.role.value,
            "email": self.email,
        }


def _decode_token(token: str) -> dict:
    if settings.effective_auth_mode == "local":
        try:
            return decode_local_token(token)
        except jwt.PyJWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid or expired token: {exc}",
            ) from exc

    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        ) from exc


async def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> CurrentUser:
    auth_header = request.headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = auth_header.split(" ", 1)[1]
    payload = _decode_token(token)
    user_id = payload.get("sub")
    email = payload.get("email", "")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub claim",
        )

    # tenant_users is intentionally excluded from RLS (it's the auth lookup table),
    # so this query works before the RLS context is set.
    tenant_user = (
        db.query(TenantUser)
        .filter(TenantUser.supabase_user_id == user_id)
        .first()
    )

    if not tenant_user:
        # Auto-provision: new Supabase user logging in for the first time.
        # Create a private tenant so they can start adding companies immediately.
        # Only do this in Supabase mode — local mode requires explicit registration.
        if settings.effective_auth_mode != "supabase":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User has no tenant membership",
            )
        company_label = email.split("@")[0].replace(".", " ").replace("_", " ").title()
        tenant = Tenant(id=_uuid.UUID(user_id), company_name=f"{company_label} Co.")
        db.add(tenant)
        db.flush()
        tenant_user = TenantUser(
            tenant_id=tenant.id,
            supabase_user_id=user_id,
            email=email,
            role=UserRole.owner,
            status=UserStatus.active,
            joined_at=datetime.now(timezone.utc),
        )
        db.add(tenant_user)
        db.commit()
        db.refresh(tenant_user)

    if tenant_user.status == UserStatus.disabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )

    # Set Postgres RLS tenant context for this session.
    # FastAPI caches Depends(get_db) per request, so `db` here is the same
    # Session object that will be injected into the route handler. Any queries
    # the handler runs will see only this tenant's rows.
    set_rls_tenant(db, str(tenant_user.tenant_id))

    return CurrentUser(
        user_id=user_id,
        tenant_id=tenant_user.tenant_id,
        role=tenant_user.role,
        email=tenant_user.email or email,
    )


def require_role(*allowed_roles: str):
    allowed = {UserRole(r) for r in allowed_roles}

    async def _check(current_user: Annotated[CurrentUser, Depends(get_current_user)]):
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role.value}' not permitted for this action",
            )
        return current_user

    return _check


def require_write_access():
    return require_role("owner", "admin", "cfo", "controller")
