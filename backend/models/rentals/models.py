import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, Enum, ForeignKey, Index,
    Integer, JSON, Numeric, String, Text, Uuid, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class RentalUnitStatus(str, enum.Enum):
    occupied = "occupied"
    vacant = "vacant"
    notice = "notice"
    reserved = "reserved"
    maintenance_hold = "maintenance_hold"


class RentalLeaseStatus(str, enum.Enum):
    active = "active"
    notice_given = "notice_given"
    expired = "expired"
    renewed = "renewed"


class RentalExpenseCategory(str, enum.Enum):
    management = "management"
    maintenance = "maintenance"
    utilities = "utilities"
    cam = "cam"
    repairs = "repairs"
    tax = "tax"
    insurance = "insurance"
    other = "other"


class RentalPartnerRole(str, enum.Enum):
    general_partner = "general_partner"
    limited_partner = "limited_partner"
    sole_owner = "sole_owner"


class RentalCompany(Base):
    __tablename__ = "r_companies"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True, server_default="active")
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    collected_this_month: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    vacancy_loss: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    monthly_rent_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    gross_potential_rent: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    last_sync_month: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_sync_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    occupied_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_units: Mapped[int | None] = mapped_column(Integer, nullable=True)

    properties: Mapped[list["RentalProp"]] = relationship("RentalProp", back_populates="company", cascade="all, delete-orphan")
    units: Mapped[list["RentalUnit"]] = relationship("RentalUnit", back_populates="company", cascade="all, delete-orphan")
    expenses: Mapped[list["RentalExpense"]] = relationship("RentalExpense", back_populates="company", cascade="all, delete-orphan")
    ownership: Mapped[list["RentalOwnership"]] = relationship("RentalOwnership", back_populates="company", cascade="all, delete-orphan")

    __table_args__ = (Index("ix_r_companies_tenant", "tenant_id"),)


class RentalProp(Base):
    __tablename__ = "r_properties"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_companies.id"), nullable=False, index=True)
    property_name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    property_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company: Mapped["RentalCompany"] = relationship("RentalCompany", back_populates="properties")
    units: Mapped[list["RentalUnit"]] = relationship("RentalUnit", back_populates="property")

    __table_args__ = (Index("ix_r_properties_tenant_company", "tenant_id", "company_id"),)


class RentalUnit(Base):
    __tablename__ = "r_units"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_properties.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_companies.id"), nullable=False, index=True)
    unit_number: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[RentalUnitStatus] = mapped_column(Enum(RentalUnitStatus, name="rental_unit_status"), nullable=False)
    monthly_rent: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    status_changed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    rent_history: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    vacancy_loss: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    property: Mapped["RentalProp"] = relationship("RentalProp", back_populates="units")
    company: Mapped["RentalCompany"] = relationship("RentalCompany", back_populates="units")
    r_tenants: Mapped[list["RentalTenant"]] = relationship("RentalTenant", back_populates="unit")
    leases: Mapped[list["RentalLease"]] = relationship("RentalLease", back_populates="unit")
    invoices: Mapped[list["RentalInvoice"]] = relationship("RentalInvoice", back_populates="unit")

    __table_args__ = (Index("ix_r_units_tenant_company", "tenant_id", "company_id"),)


class RentalTenant(Base):
    __tablename__ = "r_tenants"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_units.id"), nullable=False, index=True)
    tenant_name: Mapped[str] = mapped_column(String(255), nullable=False)
    tenant_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tenant_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    unit: Mapped["RentalUnit"] = relationship("RentalUnit", back_populates="r_tenants")

    __table_args__ = (Index("ix_r_tenants_tenant_unit", "tenant_id", "unit_id"),)


class RentalLease(Base):
    __tablename__ = "r_leases"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_units.id"), nullable=False, index=True)
    r_tenant_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_tenants.id"), nullable=True, index=True)
    lease_start: Mapped[date] = mapped_column(Date, nullable=False)
    lease_end: Mapped[date] = mapped_column(Date, nullable=False)
    escalation_pct_annual: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    deposit_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    notice_period_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lock_in_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[RentalLeaseStatus] = mapped_column(Enum(RentalLeaseStatus, name="rental_lease_status"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    unit: Mapped["RentalUnit"] = relationship("RentalUnit", back_populates="leases")
    rtenant: Mapped["RentalTenant | None"] = relationship("RentalTenant")
    invoices: Mapped[list["RentalInvoice"]] = relationship("RentalInvoice", back_populates="lease")

    __table_args__ = (Index("ix_r_leases_tenant_unit", "tenant_id", "unit_id"),)


class RentalInvoice(Base):
    __tablename__ = "r_invoices"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_units.id"), nullable=False, index=True)
    lease_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_leases.id"), nullable=False, index=True)
    billing_period: Mapped[date] = mapped_column(Date, nullable=False)
    amount_billed: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    unit: Mapped["RentalUnit"] = relationship("RentalUnit", back_populates="invoices")
    lease: Mapped["RentalLease"] = relationship("RentalLease", back_populates="invoices")
    collections: Mapped[list["RentalCollection"]] = relationship("RentalCollection", back_populates="invoice")

    __table_args__ = (Index("ix_r_invoices_tenant_unit", "tenant_id", "unit_id"),)


class RentalCollection(Base):
    __tablename__ = "r_collections"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_invoices.id"), nullable=False, index=True)
    amount_collected: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    collected_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    invoice: Mapped["RentalInvoice"] = relationship("RentalInvoice", back_populates="collections")

    __table_args__ = (Index("ix_r_collections_tenant_invoice", "tenant_id", "invoice_id"),)


class RentalExpense(Base):
    __tablename__ = "r_expenses"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_properties.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_companies.id"), nullable=False, index=True)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[RentalExpenseCategory] = mapped_column(Enum(RentalExpenseCategory, name="rental_expense_category"), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    property: Mapped["RentalProp"] = relationship("RentalProp")
    company: Mapped["RentalCompany"] = relationship("RentalCompany", back_populates="expenses")

    __table_args__ = (Index("ix_r_expenses_tenant_company", "tenant_id", "company_id"),)


class RentalOwnership(Base):
    __tablename__ = "r_ownership"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_companies.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_properties.id"), nullable=True, index=True)
    partner_name: Mapped[str] = mapped_column(String(255), nullable=False)
    property_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    property_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    entity_structure: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ownership_pct: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False)
    role: Mapped[RentalPartnerRole] = mapped_column(Enum(RentalPartnerRole, name="rental_partner_role"), nullable=False)
    cost_basis: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    book_value: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    existing_debt: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    capital_contributed: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company: Mapped["RentalCompany"] = relationship("RentalCompany", back_populates="ownership")
    property: Mapped["RentalProp | None"] = relationship("RentalProp")

    __table_args__ = (Index("ix_r_ownership_tenant_company", "tenant_id", "company_id"),)


class RentalFinancialUpload(Base):
    """Stores parsed P&L / Balance Sheet / Cash Flow data uploaded per company."""
    __tablename__ = "r_financial_uploads"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_companies.id", ondelete="CASCADE"), nullable=False, index=True)
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    filename: Mapped[str | None] = mapped_column(String(500), nullable=True)
    date_range: Mapped[str | None] = mapped_column(String(500), nullable=True)
    years: Mapped[list | None] = mapped_column(JSON, nullable=True)
    periods: Mapped[list | None] = mapped_column(JSON, nullable=True)
    pl_data: Mapped[list | None] = mapped_column(JSON, nullable=True)
    bs_data: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cf_data: Mapped[list | None] = mapped_column(JSON, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (Index("ix_r_financial_uploads_tenant_company", "tenant_id", "company_id"),)
