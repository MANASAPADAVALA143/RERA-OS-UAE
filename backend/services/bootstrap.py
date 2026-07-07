"""Bootstrap local demo tenant + seed data on first run (no Supabase required)."""
import logging

from sqlalchemy.orm import Session

from config import settings
from models.tenancy import Tenant, TenantUser, UserRole, UserStatus
from services.local_auth import DEMO_COMPANY, DEMO_EMAIL, DEMO_PASSWORD, hash_password, new_local_user_id

logger = logging.getLogger("estatecfo")


def ensure_local_demo(db: Session) -> None:
    if settings.effective_auth_mode != "local":
        return

    from database import is_sqlite

    existing = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
    if existing:
        # Only seed locally — skip over-the-wire RDS seeding on every restart
        if is_sqlite:
            from scripts.seed_rentals import seed as seed_rentals
            seed_rentals()
        return

    logger.info("Creating local demo tenant: %s / %s", DEMO_EMAIL, DEMO_PASSWORD)

    tenant = Tenant(company_name=DEMO_COMPANY)
    db.add(tenant)
    db.flush()

    user_id = new_local_user_id()
    db.add(
        TenantUser(
            tenant_id=tenant.id,
            supabase_user_id=user_id,
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            full_name="Primary Operator",
            role=UserRole.owner,
            status=UserStatus.active,
        )
    )
    db.commit()

    # Skip heavy demo seeding on PostgreSQL — too slow over network
    if is_sqlite:
        from scripts.seed_demo_tenant import seed
        seed(tenant.id, skip_if_seeded=True)

        from scripts.seed_rentals import seed as seed_rentals
        seed_rentals()
