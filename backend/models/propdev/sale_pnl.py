"""
Provisional / Actual Sale P&L record -- the source of truth behind the
Partner ROI tab's "Summary Showing Partners Share of Profit/Loss on Sale
of Property" figures.

One entity can have many `provisional` rows over time (re-estimates as a
deal develops) but at most one `actual` row ever (the real closed sale) --
enforced by a partial unique index on company_id where status='actual'.
View logic (see services/propdev_sale_pnl.py get_current_sale_pnl): actual
row wins if one exists, otherwise the most recent provisional row is used
and labeled "Projected". Provisional and actual figures are never blended.
"""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, Text, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevSalePnl(Base):
    __tablename__ = "propdev_sale_pnl"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False)  # 'provisional' | 'actual'

    sale_consideration: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    total_lots: Mapped[int | None] = mapped_column(nullable=True)
    land_cost: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    hard_cost: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    soft_cost: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    title_company_charges: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    other_charges: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    property_tax: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    loan_processing_charges: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    professional_charges: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    legal_fees: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    interest_on_mortgage_loan: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    # Fraction (0.09 = 9%), applied to (land_cost + hard_cost + soft_cost) --
    # see services/propdev_sale_pnl.py compute_sale_pnl_totals for the formula
    # (verified against the ABC Ventures LLC reference P&L).
    management_fee_pct: Mapped[float] = mapped_column(Numeric(6, 4), default=0, nullable=False)
    sale_commission_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sale_commission_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany")

    __table_args__ = (
        CheckConstraint("status IN ('provisional', 'actual')", name="ck_propdev_sale_pnl_status"),
        Index("ix_propdev_sale_pnl_tenant", "tenant_id"),
        Index("ix_propdev_sale_pnl_company", "company_id"),
        # At most one actual row per entity, ever. Many provisional rows are fine
        # (re-estimates over time) -- ordinary index above, not this partial one,
        # covers lookups for those.
        Index(
            "uniq_propdev_sale_pnl_actual_per_company",
            "company_id",
            unique=True,
            postgresql_where=text("status = 'actual'"),
            sqlite_where=text("status = 'actual'"),
        ),
    )
