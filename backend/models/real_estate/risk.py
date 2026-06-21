import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Table, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

re_vendor_project_link = Table(
    "re_vendor_project_links",
    Base.metadata,
    Column("vendor_id", Uuid(as_uuid=True), ForeignKey("vendor_contractors.id"), primary_key=True),
    Column("project_id", Uuid(as_uuid=True), ForeignKey("projects.id"), primary_key=True),
    Column("tenant_id", Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True),
)


class VendorType(str, enum.Enum):
    general_contractor = "general_contractor"
    subcontractor = "subcontractor"
    architect_engineer = "architect_engineer"
    property_manager = "property_manager"
    broker = "broker"


class ClaimType(str, enum.Enum):
    construction_defect = "construction_defect"
    contract_dispute = "contract_dispute"
    employment = "employment"
    property_damage = "property_damage"
    other = "other"


class ClaimStatus(str, enum.Enum):
    open = "open"
    in_mediation = "in_mediation"
    in_litigation = "in_litigation"
    settled = "settled"
    dismissed = "dismissed"


class TaxEventType(str, enum.Enum):
    exchange_1031_identified = "1031_exchange_identified"
    exchange_1031_deadline_45day = "1031_exchange_deadline_45day"
    exchange_1031_deadline_180day = "1031_exchange_deadline_180day"
    depreciation_schedule = "depreciation_schedule"
    property_tax_assessment = "property_tax_assessment"


class TaxEventStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    missed_deadline = "missed_deadline"


class VendorContractor(Base):
    __tablename__ = "vendor_contractors"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_type: Mapped[VendorType] = mapped_column(Enum(VendorType, name="vendor_type"), nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    projects: Mapped[list["Project"]] = relationship("Project", secondary=re_vendor_project_link, backref="vendors")

    __table_args__ = (Index("ix_vendors_tenant_name", "tenant_id", "vendor_name"),)


class LitigationClaim(Base):
    __tablename__ = "litigation_claims"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=True, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)
    claim_description: Mapped[str] = mapped_column(Text, nullable=False)
    claim_type: Mapped[ClaimType] = mapped_column(Enum(ClaimType, name="claim_type"), nullable=False)
    claimant_name: Mapped[str] = mapped_column(String(255), nullable=False)
    filed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    exposure_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    probability_weighted_reserve: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    status: Mapped[ClaimStatus] = mapped_column(Enum(ClaimStatus, name="claim_status"), nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (Index("ix_litigation_tenant_status", "tenant_id", "status"),)


class TaxEvent(Base):
    __tablename__ = "tax_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=False, index=True)
    event_type: Mapped[TaxEventType] = mapped_column(Enum(TaxEventType, name="tax_event_type"), nullable=False)
    related_project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)
    related_reit_asset_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("reit_assets.id"), nullable=True, index=True)
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deadline_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    status: Mapped[TaxEventStatus] = mapped_column(Enum(TaxEventStatus, name="tax_event_status"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (Index("ix_tax_events_tenant_deadline", "tenant_id", "deadline_date"),)
