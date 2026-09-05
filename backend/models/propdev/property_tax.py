import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class PropDevPropertyTax(Base):
    __tablename__ = "propdev_property_tax"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=True, index=True)

    entity_name: Mapped[str] = mapped_column(String(255), nullable=False)
    property_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tax_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tax_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    tax_with_penalty: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    paid_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    balance: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_status: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_propdev_property_tax_tenant", "tenant_id"),
        Index("ix_propdev_property_tax_company", "company_id"),
    )
