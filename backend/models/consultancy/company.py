import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ConsultancyCompany(Base):
    """A consulting/staffing business tracked in the Consultancy & Outsourcing segment.

    Phase 1 is financials-only (P&L/BS/CF upload) — Clients/Workforce/Deployments/
    Billing & Collections (Phase 2) will hang off this company via their own tables
    once real employee-deployment data is available.
    """
    __tablename__ = "consultancy_companies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    cash_available: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True, server_default="active")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_consultancy_companies_tenant", "tenant_id"),)
