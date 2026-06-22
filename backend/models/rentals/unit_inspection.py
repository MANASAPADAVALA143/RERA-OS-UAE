import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class UnitInspectionType(str, enum.Enum):
    move_in = "move_in"
    move_out = "move_out"
    periodic = "periodic"


class UnitConditionScore(str, enum.Enum):
    excellent = "excellent"
    good = "good"
    fair = "fair"
    poor = "poor"
    needs_repair = "needs_repair"


class ChecklistCondition(str, enum.Enum):
    ok = "ok"
    damaged = "damaged"
    missing = "missing"
    needs_cleaning = "needs_cleaning"


class UnitInspection(Base):
    """Unit condition tracking at move-in/move-out/periodic.
    Separate from Construction's Inspection model (regulatory/code inspections on build projects)."""
    __tablename__ = "r_unit_inspections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_units.id"), nullable=False, index=True)
    lease_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_leases.id"), nullable=True, index=True)
    inspection_type: Mapped[UnitInspectionType] = mapped_column(Enum(UnitInspectionType, name="unit_inspection_type"), nullable=False)
    inspection_date: Mapped[date] = mapped_column(Date, nullable=False)
    performed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    condition_score: Mapped[UnitConditionScore] = mapped_column(Enum(UnitConditionScore, name="unit_condition_score"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    unit: Mapped["RentalUnit"] = relationship("RentalUnit")
    lease: Mapped["RentalLease | None"] = relationship("RentalLease")
    photos: Mapped[list["UnitInspectionPhoto"]] = relationship(
        "UnitInspectionPhoto", back_populates="inspection", cascade="all, delete-orphan"
    )
    checklist: Mapped[list["UnitInspectionChecklistItem"]] = relationship(
        "UnitInspectionChecklistItem", back_populates="inspection", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_r_unit_inspections_tenant_unit", "tenant_id", "unit_id"),)


class UnitInspectionPhoto(Base):
    __tablename__ = "r_unit_inspection_photos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    inspection_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_unit_inspections.id"), nullable=False, index=True)
    file_reference: Mapped[str] = mapped_column(String(512), nullable=False)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    room_area: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    inspection: Mapped["UnitInspection"] = relationship("UnitInspection", back_populates="photos")

    __table_args__ = (Index("ix_r_unit_insp_photos_inspection", "inspection_id"),)


class UnitInspectionChecklistItem(Base):
    __tablename__ = "r_unit_inspection_checklist"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    inspection_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_unit_inspections.id"), nullable=False, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    condition: Mapped[ChecklistCondition] = mapped_column(Enum(ChecklistCondition, name="checklist_condition"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    inspection: Mapped["UnitInspection"] = relationship("UnitInspection", back_populates="checklist")

    __table_args__ = (Index("ix_r_unit_insp_checklist_inspection", "inspection_id"),)


from models.rentals.models import RentalUnit, RentalLease  # noqa: E402, F401
