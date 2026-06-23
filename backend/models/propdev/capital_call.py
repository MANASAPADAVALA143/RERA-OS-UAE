import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevCapitalCall(Base):
    __tablename__ = "propdev_capital_calls"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)
    partner_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_partners.id"), nullable=False, index=True)

    period: Mapped[str] = mapped_column(String(100), nullable=False)

    share_percent: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False)
    total_call_amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    partner_share: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)

    old_dues: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    total_due: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    amount_received: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(String(50), default="Outstanding", nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany", back_populates="capital_calls")
    partner: Mapped["PropDevPartner"] = relationship("PropDevPartner")

    __table_args__ = (
        Index("ix_propdev_capital_calls_tenant", "tenant_id"),
        Index("ix_propdev_capital_calls_company", "company_id"),
        Index("ix_propdev_capital_calls_partner", "partner_id"),
    )
