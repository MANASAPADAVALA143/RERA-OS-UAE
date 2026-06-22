import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class QCStatus(str, enum.Enum):
    passed = "passed"
    failed = "failed"
    pending = "pending"


class QualityCheck(Base):
    __tablename__ = "quality_checks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    # linked_sov_id references cost_trades.id — same SOV division reference as the SOV section
    linked_sov_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("cost_trades.id"), nullable=True, index=True)
    qc_date: Mapped[date | None] = mapped_column(Date, nullable=True)      # date the QC was performed
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)   # start of the work period this QC covers
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)     # end of the work period this QC covers
    # pct_complete = completion of the underlying WORK being checked at time of QC (not the QC itself)
    pct_complete: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    qc_performed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)          # primary observation notes
    materials_notes: Mapped[str | None] = mapped_column(Text, nullable=True) # materials/spec details (e.g. "used cpvc Sch 80 pipe")
    status: Mapped[QCStatus] = mapped_column(Enum(QCStatus, name="qc_status"), nullable=False, default=QCStatus.pending)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    linked_sov: Mapped["CostTrade"] = relationship("CostTrade", foreign_keys=[linked_sov_id])

    __table_args__ = (
        Index("ix_quality_checks_tenant_project", "tenant_id", "project_id"),
        Index("ix_quality_checks_linked_sov", "linked_sov_id"),
    )


# Avoid circular imports — CostTrade is imported at runtime via string ref in relationship
from models.real_estate.construction_cost import CostTrade  # noqa: E402, F401
