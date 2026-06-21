import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ReitPropertyAssetClass(str, enum.Enum):
    multifamily_townhome = "multifamily_townhome"
    multifamily_garden = "multifamily_garden"
    multifamily_midrise = "multifamily_midrise"
    office = "office"
    retail = "retail"
    industrial = "industrial"
    mixed_use = "mixed_use"
    self_storage = "self_storage"


class ReitPropertyStatus(str, enum.Enum):
    active = "active"
    under_renovation = "under_renovation"
    held_for_sale = "held_for_sale"
    sold = "sold"


class ReitGreenCertification(str, enum.Enum):
    none = "none"
    leed_certified = "leed_certified"
    leed_silver = "leed_silver"
    leed_gold = "leed_gold"
    leed_platinum = "leed_platinum"
    energy_star = "energy_star"


class ReitProperty(Base):
    __tablename__ = "reit_properties"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    property_code: Mapped[str] = mapped_column(String(50), nullable=False)
    property_name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    asset_class: Mapped[ReitPropertyAssetClass] = mapped_column(
        Enum(ReitPropertyAssetClass, name="reit_property_asset_class"), nullable=False
    )
    total_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    acquisition_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    acquisition_price: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    current_market_value_estimate: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    current_market_value_as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    green_certification: Mapped[ReitGreenCertification | None] = mapped_column(
        Enum(ReitGreenCertification, name="reit_green_certification"), nullable=True
    )
    insurance_coverage_amount: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    insurance_renewal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    min_buffer_target: Mapped[float] = mapped_column(Numeric(14, 2), default=15000, nullable=False)
    status: Mapped[ReitPropertyStatus] = mapped_column(
        Enum(ReitPropertyStatus, name="reit_property_status"), default=ReitPropertyStatus.active, nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    units: Mapped[list["ReitUnit"]] = relationship("ReitUnit", back_populates="property")
    operating_expenses: Mapped[list["ReitOperatingExpense"]] = relationship("ReitOperatingExpense", back_populates="property")
    loan: Mapped["ReitLoan | None"] = relationship("ReitLoan", back_populates="property", uselist=False)
    ownership: Mapped[list["ReitOwnership"]] = relationship("ReitOwnership", back_populates="property")
    cash_flow_weeks: Mapped[list["ReitCashFlowWeek"]] = relationship("ReitCashFlowWeek", back_populates="property")

    __table_args__ = (
        Index("ix_reit_properties_tenant_code", "tenant_id", "property_code", unique=True),
    )
