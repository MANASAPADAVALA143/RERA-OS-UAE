import { useMemo, useRef, useState, useEffect } from 'react';
import { Download, Zap, CheckCircle2, TrendingDown, Plus, X, FileSpreadsheet, DollarSign, Briefcase, AlertCircle, TrendingUp, Calendar } from 'lucide-react';
import { useRentalCfoData, dscrStatus } from '../../hooks/useRentalCfoData';
import { LoadingSkeleton } from '../../components/ui/Table';
import { fmtUSD } from '../../components/ProtectedRoute';
import { api } from '../../services/api';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';

const MARKET_RATE = 0.065;

const DSCR_STYLE = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', grey: 'bg-gray-100 text-gray-600' };

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
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
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
            className="px-6 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">
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

  if (loading) return <LoadingSkeleton rows={10} />;
  if (error) return <div className="text-red-600 p-4">{error}<button className="ml-3 underline" onClick={reload}>Retry</button></div>;

  return (
    <div className="space-y-6 -m-6 p-6" style={{ background: 'transparent' }}>
      <AddLoanDrawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={reload}
        companyNames={companies.map(c => c.company_name)}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Loan Tracker</h1>
          <p className="text-sm text-gray-500">Rental property debt portfolio</p>
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
          <button className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs"><Zap size={13} /> AI Insights</button>
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
          { label: 'Total Loan Portfolio', value: fmtUSD(kpis.portfolio ?? 0), icon: DollarSign, color: 'rgba(59, 130, 246, 0.15)', border: '#3B82F6' },
          { label: 'Total Monthly EMI', value: fmtUSD(kpis.emi ?? 0), icon: TrendingUp, color: 'rgba(139, 92, 246, 0.15)', border: '#8B5CF6' },
          { label: 'Weighted Avg Rate', value: `${((kpis.wAvg ?? 0) * 100).toFixed(2)}%`, icon: AlertCircle, color: 'rgba(251, 146, 60, 0.15)', border: '#FB923C' },
          { label: 'Next Maturity', value: kpis.nextMat?.loan_maturity_date ?? '—', icon: Calendar, color: 'rgba(34, 197, 94, 0.15)', border: '#22C55E', sub: kpis.nextMat?.property_name },
          { label: 'Total Outstanding', value: fmtUSD(filtered.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0) ?? 0), icon: Briefcase, color: 'rgba(168, 85, 247, 0.15)', border: '#A855F7' },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border p-5" style={{ background: '#FFFFFF', borderColor: '#E5E7EB', borderLeft: `4px solid ${k.border}` }}>
              <div className="flex items-start justify-between mb-3">
                <p style={{ fontSize: '12px', color: '#666666', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>{k.label}</p>
                <div style={{ background: k.color, width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} style={{ color: k.border }} />
                </div>
              </div>
              <p style={{ fontSize: '24px', fontWeight: 'bold', fontFamily: 'monospace', color: '#1F2937', minHeight: '32px' }}>{k.value}</p>
              {k.sub && <p style={{ fontSize: '12px', color: '#888888', marginTop: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.sub}</p>}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-900 text-white"><h3 className="font-semibold">Loan Register</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {([
                  ['Company', 'left'], ['Building', 'left'], ['Bank', 'left'],
                  ['Loan Amount', 'right'], ['Rate', 'right'], ['EMI', 'right'],
                  ['Outstanding', 'right'], ['Maturity', 'right'], ['EMI Day', 'right'],
                  ['DSCR', 'right'], ['Status', 'right'],
                ] as [string, string][]).map(([h, align]) => (
                  <th key={h} className={`px-3 py-2.5 text-${align} whitespace-nowrap`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(l => {
                const st = dscrStatus(l.dscr);
                return (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-left">{l.company_name}</td>
                    <td className="px-3 py-2.5 text-left">{l.property_name}</td>
                    <td className="px-3 py-2.5 text-left">{l.loan_bank_name}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtUSD(l.loan_amount)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{l.loan_interest_rate != null ? `${(l.loan_interest_rate * 100).toFixed(2)}%` : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{l.loan_emi != null ? fmtUSD(l.loan_emi) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtUSD(l.loan_balance_as_of ?? l.loan_amount)}</td>
                    <td className="px-3 py-2.5 text-right text-xs">{l.loan_maturity_date ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">{l.loan_emi_day ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{l.dscr != null ? `${l.dscr.toFixed(2)}x` : '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${DSCR_STYLE[st]}`}>{st}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No loans found for rental portfolio</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-800 mb-3">EMI Calendar — {today.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
            const dueLoans = filtered.filter(l => l.loan_emi_day === d);
            if (dueLoans.length === 0) return <div key={d} className="w-8 h-8 text-xs text-gray-300 flex items-center justify-center">{d}</div>;
            const overdue = d < dayOfMonth;
            const dueSoon = d >= dayOfMonth && d <= dayOfMonth + 3;
            const color = overdue ? 'bg-red-500 text-white' : dueSoon ? 'bg-amber-400 text-white' : 'bg-green-600 text-white';
            return (
              <div key={d} className="relative group">
                <div className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center ${color}`}>{d}</div>
                <div className="hidden group-hover:block absolute z-10 top-9 left-0 bg-gray-900 text-white text-xs rounded p-2 whitespace-nowrap">
                  {dueLoans.map(l => <div key={l.id}>{l.loan_bank_name}: {fmtUSD(l.loan_emi ?? 0)}</div>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4" style={{ borderLeft: '4px solid #FB923C' }}>
        <div className="flex items-start gap-3">
          {highRateLoans.length > 0 ? (
            <>
              <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-amber-900">Refinancing Opportunity</h4>
                <p className="text-sm text-amber-800 mt-1">
                  {highRateLoans.length} loan(s) above market rate ({(MARKET_RATE * 100).toFixed(1)}%).
                  Est. monthly savings: <strong>{fmtUSD(monthlySavings)}</strong> ({fmtUSD(monthlySavings * 12)}/yr)
                </p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-green-900">All Rates Optimized</h4>
                <p className="text-sm text-green-800">All loans at or below market rate ({(MARKET_RATE * 100).toFixed(1)}%)</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Debt by Building</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={debtByBuildingData}
                cx="50%" cy="50%"
                outerRadius={80}
                dataKey="value"
                nameKey="name"
              >
                {['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444'].map((color, i) => <Cell key={i} fill={color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Legend iconSize={12} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">EMI Breakdown by Bank</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={emiByBankData}
              margin={{ left: 0, right: 10, top: 5, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="value" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Maturity Timeline</h3>
          <div className="space-y-2">
            {maturityTimelineData.map((l, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-900">{l.property_name}</span>
                    <span className="text-gray-600">{l.monthsLeft}mo</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, (l.monthsLeft / 60) * 100)}%`,
                        background: l.color
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{l.loan_maturity_date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Interest Rate Comparison vs Market</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={rateComparisonData}
              margin={{ left: 0, right: 10, top: 5, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(1)}%`} />
              <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="rate" fill="#3B82F6" name="Loan Rate" radius={[4, 4, 0, 0]} />
              <Bar dataKey="market" fill="#10B981" name="Market Rate" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b bg-gradient-to-r from-slate-900 to-slate-800 text-white"><h3 className="font-semibold">Building DSCR Health</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100 text-xs text-gray-600 uppercase font-semibold border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left">Building</th>
                <th className="px-4 py-3 text-right">NOI (Annual)</th>
                <th className="px-4 py-3 text-right">Debt Service</th>
                <th className="px-4 py-3 text-right">DSCR Ratio</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left">Recommendation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dscrHealth.map(row => {
                const statusConfig = {
                  green: { bg: 'bg-emerald-50', text: 'text-emerald-800', dot: 'bg-emerald-500' },
                  amber: { bg: 'bg-amber-50', text: 'text-amber-800', dot: 'bg-amber-500' },
                  red: { bg: 'bg-red-50', text: 'text-red-800', dot: 'bg-red-500' },
                  grey: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' },
                };
                const config = statusConfig[row.status];
                return (
                  <tr key={row.building} className={`${config.bg} hover:shadow-sm transition-all`}>
                    <td className="px-4 py-3 font-semibold text-gray-900">{row.building}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-900">{fmtUSD(row.noi)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-900">{fmtUSD(row.debtService)}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {row.dscr != null ? (
                        <span className={`font-bold text-lg ${row.status === 'green' ? 'text-emerald-600' : row.status === 'amber' ? 'text-amber-600' : 'text-red-600'}`}>
                          {row.dscr.toFixed(2)}x
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium capitalize ${DSCR_STYLE[row.status]}`}>
                        <span className={`w-2 h-2 rounded-full ${config.dot}`} />
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{row.recommendation}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {dscrHealth.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              <p>No buildings with loans found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
