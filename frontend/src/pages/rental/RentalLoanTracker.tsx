import { useMemo, useRef, useState, useEffect } from 'react';
import { Download, Zap, CheckCircle2, TrendingDown, Plus, X, FileSpreadsheet, DollarSign, Briefcase, AlertCircle, TrendingUp, Calendar } from 'lucide-react';
import { useRentalCfoData, dscrStatus } from '../../hooks/useRentalCfoData';
import { LoadingSkeleton } from '../../components/ui/Table';
import { fmtUSD } from '../../components/ProtectedRoute';
import { api } from '../../services/api';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts';
import { BulletChartStrip } from '../../components/shared/BulletChartStrip';
import type { BulletDef, BulletCard } from '../../components/shared/BulletChartStrip';

const MARKET_RATE = 0.065;

const DSCR_STYLE = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', grey: 'bg-gray-100 text-gray-600' };

// Parchment theme tokens
const PT = {
  pageBg:   '#F7F1E6',
  cardBg:   '#FBF6EE',
  border:   '#E8DEC8',
  hdrBg:    '#EFE0C8',
  hdrText:  '#5C5043',
  rowOdd:   '#F7F1E6',
  rowEven:  '#FBF6EE',
  text:     '#262626',
  muted:    '#6B6B6B',
};


const EMPTY_FORM = {
  company_name: '', property_name: '', loan_bank_name: '',
  loan_amount: '', loan_interest_rate: '', loan_emi: '',
  loan_emi_day: '', loan_maturity_date: '', loan_balance_as_of: '',
  loan_balance_as_of_date: '', loan_date: '', noi_annual: '',
  current_property_value: '', lender_name: '', lender_phone: '',
};

function AddLoanDrawer({ open, onClose, onSaved, companyNames }: {
  open: boolean; onClose: () => void; onSaved: () => void; companyNames: string[];
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company_name || !form.property_name || !form.loan_bank_name || !form.loan_amount) {
      setErr('Company, Property, Bank, and Loan Amount are required.'); return;
    }
    setSaving(true); setErr('');
    try {
      await api.post('/api/real-estate/loans', {
        company_name: form.company_name,
        property_name: form.property_name,
        loan_bank_name: form.loan_bank_name,
        loan_amount: parseFloat(form.loan_amount),
        loan_interest_rate: form.loan_interest_rate ? parseFloat(form.loan_interest_rate) / 100 : null,
        loan_emi: form.loan_emi ? parseFloat(form.loan_emi) : null,
        loan_emi_day: form.loan_emi_day ? parseInt(form.loan_emi_day) : null,
        loan_maturity_date: form.loan_maturity_date || null,
        loan_balance_as_of: form.loan_balance_as_of ? parseFloat(form.loan_balance_as_of) : null,
        loan_balance_as_of_date: form.loan_balance_as_of_date || null,
        loan_date: form.loan_date || null,
        noi_annual: form.noi_annual ? parseFloat(form.noi_annual) : null,
        current_property_value: form.current_property_value ? parseFloat(form.current_property_value) : null,
        lender_name: form.lender_name || null,
        lender_phone: form.lender_phone || null,
        context_type: 'rental',
      });
      setForm({ ...EMPTY_FORM });
      onSaved();
      onClose();
    } catch (ex: unknown) {
      const msg = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? 'Failed to save loan. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const F = ({ label, id, type = 'text', required = false, placeholder = '', hint = '' }: {
    label: string; id: keyof typeof EMPTY_FORM; type?: string; required?: boolean; placeholder?: string; hint?: string;
  }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type} value={form[id]} onChange={e => set(id, e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-900 text-white shrink-0">
          <h2 className="font-bold text-lg">Add Loan</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Property</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Company<span className="text-red-500 ml-0.5">*</span></label>
                <input list="co-opts" value={form.company_name} onChange={e => { set('company_name', e.target.value); set('property_name', e.target.value); }}
                  placeholder="ABC LLC"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                <datalist id="co-opts">{companyNames.map(n => <option key={n} value={n} />)}</datalist>
              </div>
              <F label="Building / Suite" id="property_name" required placeholder="Suite 123" />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Loan Details</p>
            <div className="grid grid-cols-2 gap-3">
              <F label="Bank / Lender" id="loan_bank_name" required placeholder="Bank of America" />
              <F label="Loan Amount ($)" id="loan_amount" type="number" required placeholder="500000" />
              <F label="Interest Rate (%)" id="loan_interest_rate" type="number" placeholder="6.5" hint="Enter as percentage e.g. 6.5 for 6.5%" />
              <F label="Monthly EMI ($)" id="loan_emi" type="number" placeholder="3200" />
              <F label="EMI Day of Month" id="loan_emi_day" type="number" placeholder="1" hint="1–31, day EMI is debited" />
              <F label="Loan Date" id="loan_date" type="date" />
              <F label="Maturity Date" id="loan_maturity_date" type="date" />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Outstanding Balance</p>
            <div className="grid grid-cols-2 gap-3">
              <F label="Current Balance ($)" id="loan_balance_as_of" type="number" placeholder="480000" />
              <F label="Balance As-Of Date" id="loan_balance_as_of_date" type="date" />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">DSCR / LTV Inputs (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <F label="NOI Annual ($)" id="noi_annual" type="number" placeholder="42000" hint="Net Operating Income per year" />
              <F label="Property Value ($)" id="current_property_value" type="number" placeholder="750000" hint="Current market value for LTV calc" />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Lender Contact (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <F label="Contact Name" id="lender_name" placeholder="John Smith" />
              <F label="Phone" id="lender_phone" placeholder="+1 555 000 0000" />
            </div>
          </div>
        </form>

        <div className="px-6 py-4 border-t bg-gray-50 shrink-0 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-100">Cancel</button>
          <button type="submit" disabled={saving} onClick={submit}
            className="px-6 py-2 text-sm rounded-lg bg-accent hover:bg-accent/90 text-primary font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Loan'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RentalLoanTracker() {
  const { companies, buildings, loans, loading, error, reload } = useRentalCfoData();
  const [companyFilter, setCompanyFilter] = useState('all');
  const [buildingFilter, setBuildingFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // DEBUG: Log data state
  useEffect(() => {
    console.log('🔍 Loan Tracker Debug:', { loading, error, loansCount: loans?.length ?? 0, companiesCount: companies?.length ?? 0 });
  }, [loading, error, loans, companies]);

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post<{ created: number; message: string }>('/api/real-estate/loans/import-excel', fd);
      setImportMsg({ text: res.data.message, ok: true });
      reload();
    } catch (ex: unknown) {
      const msg = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setImportMsg({ text: msg ?? 'Import failed — check the file format.', ok: false });
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  const buildingOptions = useMemo(() => {
    const names = new Set(loans.map(l => l.property_name));
    return [...names].sort();
  }, [loans]);

  const filtered = useMemo(() => {
    let rows = loans;
    if (companyFilter !== 'all') {
      const co = companies.find(c => c.id === companyFilter);
      if (co) rows = rows.filter(l => l.company_name === co.company_name);
    }
    if (buildingFilter !== 'all') rows = rows.filter(l => l.property_name === buildingFilter);
    return rows;
  }, [loans, companyFilter, buildingFilter, companies]);

  const kpis = useMemo(() => {
    const portfolio = filtered.reduce((s, l) => s + (l.loan_balance_as_of ?? l.loan_amount), 0);
    const emi = filtered.reduce((s, l) => s + (l.loan_emi ?? 0), 0);
    const rates = filtered.filter(l => l.loan_interest_rate != null);
    const wAvg = rates.length > 0
      ? rates.reduce((s, l) => s + (l.loan_interest_rate ?? 0) * (l.loan_balance_as_of ?? l.loan_amount), 0) /
        rates.reduce((s, l) => s + (l.loan_balance_as_of ?? l.loan_amount), 0)
      : 0;
    const nextMat = filtered
      .filter(l => l.loan_maturity_date)
      .sort((a, b) => (a.loan_maturity_date ?? '').localeCompare(b.loan_maturity_date ?? ''))[0];
    return { portfolio, emi, wAvg, nextMat };
  }, [filtered]);

  const highRateLoans = filtered.filter(l => (l.loan_interest_rate ?? 0) > MARKET_RATE);
  const monthlySavings = highRateLoans.reduce((s, l) => {
    const bal = l.loan_balance_as_of ?? l.loan_amount;
    return s + bal * ((l.loan_interest_rate ?? 0) - MARKET_RATE) / 12;
  }, 0);

  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  const dscrHealth = useMemo(() => buildings.map(b => {
    const bLoans = loans.filter(l => l.company_name === b.companyName && l.property_name === b.buildingName);
    const debtService = bLoans.reduce((s, l) => s + (l.loan_emi ?? 0) * 12, 0);
    const noiAnnual = b.noi * 12;
    const dscr = debtService > 0 ? noiAnnual / debtService : null;
    const st = dscrStatus(dscr);
    return {
      building: b.buildingName,
      noi: noiAnnual,
      debtService,
      dscr,
      status: st,
      recommendation: st === 'red' ? 'Reduce debt or boost NOI' : st === 'amber' ? 'Monitor closely' : 'Healthy coverage',
    };
  }), [buildings, loans]);

  const debtByBuildingData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(l => {
      map[l.property_name] = (map[l.property_name] || 0) + (l.loan_balance_as_of ?? l.loan_amount);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const emiByBankData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(l => {
      map[l.loan_bank_name] = (map[l.loan_bank_name] || 0) + (l.loan_emi ?? 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const rateComparisonData = useMemo(() => {
    return filtered
      .filter(l => l.loan_interest_rate != null)
      .map(l => ({
        name: l.property_name,
        rate: (l.loan_interest_rate ?? 0) * 100,
        market: MARKET_RATE * 100,
      }));
  }, [filtered]);

  const maturityTimelineData = useMemo(() => {
    const now = new Date();
    return filtered
      .filter(l => l.loan_maturity_date)
      .sort((a, b) => (a.loan_maturity_date ?? '').localeCompare(b.loan_maturity_date ?? ''))
      .map(l => {
        const matDate = new Date(l.loan_maturity_date!);
        const monthsLeft = (matDate.getFullYear() - now.getFullYear()) * 12 + (matDate.getMonth() - now.getMonth());
        let color = '#10B981';
        if (monthsLeft < 12) color = '#EF4444';
        else if (monthsLeft < 24) color = '#F59E0B';
        return { ...l, monthsLeft, color };
      });
  }, [filtered]);

  // ── New KPIs ────────────────────────────────────────────────────────────────
  const extKpis = useMemo(() => {
    const now = new Date();
    const totalOutstanding = filtered.reduce((s, l) => s + (l.loan_balance_as_of ?? l.loan_amount), 0);

    // Weighted avg remaining term (months), weighted by outstanding balance
    const loansWithMaturity = filtered.filter(l => l.loan_maturity_date);
    const weightedTermNum = loansWithMaturity.reduce((s, l) => {
      const bal = l.loan_balance_as_of ?? l.loan_amount;
      const mat = new Date(l.loan_maturity_date!);
      const months = Math.max(0, (mat.getFullYear() - now.getFullYear()) * 12 + mat.getMonth() - now.getMonth());
      return s + months * bal;
    }, 0);
    const weightedTermDen = loansWithMaturity.reduce((s, l) => s + (l.loan_balance_as_of ?? l.loan_amount), 0);
    const weightedAvgTerm = weightedTermDen > 0 ? weightedTermNum / weightedTermDen : null;

    // Maturing in next 12 months
    const in12 = filtered.filter(l => {
      if (!l.loan_maturity_date) return false;
      const mat = new Date(l.loan_maturity_date);
      const months = (mat.getFullYear() - now.getFullYear()) * 12 + mat.getMonth() - now.getMonth();
      return months >= 0 && months <= 12;
    });
    const maturingCount = in12.length;
    const maturingAmt   = in12.reduce((s, l) => s + (l.loan_balance_as_of ?? l.loan_amount), 0);

    // Average LTV (only where current_property_value is populated)
    const ltvLoans = filtered.filter(l => l.current_property_value && l.current_property_value > 0);
    const avgLtv = ltvLoans.length > 0
      ? ltvLoans.reduce((s, l) => {
          const bal = l.loan_balance_as_of ?? l.loan_amount;
          return s + (bal / l.current_property_value!) * 100;
        }, 0) / ltvLoans.length
      : null;
    const ltvCount = ltvLoans.length;

    // Portfolio DSCR: total annual NOI / total annual debt service
    const totalDebtService = filtered.reduce((s, l) => s + (l.loan_emi ?? 0) * 12, 0);
    const noiLoans = filtered.filter(l => l.noi_annual && l.noi_annual > 0);
    const totalNoi = noiLoans.reduce((s, l) => s + (l.noi_annual ?? 0), 0);
    const portfolioDscr = totalDebtService > 0 && totalNoi > 0 ? totalNoi / totalDebtService : null;

    // Concentration risk: largest building share & largest lender share
    const byBuilding: Record<string, number> = {};
    const byLender:   Record<string, number> = {};
    filtered.forEach(l => {
      const bal = l.loan_balance_as_of ?? l.loan_amount;
      byBuilding[l.property_name]  = (byBuilding[l.property_name]  || 0) + bal;
      byLender[l.loan_bank_name]   = (byLender[l.loan_bank_name]   || 0) + bal;
    });
    const maxBuilding = Object.entries(byBuilding).sort((a, b) => b[1] - a[1])[0];
    const maxLender   = Object.entries(byLender).sort((a, b) => b[1] - a[1])[0];
    const topBuildingPct  = totalOutstanding > 0 && maxBuilding ? maxBuilding[1] / totalOutstanding * 100 : null;
    const topLenderPct    = totalOutstanding > 0 && maxLender   ? maxLender[1]   / totalOutstanding * 100 : null;

    return {
      weightedAvgTerm, maturingCount, maturingAmt, avgLtv, ltvCount,
      portfolioDscr, totalNoi, totalDebtService,
      topBuilding: maxBuilding?.[0] ?? '', topBuildingPct,
      topLender:   maxLender?.[0]   ?? '', topLenderPct,
    };
  }, [filtered]);

  // Maturity Ladder — debt maturing per calendar year (aggregated)
  const maturityLadderData = useMemo(() => {
    const byYear: Record<number, number> = {};
    filtered.forEach(l => {
      if (!l.loan_maturity_date) return;
      const yr = new Date(l.loan_maturity_date).getFullYear();
      byYear[yr] = (byYear[yr] || 0) + (l.loan_balance_as_of ?? l.loan_amount);
    });
    return Object.entries(byYear)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([year, amount]) => ({ year, amount }));
  }, [filtered]);

  // Rate variance (bps above/below MARKET_RATE)
  const rateVarianceData = useMemo(() => {
    return filtered
      .filter(l => l.loan_interest_rate != null)
      .map(l => ({
        name: l.property_name,
        bps: Math.round(((l.loan_interest_rate ?? 0) - MARKET_RATE) * 10000),
        bal: l.loan_balance_as_of ?? l.loan_amount,
      }))
      .sort((a, b) => b.bps - a.bps);
  }, [filtered]);

  // Debt by Building — ranked bar (replaces donut)
  const debtByBuildingRanked = useMemo(() => {
    return [...debtByBuildingData]
      .sort((a, b) => b.value - a.value)
      .map(d => ({ ...d, label: d.name.length > 16 ? d.name.slice(0, 14) + '…' : d.name }));
  }, [debtByBuildingData]);

  // DSCR Bullet Chart data
  const dscrBulletCards: BulletCard[] = useMemo(() => dscrHealth
    .filter(r => r.dscr != null)
    .map(r => ({
      name: r.building,
      value: `${r.dscr!.toFixed(2)}x`,
      status: r.dscr! > 1.25 ? 'good' : r.dscr! >= 1.0 ? 'monitor' : 'critical',
    } satisfies BulletCard)), [dscrHealth]);

  const dscrBulletDefs: BulletDef[] = useMemo(() => dscrHealth
    .filter(r => r.dscr != null)
    .map(r => ({
      names: [r.building],
      benchmark: 1.25,
      unit: 'x',
      reversed: false,
      max: 3,
      extract: v => parseFloat(v) || 0,
    })), [dscrHealth]);

  if (loading) return <LoadingSkeleton rows={10} />;
  if (error) return <div className="text-red-600 p-4">{error}<button className="ml-3 underline" onClick={reload}>Retry</button></div>;

  return (
    <div className="space-y-6 -m-6 p-6" style={{ background: PT.pageBg }}>
      <AddLoanDrawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={reload}
        companyNames={companies.map(c => c.company_name)}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: '#1C1917', lineHeight: 1.25 }}>Loan Tracker</h1>
          <p style={{ fontSize: 13, fontWeight: 400, color: '#6B6B6B', marginTop: 2 }}>Rental property debt portfolio · DSCR analysis, refinancing &amp; amortization</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setBuildingFilter('all'); }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="all">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <select value={buildingFilter} onChange={e => setBuildingFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="all">All Buildings</option>
            {buildingOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs"><Download size={13} /> Export</button>
          <button className="flex items-center gap-1 px-3 py-1.5 bg-accent text-primary rounded-lg text-xs"><Zap size={13} /> AI Insights</button>
          <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} />
          <button
            onClick={() => importRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            <FileSpreadsheet size={14} />{importing ? 'Importing…' : 'Import Excel'}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium">
            <Plus size={14} /> Add Loan
          </button>
        </div>
      </div>

      {importMsg && (
        <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm border ${importMsg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <span>{importMsg.text}</span>
          <button onClick={() => setImportMsg(null)} className="text-xs underline shrink-0">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Loan Portfolio', value: fmtUSD(kpis.portfolio ?? 0) },
          { label: 'Total Monthly EMI', value: fmtUSD(kpis.emi ?? 0) },
          { label: 'Weighted Avg Rate', value: `${((kpis.wAvg ?? 0) * 100).toFixed(2)}%` },
          { label: 'Next Maturity', value: kpis.nextMat?.loan_maturity_date ?? '—', sub: kpis.nextMat?.property_name },
          { label: 'Total Outstanding', value: fmtUSD(filtered.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0) ?? 0) },
        ].map(k => (
          <div key={k.label} style={{ background: PT.cardBg, border: `0.5px solid ${PT.border}`, borderRadius: 8, padding: '16px 16px 12px' }}>
            <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: PT.muted, marginBottom: 8 }}>{k.label}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: PT.text, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums lining-nums' }}>{k.value}</p>
            {k.sub && <p style={{ fontSize: 12, color: PT.muted, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Second KPI row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Portfolio DSCR */}
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 8, padding: '16px 16px 12px',
          borderLeft: extKpis.portfolioDscr == null ? `3px solid ${PT.border}` : extKpis.portfolioDscr > 1.25 ? '3px solid #22A06B' : extKpis.portfolioDscr >= 1.0 ? '3px solid #F2C94C' : '3px solid #EB5757' }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: PT.muted, marginBottom: 8 }}>Portfolio DSCR</p>
          {extKpis.portfolioDscr != null ? (
            <>
              <p style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums lining-nums',
                color: extKpis.portfolioDscr > 1.25 ? '#22A06B' : extKpis.portfolioDscr >= 1.0 ? '#F2C94C' : '#EB5757' }}>
                {extKpis.portfolioDscr.toFixed(2)}x
              </p>
              <p style={{ fontSize: 11, color: PT.muted, marginTop: 4 }}>NOI {fmtUSD(extKpis.totalNoi)}/yr ÷ DS {fmtUSD(extKpis.totalDebtService)}/yr</p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 16, fontWeight: 600, color: PT.muted }}>Not available</p>
              <p style={{ fontSize: 11, color: PT.muted, marginTop: 4 }}>Add NOI Annual to loans for DSCR</p>
            </>
          )}
        </div>

        {/* Weighted Avg Remaining Term */}
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 8, padding: '16px 16px 12px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: PT.muted, marginBottom: 8 }}>Wtd Avg Remaining Term</p>
          {extKpis.weightedAvgTerm != null ? (
            <>
              <p style={{ fontSize: 28, fontWeight: 700, color: extKpis.weightedAvgTerm < 12 ? '#EB5757' : extKpis.weightedAvgTerm < 36 ? '#F2C94C' : PT.text, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums lining-nums' }}>
                {Math.round(extKpis.weightedAvgTerm)}mo
              </p>
              <p style={{ fontSize: 11, color: PT.muted, marginTop: 4 }}>~{(extKpis.weightedAvgTerm / 12).toFixed(1)} yrs · weighted by balance</p>
            </>
          ) : (
            <p style={{ fontSize: 16, fontWeight: 600, color: PT.muted }}>No maturity dates</p>
          )}
        </div>

        {/* Maturing in 12 months */}
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 8, padding: '16px 16px 12px',
          borderLeft: extKpis.maturingCount > 0 ? '3px solid #EB5757' : `1px solid ${PT.border}` }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: PT.muted, marginBottom: 8 }}>Maturing ≤12 Months</p>
          <p style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2, color: extKpis.maturingCount > 0 ? '#EB5757' : '#22A06B' }}>
            {extKpis.maturingCount} loan{extKpis.maturingCount !== 1 ? 's' : ''}
          </p>
          <p style={{ fontSize: 11, color: PT.muted, marginTop: 4 }}>
            {extKpis.maturingCount > 0 ? fmtUSD(extKpis.maturingAmt) + ' coming due' : 'No near-term maturities'}
          </p>
        </div>

        {/* Average LTV / Concentration */}
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 8, padding: '16px 16px 12px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: PT.muted, marginBottom: 8 }}>Average LTV</p>
          {extKpis.avgLtv != null ? (
            <>
              <p style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums lining-nums',
                color: extKpis.avgLtv <= 75 ? '#22A06B' : extKpis.avgLtv <= 85 ? '#F2C94C' : '#EB5757' }}>
                {extKpis.avgLtv.toFixed(1)}%
              </p>
              <p style={{ fontSize: 11, color: PT.muted, marginTop: 4 }}>{extKpis.ltvCount} of {filtered.length} loans have property value</p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 16, fontWeight: 600, color: PT.muted }}>Not available</p>
              <p style={{ fontSize: 11, color: PT.muted, marginTop: 4 }}>Add Property Value to loans for LTV</p>
            </>
          )}
        </div>
      </div>

      {/* Concentration Risk + Fixed/Floating row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 8, padding: '16px 16px 12px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: PT.muted, marginBottom: 10 }}>Building Concentration Risk</p>
          {extKpis.topBuildingPct != null ? (
            <>
              <p style={{ fontSize: 22, fontWeight: 700, color: extKpis.topBuildingPct > 50 ? '#EB5757' : extKpis.topBuildingPct > 33 ? '#F2C94C' : '#22A06B', fontVariantNumeric: 'tabular-nums lining-nums' }}>
                {extKpis.topBuildingPct.toFixed(0)}%
              </p>
              <p style={{ fontSize: 12, color: PT.muted, marginTop: 4 }}>Largest: {extKpis.topBuilding}</p>
            </>
          ) : <p style={{ fontSize: 14, color: PT.muted }}>—</p>}
        </div>
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 8, padding: '16px 16px 12px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: PT.muted, marginBottom: 10 }}>Lender Concentration Risk</p>
          {extKpis.topLenderPct != null ? (
            <>
              <p style={{ fontSize: 22, fontWeight: 700, color: extKpis.topLenderPct > 60 ? '#EB5757' : extKpis.topLenderPct > 40 ? '#F2C94C' : '#22A06B', fontVariantNumeric: 'tabular-nums lining-nums' }}>
                {extKpis.topLenderPct.toFixed(0)}%
              </p>
              <p style={{ fontSize: 12, color: PT.muted, marginTop: 4 }}>Largest lender: {extKpis.topLender}</p>
            </>
          ) : <p style={{ fontSize: 14, color: PT.muted }}>—</p>}
        </div>
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 8, padding: '16px 16px 12px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: PT.muted, marginBottom: 10 }}>Fixed vs Floating Split</p>
          <p style={{ fontSize: 16, fontWeight: 600, color: PT.muted }}>Not available</p>
          <p style={{ fontSize: 11, color: PT.muted, marginTop: 4 }}>Rate type not tracked per loan</p>
        </div>
      </div>

      <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${PT.border}` }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text }}>Loan Register</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: PT.hdrBg }}>
                {([
                  ['Company', 'left'], ['Building', 'left'], ['Bank', 'left'],
                  ['Loan Amount', 'right'], ['Rate', 'right'], ['EMI', 'right'],
                  ['Outstanding', 'right'], ['Maturity', 'right'], ['EMI Day', 'right'],
                  ['DSCR', 'right'], ['Status', 'right'],
                ] as [string, string][]).map(([h, align]) => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: align as 'left' | 'right', fontSize: 12, fontWeight: 600, color: PT.hdrText, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: `1px solid ${PT.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, idx) => {
                const st = dscrStatus(l.dscr);
                const rate = l.loan_interest_rate != null ? l.loan_interest_rate * 100 : null;
                const rateColor = rate == null ? PT.muted : rate <= 6.5 ? '#22A06B' : '#F5A623';
                const now = new Date();
                const matColor = (() => {
                  if (!l.loan_maturity_date) return PT.text;
                  const mat = new Date(l.loan_maturity_date);
                  const months = (mat.getFullYear() - now.getFullYear()) * 12 + mat.getMonth() - now.getMonth();
                  return months < 12 ? '#D9534F' : PT.text;
                })();
                const dscrColor = l.dscr == null ? PT.muted : l.dscr < 1.0 ? '#D9534F' : l.dscr <= 1.25 ? '#F5A623' : '#22A06B';
                return (
                  <tr key={l.id} style={{ background: idx % 2 === 0 ? PT.rowOdd : PT.rowEven, borderBottom: `1px solid ${PT.border}` }}>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: PT.text }}>{l.company_name}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: PT.text }}>{l.property_name}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: PT.text }}>{l.loan_bank_name}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: PT.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>{fmtUSD(l.loan_amount)}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: rateColor, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums', fontWeight: 600 }}>{rate != null ? `${rate.toFixed(2)}%` : '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: PT.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>{l.loan_emi != null ? fmtUSD(l.loan_emi) : '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: PT.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>{fmtUSD(l.loan_balance_as_of ?? l.loan_amount)}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: matColor, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums', fontWeight: matColor === '#D9534F' ? 600 : 400 }}>{l.loan_maturity_date ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: PT.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>{l.loan_emi_day ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: dscrColor, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums', fontWeight: 600 }}>{l.dscr != null ? `${l.dscr.toFixed(2)}x` : '—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${DSCR_STYLE[st]}`}>{st}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-center py-8 text-sm" style={{ color: PT.muted }}>No loans found for rental portfolio</p>}
        </div>
      </div>

      <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: PT.text, marginBottom: 12 }}>EMI Calendar — {today.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
            const dueLoans = filtered.filter(l => l.loan_emi_day === d);
            if (dueLoans.length === 0) return <div key={d} style={{ width: 28, height: 28, fontSize: 11, color: '#C5BDB0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{d}</div>;
            return (
              <div key={d} className="relative group">
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#22A06B', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 3 }}>{d}</div>
                <div className="hidden group-hover:block absolute z-10 top-7 left-0 bg-gray-900 text-white text-xs rounded p-2 whitespace-nowrap">
                  {dueLoans.map(l => <div key={l.id}>{l.loan_bank_name}: {fmtUSD(l.loan_emi ?? 0)}</div>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        {/* Refinancing opportunity banner */}
        {highRateLoans.length > 0 && (
          <div style={{ background: '#FFF7E8', borderLeft: '4px solid #F2994A', borderRadius: '0 8px 8px 0', padding: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle size={18} style={{ color: '#F2994A', flexShrink: 0, marginTop: 1 }} />
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#7A4500', marginBottom: 2 }}>Refinancing Opportunity</h4>
              <p style={{ fontSize: 13, color: '#7A4500' }}>
                {highRateLoans.length} loan(s) above market rate ({(MARKET_RATE * 100).toFixed(1)}%).
                Est. monthly savings: <strong>{fmtUSD(monthlySavings)}</strong> ({fmtUSD(monthlySavings * 12)}/yr)
              </p>
            </div>
          </div>
        )}

        {/* Cash / EMI alert banner */}
        {kpis.emi > 0 && kpis.emi * 12 > kpis.portfolio * 0.12 && (
          <div style={{ background: '#FFECEC', borderLeft: '4px solid #EB5757', borderRadius: '0 8px 8px 0', padding: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <TrendingDown size={18} style={{ color: '#EB5757', flexShrink: 0, marginTop: 1 }} />
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#7B0000', marginBottom: 2 }}>High Debt Service</h4>
              <p style={{ fontSize: 13, color: '#7B0000' }}>
                Annual EMI of <strong>{fmtUSD(kpis.emi * 12)}</strong> exceeds 12% of loan portfolio — review cash reserves.
              </p>
            </div>
          </div>
        )}

        {/* Rate advantage banner */}
        {highRateLoans.length === 0 && filtered.length > 0 && (
          <div style={{ background: '#F4FFF3', borderLeft: '4px solid #27AE60', borderRadius: '0 8px 8px 0', padding: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <CheckCircle2 size={18} style={{ color: '#27AE60', flexShrink: 0, marginTop: 1 }} />
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#1A5C33', marginBottom: 2 }}>All Rates Optimized</h4>
              <p style={{ fontSize: 13, color: '#1A5C33' }}>All loans at or below market rate ({(MARKET_RATE * 100).toFixed(1)}%). No refinancing action needed.</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text, marginBottom: 4 }}>Debt by Building</h3>
          <p style={{ fontSize: 12, color: PT.muted, marginBottom: 16 }}>Outstanding balance ranked highest to lowest</p>
          {debtByBuildingRanked.length === 0 ? (
            <p style={{ fontSize: 13, color: PT.muted }}>No loan data</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, debtByBuildingRanked.length * 38)}>
              <BarChart data={debtByBuildingRanked} layout="vertical" margin={{ left: 0, right: 60, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PT.border} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: PT.muted }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12, fill: PT.text }} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} labelFormatter={(_l, payload) => payload?.[0]?.payload?.name ?? ''} />
                <Bar dataKey="value" name="Balance" radius={[0, 4, 4, 0]}>
                  {debtByBuildingRanked.map((_, i) => <Cell key={i} fill={i === 0 ? '#D4AF37' : i === 1 ? '#F2C94C' : '#E8DEC8'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text, marginBottom: 16 }}>EMI Breakdown by Bank</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={emiByBankData} margin={{ left: 0, right: 10, top: 16, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={PT.border} />
              <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11, fill: PT.muted }} />
              <YAxis tick={{ fontSize: 11, fill: PT.muted }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="value" fill="#D4AF37" name="Monthly EMI" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="value" position="top" formatter={(v: number) => fmtUSD(v)} style={{ fontSize: 10, fill: PT.text }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text, marginBottom: 4 }}>Maturity Ladder</h3>
          <p style={{ fontSize: 12, color: PT.muted, marginBottom: 16 }}>Total debt maturing per calendar year</p>
          {maturityLadderData.length === 0 ? (
            <p style={{ fontSize: 13, color: PT.muted }}>No maturity dates recorded</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={maturityLadderData} margin={{ left: 0, right: 10, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PT.border} />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: PT.muted }} />
                <YAxis tick={{ fontSize: 11, fill: PT.muted }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} labelFormatter={l => `Year ${l}`} />
                <Bar dataKey="amount" name="Maturing Balance" radius={[4, 4, 0, 0]}>
                  {maturityLadderData.map((d, i) => {
                    const yr = typeof d.year === 'string' ? parseInt(d.year) : d.year;
                    const now = new Date().getFullYear();
                    return <Cell key={i} fill={yr - now <= 1 ? '#EB5757' : yr - now <= 2 ? '#F2C94C' : '#D4AF37'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text, marginBottom: 4 }}>Rate Variance vs Market ({(MARKET_RATE * 100).toFixed(1)}%)</h3>
          <p style={{ fontSize: 12, color: PT.muted, marginBottom: 16 }}>Basis points above (↑ costly) or below (↓ good) the {(MARKET_RATE * 100).toFixed(1)}% benchmark</p>
          {rateVarianceData.length === 0 ? (
            <p style={{ fontSize: 13, color: PT.muted }}>No interest rate data</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={rateVarianceData} margin={{ left: 0, right: 10, top: 8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PT.border} />
                <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11, fill: PT.muted }} />
                <YAxis tick={{ fontSize: 11, fill: PT.muted }} tickFormatter={v => `${v > 0 ? '+' : ''}${v}bps`} />
                <Tooltip formatter={(v: number) => [`${v > 0 ? '+' : ''}${v} bps`, 'Rate vs Market']} />
                <ReferenceLine y={0} stroke={PT.border} strokeWidth={2} />
                <Bar dataKey="bps" name="Rate vs Market" radius={[4, 4, 0, 0]}>
                  {rateVarianceData.map((d, i) => <Cell key={i} fill={d.bps <= 0 ? '#22A06B' : d.bps <= 50 ? '#F2C94C' : '#EB5757'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {dscrBulletCards.length > 0 && (
        <BulletChartStrip
          cards={dscrBulletCards}
          defs={dscrBulletDefs}
          title="DSCR by Building"
          subtitle="Debt Service Coverage Ratio vs 1.25x benchmark — bar colour reflects coverage health · ▎ marker = 1.25x target"
        />
      )}

      <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${PT.border}` }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text }}>Building DSCR Health</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: PT.hdrBg }}>
                {(['Building', 'NOI (Annual)', 'Debt Service', 'DSCR Ratio', 'Status', 'Recommendation'] as const).map((h, i) => (
                  <th key={h} style={{ padding: '9px 16px', textAlign: i === 0 || i === 5 ? 'left' : i === 4 ? 'center' : 'right', fontSize: 12, fontWeight: 600, color: PT.hdrText, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: `1px solid ${PT.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dscrHealth.map((row, idx) => {
                const dscrColor = row.dscr == null ? PT.muted : row.dscr < 1.0 ? '#D9534F' : row.dscr <= 1.25 ? '#F5A623' : '#22A06B';
                return (
                  <tr key={row.building} style={{ background: idx % 2 === 0 ? PT.rowOdd : PT.rowEven, borderBottom: `1px solid ${PT.border}` }}>
                    <td style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, color: PT.text }}>{row.building}</td>
                    <td style={{ padding: '9px 16px', fontSize: 13, color: PT.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>{fmtUSD(row.noi)}</td>
                    <td style={{ padding: '9px 16px', fontSize: 13, color: PT.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>{fmtUSD(row.debtService)}</td>
                    <td style={{ padding: '9px 16px', fontSize: 14, fontWeight: 700, color: dscrColor, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>
                      {row.dscr != null ? `${row.dscr.toFixed(2)}x` : '—'}
                    </td>
                    <td style={{ padding: '9px 16px', textAlign: 'center' }}>
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium capitalize ${DSCR_STYLE[row.status]}`}>
                        {row.status}
                      </span>
                    </td>
                    <td style={{ padding: '9px 16px', fontSize: 13, color: PT.muted }}>{row.recommendation}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {dscrHealth.length === 0 && (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: PT.muted, fontSize: 13 }}>No buildings with loans found</div>
          )}
        </div>
      </div>
    </div>
  );
}
