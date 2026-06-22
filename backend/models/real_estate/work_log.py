import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class WorkLogStatus(str, enum.Enum):
    open = "open"
    closed = "closed"


class SiteCondition(str, enum.Enum):
    sunny = "sunny"
    rain = "rain"
    cloudy = "cloudy"
    snow = "snow"
    extreme_heat = "extreme_heat"
    other = "other"


class WorkLogEntry(Base):
    __tablename__ = "work_log_entries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    report_date: Mapped[str] = mapped_column(String(10), nullable=False)  # ISO date string YYYY-MM-DD
    status: Mapped[WorkLogStatus] = mapped_column(Enum(WorkLogStatus, name="work_log_status"), nullable=False, default=WorkLogStatus.open)
    site_condition: Mapped[SiteCondition] = mapped_column(Enum(SiteCondition, name="site_condition"), nullable=False, default=SiteCondition.sunny)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    images: Mapped[list["WorkLogImage"]] = relationship(
        "WorkLogImage", back_populates="entry", cascade="all, delete-orphan", order_by="WorkLogImage.uploaded_at"
    )
    notes: Mapped[list["WorkLogNote"]] = relationship(
        "WorkLogNote", back_populates="entry", cascade="all, delete-orphan", order_by="WorkLogNote.sequence_number"
    )

    __table_args__ = (
        Index("ix_work_log_entries_tenant_project", "tenant_id", "project_id"),
        Index("ix_work_log_entries_tenant_date", "tenant_id", "report_date"),
    )


class WorkLogImage(Base):
    __tablename__ = "work_log_images"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    work_log_entry_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("work_log_entries.id"), nullable=False, index=True)
    file_reference: Mapped[str] = mapped_column(String(512), nullable=False)  # filename stored in uploads/ dir
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    entry: Mapped["WorkLogEntry"] = relationship("WorkLogEntry", back_populates="images")

    __table_args__ = (Index("ix_work_log_images_entry", "work_log_entry_id"),)


class WorkLogNote(Base):
    __tablename__ = "work_log_notes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    work_log_entry_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("work_log_entries.id"), nullable=False, index=True)
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    trade_or_crew: Mapped[str | None] = mapped_column(String(255), nullable=True)
    narrative: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    entry: Mapped["WorkLogEntry"] = relationship("WorkLogEntry", back_populates="notes")

    __table_args__ = (Index("ix_work_log_notes_entry", "work_log_entry_id"),)
