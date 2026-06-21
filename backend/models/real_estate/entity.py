import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class EntityType(str, enum.Enum):
    LLC = "LLC"
    LP = "LP"
    Corp = "Corp"
    REIT_Trust = "REIT_Trust"
    Parent = "Parent"


class BusinessLine(str, enum.Enum):
    construction = "construction"
    development = "development"
    reit = "reit"
    rental = "rental"
    holding = "holding"


class ProjectType(str, enum.Enum):
    residential_for_sale = "residential_for_sale"
    commercial_for_sale = "commercial_for_sale"
    mixed_use = "mixed_use"
    contracted_epc = "contracted_epc"


class ProjectStatus(str, enum.Enum):
    land_acquisition = "land_acquisition"
    permitting = "permitting"
    under_construction = "under_construction"
    selling = "selling"
    substantially_complete = "substantially_complete"
    closed_out = "closed_out"


class Entity(Base):
    __tablename__ = "entities"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_name: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_type: Mapped[EntityType] = mapped_column(Enum(EntityType, name="entity_type"), nullable=False)
    ein: Mapped[str | None] = mapped_column(String(20), nullable=True)
    formation_state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    formation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    parent_entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=True, index=True)
    business_line: Mapped[BusinessLine] = mapped_column(Enum(BusinessLine, name="business_line"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    parent: Mapped["Entity | None"] = relationship("Entity", remote_side=[id], backref="children")
    projects: Mapped[list["Project"]] = relationship("Project", back_populates="entity")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=False, index=True)
    project_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    project_name: Mapped[str] = mapped_column(String(255), nullable=False)
    project_type: Mapped[ProjectType] = mapped_column(Enum(ProjectType, name="project_type"), nullable=False)
    contract_value: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    total_project_cost: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    county: Mapped[str | None] = mapped_column(String(100), nullable=True)
    total_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_saleable_sqft: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    total_land_acres: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(Enum(ProjectStatus, name="project_status"), nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    flood_zone: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    wildfire_risk_zone: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hurricane_zone: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    insurance_coverage_amount: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    insurance_renewal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    entity: Mapped["Entity"] = relationship("Entity", back_populates="projects")
    permits: Mapped[list["Permit"]] = relationship("Permit", back_populates="project")
    cost_trades: Mapped[list["CostTrade"]] = relationship(
        "CostTrade", back_populates="project", foreign_keys="CostTrade.project_id"
    )
    units: Mapped[list["Unit"]] = relationship("Unit", back_populates="project")
    change_orders: Mapped[list["ChangeOrder"]] = relationship("ChangeOrder", back_populates="project")
    schedule_tasks: Mapped[list["ScheduleTask"]] = relationship("ScheduleTask", back_populates="project")
    compliance_docs: Mapped[list["ComplianceDoc"]] = relationship("ComplianceDoc", back_populates="project")
    financial_snapshots: Mapped[list["ProjectFinancials"]] = relationship(
        "ProjectFinancials", back_populates="project"
    )
    roi_assumptions: Mapped["ProjectROIAssumptions | None"] = relationship(
        "ProjectROIAssumptions", back_populates="project", uselist=False
    )

    __table_args__ = (Index("ix_projects_tenant_entity", "tenant_id", "entity_id"),)
