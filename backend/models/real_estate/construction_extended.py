import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ChangeOrderStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    pending_approval = "pending_approval"
    approved = "approved"
    rejected = "rejected"


class ScheduleTaskStatus(str, enum.Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    complete = "complete"
    late = "late"
    override = "override"  # status forced manually; reason stored in status_override_reason


class ComplianceDocStatus(str, enum.Enum):
    compliant = "compliant"
    pending = "pending"
    missing = "missing"
    expired = "expired"


class TaskLineScope(str, enum.Enum):
    in_scope = "in_scope"
    out_of_scope = "out_of_scope"
    tbd = "tbd"


class TaskLineAction(str, enum.Enum):
    add = "add"
    delete = "delete"
    revise = "revise"
    no_change = "no_change"


class ChangeOrder(Base):
    __tablename__ = "change_orders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    co_number: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    csi_division_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    trade_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    requested_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    approved_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    status: Mapped[ChangeOrderStatus] = mapped_column(Enum(ChangeOrderStatus, name="change_order_status"), nullable=False)
    reason_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    request_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    impact_on_schedule_days: Mapped[int | None] = mapped_column(nullable=True)
    # Extended header fields (added via schema_patches for existing deployments)
    requested_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    type_of_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    approver: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attached_cr: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gc_superintendent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="change_orders")
    task_lines: Mapped[list["ChangeOrderTaskLine"]] = relationship(
        "ChangeOrderTaskLine", back_populates="change_order", cascade="all, delete-orphan", order_by="ChangeOrderTaskLine.created_at"
    )

    __table_args__ = (Index("ix_change_orders_tenant_project", "tenant_id", "project_id"),)


class ChangeOrderTaskLine(Base):
    __tablename__ = "change_order_task_lines"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    change_order_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("change_orders.id"), nullable=False, index=True)
    division: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subdivision: Mapped[str | None] = mapped_column(String(255), nullable=True)
    task: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope: Mapped[TaskLineScope | None] = mapped_column(Enum(TaskLineScope, name="task_line_scope"), nullable=True)
    original_value: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    cost_impact: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    action: Mapped[TaskLineAction | None] = mapped_column(Enum(TaskLineAction, name="task_line_action"), nullable=True)
    orig_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    orig_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    orig_duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revised_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    revised_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    revised_duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    schedule_impact_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    change_order: Mapped["ChangeOrder"] = relationship("ChangeOrder", back_populates="task_lines")

    __table_args__ = (Index("ix_co_task_lines_tenant_co", "tenant_id", "change_order_id"),)


class ScheduleTask(Base):
    __tablename__ = "schedule_tasks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # SOV hierarchy breadcrumb (same text values as CostTrade.division_label / line items)
    division: Mapped[str | None] = mapped_column(String(255), nullable=True)
    line_item_code: Mapped[str | None] = mapped_column(String(50), nullable=True)   # e.g. "5.13.5"
    line_item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)  # e.g. "Erection of steel members"
    planned_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actual_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    pct_complete: Mapped[float] = mapped_column(Numeric(5, 4), default=0, nullable=False)
    status: Mapped[ScheduleTaskStatus] = mapped_column(Enum(ScheduleTaskStatus, name="schedule_task_status"), nullable=False)
    status_override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_critical: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_milestone: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="schedule_tasks")

    __table_args__ = (Index("ix_schedule_tasks_tenant_project", "tenant_id", "project_id"),)


class ComplianceDoc(Base):
    __tablename__ = "compliance_docs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(100), nullable=False)
    doc_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ComplianceDocStatus] = mapped_column(Enum(ComplianceDocStatus, name="compliance_doc_status"), nullable=False)
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_blocking: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="compliance_docs")

    __table_args__ = (Index("ix_compliance_docs_tenant_project", "tenant_id", "project_id"),)


class ProjectFinancials(Base):
    """Cash-basis reporting snapshot — one row per period, append-only history."""

    __tablename__ = "project_financial_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_from_owner: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    paid_to_subcontractors: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    other_expenses: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    retainage_held: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    retainage_receivable: Mapped[float] = mapped_column(Numeric(16, 2), default=0, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="financial_snapshots")

    __table_args__ = (Index("ix_project_financial_snapshots_tenant_project", "tenant_id", "project_id"),)


class ExitStrategy(str, enum.Enum):
    forward_sale = "forward_sale"
    hold_as_reit = "hold_as_reit"
    build_to_suit_sale = "build_to_suit_sale"


class ProjectROIAssumptions(Base):
    __tablename__ = "project_roi_assumptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False, unique=True, index=True)
    total_project_cost: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    equity_pct: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    debt_pct: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    interest_rate_annual: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    construction_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exit_strategy: Mapped[ExitStrategy] = mapped_column(
        Enum(ExitStrategy, name="exit_strategy"), default=ExitStrategy.forward_sale, nullable=False
    )
    stabilized_noi: Mapped[float | None] = mapped_column(Numeric(16, 2), nullable=True)
    exit_cap_rate: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    selling_costs_pct: Mapped[float] = mapped_column(Numeric(8, 4), default=0.025, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="roi_assumptions", uselist=False)
