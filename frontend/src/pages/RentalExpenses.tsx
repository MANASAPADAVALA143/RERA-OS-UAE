import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';
import PeriodToggle from '../components/shared/PeriodToggle';
import { type Period, getPeriodKeys } from '../utils/periodWindow';

// ── types ────────────────────────────────────────────────────────────────────
interface FinItem {
  label: string;
  values?: Record<number, number>;
  monthlyValues?: Record<string, number>;
  children?: FinItem[];
}

interface CompanyOption { id: string; company_name: string }

// Set to true in dev to log every line item being classified (per company, to console)
const DEBUG_EXPENSES = false;

// ── category matchers (in priority order) ────────────────────────────────────
// No catch-all here — unclassified non-revenue leaf items fall into "Other" via classifyLabel fallback
const EXPENSE_CATS: { label: string; re: RegExp }[] = [
  { label: 'Management Fee',           re: /management\s*fee/i },
  { label: 'Insurance',                re: /insurance/i },
  { label: 'Interest',                 re: /interest.*loan|interest.*paid|interest.*expense|interest\s+on/i },
  { label: 'Legal',                    re: /\blegal\b/i },
  { label: 'Accounting Fee',           re: /accounting\s*fee/i },
  { label: 'HOA',                      re: /\bhoa\b/i },
  { label: 'Property Tax',             re: /property\s*tax|real\s*estate\s*tax/i },
  { label: 'Repairs & Maintenance',    re: /repair|maintenance/i },
  { label: 'Utilities',                re: /utilit/i },
  { label: 'Depreciation',             re: /depreciat/i },
  { label: 'Consulting',               re: /consult/i },
  { label: 'Loan Processing',          re: /loan.*process/i },
  { label: 'Membership/Subscriptions', re: /membership|subscript/i },
  { label: 'Misc Expenses',            re: /\bmisc\b/i },
  { label: 'Office Supplies',          re: /office.*suppl/i },
  { label: 'Cleaning',                 re: /clean/i },
  { label: 'Irrigation',               re: /irrigat/i },
  { label: 'Advertising',              re: /advertis/i },
  { label: 'Appraisal Fee',            re: /apprais/i },
  { label: 'Bank Charges',             re: /bank.*charg|bank.*fee/i },
  { label: 'Commission',               re: /commission/i },
  { label: 'Courier',                  re: /courier/i },
  { label: 'Donation',                 re: /donat/i },
  { label: 'Engineering',              re: /engineer/i },
  { label: 'Fire Safety',              re: /fire.*safe|fire.*protect/i },
];

// Lines to skip: totals/subtotals and revenue/income items.
// Only applied to LEAF nodes (parent group nodes are skipped by buildExpRows, not here).
const SKIP_RE = /^(total|subtotal|net\s|gross\s|\bincome\b|^revenue|rental\s+income|rent\s+income|rent\s*-|other\s+income|total\s+revenue|total\s+income|total\s+rent|operating\s+income|net\s+income|net\s+loss)/i;

// Returns the expense category for a leaf P&L label, or null to skip revenue/total lines.
// Unrecognised non-revenue leaves → "Other" (not null) so nothing is silently dropped.
function classifyLabel(label: string): string | null {
  if (SKIP_RE.test(label.trim())) return null; // revenue or total line — skip
  for (const { label: cat, re } of EXPENSE_CATS) {
    if (re.test(label)) return cat;
  }
  return 'Other'; // unclassified expense leaf (e.g. "Contract Expenses", "Loss on investments")
}

// ── helpers ──────────────────────────────────────────────────────────────────
function flattenItems(items: FinItem[]): FinItem[] {
  const out: FinItem[] = [];
  function walk(list: FinItem[]) {
    for (const item of list) {
      out.push(item);
      if (item.children?.length) walk(item.children);
    }
  }
  walk(items);
  return out;
}

function allMonthKeys(items: FinItem[]): string[] {
  const seen = new Set<string>();
  flattenItems(items).forEach(item =>
    Object.keys(item.monthlyValues ?? {}).forEach(k => seen.add(k))
  );
  return Array.from(seen);
}

const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthSortKey(k: string): number {
  const [m, y] = k.split(' ');
  return (parseInt(y) || 0) * 100 + (MNAMES.indexOf(m) + 1);
}

// ── expense row builder ───────────────────────────────────────────────────────
interface ExpRow { company: string; category: string; month: string; amount: number }

function buildExpRows(companyName: string, pl: FinItem[]): ExpRow[] {
  const rows: ExpRow[] = [];
  const debugTotals: Record<string, number> = {};

  for (const item of flattenItems(pl)) {
    // Skip parent/group nodes — their monthlyValues are rollups of their children.
    // Summing both parent and children would double-count. Leaf nodes only.
    if (item.children?.length) continue;

    const cat = classifyLabel(item.label);
    if (!cat) continue; // revenue or total line

    const mv = item.monthlyValues ?? {};
    for (const [month, val] of Object.entries(mv)) {
      const amount = Math.abs(val);
      if (amount > 0) {
        rows.push({ company: companyName, category: cat, month, amount });
        if (DEBUG_EXPENSES) debugTotals[`${cat} | ${item.label}`] = (debugTotals[`${cat} | ${item.label}`] ?? 0) + amount;
      }
    }
  }

  if (DEBUG_EXPENSES) {
    console.group(`[ExpenseDebug] ${companyName}`);
    const grandTotal = Object.values(debugTotals).reduce((s, v) => s + v, 0);
    Object.entries(debugTotals).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
      console.log(`  ${k}: $${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    );
    console.log(`  ── TOTAL: $${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.groupEnd();
  }

  return rows;
}

// ── colours ──────────────────────────────────────────────────────────────────
const PALETTE = [
  '#D4AF37','#8B5CF6','#EC4899','#F59E0B','#10B981','#06B6D4',
  '#F97316','#EF4444','#3B82F6','#14B8A6','#A78BFA','#FB923C',
  '#84CC16','#E879F9','#38BDF8','#FCD34D','#6EE7B7','#FCA5A5',
];
const catColor = (cat: string, allCats: string[]) =>
  PALETTE[allCats.indexOf(cat) % PALETTE.length] ?? '#A8A29E';

const TT = { contentStyle: { background: '#F7F5F0', border: '1px solid #DDD8CC', borderRadius: '0.5rem' } };

// ── component ─────────────────────────────────────────────────────────────────
export default function RentalExpenses() {
  const [companies, setCompanies]         = useState<CompanyOption[]>([]);
  const [allPl, setAllPl]                 = useState<Record<string, FinItem[]>>({});
  const [allNames, setAllNames]           = useState<Record<string, string>>({});
  const [loading, setLoading]             = useState(true);
  const [filterCompany, setFilterCompany] = useState('');
  const [period, setPeriod]               = useState<Period | null>(null);
  const [pMonth, setPMonth]               = useState(new Date().getMonth() + 1);
  const [pYear, setPYear]                 = useState(new Date().getFullYear());

  useEffect(() => {
    api.get<CompanyOption[]>('/api/rentals/companies')
      .then(r => setCompanies(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  const loadFinancials = useCallback(async (list: CompanyOption[]) => {
    setLoading(true);
    const results = await Promise.all(
      list.map(co =>
        api.get<{ company_name: string; pl: FinItem[] }>(`/api/rentals/financials/${co.id}`)
          .then(r => ({ id: co.id, name: r.data.company_name, pl: r.data.pl ?? [] }))
          .catch(() => ({ id: co.id, name: co.company_name, pl: [] as FinItem[] }))
      )
    );
    const plMap: Record<string, FinItem[]> = {};
    const nameMap: Record<string, string>  = {};
    results.forEach(r => { plMap[r.id] = r.pl; nameMap[r.id] = r.name; });
    setAllPl(plMap);
    setAllNames(nameMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (companies.length) loadFinancials(companies);
  }, [companies, loadFinancials]);

  // All expense rows (optionally filtered by company)
  const allRows = useMemo<ExpRow[]>(() => {
    const ids = filterCompany ? [filterCompany] : Object.keys(allPl);
    return ids.flatMap(id => buildExpRows(allNames[id] ?? id, allPl[id] ?? []));
  }, [allPl, allNames, filterCompany]);

  // Available month keys for PeriodToggle
  const availableKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.values(allPl).forEach(pl => allMonthKeys(pl).forEach(k => keys.add(k)));
    return Array.from(keys).sort((a, b) => monthSortKey(a) - monthSortKey(b));
  }, [allPl]);

  // Period-filtered rows
  const filteredRows = useMemo<ExpRow[]>(() => {
    if (!period) return allRows;
    const keys = new Set(getPeriodKeys(period, pMonth, pYear));
    return allRows.filter(r => keys.has(r.month));
  }, [allRows, period, pMonth, pYear]);

  // "This Month" tile: when a period is active, shows the period total instead (same scope as donut)
  const currentMonthKey = `${MNAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const periodLabel = period ? period : 'This Month';
  const periodTotal = useMemo(() =>
    period
      ? filteredRows.reduce((s, r) => s + r.amount, 0)
      : allRows.filter(r => r.month === currentMonthKey).reduce((s, r) => s + r.amount, 0),
  [period, filteredRows, allRows, currentMonthKey]);

  // All Time is always full history regardless of period — labelled clearly
  const totalAllTime = useMemo(() => allRows.reduce((s, r) => s + r.amount, 0), [allRows]);

  // Top Category respects the period toggle (same window as the donut below it)
  const topCategory = useMemo(() => {
    const byCat: Record<string, number> = {};
    filteredRows.forEach(r => { byCat[r.category] = (byCat[r.category] ?? 0) + r.amount; });
    return Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  }, [filteredRows]);

  const allCats = useMemo(() => [...new Set(filteredRows.map(r => r.category))].sort(), [filteredRows]);

  const byCategory = useMemo(() => {
    const byCat: Record<string, number> = {};
    filteredRows.forEach(r => { byCat[r.category] = (byCat[r.category] ?? 0) + r.amount; });
    return Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount }));
  }, [filteredRows]);

  const byCompany = useMemo(() => {
    const byCo: Record<string, number> = {};
    filteredRows.forEach(r => { byCo[r.company] = (byCo[r.company] ?? 0) + r.amount; });
    return Object.entries(byCo).sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount }));
  }, [filteredRows]);

  // Trend uses all-time (not period-filtered) to always show 6-month history
  const trendData = useMemo(() => {
    const byMonth: Record<string, number> = {};
    allRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    return Object.entries(byMonth)
      .sort((a, b) => monthSortKey(a[0]) - monthSortKey(b[0]))
      .slice(-6)
      .map(([month, amount]) => ({ month, amount: parseFloat(amount.toFixed(2)) }));
  }, [allRows]);

  // Deduplicated table rows (company × category × month)
  const tableRows = useMemo(() => {
    const agg: Record<string, ExpRow> = {};
    filteredRows.forEach(r => {
      const key = `${r.company}|${r.category}|${r.month}`;
      if (agg[key]) agg[key] = { ...agg[key], amount: agg[key].amount + r.amount };
      else agg[key] = { ...r };
    });
    return Object.values(agg).sort((a, b) =>
      a.company.localeCompare(b.company) ||
      a.category.localeCompare(b.category) ||
      monthSortKey(a.month) - monthSortKey(b.month)
    );
  }, [filteredRows]);

  const noData = !loading && allRows.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1C1917' }}>Expenses</h1>
          <p className="text-sm mt-0.5" style={{ color: '#A8A29E' }}>
            Pulled from P&amp;L financials — all categories, all companies
          </p>
        </div>
      </div>

      {/* Filters + PeriodToggle */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-lg" style={{ background: '#F0EDE5', border: '1px solid #DDD8CC' }}>
        <span className="text-xs font-semibold" style={{ color: '#A8A29E' }}>COMPANY</span>
        <select
          value={filterCompany}
          onChange={e => setFilterCompany(e.target.value)}
          style={{ background: '#F7F5F0', color: '#1C1917', borderColor: '#DDD8CC' }}
          className="px-3 py-1.5 border rounded-lg text-sm focus:outline-none"
        >
          <option value="">All Companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <div className="ml-auto">
          <PeriodToggle
            period={period} month={pMonth} year={pYear}
            availableKeys={availableKeys}
            onChange={(p, m, y) => { setPeriod(p); setPMonth(m); setPYear(y); }}
          />
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : noData ? (
        <div className="p-6 rounded-lg text-center" style={{ background: '#F0EDE5', border: '1px solid #DDD8CC', color: '#A8A29E' }}>
          No P&amp;L data uploaded yet. Upload financial statements in the Financials tab to see expenses here.
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label={periodLabel}           value={fmtUSD(periodTotal)} accent />
            <KpiCard label="All Time (all years)"  value={fmtUSD(totalAllTime)} />
            <KpiCard label="Top Category"          value={topCategory} />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Donut */}
            <Card title="Expense by Category">
              {byCategory.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={byCategory} cx="50%" cy="50%"
                        innerRadius={48} outerRadius={76} paddingAngle={2}
                        dataKey="amount" nameKey="category">
                        {byCategory.map((e, i) => (
                          <Cell key={i} fill={catColor(e.category, allCats)} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto pr-1">
                    {byCategory.map((e, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5" style={{ color: '#57534E' }}>
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: catColor(e.category, allCats) }} />
                          {e.category}
                        </span>
                        <span style={{ color: '#1C1917', fontWeight: 600 }}>{fmtUSD(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#A8A29E' }}>No data</div>
              )}
            </Card>

            {/* By Company */}
            <Card title="Expense by Company">
              {byCompany.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byCompany} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#92400E' }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#92400E' }} width={90} />
                    <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                    <Bar dataKey="amount" fill="#D4AF37" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#A8A29E' }}>No data</div>
              )}
            </Card>

            {/* Trend */}
            <Card title="Expense Trend — 6 Months">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData}>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#92400E' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#92400E' }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                    <Line type="monotone" dataKey="amount" stroke="#10B981"
                      strokeWidth={2} dot={{ fill: '#10B981', r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#A8A29E' }}>No trend data</div>
              )}
            </Card>
          </div>

          {/* Table */}
          <Card title={`All Expenses${period ? ` — ${period}` : ''}`}>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0" style={{ background: '#F0EDE5' }}>
                  <tr className="border-b" style={{ borderColor: '#DDD8CC' }}>
                    {['Company', 'Category', 'Month', 'Amount'].map(h => (
                      <th key={h} className="py-2 px-3 font-medium text-left" style={{ color: '#A8A29E' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr><td colSpan={4} className="py-8 text-center" style={{ color: '#A8A29E' }}>
                      No expenses in the selected period
                    </td></tr>
                  ) : tableRows.map((r, i) => (
                    <tr key={i} className="border-b" style={{ borderColor: '#F7F5F0' }}>
                      <td className="py-2 px-3" style={{ color: '#92400E' }}>{r.company}</td>
                      <td className="py-2 px-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: catColor(r.category, allCats), color: 'white' }}>
                          {r.category}
                        </span>
                      </td>
                      <td className="py-2 px-3" style={{ color: '#78716C' }}>{r.month}</td>
                      <td className="py-2 px-3 font-semibold" style={{ color: '#1C1917' }}>{fmtUSD(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {tableRows.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #DDD8CC', background: '#F0EDE5' }}>
                      <td colSpan={3} className="py-2 px-3 font-semibold" style={{ color: '#1C1917' }}>Total</td>
                      <td className="py-2 px-3 font-bold" style={{ color: '#D4AF37' }}>
                        {fmtUSD(tableRows.reduce((s, r) => s + r.amount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
