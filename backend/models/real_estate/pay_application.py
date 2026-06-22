import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PayAppStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    approved = "approved"
    paid = "paid"
    rejected = "rejected"


class PayApplication(Base):
    """
    AIA G702-style pay application — one record per billing period per subcontractor.
    Computed fields (total_completed_stored, retainage_amount, etc.) are stored
    at save time so the record is a self-contained billing snapshot.
    """
    __tablename__ = "pay_applications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)

    pay_app_number: Mapped[str] = mapped_column(String(50), nullable=False)     # e.g. "001"
    subcontractor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)

    # G702 line items (D–K)
    scheduled_value: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)     # D: original contract value
    prev_completed: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)      # E: completed from previous apps
    curr_completed: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)      # F: completed this period
    stored_materials: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)    # G3: stored materials
    total_completed_stored: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)  # G: E+F+stored
    retainage_pct: Mapped[float] = mapped_column(Numeric(5, 4), default=0.10, nullable=False)    # e.g. 0.10 = 10%
    retainage_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)   # H
    total_less_retainage: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)  # I: G-H
    previous_payments: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)  # J
    current_payment_due: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)  # K: I-J

    status: Mapped[PayAppStatus] = mapped_column(
        Enum(PayAppStatus, name="pay_app_status"), default=PayAppStatus.draft, nullable=False
    )
    submitted_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    project: Mapped["Project"] = relationship("Project", back_populates="pay_applications")

    __table_args__ = (Index("ix_pay_applications_tenant_project", "tenant_id", "project_id"),)
