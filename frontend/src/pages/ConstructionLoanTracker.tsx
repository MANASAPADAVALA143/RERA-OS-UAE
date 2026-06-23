import { useCallback, useEffect, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, ChevronRight, Eye, EyeOff, Trash2, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD } from '../components/ProtectedRoute';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Loan {
  id: string;
  entity_id: string | null;
  company_name: string;
  property_name: string;
  loan_bank_name: string;
  loan_date: string | null;
  loan_account_no: string | null;   // masked in list response (****XXXX)
  loan_amount: number;
  loan_interest_rate: number | null;
  loan_emi: number | null;
  lender_name: string | null;
  lender_email: string | null;
  lender_phone: string | null;
  loan_maturity_date: string | null;
  loan_balance_as_of: number | null;
  loan_balance_as_of_date: string | null;
  loan_emi_day: number | null;
  loan_deduction_bank_account: string | null;
  noi_annual: number | null;
  current_property_value: number | null;
  context_type: string | null;
  dscr: number | null;
  ltv_current: number | null;
  dscr_status: string | null;
  created_by: string | null;
  created_at: string;
}

interface Summary {
  count: number;
  total_loan_amount: number;
  total_outstanding_balance: number;
  total_monthly_emi: number;
  maturing_in_90_days: number;
}

interface EntityOption {
  id: string;
  entity_name: string;
}

type SortKey = keyof Loan;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRate(r: number | null) {
  if (r == null) return '—';
  return `${(r * 100).toFixed(2)}%`;
}

function fmtDay(d: number | null) {
  if (d == null) return '—';
  const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  return `${d}${suffix}`;
}

function fmtDscr(v: number | null) {
  if (v == null) return '—';
  return v.toFixed(2) + 'x';
}

function fmtLtv(v: number | null) {
  if (v == null) return '—';
  return (v * 100).toFixed(1) + '%';
}

function dscrColor(v: number | null): string {
  if (v == null) return 'text-gray-400';
  if (v < 1.00) return 'text-red-700 font-semibold';
  if (v < 1.25) return 'text-amber-700 font-semibold';
  return 'text-green-700 font-semibold';
}

function isMaturingSoon(maturity: string | null): boolean {
  if (!maturity) return false;
  const today = new Date();
  const mat = new Date(maturity);
  const diff = (mat.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 90;
}

// ── Blank form ────────────────────────────────────────────────────────────────

const BLANK_FORM = {
  entity_id: '',
  company_name: '',
  property_name: '',
  loan_bank_name: '',
  loan_date: '',
  loan_account_no: '',
  loan_amount: '',
  loan_interest_rate: '',
  loan_emi: '',
  lender_name: '',
  lender_email: '',
  lender_phone: '',
  loan_maturity_date: '',
  loan_balance_as_of: '',
  loan_balance_as_of_date: '',
  loan_emi_day: '',
  loan_deduction_bank_account: '',
  noi_annual: '',
  current_property_value: '',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ConstructionLoanTracker() {
  const { canWrite } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [summary, setSummary] = useState<Summary>({
    count: 0,
    total_loan_amount: 0,
    total_outstanding_balance: 0,
    total_monthly_emi: 0,
    maturing_in_90_days: 0,
  });
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [error, setError] = useState('');

  const [sortKey, setSortKey] = useState<SortKey>('loan_maturity_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // account number reveal: maps loan id → full account number string
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleting, setDeleting] = useState<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/real-estate/loans');
      setLoans(res.data.items ?? []);
      setSummary(res.data.summary ?? {
        count: 0, total_loan_amount: 0, total_outstanding_balance: 0,
        total_monthly_emi: 0, maturing_in_90_days: 0,
      });
    } catch {
      setError('Failed to load loans.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/api/real-estate/entities')
      .then(res => setEntities(res.data ?? []))
      .catch(() => {});
  }, []);

  // ── Sorting ───────────────────────────────────────────────────────────────

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sorted = [...loans].sort((a, b) => {
    const av = a[sortKey]; const bv = b[sortKey];
    if (av == null) return 1; if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // ── Account reveal ────────────────────────────────────────────────────────

  async function handleReveal(loanId: string) {
    if (revealed[loanId]) {
      // hide again
      setRevealed(r => { const n = { ...r }; delete n[loanId]; return n; });
      return;
    }
    setRevealing(loanId);
    try {
      const res = await api.get(`/api/real-estate/loans/${loanId}/reveal-account`);
      setRevealed(r => ({ ...r, [loanId]: res.data.loan_account_no ?? '—' }));
    } catch {
      // silently fail — stay masked
    } finally {
      setRevealing(null);
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.company_name.trim()) { setFormError('Company name is required.'); return; }
    if (!form.property_name.trim()) { setFormError('Property name is required.'); return; }
    if (!form.loan_bank_name.trim()) { setFormError('Bank name is required.'); return; }
    if (!form.loan_amount || parseFloat(form.loan_amount) <= 0) { setFormError('Loan amount must be > 0.'); return; }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        company_name: form.company_name.trim(),
        property_name: form.property_name.trim(),
        loan_bank_name: form.loan_bank_name.trim(),
        loan_amount: parseFloat(form.loan_amount),
      };
      if (form.entity_id) payload.entity_id = form.entity_id;
      if (form.loan_date) payload.loan_date = form.loan_date;
      if (form.loan_account_no) payload.loan_account_no = form.loan_account_no.trim();
      if (form.loan_interest_rate) payload.loan_interest_rate = parseFloat(form.loan_interest_rate) / 100;
      if (form.loan_emi) payload.loan_emi = parseFloat(form.loan_emi);
      if (form.lender_name) payload.lender_name = form.lender_name.trim();
      if (form.lender_email) payload.lender_email = form.lender_email.trim();
      if (form.lender_phone) payload.lender_phone = form.lender_phone.trim();
      if (form.loan_maturity_date) payload.loan_maturity_date = form.loan_maturity_date;
      if (form.loan_balance_as_of) payload.loan_balance_as_of = parseFloat(form.loan_balance_as_of);
      if (form.loan_balance_as_of_date) payload.loan_balance_as_of_date = form.loan_balance_as_of_date;
      if (form.loan_emi_day) payload.loan_emi_day = parseInt(form.loan_emi_day, 10);
      if (form.loan_deduction_bank_account) payload.loan_deduction_bank_account = form.loan_deduction_bank_account.trim();
      if (form.noi_annual) payload.noi_annual = parseFloat(form.noi_annual);
      if (form.current_property_value) payload.current_property_value = parseFloat(form.current_property_value);

      await api.post('/api/real-estate/loans', payload);
      setForm({ ...BLANK_FORM });
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(msg || 'Failed to create loan.');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Delete this loan record?')) return;
    setDeleting(id);
    try {
      await api.delete(`/api/real-estate/loans/${id}`);
      await load();
    } finally {
      setDeleting(null);
    }
  }

  // ── Table helpers ─────────────────────────────────────────────────────────

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronRight size={12} className="opacity-30 rotate-90" />;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  }

  function th(label: string, col: SortKey, align = 'left') {
    return (
      <th
        key={col}
        onClick={() => handleSort(col)}
        className={`px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap text-${align}`}
      >
        <span className="inline-flex items-center gap-1">{label}<SortIcon col={col} /></span>
      </th>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Total Loan Amount" value={fmtUSD(summary.total_loan_amount)} />
        <KpiCard label="Outstanding Balance" value={fmtUSD(summary.total_outstanding_balance)} />
        <KpiCard label="Total Monthly EMI" value={fmtUSD(summary.total_monthly_emi)} />
        <KpiCard
          label="Maturing in 90 Days"
          value={String(summary.maturing_in_90_days)}
          accent={summary.maturing_in_90_days > 0}
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Loans Table */}
      <Card
        title="Loan Register"
        action={
          canWrite && (
            <button
              onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus size={13} /> Add Loan
            </button>
          )
        }
      >
        {/* Create form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">New Loan</h3>
            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Company — link to entity */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Company (Entity) *</label>
                <select
                  value={form.entity_id}
                  onChange={e => {
                    const id = e.target.value;
                    const ent = entities.find(x => x.id === id);
                    setForm(f => ({ ...f, entity_id: id, company_name: ent ? ent.entity_name : f.company_name }));
                  }}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                >
                  <option value="">— Select entity or type below —</option>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.entity_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Company Name *</label>
                <input
                  value={form.company_name}
                  onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                  placeholder="Company name"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Property Name *</label>
                <input
                  value={form.property_name}
                  onChange={e => setForm(f => ({ ...f, property_name: e.target.value }))}
                  placeholder="Eastside Lofts Phase 1"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bank *</label>
                <input
                  value={form.loan_bank_name}
                  onChange={e => setForm(f => ({ ...f, loan_bank_name: e.target.value }))}
                  placeholder="Wells Fargo Bank"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Loan Date</label>
                <input
                  type="date"
                  value={form.loan_date}
                  onChange={e => setForm(f => ({ ...f, loan_date: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Account Number</label>
                <input
                  value={form.loan_account_no}
                  onChange={e => setForm(f => ({ ...f, loan_account_no: e.target.value }))}
                  placeholder="Full account number"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Loan Amount * ($)</label>
                <input
                  type="number" step="0.01" min="0.01"
                  value={form.loan_amount}
                  onChange={e => setForm(f => ({ ...f, loan_amount: e.target.value }))}
                  placeholder="5000000.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Interest Rate (%)</label>
                <input
                  type="number" step="0.001" min="0"
                  value={form.loan_interest_rate}
                  onChange={e => setForm(f => ({ ...f, loan_interest_rate: e.target.value }))}
                  placeholder="7.50"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Monthly EMI ($)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.loan_emi}
                  onChange={e => setForm(f => ({ ...f, loan_emi: e.target.value }))}
                  placeholder="54870.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lender Name</label>
                <input
                  value={form.lender_name}
                  onChange={e => setForm(f => ({ ...f, lender_name: e.target.value }))}
                  placeholder="James Harrington"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lender Email</label>
                <input
                  type="email"
                  value={form.lender_email}
                  onChange={e => setForm(f => ({ ...f, lender_email: e.target.value }))}
                  placeholder="lender@bank.com"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lender Phone</label>
                <input
                  value={form.lender_phone}
                  onChange={e => setForm(f => ({ ...f, lender_phone: e.target.value }))}
                  placeholder="(512) 555-0201"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Maturity Date</label>
                <input
                  type="date"
                  value={form.loan_maturity_date}
                  onChange={e => setForm(f => ({ ...f, loan_maturity_date: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Current Balance ($)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.loan_balance_as_of}
                  onChange={e => setForm(f => ({ ...f, loan_balance_as_of: e.target.value }))}
                  placeholder="4800000.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Balance As-of Date</label>
                <input
                  type="date"
                  value={form.loan_balance_as_of_date}
                  onChange={e => setForm(f => ({ ...f, loan_balance_as_of_date: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">EMI Day of Month (1–31)</label>
                <input
                  type="number" min="1" max="31" step="1"
                  value={form.loan_emi_day}
                  onChange={e => setForm(f => ({ ...f, loan_emi_day: e.target.value }))}
                  placeholder="12"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">EMI Deduction Account</label>
                <input
                  value={form.loan_deduction_bank_account}
                  onChange={e => setForm(f => ({ ...f, loan_deduction_bank_account: e.target.value }))}
                  placeholder="Chase Business Checking ****4821"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Annual NOI ($) <span className="text-gray-400 font-normal">for DSCR</span></label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.noi_annual}
                  onChange={e => setForm(f => ({ ...f, noi_annual: e.target.value }))}
                  placeholder="620000.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Current Property Value ($) <span className="text-gray-400 font-normal">for LTV</span></label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.current_property_value}
                  onChange={e => setForm(f => ({ ...f, current_property_value: e.target.value }))}
                  placeholder="8500000.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(''); setForm({ ...BLANK_FORM }); }}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Create Loan'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : loans.length === 0 ? (
          <p className="text-center py-10 text-sm text-gray-400">No loans recorded. Add the first one above.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:-mx-6">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  {th('Company', 'company_name')}
                  {th('Property', 'property_name')}
                  {th('Bank', 'loan_bank_name')}
                  {th('Loan Date', 'loan_date')}
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    Account No
                  </th>
                  {th('Amount', 'loan_amount', 'right')}
                  {th('Rate', 'loan_interest_rate', 'right')}
                  {th('EMI', 'loan_emi', 'right')}
                  {th('Maturity', 'loan_maturity_date')}
                  {th('Balance', 'loan_balance_as_of', 'right')}
                  {th('DSCR', 'dscr', 'right')}
                  {th('LTV', 'ltv_current', 'right')}
                  {th('EMI Day', 'loan_emi_day')}
                  {th('Lender', 'lender_name')}
                  {canWrite && <th className="px-3 py-2 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(loan => {
                  const maturing = isMaturingSoon(loan.loan_maturity_date);
                  const accountDisplay = revealed[loan.id] ?? loan.loan_account_no;
                  const isRevealed = !!revealed[loan.id];
                  return (
                    <>
                      <tr
                        key={loan.id}
                        className={`hover:bg-gray-50 transition-colors ${maturing ? 'bg-amber-50/40' : ''}`}
                      >
                        {/* Expand toggle */}
                        <td className="px-3 py-2.5 text-center">
                          <button
                            onClick={() => setExpandedId(expandedId === loan.id ? null : loan.id)}
                            className="text-gray-400 hover:text-gray-700"
                          >
                            {expandedId === loan.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </td>

                        <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{loan.company_name}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{loan.property_name}</td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{loan.loan_bank_name}</td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{loan.loan_date ?? '—'}</td>

                        {/* Account number with reveal toggle */}
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-xs text-gray-600">{accountDisplay ?? '—'}</span>
                            {loan.loan_account_no && (
                              <button
                                onClick={() => handleReveal(loan.id)}
                                disabled={revealing === loan.id}
                                title={isRevealed ? 'Hide account number' : 'Reveal full account number'}
                                className="text-gray-300 hover:text-primary transition-colors disabled:opacity-40"
                              >
                                {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            )}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">
                          {fmtUSD(loan.loan_amount)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600 whitespace-nowrap">
                          {fmtRate(loan.loan_interest_rate)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                          {loan.loan_emi != null ? fmtUSD(loan.loan_emi) : '—'}
                        </td>

                        {/* Maturity date — amber badge if within 90 days */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {loan.loan_maturity_date ? (
                            <span className={`inline-flex items-center gap-1 text-xs ${maturing ? 'text-amber-700 font-semibold' : 'text-gray-500'}`}>
                              {maturing && <AlertTriangle size={11} className="text-amber-500 shrink-0" />}
                              {loan.loan_maturity_date}
                            </span>
                          ) : '—'}
                        </td>

                        <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                          {loan.loan_balance_as_of != null ? (
                            <>
                              {fmtUSD(loan.loan_balance_as_of)}
                              {loan.loan_balance_as_of_date && (
                                <div className="text-xs text-gray-400 font-normal">as of {loan.loan_balance_as_of_date}</div>
                              )}
                            </>
                          ) : '—'}
                        </td>

                        <td className={`px-3 py-2.5 text-right whitespace-nowrap ${dscrColor(loan.dscr)}`}>
                          {fmtDscr(loan.dscr)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600 whitespace-nowrap">
                          {fmtLtv(loan.ltv_current)}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtDay(loan.loan_emi_day)}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{loan.lender_name ?? '—'}</td>

                        {canWrite && (
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => handleDelete(loan.id)}
                              disabled={deleting === loan.id}
                              className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>

                      {/* Expandable detail drawer */}
                      {expandedId === loan.id && (
                        <tr key={`${loan.id}-drawer`} className="bg-slate-50">
                          <td colSpan={canWrite ? 16 : 15} className="px-6 py-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-10 gap-y-1.5 text-xs text-gray-600">
                              <div>
                                <span className="font-medium text-gray-500">Lender: </span>
                                {loan.lender_name ?? '—'}
                              </div>
                              {loan.lender_email && (
                                <div>
                                  <span className="font-medium text-gray-500">Lender Email: </span>
                                  <a href={`mailto:${loan.lender_email}`} className="text-primary hover:underline">
                                    {loan.lender_email}
                                  </a>
                                </div>
                              )}
                              {loan.lender_phone && (
                                <div>
                                  <span className="font-medium text-gray-500">Lender Phone: </span>
                                  {loan.lender_phone}
                                </div>
                              )}
                              <div>
                                <span className="font-medium text-gray-500">EMI Deduction Account: </span>
                                {loan.loan_deduction_bank_account ?? '—'}
                              </div>
                              <div>
                                <span className="font-medium text-gray-500">EMI Day: </span>
                                {fmtDay(loan.loan_emi_day)}
                              </div>
                              <div>
                                <span className="font-medium text-gray-500">Interest Rate: </span>
                                {fmtRate(loan.loan_interest_rate)}
                              </div>
                              {loan.loan_balance_as_of_date && (
                                <div>
                                  <span className="font-medium text-gray-500">Balance Date: </span>
                                  {loan.loan_balance_as_of_date}
                                </div>
                              )}
                              {loan.noi_annual != null && (
                                <div>
                                  <span className="font-medium text-gray-500">Annual NOI: </span>
                                  {fmtUSD(loan.noi_annual)}
                                </div>
                              )}
                              {loan.current_property_value != null && (
                                <div>
                                  <span className="font-medium text-gray-500">Property Value: </span>
                                  {fmtUSD(loan.current_property_value)}
                                </div>
                              )}
                              {loan.created_by && (
                                <div>
                                  <span className="font-medium text-gray-500">Added by: </span>
                                  {loan.created_by}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
