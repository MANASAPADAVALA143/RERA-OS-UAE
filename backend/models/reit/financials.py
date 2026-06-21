import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ReitOpexCategory(str, enum.Enum):
    property_management = "property_management"
    utilities = "utilities"
    repairs_maintenance = "repairs_maintenance"
    insurance = "insurance"
    taxes = "taxes"
    administrative = "administrative"
    debt_service = "debt_service"


class ReitRateType(str, enum.Enum):
    fixed = "fixed"
    floating = "floating"


class ReitPartnerRole(str, enum.Enum):
    general_partner = "general_partner"
    limited_partner = "limited_partner"
    sole_owner = "sole_owner"


class ReitOperatingExpense(Base):
    __tablename__ = "reit_operating_expenses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("reit_properties.id"), nullable=False, index=True)
    period_month: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[ReitOpexCategory] = mapped_column(Enum(ReitOpexCategory, name="reit_opex_category"), nullable=False)
    sub_head: Mapped[str] = mapped_column(String(255), nullable=False)
    monthly_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    property: Mapped["ReitProperty"] = relationship("ReitProperty", back_populates="operating_expenses")

    __table_args__ = (Index("ix_reit_opex_tenant_property_period", "tenant_id", "property_id", "period_month"),)


class ReitLoan(Base):
    __tablename__ = "reit_loans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("reit_properties.id"), nullable=False, unique=True, index=True)
    lender_name: Mapped[str] = mapped_column(String(255), nullable=False)
    original_loan_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    current_principal_balance: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    interest_rate_annual: Mapped[float] = mapped_column(Numeric(8, 4), default=0, nullable=False)
    rate_type: Mapped[ReitRateType] = mapped_column(Enum(ReitRateType, name="reit_rate_type"), nullable=False)
    origination_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    maturity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amortization_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_principal: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    monthly_interest: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    ltv_at_origination: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    property: Mapped["ReitProperty"] = relationship("ReitProperty", back_populates="loan")


class ReitOwnership(Base):
    __tablename__ = "reit_ownership"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("reit_properties.id"), nullable=False, index=True)
    partner_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[ReitPartnerRole] = mapped_column(Enum(ReitPartnerRole, name="reit_partner_role"), nullable=False)
    ownership_pct: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False)
    capital_contributed: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    preferred_return_pct: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    property: Mapped["ReitProperty"] = relationship("ReitProperty", back_populates="ownership")

    __table_args__ = (Index("ix_reit_ownership_tenant_property", "tenant_id", "property_id"),)


class ReitCashFlowWeek(Base):
    __tablename__ = "reit_cash_flow_weeks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("reit_properties.id"), nullable=False, index=True)
    week_number: Mapped[int] = mapped_column(Integer, nullable=False)
    week_start_date: Mapped[date] = mapped_column(Date, nullable=False)
    opening_balance: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    inflows: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    outflows: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    alert_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    property: Mapped["ReitProperty"] = relationship("ReitProperty", back_populates="cash_flow_weeks")

    __table_args__ = (
        Index("ix_reit_cash_flow_weeks_property_week", "property_id", "week_number", unique=True),
    )
