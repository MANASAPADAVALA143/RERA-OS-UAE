from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_role
from models.tenancy import Tenant

router = APIRouter(prefix="/api/tenant", tags=["tenant"])


class TenantSettingsUpdate(BaseModel):
    company_name: str | None = None
    ai_narrative_enabled: bool | None = None


@router.get("/settings")
def get_tenant_settings(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        return {}
    return {
        "company_name": tenant.company_name,
        "subscription_tier": tenant.subscription_tier.value,
        "ai_narrative_enabled": tenant.ai_narrative_enabled,
    }


@router.patch("/settings")
def update_tenant_settings(
    body: TenantSettingsUpdate,
    current_user: CurrentUser = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        return {"error": "Tenant not found"}

    if body.company_name is not None:
        tenant.company_name = body.company_name
    if body.ai_narrative_enabled is not None:
        tenant.ai_narrative_enabled = body.ai_narrative_enabled

    db.commit()
    return {
        "company_name": tenant.company_name,
        "subscription_tier": tenant.subscription_tier.value,
        "ai_narrative_enabled": tenant.ai_narrative_enabled,
    }
