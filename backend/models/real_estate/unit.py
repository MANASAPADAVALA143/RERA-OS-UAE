import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class UnitType(str, enum.Enum):
    studio = "studio"
    one_bed = "1_bed"
    two_bed = "2_bed"
    three_bed = "3_bed"
    three_bed_corner = "3_bed_corner"
    four_bed = "4_bed"
    penthouse = "penthouse"
    commercial_retail = "commercial_retail"
    commercial_office = "commercial_office"


class UnitStatus(str, enum.Enum):
    unreleased = "unreleased"
    available = "available"
    reserved = "reserved"
    under_contract = "under_contract"
    closed = "closed"
    rental_hold = "rental_hold"


class BuyerFinancingType(str, enum.Enum):
    cash = "cash"
    conventional_mortgage = "conventional_mortgage"
    fha = "fha"
    va = "va"
    other = "other"


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    unit_number: Mapped[str] = mapped_column(String(100), nullable=False)
    unit_type: Mapped[UnitType] = mapped_column(Enum(UnitType, name="unit_type"), nullable=False)
    floor_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sqft: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    allocated_land_cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    allocated_construction_cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    allocated_soft_cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    list_price: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    achieved_sale_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    status: Mapped[UnitStatus] = mapped_column(Enum(UnitStatus, name="unit_status"), nullable=False)
    days_on_market: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reservation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    closing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    buyer_financing_type: Mapped[BuyerFinancingType | None] = mapped_column(
        Enum(BuyerFinancingType, name="buyer_financing_type"), nullable=True
    )
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="units")

    __table_args__ = (Index("ix_units_tenant_project", "tenant_id", "project_id"),)
