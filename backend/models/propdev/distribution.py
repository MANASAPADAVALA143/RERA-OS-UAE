"""
Per-event distribution record — Phase 2 of the Capital Structure tab
(Distribution Waterfall Reinvest/Payout toggle).

Deliberately separate from PropDevCapitalCall: capital calls are inbound
(partner -> company, "we're calling for money"); distributions are outbound
(company -> partner, "here's your payout/return"). They are opposite cash
flows and were never the same table, despite superficially similar shape.

`propdev_partners.distributions_received` remains a lump-sum running total
(kept in sync, not replaced) so existing Partner ROI Summary / Ownership tab
code that reads it does not need to change; this table adds per-event history
and the reinvest-vs-payout decision, which a single running total can't hold.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevDistribution(Base):
    __tablename__ = "propdev_distributions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)
    partner_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_partners.id"), nullable=False, index=True)

    period: Mapped[str] = mapped_column(String(100), nullable=False)
    distribution_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)

    # "reinvest" | "payout" -- a per-event decision, not a fixed partner attribute:
    # the same partner can reinvest one round and take payout the next.
    distribution_action: Mapped[str] = mapped_column(String(20), default="payout", nullable=False)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany", back_populates="distributions")
    partner: Mapped["PropDevPartner"] = relationship("PropDevPartner")

    __table_args__ = (
        Index("ix_propdev_distributions_tenant", "tenant_id"),
        Index("ix_propdev_distributions_company", "company_id"),
        Index("ix_propdev_distributions_partner", "partner_id"),
    )
