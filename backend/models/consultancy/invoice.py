import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ConsultancyInvoice(Base):
    """One client invoice for a Consultancy company — flat, per-row table.

    Unlike QBArAgingSnapshot/Row (point-in-time snapshots for trend history),
    invoices carry their own invoice_date/collected_date, so Billed-vs-Collected
    and Realization Rate trends are derived directly from this table without
    needing separate monthly snapshots. Re-uploading replaces all rows for the
    company (mirrors ConsultancyFinancialUpload's upsert-per-company pattern).
    """
    __tablename__ = "consultancy_invoices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("consultancy_companies.id", ondelete="CASCADE"), nullable=False, index=True,
    )

    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    collected_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    collected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Optional — only present when the source roster includes a standard/list billing
    # rate alongside the actual billed amount; powers the Realization Rate chart.
    standard_rate_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)

    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (Index("ix_consultancy_invoices_tenant_company", "tenant_id", "company_id"),)
