import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, ChevronRight, Paperclip, Trash2, ExternalLink } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD } from '../components/ProtectedRoute';

interface Expense {
  id: string;
  expense_date: string;
  category: string;
  division: string | null;
  subdivision: string | null;
  line_item: string | null;
  expense_type: string | null;
  currency: string;
  amount: number;
  payable_to: string;
  mode_of_payment: string | null;
  description: string;
  receipt_file_reference: string | null;
  created_by: string | null;
  created_at: string;
}

interface ExpenseSummary {
  count: number;
  total_expenses: number;
  total_refunds: number;
  total_recurring: number;
  this_month: number;
  by_division: Record<string, number>;
}

interface SovTrade { division_label: string | null; }

type SortKey = keyof Expense;

const CATEGORY_COLORS: Record<string, string> = {
  expense: 'bg-red-50 text-red-700',
  refund: 'bg-green-50 text-green-700',
  recurring_expense: 'bg-purple-50 text-purple-700',
};

const CATEGORY_LABELS: Record<string, string> = {
  expense: 'Expense',
  refund: 'Refund',
  recurring_expense: 'Recurring',
};

const MODES = ['ach', 'check', 'wire', 'credit_card', 'cash', 'other'];
const MODE_LABELS: Record<string, string> = {
  ach: 'ACH', check: 'Check', wire: 'Wire', credit_card: 'Credit Card', cash: 'Cash', other: 'Other',
};

const BLANK_FORM = {
  expense_date: '',
  category: 'expense',
  division: '',
  subdivision: '',
  line_item: '',
  expense_type: '',
  currency: 'USD',
  amount: '',
  payable_to: '',
  mode_of_payment: '',
  description: '',
};

export default function ConstructionExpenses({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'write';

  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary>({
    count: 0, total_expenses: 0, total_refunds: 0, total_recurring: 0, this_month: 0, by_division: {},
  });
  const [divisions, setDivisions] = useState<string[]>([]);
  const [error, setError] = useState('');

  const [sortKey, setSortKey] = useState<SortKey>('expense_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { project_id: projectId };
      if (filterCategory) params.category = filterCategory;
      const res = await api.get('/api/real-estate/expenses', { params });
      setExpenses(res.data.items ?? []);
      setSummary(res.data.summary ?? { count: 0, total_expenses: 0, total_refunds: 0, total_recurring: 0, this_month: 0, by_division: {} });
    } catch {
      setError('Failed to load expenses.');
    } finally {
      setLoading(false);
    }
  }, [projectId, filterCategory]);

  // Load unique divisions from SOV trades for cascading dropdown
  useEffect(() => {
    if (!projectId) return;
    api.get('/api/real-estate/costs/trades', { params: { project_id: projectId } })
      .then(res => {
        const divs = Array.from(new Set(
          (res.data as SovTrade[]).map(t => t.division_label).filter(Boolean)
        )) as string[];
        setDivisions(divs);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sorted = [...expenses].sort((a, b) => {
    const av = a[sortKey]; const bv = b[sortKey];
    if (av == null) return 1; if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.expense_date) { setFormError('Date is required.'); return; }
    if (!form.amount || parseFloat(form.amount) <= 0) { setFormError('Amount must be > 0.'); return; }
    if (!form.payable_to.trim()) { setFormError('Payable to is required.'); return; }
    if (!form.description.trim()) { setFormError('Description is required.'); return; }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('project_id', projectId);
      fd.append('expense_date', form.expense_date);
      fd.append('category', form.category);
      fd.append('amount', form.amount);
      fd.append('payable_to', form.payable_to.trim());
      fd.append('description', form.description.trim());
      if (form.division) fd.append('division', form.division);
      if (form.subdivision) fd.append('subdivision', form.subdivision.trim());
      if (form.line_item) fd.append('line_item', form.line_item.trim());
      if (form.expense_type) fd.append('expense_type', form.expense_type.trim());
      if (form.currency) fd.append('currency', form.currency);
      if (form.mode_of_payment) fd.append('mode_of_payment', form.mode_of_payment);
      if (receiptFile) fd.append('receipt', receiptFile);

      await api.post('/api/real-estate/expenses', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm({ ...BLANK_FORM });
      setReceiptFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setShowForm(false);
      await load();
    } catch (err: any) {
      setFormError(err?.response?.data?.detail || 'Failed to create expense.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return;
    await api.delete(`/api/real-estate/expenses/${id}`);
    await load();
  }

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

  if (!projectId) return <p className="text-gray-400 text-sm">Select a project to view expenses.</p>;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Total Expenses" value={fmtUSD(summary.total_expenses)} />
        <KpiCard label="This Month" value={fmtUSD(summary.this_month)} />
        <KpiCard label="Refunds" value={fmtUSD(summary.total_refunds)} />
        <KpiCard label="Recurring" value={fmtUSD(summary.total_recurring)} />
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Expenses Table */}
      <Card
        title="Expenses"
        action={
          <div className="flex items-center gap-2">
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="text-xs px-2 py-1 border border-gray-300 rounded-lg text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="">All Categories</option>
              <option value="expense">Expense</option>
              <option value="refund">Refund</option>
              <option value="recurring_expense">Recurring</option>
            </select>
            {canWrite && (
              <button
                onClick={() => setShowForm(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus size={13} /> New Expense
              </button>
            )}
          </div>
        }
      >
        {/* Create Form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">New Expense</h3>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                <input
                  type="date"
                  value={form.expense_date}
                  onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                >
                  <option value="expense">Expense</option>
                  <option value="refund">Refund</option>
                  <option value="recurring_expense">Recurring Expense</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount *</label>
                <input
                  type="number" step="0.01" min="0.01"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Division (from SOV)</label>
                <select
                  value={form.division}
                  onChange={e => setForm(f => ({ ...f, division: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                >
                  <option value="">— None —</option>
                  {divisions.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subdivision</label>
                <input
                  value={form.subdivision}
                  onChange={e => setForm(f => ({ ...f, subdivision: e.target.value }))}
                  placeholder="e.g. Temporary Site Facilities"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Line Item</label>
                <input
                  value={form.line_item}
                  onChange={e => setForm(f => ({ ...f, line_item: e.target.value }))}
                  placeholder="e.g. Field Office - Utilities"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expense Type</label>
                <input
                  value={form.expense_type}
                  onChange={e => setForm(f => ({ ...f, expense_type: e.target.value }))}
                  placeholder="e.g. Supplies, Labor, Rental"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payable To *</label>
                <input
                  value={form.payable_to}
                  onChange={e => setForm(f => ({ ...f, payable_to: e.target.value }))}
                  placeholder="Vendor / Payee name"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Mode of Payment</label>
                <select
                  value={form.mode_of_payment}
                  onChange={e => setForm(f => ({ ...f, mode_of_payment: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                >
                  <option value="">— None —</option>
                  {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of what this expense covers"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none resize-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Paperclip size={12} className="inline mr-1" />
                  Attach Receipt
                  <span className="ml-2 font-normal text-gray-400 text-xs">(Receipt storage only — OCR auto-fill not yet available)</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={e => setReceiptFile(e.target.files?.[0] ?? null)}
                  className="text-sm text-gray-600"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button"
                onClick={() => { setShowForm(false); setFormError(''); setForm({ ...BLANK_FORM }); setReceiptFile(null); }}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Create Expense'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : expenses.length === 0 ? (
          <p className="text-center py-10 text-sm text-gray-400">No expenses yet for this project.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:-mx-6">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  {th('Date', 'expense_date')}
                  {th('Category', 'category')}
                  {th('Division', 'division')}
                  {th('Payable To', 'payable_to')}
                  {th('Amount', 'amount', 'right')}
                  {th('Mode', 'mode_of_payment')}
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-8 text-center">Rcpt</th>
                  {canWrite && <th className="px-3 py-2 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(exp => (
                  <>
                    <tr key={exp.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setExpandedId(expandedId === exp.id ? null : exp.id)}
                          className="text-gray-400 hover:text-gray-700"
                        >
                          {expandedId === exp.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{exp.expense_date}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[exp.category] ?? 'bg-gray-100 text-gray-600'}`}>
                          {CATEGORY_LABELS[exp.category] ?? exp.category}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs">{exp.division ?? '—'}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-800">{exp.payable_to}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${exp.category === 'refund' ? 'text-green-700' : 'text-gray-900'}`}>
                        {exp.category === 'refund' ? `+${fmtUSD(exp.amount)}` : fmtUSD(exp.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{exp.mode_of_payment ? MODE_LABELS[exp.mode_of_payment] ?? exp.mode_of_payment : '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {exp.receipt_file_reference ? (
                          <a href={exp.receipt_file_reference} target="_blank" rel="noreferrer"
                            className="text-primary hover:text-primary/70" title="View receipt">
                            <ExternalLink size={13} />
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {canWrite && (
                        <td className="px-3 py-2.5 text-center">
                          <button onClick={() => handleDelete(exp.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                    {/* Detail drawer */}
                    {expandedId === exp.id && (
                      <tr key={`${exp.id}-drawer`} className="bg-slate-50">
                        <td colSpan={canWrite ? 9 : 8} className="px-6 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-1 text-xs text-gray-600">
                            <div><span className="font-medium text-gray-500">Description: </span>{exp.description}</div>
                            {exp.subdivision && <div><span className="font-medium text-gray-500">Subdivision: </span>{exp.subdivision}</div>}
                            {exp.line_item && <div><span className="font-medium text-gray-500">Line Item: </span>{exp.line_item}</div>}
                            {exp.expense_type && <div><span className="font-medium text-gray-500">Type: </span>{exp.expense_type}</div>}
                            <div><span className="font-medium text-gray-500">Currency: </span>{exp.currency}</div>
                            {exp.created_by && <div><span className="font-medium text-gray-500">Created by: </span>{exp.created_by}</div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Division breakdown */}
      {Object.keys(summary.by_division).length > 0 && (
        <Card title="Spending by Division">
          <div className="space-y-2">
            {Object.entries(summary.by_division)
              .sort((a, b) => b[1] - a[1])
              .map(([div, amt]) => {
                const max = Math.max(...Object.values(summary.by_division));
                const pct = max > 0 ? (amt / max) * 100 : 0;
                return (
                  <div key={div} className="flex items-center gap-3">
                    <div className="w-32 text-xs text-gray-600 truncate flex-shrink-0">{div}</div>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-24 text-right text-xs font-medium text-gray-700">{fmtUSD(amt)}</div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
}
