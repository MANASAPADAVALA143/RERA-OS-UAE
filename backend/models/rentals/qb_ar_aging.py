"""
QuickBooks AR Aging Detail — persistent storage of monthly snapshots.

Each upload creates one QBArAgingSnapshot and N QBArAgingRow records.
History is preserved so trend charts can be built once 3+ snapshots exist.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class QBArAgingSnapshot(Base):
    """One QB AR Aging Detail export upload — keeps history across months."""
    __tablename__ = "r_qb_ar_aging_snapshots"

    id:              Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id:       Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    as_of_date:      Mapped[date]      = mapped_column(Date, nullable=False)
    snapshot_month:  Mapped[str]       = mapped_column(String(20), nullable=False)   # e.g. "Jun-2026"
    uploaded_at:     Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by:     Mapped[str | None]= mapped_column(String(255), nullable=True)
    row_count:       Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    matched_count:   Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    unmatched_count: Mapped[int]       = mapped_column(Integer, nullable=False, default=0)

    rows: Mapped[list["QBArAgingRow"]] = relationship(
        "QBArAgingRow", back_populates="snapshot", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_r_qb_ar_snapshots_tenant_date", "tenant_id", "as_of_date"),
    )


class QBArAgingRow(Base):
    """One tenant/customer line from a QB AR Aging Detail report."""
    __tablename__ = "r_qb_ar_aging_rows"

    id:                 Mapped[uuid.UUID]    = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    snapshot_id:        Mapped[uuid.UUID]    = mapped_column(Uuid(as_uuid=True), ForeignKey("r_qb_ar_aging_snapshots.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id:          Mapped[uuid.UUID]    = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    building_name:      Mapped[str]          = mapped_column(String(500), nullable=False, default="")
    customer_name:      Mapped[str]          = mapped_column(String(500), nullable=False)
    unit_ref:           Mapped[str | None]   = mapped_column(String(500), nullable=True)
    current_amount:     Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_1_30:          Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_31_60:         Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_61_90:         Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    days_91_plus:       Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    total:              Mapped[float]        = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    has_credit:         Mapped[bool]         = mapped_column(Boolean, nullable=False, default=False)
    matched_unit_id:    Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_units.id"), nullable=True)
    matched_company_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("r_companies.id"), nullable=True)
    is_unmatched:       Mapped[bool]         = mapped_column(Boolean, nullable=False, default=False)

    snapshot: Mapped["QBArAgingSnapshot"] = relationship("QBArAgingSnapshot", back_populates="rows")

    __table_args__ = (
        Index("ix_r_qb_ar_rows_snapshot", "snapshot_id"),
        Index("ix_r_qb_ar_rows_tenant", "tenant_id"),
    )


from models.rentals.models import RentalCompany, RentalUnit  # noqa: E402, F401
