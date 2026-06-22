import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Loan(Base):
    __tablename__ = "loans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=True, index=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    property_name: Mapped[str] = mapped_column(String(255), nullable=False)
    loan_bank_name: Mapped[str] = mapped_column(String(255), nullable=False)
    loan_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_account_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    loan_amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    loan_interest_rate: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)   # e.g. 0.075 = 7.5%
    loan_emi: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    lender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lender_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lender_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    loan_maturity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_balance_as_of: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    loan_balance_as_of_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_emi_day: Mapped[int | None] = mapped_column(Integer, nullable=True)   # day-of-month 1–31
    loan_deduction_bank_account: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # DSCR/LTV fields — added for Lender Risk (Construction + Rental context)
    noi_annual: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    current_property_value: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    # 'construction' (default) or 'rental' — lets the Lender Risk cross-module view distinguish context
    context_type: Mapped[str | None] = mapped_column(String(20), nullable=True, default="construction")
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    entity: Mapped["Entity | None"] = relationship("Entity")  # type: ignore[name-defined]

    __table_args__ = (Index("ix_loans_tenant", "tenant_id"),)
