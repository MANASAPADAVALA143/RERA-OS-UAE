import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevLot(Base):
    __tablename__ = "propdev_lots"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)

    lot_no: Mapped[str] = mapped_column(String(50), nullable=False)
    block: Mapped[str] = mapped_column(String(100), nullable=False)
    size_sqft: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    list_price: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    sale_price: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)

    status: Mapped[str] = mapped_column(String(50), default="available", nullable=False)
    buyer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contract_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    close_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany", back_populates="lots")

    __table_args__ = (
        Index("ix_propdev_lots_tenant", "tenant_id"),
        Index("ix_propdev_lots_company", "company_id"),
    )
