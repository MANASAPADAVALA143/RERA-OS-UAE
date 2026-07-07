import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class SubscriptionTier(str, enum.Enum):
    trial = "trial"
    standard = "standard"
    enterprise = "enterprise"


class UserRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    cfo = "cfo"
    controller = "controller"
    analyst = "analyst"
    viewer = "viewer"
    # CA firm staff — cross-verify KPIs before client delivery; firm-wide tenant access.
    internal_reviewer = "internal_reviewer"
    # Client company portal login — read-oriented; never sees KPI breakdown tools.
    client = "client"
    # Cross-tenant platform administrator — can delete tenants.
    # Must be set manually in the DB; cannot be assigned via invite-user endpoint.
    platform_admin = "platform_admin"


class UserStatus(str, enum.Enum):
    active = "active"
    invited = "invited"
    disabled = "disabled"


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    subscription_tier: Mapped[SubscriptionTier] = mapped_column(
        Enum(SubscriptionTier, name="subscription_tier", native_enum=False),
        default=SubscriptionTier.trial,
        nullable=False,
    )
    ai_narrative_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    users: Mapped[list["TenantUser"]] = relationship("TenantUser", back_populates="tenant")


class TenantUser(Base):
    """
    Membership + role mapping. v1 assumes one user belongs to exactly one tenant.
    Multi-tenant-per-user is a deliberate v2 deferral.
    """
    __tablename__ = "tenant_users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True
    )
    supabase_user_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False), nullable=False
    )
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status", native_enum=False), default=UserStatus.active, nullable=False
    )
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="users")

    __table_args__ = (
        Index("ix_tenant_users_tenant_email", "tenant_id", "email"),
    )
