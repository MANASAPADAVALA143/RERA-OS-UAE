"""Per-partner split of a propdev_capital_calls row.

Net-new: propdev_capital_calls was already partner-scoped for manual/Excel-import
calls (one row per company+partner+period). This table exists specifically for
auto-generated calls (source_type='lot_reinvestment'), where a single capital call
amount needs to be split across every active partner by ownership share_percent at
the moment the call is raised.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevPartnerCapitalContribution(Base):
    __tablename__ = "propdev_partner_capital_contributions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    capital_call_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("propdev_capital_calls.id"), nullable=False, index=True,
    )
    partner_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_partners.id"), nullable=False, index=True)

    this_call_amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="Pending", nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    capital_call: Mapped["PropDevCapitalCall"] = relationship("PropDevCapitalCall")
    partner: Mapped["PropDevPartner"] = relationship("PropDevPartner")

    __table_args__ = (
        Index("ix_propdev_partner_capital_contributions_tenant", "tenant_id"),
        Index("ix_propdev_partner_capital_contributions_call", "capital_call_id"),
        Index("ix_propdev_partner_capital_contributions_partner", "partner_id"),
    )
