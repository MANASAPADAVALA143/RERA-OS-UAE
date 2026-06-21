import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class FacilityType(str, enum.Enum):
    construction_loan = "construction_loan"
    equity_commitment = "equity_commitment"
    mezzanine_debt = "mezzanine_debt"
    line_of_credit = "line_of_credit"
    bond_ncd = "bond_ncd"
    seller_financing = "seller_financing"


class RateType(str, enum.Enum):
    fixed = "fixed"
    floating = "floating"


class FinancingFacility(Base):
    __tablename__ = "financing_facilities"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("entities.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)
    facility_type: Mapped[FacilityType] = mapped_column(Enum(FacilityType, name="facility_type"), nullable=False)
    lender_or_investor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    committed_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    drawn_amount: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    undrawn_available: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    interest_rate_annual: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    rate_type: Mapped[RateType | None] = mapped_column(Enum(RateType, name="rate_type"), nullable=True)
    origination_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    maturity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    ltv_covenant_pct: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    dscr_covenant_min: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    ltv_current_pct: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    dscr_current: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    moratorium_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_in_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    drawdowns: Mapped[list["DebtDrawdown"]] = relationship("DebtDrawdown", back_populates="facility")

    __table_args__ = (Index("ix_financing_tenant_entity", "tenant_id", "entity_id"),)


class DebtDrawdown(Base):
    __tablename__ = "debt_drawdowns"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    facility_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("financing_facilities.id"), nullable=False, index=True)
    draw_date: Mapped[date] = mapped_column(Date, nullable=False)
    draw_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    cumulative_drawn_after: Mapped[float] = mapped_column(Numeric(16, 2), nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    facility: Mapped["FinancingFacility"] = relationship("FinancingFacility", back_populates="drawdowns")

    __table_args__ = (Index("ix_drawdowns_tenant_facility", "tenant_id", "facility_id"),)
