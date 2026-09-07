import uuid
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevCompany(Base):
    __tablename__ = "propdev_companies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    property_name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Lot inventory
    total_lots: Mapped[int] = mapped_column(default=0, nullable=False)
    total_acres: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)

    # Revenue & costs
    sale_consideration: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    land_cost: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    hard_cost: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    soft_cost: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    # Additional expenses (all from Expense Dashboard)
    title_charges: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    other_charges: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    property_tax: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    loan_processing: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    professional_charges: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    legal_fees: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    interest_on_loan: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    # Fees & rates
    management_fee_rate: Mapped[float] = mapped_column(Numeric(6, 4), default=0.09, nullable=False)
    commission_rate: Mapped[float] = mapped_column(Numeric(6, 4), default=0.045, nullable=False)
    commission: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)

    # Cash position
    cash_available: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    # Balance-sheet extras (single-property land dev)
    interest_capitalised: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    improvements: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)

    # Yearly financial history as JSON dicts keyed by year string
    yearly_pl: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    yearly_bs: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    yearly_cf: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    status: Mapped[str | None] = mapped_column(String(20), nullable=True, server_default="active")

    # Property Profile — identity
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(60), nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    county: Mapped[str | None] = mapped_column(String(120), nullable=True)
    legal_description: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    # Property Profile — land details
    land_use_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    zoning: Mapped[str | None] = mapped_column(String(100), nullable=True)
    current_status: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Property Profile — ownership history
    previous_owner_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    previous_owner_entity: Mapped[str | None] = mapped_column(String(255), nullable=True)
    acquisition_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    acquisition_price: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    acquisition_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    title_company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    deed_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Property Profile — tax information
    tax_parcel_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    property_tax_annual: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    tax_assessment_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tax_assessed_value: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    tax_exemptions: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tax_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    lots: Mapped[list["PropDevLot"]] = relationship("PropDevLot", back_populates="company", cascade="all, delete-orphan")
    partners: Mapped[list["PropDevPartner"]] = relationship("PropDevPartner", back_populates="company", cascade="all, delete-orphan")
    loans: Mapped[list["PropDevLoan"]] = relationship("PropDevLoan", back_populates="company", cascade="all, delete-orphan")
    capital_calls: Mapped[list["PropDevCapitalCall"]] = relationship("PropDevCapitalCall", back_populates="company", cascade="all, delete-orphan")
    expenses: Mapped[list["PropDevExpense"]] = relationship("PropDevExpense", back_populates="company", cascade="all, delete-orphan")
    property_improvements: Mapped[list["PropDevPropertyImprovement"]] = relationship(
        "PropDevPropertyImprovement", back_populates="company", cascade="all, delete-orphan",
    )
    distributions: Mapped[list["PropDevDistribution"]] = relationship(
        "PropDevDistribution", back_populates="company", cascade="all, delete-orphan",
    )

    __table_args__ = (Index("ix_propdev_companies_tenant", "tenant_id"),)
