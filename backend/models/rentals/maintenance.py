import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class MaintenanceCategory(str, enum.Enum):
    plumbing = "plumbing"
    electrical = "electrical"
    hvac = "hvac"
    appliance = "appliance"
    structural = "structural"
    pest_control = "pest_control"
    general = "general"
    other = "other"


class MaintenancePriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    emergency = "emergency"


class MaintenanceStatus(str, enum.Enum):
    open = "open"
    assigned = "assigned"
    in_progress = "in_progress"
    completed = "completed"
    closed = "closed"


class MaintenanceRequest(Base):
    __tablename__ = "r_maintenance_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_units.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_properties.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[MaintenanceCategory] = mapped_column(Enum(MaintenanceCategory, name="maintenance_category"), nullable=False)
    priority: Mapped[MaintenancePriority] = mapped_column(Enum(MaintenancePriority, name="maintenance_priority"), nullable=False)
    status: Mapped[MaintenanceStatus] = mapped_column(Enum(MaintenanceStatus, name="maintenance_status"), nullable=False, default=MaintenanceStatus.open)
    reported_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reported_date: Mapped[date] = mapped_column(Date, nullable=False)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    cost: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    linked_expense_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_expenses.id"), nullable=True, index=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    unit: Mapped["RentalUnit"] = relationship("RentalUnit")
    property: Mapped["RentalProp"] = relationship("RentalProp")
    linked_expense: Mapped["RentalExpense | None"] = relationship("RentalExpense")

    __table_args__ = (
        Index("ix_r_maintenance_tenant_unit", "tenant_id", "unit_id"),
        Index("ix_r_maintenance_tenant_status", "tenant_id", "status"),
    )


from models.rentals.models import RentalUnit, RentalProp, RentalExpense  # noqa: E402, F401
