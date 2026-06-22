import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ExpenseCategory(str, enum.Enum):
    expense = "expense"
    refund = "refund"
    recurring_expense = "recurring_expense"


class PaymentMode(str, enum.Enum):
    ach = "ach"
    check = "check"
    wire = "wire"
    credit_card = "credit_card"
    cash = "cash"
    other = "other"


class ProjectExpense(Base):
    """
    Line-item expense tracking. Division/subdivision/line_item are stored as text
    matching the values in CostTrade (csi_division_code / division_label) for this
    project — no separate division FK table exists.
    """
    __tablename__ = "project_expenses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)

    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[ExpenseCategory] = mapped_column(
        Enum(ExpenseCategory, name="expense_category"), nullable=False
    )

    # SOV division breadcrumb — text matching CostTrade values (no FK)
    division: Mapped[str | None] = mapped_column(String(255), nullable=True)       # e.g. "General Conditions"
    subdivision: Mapped[str | None] = mapped_column(String(255), nullable=True)    # e.g. "Temporary Site Facilities"
    line_item: Mapped[str | None] = mapped_column(String(255), nullable=True)      # e.g. "Field Office - Utilities"

    expense_type: Mapped[str | None] = mapped_column(String(100), nullable=True)  # free text — e.g. "Supplies"
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    payable_to: Mapped[str] = mapped_column(String(255), nullable=False)
    mode_of_payment: Mapped[PaymentMode | None] = mapped_column(
        Enum(PaymentMode, name="payment_mode"), nullable=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    receipt_file_reference: Mapped[str | None] = mapped_column(String(512), nullable=True)

    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    project: Mapped["Project"] = relationship("Project", back_populates="expenses")

    __table_args__ = (
        Index("ix_project_expenses_tenant_project", "tenant_id", "project_id"),
        Index("ix_project_expenses_tenant_date", "tenant_id", "expense_date"),
    )
