import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ReitUnitStatus(str, enum.Enum):
    occupied = "occupied"
    vacant = "vacant"
    renovation_hold = "renovation_hold"
    model_unit = "model_unit"


class ReitUnit(Base):
    __tablename__ = "reit_units"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("reit_properties.id"), nullable=False, index=True)
    unit_number: Mapped[str] = mapped_column(String(50), nullable=False)
    unit_type: Mapped[str] = mapped_column(String(100), nullable=False)
    sqft: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    market_rent: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    status: Mapped[ReitUnitStatus] = mapped_column(Enum(ReitUnitStatus, name="reit_unit_status"), nullable=False)
    tenant_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    actual_rent: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    lease_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    lease_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    status_changed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    property: Mapped["ReitProperty"] = relationship("ReitProperty", back_populates="units")

    __table_args__ = (Index("ix_reit_units_tenant_property", "tenant_id", "property_id"),)
