"""
Lot Reinvestment record — Phase 2 of the Capital Structure tab (Section D:
Lot Reinvestment Tracker). Net-new; no prior table for this data existed.

One row per capital-call-driven reinvestment round for a company: how much
was raised, where it went (new lots vs improvements), what's left undeployed,
and the board's sign-off on that plan.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevLotReinvestment(Base):
    __tablename__ = "propdev_lot_reinvestments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)

    period: Mapped[str] = mapped_column(String(100), nullable=False)

    capital_raised: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    deployed_to_lots: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    deployed_to_improvements: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    # Not stored as a column -- always (capital_raised - deployed_to_lots - deployed_to_improvements)
    # at read time, so it can never drift out of sync with the other three fields.

    expected_return_per_lot: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)

    # "pending" | "approved" | "rejected"
    board_approval_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany")

    __table_args__ = (
        Index("ix_propdev_lot_reinvestments_tenant", "tenant_id"),
        Index("ix_propdev_lot_reinvestments_company", "company_id"),
    )
