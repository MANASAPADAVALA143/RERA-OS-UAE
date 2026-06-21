import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class LandParcelStatus(str, enum.Enum):
    identified = "identified"
    under_loi = "under_loi"
    under_contract = "under_contract"
    due_diligence = "due_diligence"
    closed_converted_to_project = "closed_converted_to_project"
    passed = "passed"


class LandParcel(Base):
    __tablename__ = "land_parcels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=True, index=True)
    parcel_name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    acres: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    status: Mapped[LandParcelStatus] = mapped_column(Enum(LandParcelStatus, name="land_parcel_status"), nullable=False)
    asking_price: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    offered_price: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    projected_acquisition_cost: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    projected_units_or_sqft: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    projected_project_irr: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    target_close_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (Index("ix_land_parcels_tenant_status", "tenant_id", "status"),)


class MarketComp(Base):
    __tablename__ = "market_comps"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)
    market_area: Mapped[str] = mapped_column(String(255), nullable=False)
    comp_name: Mapped[str] = mapped_column(String(255), nullable=False)
    comp_price_per_sqft: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    comp_absorption_units_per_month: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    prevailing_mortgage_rate_pct: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    prevailing_cap_rate_pct: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    data_as_of_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (Index("ix_market_comps_tenant_area", "tenant_id", "market_area"),)
