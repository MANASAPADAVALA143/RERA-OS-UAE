import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class TradeName(str, enum.Enum):
    site_work_excavation = "site_work_excavation"
    foundation = "foundation"
    framing_structural = "framing_structural"
    roofing = "roofing"
    exterior_envelope = "exterior_envelope"
    plumbing_rough_finish = "plumbing_rough_finish"
    electrical_rough_finish = "electrical_rough_finish"
    hvac = "hvac"
    insulation_drywall = "insulation_drywall"
    interior_finishes = "interior_finishes"
    flooring = "flooring"
    cabinetry_millwork = "cabinetry_millwork"
    painting = "painting"
    elevators = "elevators"
    fire_protection_sprinklers = "fire_protection_sprinklers"
    landscaping_site_amenities = "landscaping_site_amenities"
    general_conditions_overhead = "general_conditions_overhead"
    contingency = "contingency"


class CostTrade(Base):
    __tablename__ = "cost_trades"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    trade_name: Mapped[TradeName] = mapped_column(Enum(TradeName, name="trade_name"), nullable=False)
    csi_division_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    division_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    budgeted_cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    actual_cost_to_date: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    committed_cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    pct_complete: Mapped[float] = mapped_column(Numeric(5, 4), default=0, nullable=False)
    prior_period_actual_cost: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    comparable_project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)
    comparable_project_actual_cost: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    last_updated_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="cost_trades", foreign_keys=[project_id])

    __table_args__ = (Index("ix_cost_trades_tenant_project", "tenant_id", "project_id"),)
