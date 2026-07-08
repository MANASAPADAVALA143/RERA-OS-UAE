"""Shared types for KPI audit / calculations review."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Status = Literal["MATCH", "MISMATCH", "CHECK_LOGIC", "INSUFFICIENT_DATA"]


@dataclass
class KpiCheckRow:
    kpi: str
    section: str
    formula: str
    raw_inputs: dict[str, Any]
    inputs_detail: dict[str, Any]
    substitution: str
    sources: list[dict[str, str]]
    canonical_value: float | None
    canonical_display: str
    displayed_value: float | None
    displayed_display: str
    difference: float | None
    difference_pct: float | None
    status: Status
    notes: str = ""


@dataclass
class CompanyAuditResult:
    company_id: str
    company_name: str
    period_label: str
    has_data: bool
    summary_status: Status
    rows: list[KpiCheckRow] = field(default_factory=list)
    mismatch_count: int = 0
    check_logic_count: int = 0
