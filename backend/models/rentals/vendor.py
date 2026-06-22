import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class VendorCategory(str, enum.Enum):
    maintenance     = "maintenance"
    utilities       = "utilities"
    property_mgmt   = "property_mgmt"
    insurance       = "insurance"
    landscaping     = "landscaping"
    cleaning        = "cleaning"
    security        = "security"
    accounting      = "accounting"
    legal           = "legal"
    other           = "other"


class RentalVendor(Base):
    __tablename__ = "r_vendors"

    id: Mapped[uuid.UUID]          = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID]   = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    vendor_name: Mapped[str]       = mapped_column(String(255), nullable=False)
    vendor_category: Mapped[VendorCategory] = mapped_column(
        Enum(VendorCategory, name="rental_vendor_category"), nullable=False, default=VendorCategory.other
    )
    contact_name: Mapped[str | None]  = mapped_column(String(255), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50),  nullable=True)
    last_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime]   = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime]   = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (Index("ix_r_vendors_tenant", "tenant_id"),)
