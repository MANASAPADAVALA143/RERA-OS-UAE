"""
QuickBooks AP Aging Detail by Vendor — persistent storage of monthly snapshots.

Each upload creates one QBApAgingSnapshot and N QBApAgingRow records.
Unmatched vendor names are seeded as new r_vendors records (see ap_ap.py router).
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class QBApAgingSnapshot(Base):
    """One QB AP Aging Detail by Vendor export — keeps history across months."""
    __tablename__ = "r_qb_ap_aging_snapshots"

    id:              Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id:       Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    as_of_date:      Mapped[date]      = mapped_column(Date, nullable=False)
    snapshot_month:  Mapped[str]       = mapped_column(String(20), nullable=False)   # e.g. "Jun-2026"
    uploaded_at:     Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by:     Mapped[str | None]= mapped_column(String(255), nullable=True)
    row_count:       Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    matched_count:   Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    seeded_count:    Mapped[int]       = mapped_column(Integer, nullable=False, default=0)

    rows: Mapped[list["QBApAgingRow"]] = relationship(
        "QBApAgingRow", back_populates="snapshot", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_r_qb_ap_snapshots_tenant_date", "tenant_id", "as_of_date"),
    )


class QBApAgingRow(Base):
    """One vendor line from a QB AP Aging Detail report."""
    __tablename__ = "r_qb_ap_aging_rows"

    id:                 Mapped[uuid.UUID]    = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    snapshot_id:        Mapped[uuid.UUID]    = mapped_column(Uuid(as_uuid=True), ForeignKey("r_qb_ap_aging_snapshots.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id:          Mapped[uuid.UUID]    = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    vendor_name:        Mapped[str]          = mapped_column(String(500), nullable=False)
    current_amount:     Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_1_30:          Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_31_60:         Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_60_plus:       Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    total:              Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    has_credit:         Mapped[bool]         = mapped_column(Boolean, nullable=False, default=False)
    vendor_id:          Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_vendors.id"), nullable=True)
    was_seeded:         Mapped[bool]         = mapped_column(Boolean, nullable=False, default=False)

    snapshot: Mapped["QBApAgingSnapshot"] = relationship("QBApAgingSnapshot", back_populates="rows")

    __table_args__ = (
        Index("ix_r_qb_ap_rows_snapshot", "snapshot_id"),
        Index("ix_r_qb_ap_rows_tenant", "tenant_id"),
    )


from models.rentals.vendor import RentalVendor  # noqa: E402, F401
