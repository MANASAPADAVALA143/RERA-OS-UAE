import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ConsultancyFinancialUpload(Base):
    """Parsed P&L / Balance Sheet / Cash Flow per Consultancy company (mirrors propdev_financial_uploads)."""
    __tablename__ = "consultancy_financial_uploads"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("consultancy_companies.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    filename: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    pl_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bs_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cf_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_range: Mapped[str | None] = mapped_column(String(500), nullable=True)
    years: Mapped[list | None] = mapped_column(JSON, nullable=True)
    periods: Mapped[list | None] = mapped_column(JSON, nullable=True)
    pl_data: Mapped[list | None] = mapped_column(JSON, nullable=True)
    bs_data: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cf_data: Mapped[list | None] = mapped_column(JSON, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (Index("ix_consultancy_fin_uploads_tenant_company", "tenant_id", "company_id"),)
