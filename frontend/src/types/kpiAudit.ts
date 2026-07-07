export type KpiAuditStatus = 'MATCH' | 'MISMATCH' | 'CHECK_LOGIC' | 'INSUFFICIENT_DATA';

export interface KpiAuditRow {
  kpi: string;
  section: string;
  formula: string;
  raw_inputs: Record<string, string>;
  inputs_detail: Record<string, string>;
  substitution: string;
  sources: Array<{ field: string; source: string }>;
  canonical_value: number | null;
  canonical_display: string;
  displayed_value: number | null;
  displayed_display: string;
  difference: number | null;
  difference_pct: number | null;
  status: KpiAuditStatus;
  notes?: string;
}

export interface CompanyKpiAuditResult {
  company_id: string;
  company_name: string;
  period_label: string;
  has_data: boolean;
  summary_status: KpiAuditStatus;
  mismatch_count: number;
  check_logic_count: number;
  rows: KpiAuditRow[];
}
