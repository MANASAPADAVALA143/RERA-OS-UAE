import { useState, useMemo } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { CapitalCall } from '../../contexts/PropertyDevContext';
import { Plus, X, AlertTriangle, CheckCircle2, Bell, Trash2, Calculator } from 'lucide-react';

const STATUS_COLORS: Record<CapitalCall['status'], string> = {
  Paid: 'bg-green-100 text-green-700',
  Partial: 'bg-amber-100 text-amber-700',
  Outstanding: 'bg-blue-100 text-blue-700',
  Overdue: 'bg-red-100 text-red-700',
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

// ── Expense builder types ────────────────────────────────────────────────────

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

// ── Decision Header ──────────────────────────────────────────────────────────

function DecisionHeader({ capitalCalls, totalExpenseNeed, monthlyEmi, cashAvailable }: {
  capitalCalls: CapitalCall[];
  totalExpenseNeed: number;
  monthlyEmi: number;
  cashAvailable: number;
}) {
  const overdue = capitalCalls.filter(c => c.status === 'Overdue');
  const outstanding = capitalCalls.filter(c => c.status !== 'Paid');
  const cashShortfall = totalExpenseNeed > cashAvailable;
  const urgency = overdue.length > 0 ? 'high' : cashShortfall ? 'medium' : 'low';

  const config = {
    high:   { bg: 'bg-red-50 border-red-300',    icon: <AlertTriangle size={20} className="text-red-500" />,   title: 'CALL NOW — Overdue Obligations', color: 'text-red-700'  },
    medium: { bg: 'bg-amber-50 border-amber-300', icon: <AlertTriangle size={20} className="text-amber-500" />, title: 'CALL SOON — Cash Shortfall Ahead', color: 'text-amber-700' },
    low:    { bg: 'bg-green-50 border-green-300', icon: <CheckCircle2  size={20} className="text-green-500" />, title: 'NO CALL NEEDED — Position Adequate',  color: 'text-green-700' },
  }[urgency];

  const bullets =
    urgency === 'high'
      ? [
          `${overdue.length} capital call${overdue.length > 1 ? 's' : ''} overdue — total $${overdue.reduce((s,c) => s+c.totalDue-c.received,0).toLocaleString()} unpaid.`,
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

// ── Main Component ───────────────────────────────────────────────────────────

export default function PD06CapitalCalls() {
  const { capitalCalls, setCapitalCalls, partners, loans, properties } = usePropDev();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ period: '', totalCallAmount: '', dueDate: '', notes: '' });
  const [expenses, setExpenses] = useState<ExpenseRow[]>([newExpenseRow()]);
  const [showExpenses, setShowExpenses] = useState(true);

  const periods = [...new Set(capitalCalls.map(c => c.period))];
  const totalCalled = capitalCalls.reduce((s, c) => s + c.totalDue, 0);
  const totalReceived = capitalCalls.reduce((s, c) => s + c.received, 0);
  const totalOutstanding = totalCalled - totalReceived;
  const overdueCount = capitalCalls.filter(c => c.status === 'Overdue').length;

  const monthlyEmi = loans.reduce((s, l) => s + l.emi, 0);
  const cashAvailable = properties[0]?.cashAvailable ?? 0;

  const totalExpenseNeed = useMemo(
    () => expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [expenses],
  );

  // Auto-calculate per-partner splits when total call amount changes
  const partnerSplits = useMemo(() => {
    const total = parseFloat(form.totalCallAmount.replace(/,/g, '') || '0');
    return partners.map(p => ({
      ...p,
      callShare: (p.sharePercent / 100) * total,
    }));
  }, [form.totalCallAmount, partners]);

  function addExpenseRow() {
    setExpenses(prev => [...prev, newExpenseRow()]);
  }

  function updateExpenseRow(id: string, field: keyof ExpenseRow, value: string | number) {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  function removeExpenseRow(id: string) {
    setExpenses(prev => prev.filter(e => e.id !== id));
  }

  function applyExpensesToCall() {
    setForm(f => ({ ...f, totalCallAmount: String(Math.ceil(totalExpenseNeed)) }));
  }

  function addCall() {
    if (!form.period || !form.totalCallAmount) return;
    const total = parseFloat(form.totalCallAmount.replace(/,/g, ''));
    const newCalls: CapitalCall[] = partners.map(p => ({
      id: `cc-${Date.now()}-${p.id}`,
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
    setCapitalCalls([...capitalCalls, ...newCalls]);
    setShowModal(false);
    setForm({ period: '', totalCallAmount: '', dueDate: '', notes: '' });
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

      {/* Decision Header */}
      <DecisionHeader
        capitalCalls={capitalCalls}
        totalExpenseNeed={totalExpenseNeed}
        monthlyEmi={monthlyEmi}
        cashAvailable={cashAvailable}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Called',    value: fmt(totalCalled),      sub: `${capitalCalls.length} calls`,       color: 'text-gray-900'   },
          { label: 'Total Received',  value: fmt(totalReceived),    sub: `${((totalReceived/Math.max(1,totalCalled))*100).toFixed(0)}% collected`, color: 'text-green-700'  },
          { label: 'Outstanding',     value: fmt(totalOutstanding), sub: `${capitalCalls.filter(c=>c.status!=='Paid').length} active`,   color: totalOutstanding > 0 ? 'text-red-600' : 'text-gray-400' },
          { label: 'Overdue Calls',   value: String(overdueCount),  sub: 'need immediate action',              color: overdueCount > 0 ? 'text-red-700' : 'text-green-600' },
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
        const periodCalls = capitalCalls.filter(c => c.period === period);
        const pTotal = periodCalls.reduce((s, c) => s + c.totalDue, 0);
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
                    {['Partner', 'Share %', 'Total Call', 'Partner Share', 'Old Dues', 'Total Due', 'Received', 'Due Date', 'Balance', 'Status', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {periodCalls.map(c => {
                    const balance = c.totalDue - c.received;
                    return (
                      <tr key={c.id} className={`hover:bg-gray-50 ${c.status === 'Overdue' ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3 font-medium text-gray-900">{c.partnerName}</td>
                        <td className="px-4 py-3 text-right">{c.sharePercent}%</td>
                        <td className="px-4 py-3 text-right">{fmt(c.totalCallAmount)}</td>
                        <td className="px-4 py-3 text-right">{fmt(c.partnerShare)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{c.oldDues > 0 ? fmt(c.oldDues) : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt(c.totalDue)}</td>
                        <td className="px-4 py-3 text-right text-green-700">{fmt(c.received)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{c.dueDate ?? c.receivedDate ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600">{balance > 0 ? fmt(balance) : '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status]}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
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
                    <td className="px-4 py-3 font-bold" colSpan={5}>TOTAL</td>
                    <td className="px-4 py-3 text-right font-bold">{fmt(pTotal)}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-300">{fmt(pReceived)}</td>
                    <td />
                    <td className="px-4 py-3 text-right font-bold text-red-300">{fmt(pTotal - pReceived)}</td>
                    <td /><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {/* Issue Capital Call Modal */}
      {showModal && (
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

              {/* Auto-calculated partner splits */}
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
      )}
    </div>
  );
}
