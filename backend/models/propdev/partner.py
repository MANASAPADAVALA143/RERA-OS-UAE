import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevPartner(Base):
    __tablename__ = "propdev_partners"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    partner_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "Class A", "Class B"

    # Numeric(6,4) overflows at exactly 100.0000% (single-owner rows) — widened to match the
    # schema_patches.py ALTER that already runs against the live table.
    share_percent: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False)
    capital_contributed: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    capital_contributed_estimated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    distributions_received: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    preferred_return: Mapped[float] = mapped_column(Numeric(6, 4), default=0, nullable=False)

    status: Mapped[str] = mapped_column(String(50), default="Active", nullable=False)

    entity_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    property_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    property_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    entity_line: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cost_basis: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    book_value: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    fair_market_value: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    existing_debt: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany", back_populates="partners")

    __table_args__ = (
        Index("ix_propdev_partners_tenant", "tenant_id"),
        Index("ix_propdev_partners_company", "company_id"),
    )
