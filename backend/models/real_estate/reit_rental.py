import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class AssetClass(str, enum.Enum):
    office = "office"
    retail = "retail"
    industrial = "industrial"
    multifamily = "multifamily"
    mixed_use = "mixed_use"
    self_storage = "self_storage"


class GreenCertification(str, enum.Enum):
    none = "none"
    leed_certified = "leed_certified"
    leed_silver = "leed_silver"
    leed_gold = "leed_gold"
    leed_platinum = "leed_platinum"
    energy_star = "energy_star"


class PropertyType(str, enum.Enum):
    multifamily = "multifamily"
    single_family = "single_family"
    commercial_small = "commercial_small"
    mixed_use = "mixed_use"


class ReitAsset(Base):
    __tablename__ = "reit_assets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=False, index=True)
    asset_name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    asset_class: Mapped[AssetClass] = mapped_column(Enum(AssetClass, name="asset_class"), nullable=False)
    acquisition_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    acquisition_cost: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    current_book_value: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    current_market_value: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    total_rentable_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    occupied_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    annual_rental_income: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    annual_operating_expenses: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    ltv_pct: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    cap_rate: Mapped[float] = mapped_column(Numeric(6, 4), default=0, nullable=False)
    wale_years: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    green_certification: Mapped[GreenCertification | None] = mapped_column(
        Enum(GreenCertification, name="green_certification"), nullable=True
    )
    insurance_coverage_amount: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    insurance_renewal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    leases: Mapped[list["Lease"]] = relationship("Lease", back_populates="reit_asset", foreign_keys="Lease.reit_asset_id")

    __table_args__ = (Index("ix_reit_assets_tenant_entity", "tenant_id", "entity_id"),)


class RentalProperty(Base):
    __tablename__ = "rental_properties"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=False, index=True)
    property_name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    property_type: Mapped[PropertyType] = mapped_column(Enum(PropertyType, name="property_type"), nullable=False)
    total_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    occupied_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    monthly_rent_billed: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    monthly_rent_collected: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    monthly_maintenance_cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    avg_dso_days: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    leases: Mapped[list["Lease"]] = relationship("Lease", back_populates="rental_property", foreign_keys="Lease.rental_property_id")

    __table_args__ = (Index("ix_rental_properties_tenant_entity", "tenant_id", "entity_id"),)


class Lease(Base):
    __tablename__ = "leases"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    reit_asset_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("reit_assets.id"), nullable=True, index=True)
    rental_property_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("rental_properties.id"), nullable=True, index=True)
    tenant_name: Mapped[str] = mapped_column(String(255), nullable=False)
    leased_sqft: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    annual_rent: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    lease_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    lease_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    escalation_pct_annual: Mapped[float] = mapped_column(Numeric(6, 4), default=0, nullable=False)
    is_renewal_option: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tenant_industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    reit_asset: Mapped["ReitAsset | None"] = relationship("ReitAsset", back_populates="leases", foreign_keys=[reit_asset_id])
    rental_property: Mapped["RentalProperty | None"] = relationship("RentalProperty", back_populates="leases", foreign_keys=[rental_property_id])

    __table_args__ = (Index("ix_leases_tenant_reit", "tenant_id", "reit_asset_id"),)
