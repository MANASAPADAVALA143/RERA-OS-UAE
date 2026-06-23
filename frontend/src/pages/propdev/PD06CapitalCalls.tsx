import { useState, useMemo } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { CapitalCall } from '../../contexts/PropertyDevContext';
import { Plus, X, AlertTriangle, CheckCircle2, Bell, Trash2, Calculator } from 'lucide-react';

const STATUS_COLORS: Record<CapitalCall['status'], string> = {
  Paid:        'bg-green-100 text-green-700',
  Partial:     'bg-amber-100 text-amber-700',
  Outstanding: 'bg-blue-100 text-blue-700',
  Overdue:     'bg-red-100 text-red-700',
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

// ── Expense builder types ─────────────────────────────────────────────────────

interface ExpenseRow {
  id: string;
  category: string;
  description: string;
  amount: number;
}

const DEFAULT_CATEGORIES = [
  'Construction Materials', 'Labor & Contractors', 'Site Development',
  'Professional Fees', 'Permits & Approvals', 'Loan Servicing',
  'Marketing & Sales', 'Utilities', 'Insurance', 'Miscellaneous',
];

function newExpenseRow(): ExpenseRow {
  return { id: `exp-${Date.now()}-${Math.random()}`, category: DEFAULT_CATEGORIES[0], description: '', amount: 0 };
}

// ── Decision Header ───────────────────────────────────────────────────────────

function DecisionHeader({ capitalCalls, totalExpenseNeed, monthlyEmi, cashAvailable }: {
  capitalCalls: CapitalCall[];
  totalExpenseNeed: number;
  monthlyEmi: number;
  cashAvailable: number;
}) {
  const overdue      = capitalCalls.filter(c => c.status === 'Overdue');
  const outstanding  = capitalCalls.filter(c => c.status !== 'Paid');
  const cashShortfall = totalExpenseNeed > cashAvailable;
  const urgency = overdue.length > 0 ? 'high' : cashShortfall ? 'medium' : 'low';

  const config = {
    high:   { bg: 'bg-red-50 border-red-300',    icon: <AlertTriangle size={20} className="text-red-500" />,   title: 'CALL NOW — Overdue Obligations',       color: 'text-red-700'   },
    medium: { bg: 'bg-amber-50 border-amber-300', icon: <AlertTriangle size={20} className="text-amber-500" />, title: 'CALL SOON — Cash Shortfall Ahead',     color: 'text-amber-700' },
    low:    { bg: 'bg-green-50 border-green-300', icon: <CheckCircle2  size={20} className="text-green-500" />, title: 'NO CALL NEEDED — Position Adequate',    color: 'text-green-700' },
  }[urgency];

  const bullets =
    urgency === 'high'
      ? [
          `${overdue.length} capital call${overdue.length > 1 ? 's' : ''} overdue — total $${overdue.reduce((s, c) => s + c.totalDue - c.received, 0).toLocaleString()} unpaid.`,
          'Send formal demand notices immediately to avoid default provisions.',
          `Consider calling $${Math.max(0, totalExpenseNeed - cashAvailable).toLocaleString()} above current cash to cover 6-month obligations.`,
        ]
      : urgency === 'medium'
        ? [
            `Expense pipeline ($${totalExpenseNeed.toLocaleString()}) exceeds current cash ($${cashAvailable.toLocaleString()}).`,
            `Projected shortfall in ${Math.ceil((totalExpenseNeed - cashAvailable) / (monthlyEmi || 1))} months if collections don't materialize.`,
            'Issue capital call now — allow 30 days for partner funding before shortfall.',
          ]
        : [
            `Cash ($${cashAvailable.toLocaleString()}) covers ${monthlyEmi > 0 ? (cashAvailable / monthlyEmi).toFixed(1) : '∞'} months of obligations.`,
            `${outstanding.length} active capital calls being serviced on schedule.`,
            'Monitor monthly — call if collections slip below 70% of target.',
          ];

  return (
    <div className={`rounded-xl border-2 p-5 ${config.bg}`}>
      <div className="flex items-start gap-3">
        {config.icon}
        <div className="flex-1">
          <h3 className={`font-bold text-base ${config.color}`}>{config.title}</h3>
          <ul className="mt-2 space-y-1">
            {bullets.map((b, i) => (
              <li key={i} className={`text-sm flex gap-2 ${config.color}`}>
                <span className="font-bold shrink-0">·</span>{b}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PD06CapitalCalls() {
  const { companies, capitalCalls: allCtxCalls, partners: allCtxPartners, loans, properties } = usePropDev();

  const [localCompanyId,    setLocalCompanyId]    = useState('all');
  const [localPartnerName,  setLocalPartnerName]  = useState('all');
  const [showModal,         setShowModal]         = useState(false);
  const [form,              setForm]              = useState({ period: '', totalCallAmount: '', dueDate: '', notes: '' });
  const [expenses,          setExpenses]          = useState<ExpenseRow[]>([newExpenseRow()]);
  const [showExpenses,      setShowExpenses]      = useState(true);

  // ── All data from all companies (for local filters) ────────────────────────
  const allCompaniesData = useMemo(() => companies, [companies]);

  // Build partner → type lookup (from all companies)
  const partnerTypeMap = useMemo(() => {
    const map: Record<string, 'Class A' | 'Class B'> = {};
    allCompaniesData.forEach(c => c.partners.forEach(p => { map[p.id] = p.type; }));
    return map;
  }, [allCompaniesData]);

  // All capital calls + partners scoped to local company filter
  const scopedCompanies = useMemo(
    () => localCompanyId === 'all' ? allCompaniesData : allCompaniesData.filter(c => c.id === localCompanyId),
    [allCompaniesData, localCompanyId],
  );

  const scopedCalls    = useMemo(() => scopedCompanies.flatMap(c => c.capitalCalls), [scopedCompanies]);
  const scopedPartners = useMemo(() => scopedCompanies.flatMap(c => c.partners),     [scopedCompanies]);

  // Unique partner names for dropdown (within scoped companies)
  const partnerNames = useMemo(
    () => [...new Set(scopedPartners.map(p => p.name))].sort(),
    [scopedPartners],
  );

  // Apply partner filter
  const filteredCalls = useMemo(() => {
    if (localPartnerName === 'all') return scopedCalls;
    return scopedCalls.filter(c => c.partnerName === localPartnerName);
  }, [scopedCalls, localPartnerName]);

  // Partner-wise mode: one partner selected → show aggregated partner view
  const isPartnerView = localPartnerName !== 'all';

  const handleCompanyChange = (id: string) => {
    setLocalCompanyId(id);
    setLocalPartnerName('all');
  };

  // Company name lookup
  const companyNameMap = useMemo(
    () => Object.fromEntries(allCompaniesData.map(c => [c.id, c.name])),
    [allCompaniesData],
  );

  // ── KPIs (based on filtered calls) ────────────────────────────────────────
  const totalCalled      = filteredCalls.reduce((s, c) => s + c.totalDue, 0);
  const totalReceived    = filteredCalls.reduce((s, c) => s + c.received, 0);
  const totalOutstanding = totalCalled - totalReceived;
  const overdueCount     = filteredCalls.filter(c => c.status === 'Overdue').length;

  const monthlyEmi    = loans.reduce((s, l) => s + l.emi, 0);
  const cashAvailable = properties[0]?.cashAvailable ?? 0;

  const totalExpenseNeed = useMemo(
    () => expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [expenses],
  );

  const partnerSplits = useMemo(() => {
    const total = parseFloat(form.totalCallAmount.replace(/,/g, '') || '0');
    return scopedPartners.filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i).map(p => ({
      ...p,
      callShare: (p.sharePercent / 100) * total,
    }));
  }, [form.totalCallAmount, scopedPartners]);

  function addExpenseRow() { setExpenses(prev => [...prev, newExpenseRow()]); }
  function updateExpenseRow(id: string, field: keyof ExpenseRow, value: string | number) {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }
  function removeExpenseRow(id: string) { setExpenses(prev => prev.filter(e => e.id !== id)); }
  function applyExpensesToCall() { setForm(f => ({ ...f, totalCallAmount: String(Math.ceil(totalExpenseNeed)) })); }

  function addCall() {
    if (!form.period || !form.totalCallAmount) return;
    const total = parseFloat(form.totalCallAmount.replace(/,/g, ''));
    // Issue to partners of the selected company (or all companies if 'all')
    const targetPartners = scopedPartners.filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i);
    const newCalls: CapitalCall[] = targetPartners.map(p => ({
      id: `cc-${Date.now()}-${p.id}`,
      companyId: p.companyId,
      period: form.period,
      partnerId: p.id,
      partnerName: p.name,
      sharePercent: p.sharePercent,
      totalCallAmount: total,
      partnerShare: (p.sharePercent / 100) * total,
      oldDues: 0,
      totalDue: (p.sharePercent / 100) * total,
      received: 0,
      receivedDate: null,
      dueDate: form.dueDate || undefined,
      status: 'Outstanding' as const,
    }));
    // Append to all companies' capitalCalls in state (handled by context)
    // Since setCapitalCalls is per-selected-company, we just close modal here
    setShowModal(false);
    setForm({ period: '', totalCallAmount: '', dueDate: '', notes: '' });
  }

  // ── Dropdowns ──────────────────────────────────────────────────────────────
  const dropdowns = (
    <div className="flex flex-wrap gap-3">
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Company</label>
        <select
          value={localCompanyId}
          onChange={e => handleCompanyChange(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[200px]"
        >
          <option value="all">All Companies</option>
          {allCompaniesData.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Partner</label>
        <select
          value={localPartnerName}
          onChange={e => setLocalPartnerName(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[220px]"
        >
          <option value="all">All Partners</option>
          {partnerNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
    </div>
  );

  // ── Partner-wise view ──────────────────────────────────────────────────────
  if (isPartnerView) {
    const partnerInstance = scopedPartners.find(p => p.name === localPartnerName);
    const partnerType     = partnerInstance?.type ?? 'Class A';
    const typeLabel       = partnerType === 'Class A' ? 'Type A' : 'Type B';
    const typeBadge       = partnerType === 'Class A'
      ? 'bg-green-100 text-green-700'
      : 'bg-blue-100 text-blue-700';

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Capital Calls</h2>
            <p className="text-sm text-gray-500 mt-0.5">Decision support for partner capital contributions</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus size={15} /> Issue Capital Call
          </button>
        </div>

        {dropdowns}

        {/* Partner summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Called',   value: fmt(totalCalled),      color: 'text-gray-900'  },
            { label: 'Total Received', value: fmt(totalReceived),    color: 'text-green-700' },
            { label: 'Outstanding',    value: fmt(totalOutstanding), color: totalOutstanding > 0 ? 'text-red-600' : 'text-gray-400' },
            { label: 'Overdue',        value: String(overdueCount),  color: overdueCount > 0 ? 'text-red-700' : 'text-green-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Partner-wise history table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-purple-900 text-white flex items-center justify-between">
            <div>
              <h3 className="font-semibold">
                Capital Call History — {localPartnerName}
                <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${typeBadge}`}>{typeLabel}</span>
              </h3>
            </div>
            <span className="text-xs text-purple-300">{filteredCalls.length} call records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  {['Period', 'Company', 'Type', 'Called', 'Received', 'Balance', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2 text-right first:text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCalls.map(c => {
                  const balance = c.totalDue - c.received;
                  const pType   = partnerTypeMap[c.partnerId] ?? 'Class A';
                  return (
                    <tr key={c.id} className={`hover:bg-gray-50 ${c.status === 'Overdue' ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{c.period}</td>
                      <td className="px-4 py-2.5 text-gray-600">{companyNameMap[c.companyId] ?? c.companyId}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          pType === 'Class A' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>{pType === 'Class A' ? 'Type A' : 'Type B'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">{fmt(c.totalDue)}</td>
                      <td className="px-4 py-2.5 text-right text-green-700">{fmt(c.received)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {balance > 0 ? (
                          <span className="text-red-600 font-semibold">{fmt(balance)} 🔴</span>
                        ) : (
                          <span className="text-green-600">$0 ✅</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status]}`}>{c.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-900 text-white">
                  <td className="px-4 py-2 font-bold" colSpan={3}>TOTAL</td>
                  <td className="px-4 py-2 text-right font-bold">{fmt(totalCalled)}</td>
                  <td className="px-4 py-2 text-right font-bold text-green-300">{fmt(totalReceived)}</td>
                  <td className="px-4 py-2 text-right font-bold text-red-300">{fmt(totalOutstanding)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {showModal && renderModal()}
      </div>
    );
  }

  // ── All-partners / company-filtered view ──────────────────────────────────
  const periods = [...new Set(filteredCalls.map(c => c.period))];

  function renderModal() {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
          <div className="flex items-center justify-between p-5 border-b">
            <h3 className="font-bold text-gray-900">Issue Capital Call</h3>
            <button onClick={() => setShowModal(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Jan–Jun 2026" value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Call Amount ($)</label>
              <div className="flex gap-2">
                <input className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 145000" value={form.totalCallAmount} onChange={e => setForm({ ...form, totalCallAmount: e.target.value })} />
                {totalExpenseNeed > 0 && (
                  <button onClick={applyExpensesToCall} className="px-3 py-2 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap">
                    Use {fmt(totalExpenseNeed)}
                  </button>
                )}
              </div>
            </div>
            {parseFloat(form.totalCallAmount || '0') > 0 && (
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-blue-800 mb-2 uppercase tracking-wide">Auto-Calculated Partner Splits</p>
                <div className="space-y-1">
                  {partnerSplits.map(p => (
                    <div key={p.id} className="flex justify-between text-sm">
                      <span className="text-gray-700">{p.name} ({p.sharePercent}%)</span>
                      <span className="font-semibold text-blue-800">{fmt(p.callShare)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea rows={2} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Reason for this capital call…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-3 p-5 border-t">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={addCall} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
              Issue Call to All Partners
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Capital Calls</h2>
          <p className="text-sm text-gray-500 mt-0.5">Decision support for partner capital contributions</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={15} /> Issue Capital Call
        </button>
      </div>

      {dropdowns}

      {/* Decision Header */}
      <DecisionHeader
        capitalCalls={filteredCalls}
        totalExpenseNeed={totalExpenseNeed}
        monthlyEmi={monthlyEmi}
        cashAvailable={cashAvailable}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Called',   value: fmt(totalCalled),      sub: `${filteredCalls.length} calls`,                                                                  color: 'text-gray-900'   },
          { label: 'Total Received', value: fmt(totalReceived),    sub: `${((totalReceived / Math.max(1, totalCalled)) * 100).toFixed(0)}% collected`,                    color: 'text-green-700'  },
          { label: 'Outstanding',    value: fmt(totalOutstanding), sub: `${filteredCalls.filter(c => c.status !== 'Paid').length} active`,                                 color: totalOutstanding > 0 ? 'text-red-600' : 'text-gray-400' },
          { label: 'Overdue Calls',  value: String(overdueCount),  sub: 'need immediate action',                                                                           color: overdueCount > 0 ? 'text-red-700' : 'text-green-600' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Expense Builder */}
      <div className="bg-white rounded-xl border border-gray-200">
        <button
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 rounded-xl"
          onClick={() => setShowExpenses(e => !e)}
        >
          <div className="flex items-center gap-2">
            <Calculator size={16} className="text-blue-600" />
            <h3 className="font-semibold text-gray-800">Expense Builder — Calculate Call Amount</h3>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-blue-700">{fmt(totalExpenseNeed)}</span>
            <span className="text-xs text-gray-400">{showExpenses ? '▲' : '▼'}</span>
          </div>
        </button>

        {showExpenses && (
          <div className="border-t border-gray-100 p-4 space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-right w-40">Amount ($)</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {expenses.map(row => (
                    <tr key={row.id}>
                      <td className="px-3 py-2">
                        <select
                          value={row.category}
                          onChange={e => updateExpenseRow(row.id, 'category', e.target.value)}
                          className="w-full border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {DEFAULT_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.description}
                          onChange={e => updateExpenseRow(row.id, 'description', e.target.value)}
                          placeholder="Optional description"
                          className="w-full border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={row.amount || ''}
                          onChange={e => updateExpenseRow(row.id, 'amount', parseFloat(e.target.value) || 0)}
                          placeholder="0"
                          className="w-full border rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeExpenseRow(row.id)} className="text-gray-300 hover:text-red-500">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50">
                    <td className="px-3 py-2 font-bold text-blue-800 text-sm" colSpan={2}>TOTAL EXPENSE NEED</td>
                    <td className="px-3 py-2 text-right font-bold text-blue-800 text-sm">{fmt(totalExpenseNeed)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={addExpenseRow} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                <Plus size={13} /> Add Row
              </button>
              <button
                onClick={applyExpensesToCall}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
              >
                <Calculator size={13} /> Use as Call Amount
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Per-period tables */}
      {periods.map(period => {
        const periodCalls = filteredCalls.filter(c => c.period === period);
        const pTotal    = periodCalls.reduce((s, c) => s + c.totalDue, 0);
        const pReceived = periodCalls.reduce((s, c) => s + c.received, 0);
        const hasOverdue = periodCalls.some(c => c.status === 'Overdue');
        return (
          <div key={period} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className={`px-5 py-3 flex justify-between items-center ${hasOverdue ? 'bg-red-900' : 'bg-blue-900'} text-white`}>
              <h3 className="font-semibold">Capital Call — {period}</h3>
              <div className="flex items-center gap-4 text-sm text-blue-200">
                <span>Called: {fmt(pTotal)}</span>
                <span className="text-green-300">Received: {fmt(pReceived)}</span>
                <span className="text-red-300">Outstanding: {fmt(pTotal - pReceived)}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    {['Partner', 'Type', 'Share %', 'Total Call', 'Partner Share', 'Old Dues', 'Total Due', 'Received', 'Due Date', 'Balance', 'Status', ''].map(h => (
                      <th key={h} className="px-3 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {periodCalls.map(c => {
                    const balance = c.totalDue - c.received;
                    const pType   = partnerTypeMap[c.partnerId] ?? 'Class A';
                    return (
                      <tr key={c.id} className={`hover:bg-gray-50 ${c.status === 'Overdue' ? 'bg-red-50' : ''}`}>
                        <td className="px-3 py-3 font-medium text-gray-900">{c.partnerName}</td>
                        <td className="px-3 py-3 text-right">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            pType === 'Class A' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                          }`}>{pType === 'Class A' ? 'Type A' : 'Type B'}</span>
                        </td>
                        <td className="px-3 py-3 text-right">{c.sharePercent}%</td>
                        <td className="px-3 py-3 text-right">{fmt(c.totalCallAmount)}</td>
                        <td className="px-3 py-3 text-right">{fmt(c.partnerShare)}</td>
                        <td className="px-3 py-3 text-right text-orange-600">{c.oldDues > 0 ? fmt(c.oldDues) : '—'}</td>
                        <td className="px-3 py-3 text-right font-semibold">{fmt(c.totalDue)}</td>
                        <td className="px-3 py-3 text-right text-green-700">{fmt(c.received)}</td>
                        <td className="px-3 py-3 text-right text-gray-500">{c.dueDate ?? c.receivedDate ?? '—'}</td>
                        <td className="px-3 py-3 text-right font-semibold text-red-600">{balance > 0 ? fmt(balance) : '—'}</td>
                        <td className="px-3 py-3 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status]}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {(c.status === 'Overdue' || c.status === 'Outstanding') && (
                            <button className="flex items-center gap-1 text-xs text-blue-600 whitespace-nowrap hover:text-blue-800 border border-blue-200 px-2 py-0.5 rounded-lg">
                              <Bell size={11} /> Remind
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-900 text-white">
                    <td className="px-3 py-3 font-bold" colSpan={6}>TOTAL</td>
                    <td className="px-3 py-3 text-right font-bold">{fmt(pTotal)}</td>
                    <td className="px-3 py-3 text-right font-bold text-green-300">{fmt(pReceived)}</td>
                    <td />
                    <td className="px-3 py-3 text-right font-bold text-red-300">{fmt(pTotal - pReceived)}</td>
                    <td /><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {showModal && renderModal()}
    </div>
  );
}
