"""
Persisted P&L expense-category map for PropDev Carrying Costs Tracker.

Mirrors the intent of Construction's vendor cat_map (services/construction_
vendor_matrix.py: resolve_category/build_or_merge_category_map) but as a real
DB table, not a JSON file -- Construction's map is file-backed (MAP_PATH on
disk), which doesn't survive multi-instance deploys and isn't tenant-scoped.
This table is tenant-scoped since PropDev expense labels can legitimately
differ in meaning across tenants.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class PropDevExpenseCategoryMap(Base):
    __tablename__ = "propdev_expense_category_map"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)

    # Raw P&L line-item label as it appears in pl_data, e.g. "Property Tax - B-400".
    label: Mapped[str] = mapped_column(String(500), nullable=False)

    # interest | property_tax | improvements | other_carrying | operating | capex | debt_service | other
    expense_category: Mapped[str] = mapped_column(String(30), default="other", nullable=False)

    confidence: Mapped[float] = mapped_column(Numeric(4, 2), default=0, nullable=False)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_propdev_expense_cat_tenant_label", "tenant_id", "label", unique=True),
    )
