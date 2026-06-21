import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PermitType(str, enum.Enum):
    building_permit = "building_permit"
    grading_permit = "grading_permit"
    fire_department_approval = "fire_department_approval"
    environmental_epa_review = "environmental_epa_review"
    zoning_variance = "zoning_variance"
    demolition_permit = "demolition_permit"
    electrical_permit = "electrical_permit"
    plumbing_permit = "plumbing_permit"
    mechanical_hvac_permit = "mechanical_hvac_permit"
    water_connection = "water_connection"
    sewer_connection = "sewer_connection"
    utility_hookup_electric = "utility_hookup_electric"
    certificate_of_occupancy = "certificate_of_occupancy"
    elevator_permit = "elevator_permit"
    sign_permit = "sign_permit"
    other = "other"


class PermitStatus(str, enum.Enum):
    not_started = "not_started"
    application_prepared = "application_prepared"
    submitted = "submitted"
    under_review = "under_review"
    revisions_requested = "revisions_requested"
    approved = "approved"
    rejected = "rejected"
    expired = "expired"


class Permit(Base):
    __tablename__ = "permits"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    permit_type: Mapped[PermitType] = mapped_column(Enum(PermitType, name="permit_type"), nullable=False)
    issuing_authority: Mapped[str | None] = mapped_column(String(255), nullable=True)
    budgeted_cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    actual_cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    status: Mapped[PermitStatus] = mapped_column(Enum(PermitStatus, name="permit_status"), nullable=False)
    is_blocking: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    application_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="permits")
