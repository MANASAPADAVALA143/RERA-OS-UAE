import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class DailyProgressPhotoEntry(Base):
    """One entry per (project, date). Photos are attached to it. Completely
    separate from WorkLogEntry — different primary use case and table."""
    __tablename__ = "daily_progress_photo_entries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    photos: Mapped[list["DailyProgressPhoto"]] = relationship(
        "DailyProgressPhoto", back_populates="entry", cascade="all, delete-orphan",
        order_by="DailyProgressPhoto.uploaded_at",
    )

    __table_args__ = (
        Index("ix_daily_photo_entries_tenant_project", "tenant_id", "project_id"),
        Index("ix_daily_photo_entries_date", "tenant_id", "project_id", "entry_date", unique=True),
    )


class DailyProgressPhoto(Base):
    """Individual photo attached to a DailyProgressPhotoEntry.
    Reuses the same uploads/ directory as WorkLogImage but is a separate table."""
    __tablename__ = "daily_progress_photos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entry_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("daily_progress_photo_entries.id"), nullable=False, index=True)
    file_reference: Mapped[str] = mapped_column(String(512), nullable=False)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    entry: Mapped["DailyProgressPhotoEntry"] = relationship("DailyProgressPhotoEntry", back_populates="photos")

    __table_args__ = (Index("ix_daily_progress_photos_entry", "entry_id"),)
