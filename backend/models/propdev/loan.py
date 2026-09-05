import uuid
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import Date, DateTime, ForeignKey, Index, JSON, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevLoan(Base):
    __tablename__ = "propdev_loans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)

    bank: Mapped[str] = mapped_column(String(255), nullable=False)
    # Property / Building name from Bank Loan Information Excel (per loan).
    property_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    loan_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    account_no: Mapped[str | None] = mapped_column(String(100), nullable=True)

    loan_amount: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    balance: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    interest_rate: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False)
    emi: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)

    maturity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    emi_day: Mapped[int | None] = mapped_column(default=15, nullable=True)

    lender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lender_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lender_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    bank_account: Mapped[str | None] = mapped_column(String(255), nullable=True)
    emi_status: Mapped[str] = mapped_column(String(50), default="Current", nullable=False)

    # Loan Management (Tab 2)
    insurance_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    refinancing_status: Mapped[str | None] = mapped_column(String(50), default="Not Started", nullable=True)
    refinancing_notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    loan_purpose: Mapped[str | None] = mapped_column(String(100), nullable=True)
    maturity_checklist: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany", back_populates="loans")

    __table_args__ = (
        Index("ix_propdev_loans_tenant", "tenant_id"),
        Index("ix_propdev_loans_company", "company_id"),
    )
