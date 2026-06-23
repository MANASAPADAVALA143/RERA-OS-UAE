import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PropDevPartner(Base):
    __tablename__ = "propdev_partners"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("propdev_companies.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    partner_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "Class A", "Class B"

    share_percent: Mapped[float] = mapped_column(Numeric(6, 4), nullable=False)
    capital_contributed: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    distributions_received: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    preferred_return: Mapped[float] = mapped_column(Numeric(6, 4), default=0, nullable=False)

    status: Mapped[str] = mapped_column(String(50), default="Active", nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    company: Mapped["PropDevCompany"] = relationship("PropDevCompany", back_populates="partners")

    __table_args__ = (
        Index("ix_propdev_partners_tenant", "tenant_id"),
        Index("ix_propdev_partners_company", "company_id"),
    )
