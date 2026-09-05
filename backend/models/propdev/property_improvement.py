import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevPropertyImprovement(Base):
    __tablename__ = "propdev_property_improvements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)

    improvement_type: Mapped[str] = mapped_column(String(255), nullable=False)
    improvement_cost: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    improvement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contractor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany", back_populates="property_improvements")

    __table_args__ = (
        Index("ix_propdev_property_improvements_tenant", "tenant_id"),
        Index("ix_propdev_property_improvements_company", "company_id"),
    )
