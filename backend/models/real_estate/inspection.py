import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class InspectionType(str, enum.Enum):
    # Real construction inspection types — not a single placeholder 'other'
    structural = "structural"             # Structural steel, framing, moment frames
    plumbing = "plumbing"                 # Plumbing rough-in, top-out, finish
    electrical = "electrical"             # Electrical rough-in, service, finish
    mechanical = "mechanical"             # HVAC, mechanical systems
    fire_protection = "fire_protection"   # Fire sprinkler, suppression, fire alarm
    building_envelope = "building_envelope"  # Roofing, waterproofing, curtainwall, exterior skin
    concrete = "concrete"                 # Concrete pour, pre-pour, placement, finish
    soil_foundation = "soil_foundation"   # Soils, foundation, shoring, below-grade waterproofing
    accessibility = "accessibility"       # ADA / accessibility compliance
    energy_code = "energy_code"           # Title 24 / energy code compliance
    special = "special"                   # IBC Chapter 17 special inspections (bolts, welds, masonry, etc.)
    fire_life_safety = "fire_life_safety" # Fire egress, stair pressurization, life-safety systems
    final = "final"                       # Final building inspection / certificate of occupancy
    other = "other"                       # Catch-all for types not listed above


class InspectionStatus(str, enum.Enum):
    open = "open"
    scheduled = "scheduled"
    passed = "passed"
    failed = "failed"


class Inspection(Base):
    __tablename__ = "inspections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    inspection_number: Mapped[str] = mapped_column(String(20), nullable=False)  # e.g. "INSP-055", project-scoped sequential
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    # linked_sov_id references cost_trades.id — same SOV division reference as the SOV and QC sections
    # Supports linking at any hierarchy level via the cost_trade's csi_division_code (e.g. "1", "1.5", "1.5.8")
    linked_sov_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("cost_trades.id"), nullable=True, index=True)
    inspection_type: Mapped[InspectionType] = mapped_column(Enum(InspectionType, name="inspection_type"), nullable=False, default=InspectionType.other)
    status: Mapped[InspectionStatus] = mapped_column(Enum(InspectionStatus, name="inspection_status"), nullable=False, default=InspectionStatus.open)
    inspection_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Two distinct inspector fields: external firm/person and internal coordinator
    performed_by_org: Mapped[str | None] = mapped_column(String(512), nullable=True)      # e.g. "ECS Southwest, LLP - Stephen Mereby"
    performed_by_internal: Mapped[str | None] = mapped_column(String(255), nullable=True)  # e.g. "Naveenkumar Addula"
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    linked_sov: Mapped["CostTrade"] = relationship("CostTrade", foreign_keys=[linked_sov_id])

    __table_args__ = (
        Index("ix_inspections_tenant_project", "tenant_id", "project_id"),
        Index("ix_inspections_linked_sov", "linked_sov_id"),
        Index("ix_inspections_status", "status"),
    )


from models.real_estate.construction_cost import CostTrade  # noqa: E402, F401
