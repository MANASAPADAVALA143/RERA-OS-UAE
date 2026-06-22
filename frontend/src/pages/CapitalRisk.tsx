import { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { AlertTriangle, Shield } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

interface LenderRiskLoan {
  id: string;
  company_name: string;
  property_name: string;
  loan_bank_name: string;
  context_type: string | null;
  loan_balance_as_of: number | null;
  loan_maturity_date: string | null;
  dscr: number | null;
  ltv_current: number | null;
  dscr_status: string | null;
}

interface LenderRiskSummary {
  total_debt: number;
  total_loans: number;
  weighted_avg_dscr: number | null;
  weighted_avg_ltv: number | null;
  loans_below_1_00x: { count: number; items: LenderRiskLoan[] };
  loans_below_1_25x: { count: number; items: LenderRiskLoan[] };
  loans_below_dscr_covenant: { count: number; items: LenderRiskLoan[] };
  all_loans: LenderRiskLoan[];
}

function fmtDscr(v: number | null) {
  if (v == null) return '—';
  return v.toFixed(2) + 'x';
}

function fmtLtv(v: number | null) {
  if (v == null) return '—';
  return (v * 100).toFixed(1) + '%';
}

function dscrCellClass(v: number | null) {
  if (v == null) return 'text-gray-400';
  if (v < 1.00) return 'text-red-700 font-semibold';
  if (v < 1.25) return 'text-amber-700 font-semibold';
  return 'text-green-700 font-semibold';
}

const BUCKET_ORDER = ['0-30_days', '31-60_days', '61-90_days', '91-180_days', '180_plus_days'];
const BUCKET_LABELS: Record<string, string> = {
  '0-30_days': '0–30 days',
  '31-60_days': '31–60 days',
  '61-90_days': '61–90 days',
  '91-180_days': '91–180 days',
  '180_plus_days': '180+ days',
};
const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface Facility extends Record<string, unknown> {
  id: string;
  lender_or_investor_name: string;
  facility_type: string;
  committed_amount: number;
  drawn_amount: number;
  undrawn_available: number;
  maturity_date: string | null;
  breach_risk: string;
  ltv_headroom_pct: number;
  dscr_headroom: number;
  is_in_default: boolean;
}

interface VendorConcentration {
  top_vendor: string | null;
  top_vendor_pct: number;
  concentration_risk: boolean;
  breakdown: { vendor_name: string; committed: number; pct: number }[];
}

interface LitigationClaim extends Record<string, unknown> {
  id: string;
  claim_description: string;
  claim_type: string;
  claimant_name: string;
  exposure_amount: number;
  probability_weighted_reserve: number;
  status: string;
}

interface TaxEvent extends Record<string, unknown> {
  id: string;
  event_type: string;
  deadline_date: string | null;
  amount: number | null;
  status: string;
  days_until_deadline: number | null;
}

interface InsuranceFlag {
  type: string;
  id: string;
  name: string;
  issue: string;
  renewal_date?: string;
}

interface CapitalAvailable {
  total: number;
  breakdown: { facility_type: string; lender_or_investor_name: string; undrawn_available: number }[];
}

export default function CapitalRisk() {
  const [maturityLadder, setMaturityLadder] = useState<Record<string, number>>({});
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [capital, setCapital] = useState<CapitalAvailable | null>(null);
  const [vendorConc, setVendorConc] = useState<VendorConcentration | null>(null);
  const [litigation, setLitigation] = useState<{ claims: LitigationClaim[]; summary: { total_exposure: number; total_reserved: number } } | null>(null);
  const [taxEvents, setTaxEvents] = useState<TaxEvent[]>([]);
  const [insuranceFlags, setInsuranceFlags] = useState<InsuranceFlag[]>([]);
  const [lenderRisk, setLenderRisk] = useState<LenderRiskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ladderRes, facRes, capRes, vendorRes, litRes, taxRes, insRes, lenderRes] = await Promise.all([
        api.get<Record<string, number>>('/api/real-estate/financing/maturity-ladder'),
        api.get<Facility[]>('/api/real-estate/financing/facilities'),
        api.get<CapitalAvailable>('/api/real-estate/financing/capital-available'),
        api.get<VendorConcentration>('/api/real-estate/risk/vendor-concentration'),
        api.get<{ claims: LitigationClaim[]; summary: { total_exposure: number; total_reserved: number } }>('/api/real-estate/risk/litigation'),
        api.get<TaxEvent[]>('/api/real-estate/risk/tax-events'),
        api.get<InsuranceFlag[]>('/api/real-estate/risk/insurance-coverage'),
        api.get<LenderRiskSummary>('/api/lender-risk/summary').catch(() => ({ data: null })),
      ]);
      setMaturityLadder(ladderRes.data);
      setFacilities(facRes.data);
      setCapital(capRes.data);
      setVendorConc(vendorRes.data);
      setLitigation(litRes.data);
      setTaxEvents(taxRes.data);
      setInsuranceFlags(insRes.data);
      setLenderRisk(lenderRes.data);
    } catch {
      setError('Failed to load capital & risk data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ladderChart = BUCKET_ORDER.map((key) => ({
    bucket: BUCKET_LABELS[key] || key,
    amount: safe(maturityLadder[key]),
  }));

  const covenantColumns: Column<Facility>[] = [
    { key: 'lender_or_investor_name', label: 'Lender', sortValue: (r) => r.lender_or_investor_name },
    { key: 'facility_type', label: 'Type', render: (r) => r.facility_type.replace(/_/g, ' ') },
    { key: 'committed_amount', label: 'Committed', render: (r) => fmtUSD(r.committed_amount), sortValue: (r) => safe(r.committed_amount) },
    { key: 'drawn_amount', label: 'Drawn', render: (r) => fmtUSD(r.drawn_amount), sortValue: (r) => safe(r.drawn_amount) },
    { key: 'ltv_headroom_pct', label: 'LTV Headroom', render: (r) => `${safe(r.ltv_headroom_pct).toFixed(1)}%`, sortValue: (r) => safe(r.ltv_headroom_pct) },
    { key: 'dscr_headroom', label: 'DSCR Headroom', render: (r) => safe(r.dscr_headroom).toFixed(2), sortValue: (r) => safe(r.dscr_headroom) },
    { key: 'breach_risk', label: 'Covenant', render: (r) => <StatusPill status={r.breach_risk === 'none' ? 'healthy' : r.breach_risk} /> },
    { key: 'maturity_date', label: 'Maturity', render: (r) => r.maturity_date || '—' },
  ];

  const litigationColumns: Column<LitigationClaim>[] = [
    { key: 'claimant_name', label: 'Claimant', sortValue: (r) => r.claimant_name },
    { key: 'claim_type', label: 'Type', render: (r) => r.claim_type.replace(/_/g, ' ') },
    { key: 'exposure_amount', label: 'Exposure', render: (r) => fmtUSD(r.exposure_amount), sortValue: (r) => safe(r.exposure_amount) },
    { key: 'probability_weighted_reserve', label: 'Reserve', render: (r) => fmtUSD(r.probability_weighted_reserve), sortValue: (r) => safe(r.probability_weighted_reserve) },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
  ];

  const taxColumns: Column<TaxEvent>[] = [
    { key: 'event_type', label: 'Event', render: (r) => r.event_type.replace(/_/g, ' ') },
    { key: 'deadline_date', label: 'Deadline', render: (r) => r.deadline_date || '—' },
    { key: 'days_until_deadline', label: 'Days Left', sortValue: (r) => safe(r.days_until_deadline) },
    { key: 'amount', label: 'Amount', render: (r) => fmtUSD(r.amount), sortValue: (r) => safe(r.amount) },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-charcoal">Capital & Risk</h1>
        <LoadingSkeleton rows={10} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-charcoal">Capital & Risk</h1>
        <p className="text-red-600">{error}</p>
        <button onClick={fetchData} className="px-4 py-2 bg-primary text-white rounded-lg text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Capital & Risk</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Capital Available" value={fmtUSD(capital?.total)} accent />
        <KpiCard label="Total Exposure" value={fmtUSD(litigation?.summary.total_exposure)} sub="Litigation" />
        <KpiCard label="Reserved" value={fmtUSD(litigation?.summary.total_reserved)} sub="Litigation" />
        <KpiCard label="Top Vendor Share" value={fmtPct(vendorConc?.top_vendor_pct)} sub={vendorConc?.top_vendor || '—'} />
      </div>

      {vendorConc?.concentration_risk && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle className="text-amber-600 shrink-0" size={20} />
          <p className="text-sm text-amber-800">
            Vendor concentration risk: {vendorConc.top_vendor} represents {fmtPct(vendorConc.top_vendor_pct)} of committed spend.
          </p>
        </div>
      )}

      <ErrorBoundary>
        <Card title="Debt Maturity Ladder">
          {ladderChart.every((b) => b.amount === 0) ? (
            <p className="text-gray-400 text-center py-8">No debt facilities</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ladderChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} />
                <Bar dataKey="amount" fill="#0E3B36" name="Committed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </ErrorBoundary>

      <ErrorBoundary>
        <Card title="Covenant Monitor">
          <Table columns={covenantColumns} data={facilities} emptyMessage="No financing facilities" />
        </Card>
      </ErrorBoundary>

      <ErrorBoundary>
        <Card title="Capital Available">
          {!capital?.breakdown?.length ? (
            <p className="text-gray-400 text-center py-6">No undrawn capital</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {capital.breakdown.map((b, i) => (
                <li key={i} className="flex justify-between py-3 text-sm">
                  <span className="text-charcoal">{b.lender_or_investor_name} <span className="text-gray-400">({b.facility_type.replace(/_/g, ' ')})</span></span>
                  <span className="font-medium text-primary">{fmtUSD(b.undrawn_available)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </ErrorBoundary>

      <ErrorBoundary>
        <Card title="Vendor Concentration">
          {!vendorConc?.breakdown?.length ? (
            <p className="text-gray-400 text-center py-6">No vendor data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={vendorConc.breakdown.slice(0, 8).map((v) => ({ name: v.vendor_name, pct: safe(v.pct) * 100 }))} layout="vertical">
                <XAxis type="number" tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Bar dataKey="pct" fill="#2F8F7A" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </ErrorBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ErrorBoundary>
          <Card title="Litigation">
            <Table columns={litigationColumns} data={litigation?.claims || []} emptyMessage="No litigation claims" />
          </Card>
        </ErrorBoundary>

        <ErrorBoundary>
          <Card title="Upcoming Tax Events">
            <Table columns={taxColumns} data={taxEvents} emptyMessage="No upcoming tax events" />
          </Card>
        </ErrorBoundary>
      </div>

      {/* Lender Risk — DSCR / LTV across all loans */}
      {lenderRisk && (
        <ErrorBoundary>
          <Card title="Lender Risk (DSCR / LTV)">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              <KpiCard
                label="Weighted DSCR"
                value={fmtDscr(lenderRisk.weighted_avg_dscr)}
                accent={lenderRisk.weighted_avg_dscr != null && lenderRisk.weighted_avg_dscr < 1.25}
              />
              <KpiCard label="Weighted LTV" value={fmtLtv(lenderRisk.weighted_avg_ltv)} />
              <KpiCard
                label="Below 1.00x (Hard Breach)"
                value={String(lenderRisk.loans_below_1_00x.count)}
                accent={lenderRisk.loans_below_1_00x.count > 0}
              />
              <KpiCard
                label="Below 1.25x (Warning)"
                value={String(lenderRisk.loans_below_1_25x.count)}
                accent={lenderRisk.loans_below_1_25x.count > 0}
              />
            </div>

            {lenderRisk.loans_below_1_00x.count > 0 && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4 text-sm text-red-800">
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600" />
                {lenderRisk.loans_below_1_00x.count} loan{lenderRisk.loans_below_1_00x.count > 1 ? 's' : ''} below 1.00x DSCR — potential covenant breach.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-gray-700 min-w-[700px]">
                <thead>
                  <tr className="bg-[#0E3B36] text-white text-xs">
                    <th className="px-3 py-2 text-left">Company</th>
                    <th className="px-3 py-2 text-left">Property</th>
                    <th className="px-3 py-2 text-left">Bank</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2 text-right">DSCR</th>
                    <th className="px-3 py-2 text-right">LTV</th>
                    <th className="px-3 py-2 text-right">Maturity</th>
                  </tr>
                </thead>
                <tbody>
                  {lenderRisk.all_loans.map((loan, i) => (
                    <tr key={loan.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 whitespace-nowrap">{loan.company_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{loan.property_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{loan.loan_bank_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                          {loan.context_type ?? 'construction'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{loan.loan_balance_as_of != null ? fmtUSD(loan.loan_balance_as_of) : '—'}</td>
                      <td className={`px-3 py-2 text-right ${dscrCellClass(loan.dscr)}`}>{fmtDscr(loan.dscr)}</td>
                      <td className="px-3 py-2 text-right">{fmtLtv(loan.ltv_current)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{loan.loan_maturity_date ?? '—'}</td>
                    </tr>
                  ))}
                  {lenderRisk.all_loans.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-gray-400">No loans recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </ErrorBoundary>
      )}

      <ErrorBoundary>
        <Card title="Insurance Flags">
          {insuranceFlags.length === 0 ? (
            <p className="text-gray-400 text-center py-6">No insurance issues flagged</p>
          ) : (
            <ul className="space-y-2">
              {insuranceFlags.map((f) => (
                <li key={`${f.type}-${f.id}`} className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg text-sm">
                  <Shield size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-charcoal">{f.name}</p>
                    <p className="text-gray-600">
                      {f.issue === 'renewal_soon' ? `Renewal due ${f.renewal_date}` : 'Missing coverage in risk zone'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </ErrorBoundary>
    </div>
  );
}
