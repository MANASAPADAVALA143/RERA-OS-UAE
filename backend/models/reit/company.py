import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ReitCompany(Base):
    __tablename__ = "reit_companies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)

    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    fund_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    asset_class: Mapped[str | None] = mapped_column(String(100), nullable=True)
    aum: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="active")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (Index("ix_reit_companies_tenant", "tenant_id"),)
