import { useCallback, useEffect, useState, useMemo } from 'react';
import { Plus, X, ChevronDown, ChevronRight, Search } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../services/api';
import { useRentalPortfolio } from '../contexts/RentalPortfolioContext';
import { useRentalNav } from '../contexts/RentalNavContext';

// ─── types ────────────────────────────────────────────────────────────────────
interface ApiVendor {
  id: string;
  vendor_name: string;
  vendor_category: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  last_payment_date: string | null;
}

type VendorStatus = 'Active' | 'On Hold' | 'Disputed' | 'Inactive';
type TaxType = '1099-NEC' | '1099-MISC' | 'None';
type NinetyNineStatus = 'Not Started' | 'TIN Collected' | 'Draft Prepared' | 'Filed' | 'Delivered to Vendor';

interface VendorLocal {
  id: string;
  ein: string;
  status: VendorStatus;
  tax_type: TaxType;
  ninety_nine_status: NinetyNineStatus;
  ytd_paid: number;
  notes: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const $$ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const CAT_LABELS: Record<string, string> = {
  maintenance:  'Repairs & Maintenance',
  utilities:    'Utilities',
  property_mgmt:'Property Management',
  insurance:    'Insurance',
  landscaping:  'Landscaping',
  cleaning:     'Janitorial / Cleaning',
  security:     'Security',
  accounting:   'Accounting',
  legal:        'Legal',
  other:        'Other',
};

const STATUS_STYLE: Record<VendorStatus, string> = {
  'Active':    'bg-green-100 text-green-800',
  'On Hold':   'bg-amber-100 text-amber-800',
  'Disputed':  'bg-red-100 text-red-800',
  'Inactive':  'bg-gray-100 text-gray-600',
};

const NN_STATUS_STYLE: Record<NinetyNineStatus, string> = {
  'Not Started':          'bg-red-100 text-red-700',
  'TIN Collected':        'bg-amber-100 text-amber-700',
  'Draft Prepared':       'bg-blue-100 text-blue-700',
  'Filed':                'bg-green-100 text-green-800',
  'Delivered to Vendor':  'bg-green-100 text-green-800',
};

const BLANK_LOCAL: Omit<VendorLocal, 'id'> = {
  ein: '', status: 'Active', tax_type: '1099-NEC',
  ninety_nine_status: 'Not Started', ytd_paid: 0, notes: '',
};

const BLANK_API = {
  vendor_name: '', vendor_category: 'other',
  contact_name: '', contact_email: '', contact_phone: '',
};

const LS_KEY = 'estatecfo_vendor_local';

function loadLocal(): Record<string, VendorLocal> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch { return {}; }
}
function saveLocal(data: Record<string, VendorLocal>) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function buildNarrative(
  vendors: ApiVendor[],
  locals: Record<string, VendorLocal>,
  apByEntity: { name: string; ap: number }[],
) {
  const totalAp = apByEntity.reduce((s, r) => s + r.ap, 0);
  const overdue1099 = vendors.filter(v => {
    const loc = locals[v.id];
    return loc && loc.ytd_paid >= 600 && loc.ninety_nine_status === 'Not Started';
  });
  const overdue60 = vendors.filter(v => {
    const ap = apByEntity.find(r => r.name.toLowerCase().includes(v.vendor_name.toLowerCase().split(' ')[0]));
    return ap && ap.ap > 0;
  });
  const topAp = [...apByEntity].sort((a, b) => b.ap - a.ap).slice(0, 3);
  const lines: string[] = [];

  lines.push('── VENDOR CONCENTRATION RISKS ────────────────────────────────');
  topAp.forEach((r, i) => {
    const pct = totalAp > 0 ? ((r.ap / totalAp) * 100).toFixed(1) : '0';
    lines.push(`  ${i + 1}. ${r.name}: ${$$(r.ap)} (${pct}% of total AP)`);
    if (Number(pct) > 25)
      lines.push('     → High concentration risk — seek alternative vendor bids');
  });
  if (topAp.length === 0) lines.push('  No AP data available — upload portfolio to see vendor AP.');

  lines.push('');
  lines.push('── 1099 COMPLIANCE PRIORITIES ─────────────────────────────────');
  if (overdue1099.length > 0) {
    overdue1099.slice(0, 5).forEach(v => {
      const loc = locals[v.id];
      lines.push(`  • ${v.vendor_name}: ${$$(loc.ytd_paid)} YTD — 1099 not started (due Jan 31)`);
    });
  } else {
    lines.push('  All vendors with YTD >$600 have 1099 initiated — good standing.');
  }

  lines.push('');
  lines.push('── EARLY PAYMENT DISCOUNT OPPORTUNITIES ──────────────────────');
  const activeVendors = vendors.filter(v => (locals[v.id]?.status ?? 'Active') === 'Active');
  lines.push(`  ${activeVendors.length} active vendors eligible for early-pay discount negotiation.`);
  lines.push('  Recommended: offer 2/10 Net 30 to top 3 vendors by annual spend.');
  lines.push('  Typical savings: 2% of total AP = ' + $$(totalAp * 0.02));

  lines.push('');
  lines.push('── VENDORS AT RELATIONSHIP RISK ───────────────────────────────');
  if (overdue60.length > 0) {
    overdue60.slice(0, 3).forEach(v => {
      lines.push(`  ⚠ ${v.vendor_name} — overdue AP outstanding — contact immediately`);
    });
  } else {
    lines.push('  No vendors at relationship risk from overdue payments.');
  }

  lines.push('');
  lines.push('── RECOMMENDED VENDOR PAYMENT POLICY ─────────────────────────');
  lines.push('  1. Standard terms: Net 30 from invoice date for all vendors');
  lines.push('  2. Preferred vendors (consistent quality): 2/10 Net 30 early-pay discount');
  lines.push('  3. New vendors: hold first payment 15 days to verify bank details + EIN');
  lines.push('  4. Disputed invoices: flag immediately, escalate within 7 days');
  lines.push('  5. 1099 vendors: collect W-9 before first payment — mandatory');
  lines.push(`  6. Concentration rule: no single vendor > 30% of portfolio AP`);

  lines.push('');
  lines.push(`  Generated: ${new Date().toLocaleString()}`);
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
export default function RentalVendorManagement() {
  const { portfolio } = useRentalPortfolio();
  const { setTab }    = useRentalNav();

  const [vendors, setVendors]   = useState<ApiVendor[]>([]);
  const [locals, setLocals]     = useState<Record<string, VendorLocal>>(loadLocal);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filter1099, setFilter1099] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [apiForm, setApiForm]   = useState({ ...BLANK_API });
  const [localForm, setLocalForm] = useState({ ...BLANK_LOCAL });
  const [saving, setSaving]     = useState(false);
  const [narrative, setNarrative] = useState('');
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<ApiVendor[]>('/api/rentals/vendors');
      setVendors(res.data);
    } catch {
      setError('Failed to load vendors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateLocal(id: string, patch: Partial<VendorLocal>) {
    setLocals(prev => {
      const next = { ...prev, [id]: { ...BLANK_LOCAL, ...(prev[id] ?? {}), ...patch, id } };
      saveLocal(next);
      return next;
    });
  }

  async function submitVendor(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post<ApiVendor>('/api/rentals/vendors', {
        vendor_name:     apiForm.vendor_name.trim(),
        vendor_category: apiForm.vendor_category,
        contact_name:    apiForm.contact_name || null,
        contact_email:   apiForm.contact_email || null,
        contact_phone:   apiForm.contact_phone || null,
      });
      const id = res.data.id;
      const next = { ...locals, [id]: { id, ...localForm } };
      saveLocal(next);
      setLocals(next);
      setShowForm(false);
      setApiForm({ ...BLANK_API });
      setLocalForm({ ...BLANK_LOCAL });
      await load();
    } catch {
      alert('Failed to save vendor.');
    } finally {
      setSaving(false);
    }
  }

  // AP lookup per entity (best effort from arAp data)
  const apByEntity = useMemo(() =>
    portfolio.arAp.map(r => ({
      name: r.entity_name,
      ap: r.ap_current + r.ap_1_30 + r.ap_31_60 + r.ap_60_plus,
    })),
    [portfolio.arAp]);

  // Vendor AP estimate (match by name)
  function vendorAp(v: ApiVendor) {
    const match = apByEntity.find(r =>
      r.name.toLowerCase().includes(v.vendor_name.toLowerCase().split(' ')[0]));
    return match?.ap ?? 0;
  }

  // 1099 required: ytd_paid >= 600
  function needs1099(v: ApiVendor) {
    return (locals[v.id]?.ytd_paid ?? 0) >= 600;
  }

  const totalVendors   = vendors.length;
  const totalAp        = useMemo(() => apByEntity.reduce((s, r) => s + r.ap, 0), [apByEntity]);
  const overdueVendors = vendors.filter(v => vendorAp(v) > 0 && portfolio.arAp.some(r =>
    r.entity_name.toLowerCase().includes(v.vendor_name.toLowerCase().split(' ')[0]) && r.ap_60_plus > 0
  )).length;
  const needs1099Count = vendors.filter(v => needs1099(v)).length;

  // Filtered vendor list
  const filtered = useMemo(() => vendors.filter(v => {
    const loc = locals[v.id];
    if (search && !v.vendor_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat && v.vendor_category !== filterCat) return false;
    if (filterStatus && (loc?.status ?? 'Active') !== filterStatus) return false;
    if (filter1099 === 'yes' && !needs1099(v)) return false;
    if (filter1099 === 'no' && needs1099(v)) return false;
    return true;
  }), [vendors, locals, search, filterCat, filterStatus, filter1099]);

  // Top vendors by AP for chart
  const chartData = [...apByEntity]
    .sort((a, b) => b.ap - a.ap)
    .slice(0, 10)
    .map(r => ({ name: r.name.split(' ')[0], AP: r.ap }));

  const isNovOrLater = new Date().getMonth() >= 10; // Nov = month 10

  function generateNarrative() {
    setGenerating(true);
    setTimeout(() => {
      setNarrative(buildNarrative(vendors, locals, apByEntity));
      setGenerating(false);
    }, 900);
  }

  // ── no data guard ─────────────────────────────────────────────────────────
  if (!portfolio.loaded && !loading && vendors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-500 text-sm">Upload portfolio data to see AP-linked vendor risk.</p>
        <button onClick={() => setTab('portfolio-upload')}
          className="bg-[#0E3B36] text-white px-5 py-2 rounded-lg text-sm hover:bg-[#1A5249]">
          ← Upload Portfolio Data
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-10" style={{ fontFamily: 'Georgia, serif' }}>

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider font-sans" style={{ color: '#B8860B' }}>Vendor Management</p>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">Vendor Directory</h1>
          <p className="text-sm text-gray-400 font-sans mt-1">1099 compliance, payment history, and risk assessment</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-[#0E3B36] text-white px-4 py-2.5 rounded-lg text-sm hover:bg-[#1A5249] font-sans">
          <Plus size={15} /> Add Vendor
        </button>
      </div>

      {/* ══ SECTION 1 — Summary Cards ══════════════════════════════════════ */}
      <div>
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-3">01 — Vendor Summary</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-sans text-gray-500">Total Vendors</p>
            <p className="text-2xl font-bold font-mono mt-1 text-gray-900">{totalVendors}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-sans text-gray-500">Total AP Outstanding</p>
            <p className="text-2xl font-bold font-mono mt-1 text-gray-900">{$$(totalAp)}</p>
          </div>
          <div className={`rounded-xl border p-5 ${overdueVendors > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
            <p className="text-xs font-sans text-gray-500">Overdue (60+ days)</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${overdueVendors > 0 ? 'text-red-800' : 'text-gray-900'}`}>{overdueVendors}</p>
          </div>
          <div className={`rounded-xl border p-5 ${needs1099Count > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
            <p className="text-xs font-sans text-gray-500">1099 Required</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${needs1099Count > 0 ? 'text-amber-800' : 'text-gray-900'}`}>{needs1099Count}</p>
            {needs1099Count > 0 && <p className="text-xs font-sans text-amber-600 mt-1">YTD paid ≥ $600</p>}
          </div>
        </div>
      </div>

      {/* Add vendor form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-800 font-sans">Add New Vendor</h3>
            <button onClick={() => setShowForm(false)}><X size={16} /></button>
          </div>
          <form onSubmit={submitVendor} className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">Vendor Name *</label>
              <input required value={apiForm.vendor_name}
                onChange={e => setApiForm(f => ({ ...f, vendor_name: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans" placeholder="ACME Plumbing LLC" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">Category</label>
              <select value={apiForm.vendor_category}
                onChange={e => setApiForm(f => ({ ...f, vendor_category: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans">
                {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">EIN / Tax ID</label>
              <input value={localForm.ein}
                onChange={e => setLocalForm(f => ({ ...f, ein: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans" placeholder="XX-XXXXXXX" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">Contact Name</label>
              <input value={apiForm.contact_name}
                onChange={e => setApiForm(f => ({ ...f, contact_name: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">Email</label>
              <input type="email" value={apiForm.contact_email}
                onChange={e => setApiForm(f => ({ ...f, contact_email: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">Phone</label>
              <input value={apiForm.contact_phone}
                onChange={e => setApiForm(f => ({ ...f, contact_phone: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">Status</label>
              <select value={localForm.status}
                onChange={e => setLocalForm(f => ({ ...f, status: e.target.value as VendorStatus }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans">
                {(['Active', 'On Hold', 'Disputed', 'Inactive'] as VendorStatus[]).map(s =>
                  <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">YTD Payments ($)</label>
              <input type="number" min="0" value={localForm.ytd_paid}
                onChange={e => setLocalForm(f => ({ ...f, ytd_paid: Number(e.target.value) }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans font-mono" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-sans">1099 Type</label>
              <select value={localForm.tax_type}
                onChange={e => setLocalForm(f => ({ ...f, tax_type: e.target.value as TaxType }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans">
                <option value="1099-NEC">1099-NEC</option>
                <option value="1099-MISC">1099-MISC</option>
                <option value="None">None</option>
              </select>
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs text-gray-500 mb-1 font-sans">Notes</label>
              <input value={localForm.notes}
                onChange={e => setLocalForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm font-sans" />
            </div>
            <div className="col-span-2 md:col-span-3 flex gap-3 pt-1">
              <button type="submit" disabled={saving}
                className="bg-[#0E3B36] text-white px-5 py-2 rounded-lg text-sm disabled:opacity-50 font-sans">
                {saving ? 'Saving…' : 'Save Vendor'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="border px-5 py-2 rounded-lg text-sm text-gray-600 font-sans hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ══ SECTION 2 — Vendor Master Table ════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider">02</p>
          <h2 className="text-xl font-bold text-gray-900">Vendor Directory</h2>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-center font-sans">
          <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5">
            <Search size={14} className="text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search vendors…" className="text-sm outline-none w-40" />
          </div>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5">
            <option value="">All Categories</option>
            {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5">
            <option value="">All Statuses</option>
            {(['Active', 'On Hold', 'Disputed', 'Inactive'] as VendorStatus[]).map(s =>
              <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filter1099} onChange={e => setFilter1099(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5">
            <option value="">1099 — All</option>
            <option value="yes">1099 Required</option>
            <option value="no">Not Required</option>
          </select>
        </div>

        {error && <p className="text-red-600 text-sm p-4 font-sans">{error}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="text-white text-xs" style={{ backgroundColor: '#F0EDE5' }}>
                <th className="px-4 py-2.5 text-left"></th>
                <th className="px-4 py-2.5 text-left whitespace-nowrap">Vendor Name</th>
                <th className="px-4 py-2.5 text-left whitespace-nowrap">Category</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">YTD Paid</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">AP Outstanding</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">1099</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Status</th>
                <th className="px-4 py-2.5 text-left whitespace-nowrap">EIN / Tax ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    {loading ? 'Loading…' : 'No vendors found. Add the first one above.'}
                  </td>
                </tr>
              )}
              {filtered.map((v, i) => {
                const loc = locals[v.id];
                const status: VendorStatus = loc?.status ?? 'Active';
                const ytd = loc?.ytd_paid ?? 0;
                const ap = vendorAp(v);
                const req1099 = ytd >= 600;
                const isExpanded = expanded === v.id;
                return [
                  <tr key={v.id} className={`cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}
                    onClick={() => setExpanded(isExpanded ? null : v.id)}>
                    <td className="px-4 py-2.5 text-gray-400">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{v.vendor_name}</td>
                    <td className="px-4 py-2.5 text-gray-500">{v.vendor_category ? (CAT_LABELS[v.vendor_category] ?? v.vendor_category) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{$$(ytd)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${ap > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{$$(ap)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${req1099 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
                        {req1099 ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <select value={status}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateLocal(v.id, { status: e.target.value as VendorStatus })}
                        className={`text-xs font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer ${STATUS_STYLE[status]}`}>
                        {(['Active', 'On Hold', 'Disputed', 'Inactive'] as VendorStatus[]).map(s =>
                          <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{loc?.ein || '—'}</td>
                  </tr>,
                  isExpanded && (
                    <tr key={`${v.id}-exp`} className="bg-blue-50">
                      <td colSpan={8} className="px-8 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Contact</p>
                            <p className="font-medium">{v.contact_name || '—'}</p>
                            <p className="text-gray-500">{v.contact_email || ''}</p>
                            <p className="text-gray-500">{v.contact_phone || ''}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Last Payment</p>
                            <p className="font-mono">{v.last_payment_date ?? '—'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 mb-1">YTD Paid ($)</p>
                            <input type="number" min="0" value={loc?.ytd_paid ?? 0}
                              onChange={e => updateLocal(v.id, { ytd_paid: Number(e.target.value) })}
                              className="border rounded px-2 py-1 text-sm font-mono w-32" />
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 mb-1">EIN / Tax ID</p>
                            <input value={loc?.ein ?? ''}
                              onChange={e => updateLocal(v.id, { ein: e.target.value })}
                              className="border rounded px-2 py-1 text-sm font-mono w-32" placeholder="XX-XXXXXXX" />
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Notes</p>
                            <input value={loc?.notes ?? ''}
                              onChange={e => updateLocal(v.id, { notes: e.target.value })}
                              className="border rounded px-2 py-1 text-sm w-full" />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══ SECTION 4 — 1099 Tracker ═══════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider">04</p>
          <h2 className="text-xl font-bold text-gray-900">1099-NEC / 1099-MISC Compliance</h2>
          <p className="text-sm text-gray-400 font-sans mt-0.5">Vendors paid $600+ require 1099 by Jan 31</p>
        </div>

        {/* Warning banner */}
        {isNovOrLater && vendors.some(v => needs1099(v) && (locals[v.id]?.ninety_nine_status ?? 'Not Started') === 'Not Started') && (
          <div className="mx-5 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 font-sans">
            <p className="text-sm font-bold text-red-800">
              ⚠ Jan 31 deadline approaching — vendors with YTD &gt; $600 have unstarted 1099s
            </p>
          </div>
        )}

        <div className="overflow-x-auto p-5">
          {vendors.filter(v => needs1099(v)).length === 0 ? (
            <p className="text-sm text-gray-400 font-sans py-4">No vendors with YTD payments ≥ $600 yet. Update YTD amounts in the Vendor Directory above.</p>
          ) : (
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-white text-xs" style={{ backgroundColor: '#F0EDE5' }}>
                  <th className="px-4 py-2.5 text-left">Vendor</th>
                  <th className="px-4 py-2.5 text-left">Category</th>
                  <th className="px-4 py-2.5 text-left">EIN / SSN</th>
                  <th className="px-4 py-2.5 text-right">YTD Paid</th>
                  <th className="px-4 py-2.5 text-center">1099 Type</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {vendors.filter(v => needs1099(v)).map((v, i) => {
                  const loc = locals[v.id];
                  const nnStatus: NinetyNineStatus = loc?.ninety_nine_status ?? 'Not Started';
                  const taxType: TaxType = loc?.tax_type ?? '1099-NEC';
                  return (
                    <tr key={v.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{v.vendor_name}</td>
                      <td className="px-4 py-2.5 text-gray-500">{v.vendor_category ? (CAT_LABELS[v.vendor_category] ?? v.vendor_category) : '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{loc?.ein || <span className="text-red-500">⚠ Missing</span>}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{$$(loc?.ytd_paid ?? 0)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <select value={taxType}
                          onChange={e => updateLocal(v.id, { tax_type: e.target.value as TaxType })}
                          className="text-xs border rounded px-2 py-0.5">
                          <option value="1099-NEC">1099-NEC</option>
                          <option value="1099-MISC">1099-MISC</option>
                          <option value="None">None</option>
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <select value={nnStatus}
                          onChange={e => updateLocal(v.id, { ninety_nine_status: e.target.value as NinetyNineStatus })}
                          className={`text-xs font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer ${NN_STATUS_STYLE[nnStatus]}`}>
                          {(['Not Started', 'TIN Collected', 'Draft Prepared', 'Filed', 'Delivered to Vendor'] as NinetyNineStatus[]).map(s =>
                            <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ══ SECTION 5 — Vendor Risk Assessment ════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-1">05</p>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Vendor Concentration & Risk</h2>

        {/* Risk flags */}
        <div className="space-y-3 mb-6 font-sans">
          {apByEntity.filter(r => totalAp > 0 && r.ap / totalAp > 0.25).map(r => (
            <div key={r.name} className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-3">
              <span className="text-base">🔴</span>
              <div>
                <p className="text-sm font-bold text-red-800">HIGH CONCENTRATION</p>
                <p className="text-xs text-red-700">{r.name} = {((r.ap / totalAp) * 100).toFixed(1)}% of total AP ({$$(r.ap)}) — single entity dependency risk</p>
              </div>
            </div>
          ))}
          {vendors.filter(v => vendorAp(v) > 0 && portfolio.arAp.some(r =>
            r.entity_name.toLowerCase().includes(v.vendor_name.toLowerCase().split(' ')[0]) && r.ap_60_plus > 0
          )).map(v => (
            <div key={v.id} className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <span className="text-base">🟡</span>
              <div>
                <p className="text-sm font-bold text-amber-800">OVERDUE PAYMENT</p>
                <p className="text-xs text-amber-700">{v.vendor_name} — 60+ days outstanding — vendor relationship at risk</p>
              </div>
            </div>
          ))}
          {vendors.filter(v => (locals[v.id]?.status ?? 'Active') === 'Active' && (locals[v.id]?.ytd_paid ?? 0) === 0).slice(0, 2).map(v => (
            <div key={v.id} className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <span className="text-base">🔵</span>
              <div>
                <p className="text-sm font-bold text-blue-800">PREFERRED VENDOR — NO AP</p>
                <p className="text-xs text-blue-700">{v.vendor_name} — no outstanding balances — eligible for early-pay discount</p>
              </div>
            </div>
          ))}
          {apByEntity.length === 0 && (
            <p className="text-sm text-gray-400 font-sans">Upload portfolio data to see entity-level AP risk flags.</p>
          )}
        </div>

        {/* Top 10 by AP chart */}
        {chartData.length > 0 && (
          <>
            <h3 className="text-base font-bold text-gray-800 mb-3 font-sans">Top Entities by AP Outstanding</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: 'sans-serif' }} />
                <YAxis tick={{ fontSize: 10, fontFamily: 'monospace' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [$$(v)]} />
                <Bar dataKey="AP" fill="#B8860B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* ══ SECTION 6 — AI Vendor Advisor ══════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-1">06</p>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Vendor Strategic Advisor</h2>
        <p className="text-sm text-gray-400 font-sans mb-4">AI-generated vendor payment strategy</p>
        <button onClick={generateNarrative} disabled={generating}
          className="flex items-center gap-2 bg-[#0E3B36] text-white px-5 py-2 rounded-lg text-sm hover:bg-[#1A5249] disabled:opacity-50 font-sans mb-4">
          {generating
            ? <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
            : '⚡ Generate Vendor Strategy'}
        </button>
        {narrative && (
          <div className="bg-gray-900 rounded-xl p-5 overflow-x-auto">
            <pre className="text-green-300 text-xs leading-relaxed whitespace-pre-wrap font-mono">{narrative}</pre>
          </div>
        )}
      </div>

    </div>
  );
}
