import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class RentalReceivable(Base):
    """AR aging snapshot — one record per (company, as_of_date) entered from entity's AR aging report."""
    __tablename__ = "r_receivables"

    id: Mapped[uuid.UUID]        = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID]= mapped_column(Uuid(as_uuid=True), ForeignKey("r_companies.id"), nullable=False, index=True)
    as_of_date: Mapped[date]     = mapped_column(Date, nullable=False)
    current_amount: Mapped[float]= mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_1_30: Mapped[float]     = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_31_60: Mapped[float]    = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_61_90: Mapped[float]    = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_90_plus: Mapped[float]  = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    company: Mapped["RentalCompany"] = relationship("RentalCompany")

    __table_args__ = (Index("ix_r_receivables_tenant_co", "tenant_id", "company_id"),)


class RentalPayable(Base):
    """AP aging snapshot — one record per (company, vendor, as_of_date) from entity's AP aging report."""
    __tablename__ = "r_payables"

    id: Mapped[uuid.UUID]        = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID]= mapped_column(Uuid(as_uuid=True), ForeignKey("r_companies.id"), nullable=False, index=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_vendors.id"), nullable=False, index=True)
    as_of_date: Mapped[date]     = mapped_column(Date, nullable=False)
    # AP has 3 aging buckets (current + 1-30 + 31-60 + 60+) — 4 fields total, matching source workbook
    current_amount: Mapped[float]= mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_1_30: Mapped[float]     = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_31_60: Mapped[float]    = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_60_plus: Mapped[float]  = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    company: Mapped["RentalCompany"] = relationship("RentalCompany")
    vendor: Mapped["RentalVendor"]   = relationship("RentalVendor")

    __table_args__ = (Index("ix_r_payables_tenant_co_vendor", "tenant_id", "company_id", "vendor_id"),)


from models.rentals.models import RentalCompany   # noqa: E402, F401
from models.rentals.vendor import RentalVendor    # noqa: E402, F401
