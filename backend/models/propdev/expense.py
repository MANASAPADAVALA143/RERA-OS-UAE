import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevExpense(Base):
    __tablename__ = "propdev_expenses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)

    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    expense_type: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)

    vendor: Mapped[str] = mapped_column(String(255), nullable=False)
    invoice_no: Mapped[str | None] = mapped_column(String(100), nullable=True)

    amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="Paid", nullable=False)

    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany", back_populates="expenses")

    __table_args__ = (
        Index("ix_propdev_expenses_tenant", "tenant_id"),
        Index("ix_propdev_expenses_company", "company_id"),
        Index("ix_propdev_expenses_category", "category"),
    )
