import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../services/api';
import { Card } from '../components/ui/Card';
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
interface ExpRow { company: string; category: string; month: string; amount: number }

// ── dev debug ─────────────────────────────────────────────────────────────────
const DEBUG_EXPENSES = false;

// ── one-time adjustment (Sec 481a) ───────────────────────────────────────────
const ONE_TIME_CAT = 'OneTimeAdjustment';
const ONE_TIME_RE  = /sec\s*481|481\s*\(a\)|accounting\s*method\s*adjustment/i;

// ── expense category matchers ─────────────────────────────────────────────────
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

const SKIP_RE = /^(total|subtotal|net\s|gross\s|\bincome\b|^revenue|rental\s+income|rent\s+income|rent\s*-|other\s+income|total\s+revenue|total\s+income|total\s+rent|operating\s+income|net\s+income|net\s+loss)/i;
const REVENUE_LINE_RE  = /rental\s+income|rent\s+income|other\s+income|parking\s+income|rent\s*-/i;
const REVENUE_SKIP_RE  = /^(total\s|subtotal\s|net\s|gross\s)/i;

function classifyLabel(label: string): string | null {
  const t = label.trim();
  if (SKIP_RE.test(t)) return null;
  if (ONE_TIME_RE.test(t)) return ONE_TIME_CAT;
  for (const { label: cat, re } of EXPENSE_CATS) { if (re.test(label)) return cat; }
  return 'Other';
}

// ── helpers ───────────────────────────────────────────────────────────────────
function flattenItems(items: FinItem[]): FinItem[] {
  const out: FinItem[] = [];
  function walk(list: FinItem[]) { for (const item of list) { out.push(item); if (item.children?.length) walk(item.children); } }
  walk(items);
  return out;
}
function allMonthKeys(items: FinItem[]): string[] {
  const s = new Set<string>();
  flattenItems(items).forEach(i => Object.keys(i.monthlyValues ?? {}).forEach(k => s.add(k)));
  return Array.from(s);
}
const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthSortKey(k: string): number {
  const [m, y] = k.split(' ');
  return (parseInt(y) || 0) * 100 + (MNAMES.indexOf(m) + 1);
}
function prevMonthKey(k: string): string {
  const [m, y] = k.split(' '); const mi = MNAMES.indexOf(m);
  return mi === 0 ? `Dec ${parseInt(y)-1}` : `${MNAMES[mi-1]} ${y}`;
}

// ── row builders ──────────────────────────────────────────────────────────────
function buildExpRows(companyName: string, pl: FinItem[]): ExpRow[] {
  const rows: ExpRow[] = [];
  const dbg: Record<string,number> = {};
  for (const item of flattenItems(pl)) {
    if (item.children?.length) continue;
    const cat = classifyLabel(item.label);
    if (!cat) continue;
    for (const [month, val] of Object.entries(item.monthlyValues ?? {})) {
      const amount = Math.abs(val);
      if (amount > 0) {
        rows.push({ company: companyName, category: cat, month, amount });
        if (DEBUG_EXPENSES) dbg[`${cat} | ${item.label}`] = (dbg[`${cat} | ${item.label}`] ?? 0) + amount;
      }
    }
  }
  if (DEBUG_EXPENSES) {
    console.group(`[ExpenseDebug] ${companyName}`);
    const total = Object.values(dbg).reduce((s,v)=>s+v,0);
    Object.entries(dbg).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: $${v.toFixed(2)}`));
    console.log(`  ── TOTAL: $${total.toFixed(2)}`); console.groupEnd();
  }
  return rows;
}
function buildRevRows(pl: FinItem[]): { month: string; amount: number }[] {
  const rows: { month: string; amount: number }[] = [];
  for (const item of flattenItems(pl)) {
    if (item.children?.length) continue;
    const t = item.label.trim();
    if (REVENUE_SKIP_RE.test(t)) continue;
    if (!REVENUE_LINE_RE.test(t)) continue;
    for (const [month, val] of Object.entries(item.monthlyValues ?? {})) {
      const amount = Math.abs(val);
      if (amount > 0) rows.push({ month, amount });
    }
  }
  return rows;
}

// ── colour palette — parchment/earth tones only ───────────────────────────────
const PALETTE = [
  '#D4AF37','#B8860B','#C08B40','#8B6914','#A67C52',
  '#7A6040','#C4A882','#6B4423','#C17A3F','#9B6B4A',
  '#D4956A','#8B7355','#E8C87A','#5C4033','#A87050',
  '#7D5A3C','#D4B896','#C19A65',
];
const catColor = (cat: string, cats: string[]) => PALETTE[cats.indexOf(cat) % PALETTE.length] ?? '#A8A29E';
const TT = { contentStyle: { background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: '0.5rem', fontSize: 12 } };

// ── mini KPI card ─────────────────────────────────────────────────────────────
function KpiTile({ label, value, sub, accent, warn, tip }: {
  label: string; value: string; sub?: string; accent?: boolean; warn?: boolean; tip?: string;
}) {
  return (
    <div className="exp-kpi-card" title={tip}
      style={{
        background: accent ? 'linear-gradient(135deg,#D4AF37,#B8860B)' : warn ? '#FEF3C7' : '#FBF6EE',
        border: `1px solid ${warn ? '#FDE68A' : '#E8DEC8'}`,
        borderRadius: 12, padding: '16px 18px', cursor: 'default',
      }}>
      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: accent ? 'rgba(255,255,255,0.8)' : warn ? '#92400E' : '#78716C', marginBottom: 4 }}>
        {label}
      </p>
      <p style={{ fontSize: 22, fontWeight: 700, color: accent ? '#fff' : warn ? '#92400E' : '#1C1917', lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, color: accent ? 'rgba(255,255,255,0.7)' : '#A8A29E', marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────
export default function RentalExpenses() {
  const [companies, setCompanies]         = useState<CompanyOption[]>([]);
  const [allPl, setAllPl]                 = useState<Record<string, FinItem[]>>({});
  const [allNames, setAllNames]           = useState<Record<string, string>>({});
  const [loading, setLoading]             = useState(true);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterCat, setFilterCat]         = useState<string | null>(null);
  const [period, setPeriod]               = useState<Period | null>(null);
  const [pMonth, setPMonth]               = useState(new Date().getMonth() + 1);
  const [pYear, setPYear]                 = useState(new Date().getFullYear());
  const [showOneTime, setShowOneTime]     = useState(false);
  const oneTimePanelRef                   = useRef<HTMLDivElement>(null);

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
    setAllPl(plMap); setAllNames(nameMap); setLoading(false);
  }, []);

  useEffect(() => { if (companies.length) loadFinancials(companies); }, [companies, loadFinancials]);

  // company name → id (for bar chart drill-down)
  const nameToId = useMemo(() => {
    const m: Record<string, string> = {};
    companies.forEach(c => { m[c.company_name] = c.id; });
    return m;
  }, [companies]);

  // ── core rows ───────────────────────────────────────────────────────────────
  const allRows = useMemo<ExpRow[]>(() => {
    const ids = filterCompany ? [filterCompany] : Object.keys(allPl);
    return ids.flatMap(id => buildExpRows(allNames[id] ?? id, allPl[id] ?? []));
  }, [allPl, allNames, filterCompany]);

  const availableKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.values(allPl).forEach(pl => allMonthKeys(pl).forEach(k => keys.add(k)));
    return Array.from(keys).sort((a, b) => monthSortKey(a) - monthSortKey(b));
  }, [allPl]);

  const filteredRows = useMemo<ExpRow[]>(() => {
    if (!period) return allRows;
    const keys = new Set(getPeriodKeys(period, pMonth, pYear));
    return allRows.filter(r => keys.has(r.month));
  }, [allRows, period, pMonth, pYear]);

  const operatingRows         = useMemo(() => allRows.filter(r => r.category !== ONE_TIME_CAT), [allRows]);
  const filteredOperatingRows = useMemo(() => filteredRows.filter(r => r.category !== ONE_TIME_CAT), [filteredRows]);

  // one-time
  const oneTimeAllRows = useMemo(() => allRows.filter(r => r.category === ONE_TIME_CAT), [allRows]);
  const oneTimeTotal   = useMemo(() => oneTimeAllRows.reduce((s, r) => s + r.amount, 0), [oneTimeAllRows]);

  // revenue (for expense-to-revenue ratio)
  const allRevRows = useMemo(() => {
    const ids = filterCompany ? [filterCompany] : Object.keys(allPl);
    return ids.flatMap(id => buildRevRows(allPl[id] ?? []));
  }, [allPl, filterCompany]);

  const filteredRevRows = useMemo(() => {
    if (!period) return allRevRows;
    const keys = new Set(getPeriodKeys(period, pMonth, pYear));
    return allRevRows.filter(r => keys.has(r.month));
  }, [allRevRows, period, pMonth, pYear]);

  // ── KPI 1: period / this-month tile ─────────────────────────────────────────
  const currentMonthKey = `${MNAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const periodLabel = period ?? 'This Month';
  const periodTotal = useMemo(() =>
    period
      ? filteredOperatingRows.reduce((s, r) => s + r.amount, 0)
      : operatingRows.filter(r => r.month === currentMonthKey).reduce((s, r) => s + r.amount, 0),
  [period, filteredOperatingRows, operatingRows, currentMonthKey]);

  // ── KPI 2: all time ──────────────────────────────────────────────────────────
  const totalAllTime = useMemo(() => operatingRows.reduce((s, r) => s + r.amount, 0), [operatingRows]);

  // ── KPI 3: top category ──────────────────────────────────────────────────────
  const topCategory = useMemo(() => {
    const byCat: Record<string, number> = {};
    filteredOperatingRows.forEach(r => { byCat[r.category] = (byCat[r.category] ?? 0) + r.amount; });
    return Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  }, [filteredOperatingRows]);

  // ── KPI 4: avg monthly spend ─────────────────────────────────────────────────
  const avgMonthlySpend = useMemo(() => {
    const byMonth: Record<string, number> = {};
    filteredOperatingRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    const months = Object.keys(byMonth);
    return months.length > 0 ? Object.values(byMonth).reduce((s, v) => s + v, 0) / months.length : 0;
  }, [filteredOperatingRows]);

  // ── KPI 5: MoM change (from most recent 2 months in full history) ────────────
  const momChange = useMemo(() => {
    const byMonth: Record<string, number> = {};
    operatingRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    const months = Object.keys(byMonth).sort((a, b) => monthSortKey(a) - monthSortKey(b));
    if (months.length < 2) return null;
    const curr = byMonth[months[months.length - 1]];
    const prev = byMonth[months[months.length - 2]];
    return prev > 0 ? ((curr - prev) / prev) * 100 : null;
  }, [operatingRows]);

  // ── KPI 6: expense-to-revenue ratio ─────────────────────────────────────────
  const expToRevRatio = useMemo(() => {
    const rev = filteredRevRows.reduce((s, r) => s + r.amount, 0);
    if (rev === 0) return null;
    return (filteredOperatingRows.reduce((s, r) => s + r.amount, 0) / rev) * 100;
  }, [filteredRevRows, filteredOperatingRows]);

  // ── KPI 7: largest single line item in period ────────────────────────────────
  const largestLineItem = useMemo(() => {
    if (filteredOperatingRows.length === 0) return null;
    // aggregate to company × category × month first, then pick max
    const agg: Record<string, ExpRow> = {};
    filteredOperatingRows.forEach(r => {
      const key = `${r.company}|${r.category}|${r.month}`;
      if (agg[key]) agg[key] = { ...agg[key], amount: agg[key].amount + r.amount };
      else agg[key] = { ...r };
    });
    return Object.values(agg).reduce((max, r) => r.amount > max.amount ? r : max, Object.values(agg)[0]);
  }, [filteredOperatingRows]);

  // ── chart data ───────────────────────────────────────────────────────────────
  const allCats = useMemo(() => [...new Set(filteredOperatingRows.map(r => r.category))].sort(), [filteredOperatingRows]);

  const byCategory = useMemo(() => {
    const byCat: Record<string, number> = {};
    filteredOperatingRows.forEach(r => { byCat[r.category] = (byCat[r.category] ?? 0) + r.amount; });
    return Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount }));
  }, [filteredOperatingRows]);

  const byCompany = useMemo(() => {
    const byCo: Record<string, number> = {};
    filteredOperatingRows.forEach(r => { byCo[r.company] = (byCo[r.company] ?? 0) + r.amount; });
    return Object.entries(byCo).sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount }));
  }, [filteredOperatingRows]);

  // trend — all-time last 6 months, operating only
  const trendData = useMemo(() => {
    const byMonth: Record<string, number> = {};
    operatingRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    const months = Object.keys(byMonth).sort((a, b) => monthSortKey(a) - monthSortKey(b));
    const prev6 = months.slice(-7); // include 7 so we can compute MoM in tooltip
    return prev6.slice(-6).map(month => {
      const prevKey = prevMonthKey(month);
      const mom = byMonth[prevKey] > 0 ? ((byMonth[month] - byMonth[prevKey]) / byMonth[prevKey] * 100) : 0;
      return { month, amount: parseFloat((byMonth[month] ?? 0).toFixed(2)), mom: parseFloat(mom.toFixed(1)) };
    });
  }, [operatingRows]);

  // category sparklines — top 4 by filtered spend, last 6 months all-time trend
  const sparklineData = useMemo(() => {
    const top4 = byCategory.slice(0, 4).map(c => c.category);
    const byMonth: Record<string, number> = {};
    operatingRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    const months6 = Object.keys(byMonth).sort((a, b) => monthSortKey(a) - monthSortKey(b)).slice(-6);
    return top4.map(cat => {
      const catByMonth: Record<string, number> = {};
      operatingRows.filter(r => r.category === cat).forEach(r => {
        catByMonth[r.month] = (catByMonth[r.month] ?? 0) + r.amount;
      });
      const data = months6.map(m => ({ month: m.split(' ')[0], amount: catByMonth[m] ?? 0 }));
      const total = filteredOperatingRows.filter(r => r.category === cat).reduce((s, r) => s + r.amount, 0);
      return { cat, data, total };
    });
  }, [byCategory, operatingRows, filteredOperatingRows]);

  // YoY comparison — this year vs last year for the same months
  const yoyMonths = useMemo(() => {
    if (period) return getPeriodKeys(period, pMonth, pYear);
    const byMonth: Record<string, number> = {};
    operatingRows.forEach(r => { byMonth[r.month] = 1; });
    return Object.keys(byMonth).sort((a, b) => monthSortKey(a) - monthSortKey(b)).slice(-6);
  }, [period, pMonth, pYear, operatingRows]);

  const yoyData = useMemo(() => {
    const byMonth: Record<string, number> = {};
    operatingRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    return yoyMonths.map(m => {
      const [mon, yr] = m.split(' ');
      const lastYearKey = `${mon} ${parseInt(yr) - 1}`;
      return { month: mon, thisYear: byMonth[m] ?? 0, lastYear: byMonth[lastYearKey] ?? 0 };
    });
  }, [operatingRows, yoyMonths]);

  // heatmap — companies × months
  const heatmapCompanies = useMemo(() => [...new Set(filteredOperatingRows.map(r => r.company))].sort(), [filteredOperatingRows]);
  const heatmapCells = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOperatingRows.forEach(r => {
      const key = `${r.company}|${r.month}`;
      map[key] = (map[key] ?? 0) + r.amount;
    });
    const max = Math.max(...Object.values(map), 1);
    return { map, max };
  }, [filteredOperatingRows]);
  const heatmapMonths = useMemo(() => yoyMonths.slice(-6), [yoyMonths]);

  // table rows (company × category × month, with category drill-down filter)
  const tableRows = useMemo(() => {
    const agg: Record<string, ExpRow> = {};
    filteredOperatingRows
      .filter(r => !filterCat || r.category === filterCat)
      .forEach(r => {
        const key = `${r.company}|${r.category}|${r.month}`;
        if (agg[key]) agg[key] = { ...agg[key], amount: agg[key].amount + r.amount };
        else agg[key] = { ...r };
      });
    return Object.values(agg).sort((a, b) =>
      a.company.localeCompare(b.company) ||
      a.category.localeCompare(b.category) ||
      monthSortKey(a.month) - monthSortKey(b.month)
    );
  }, [filteredOperatingRows, filterCat]);

  const noData = !loading && operatingRows.length === 0;

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* scoped CSS */}
      <style>{`
        .exp-kpi-card { transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out; }
        .exp-kpi-card:hover { transform: scale(1.03); box-shadow: 0 6px 12px rgba(0,0,0,0.08); }
        .exp-kpi-card:active { transform: scale(0.98); }
        .exp-row:hover td { background: #F7F1E6 !important; }
        .exp-interactive:focus-visible { outline: 2px solid #D4AF37; outline-offset: 2px; }
        .exp-bar-clickable:hover { cursor: pointer; filter: brightness(1.08); }
        .exp-cat-item:hover { background: #F7F1E6; border-radius: 6px; cursor: pointer; }
      `}</style>

      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1C1917' }}>Expenses</h1>
        <p style={{ fontSize: 12, color: '#A8A29E', marginTop: 2 }}>
          Pulled from P&amp;L financials — all categories, all companies
        </p>
      </div>

      {/* Filters + PeriodToggle */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-xl"
        style={{ background: '#F0EDE5', border: '1px solid #E8DEC8' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Company</span>
        <select
          value={filterCompany}
          onChange={e => { setFilterCompany(e.target.value); setFilterCat(null); }}
          className="exp-interactive"
          style={{ background: '#FBF6EE', color: '#1C1917', border: '1px solid #E8DEC8',
            borderRadius: 8, padding: '6px 12px', fontSize: 13 }}
        >
          <option value="">All Companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        {filterCompany && (
          <button className="exp-interactive" onClick={() => setFilterCompany('')}
            style={{ fontSize: 11, color: '#D4AF37', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            × clear
          </button>
        )}
        <div className="ml-auto">
          <PeriodToggle period={period} month={pMonth} year={pYear} availableKeys={availableKeys}
            onChange={(p, m, y) => { setPeriod(p); setPMonth(m); setPYear(y); }} />
        </div>
      </div>

      {loading ? <LoadingSkeleton rows={8} /> : noData ? (
        <div className="p-6 rounded-xl text-center"
          style={{ background: '#F0EDE5', border: '1px solid #E8DEC8', color: '#A8A29E', fontSize: 14 }}>
          No P&amp;L data uploaded yet. Upload financial statements in the Financials tab to see expenses here.
        </div>
      ) : (
        <>
          {/* ── KPI row 1 ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiTile label={typeof periodLabel === 'string' ? periodLabel : 'Period'} value={fmtUSD(periodTotal)} accent
              tip={`Total operating expenses for the selected ${period ?? 'current month'} window`} />
            <KpiTile label="All Time (all years)" value={fmtUSD(totalAllTime)}
              tip="Sum of all recurring operating expenses across every uploaded period. Excludes Sec 481(a) one-time adjustments." />
            <KpiTile label="Top Category" value={topCategory}
              tip={`Category with highest spend in the selected period. Matches the largest slice in the Expense by Category donut below.`} />
          </div>

          {/* ── KPI row 2 ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile label="Avg Monthly Spend" value={fmtUSD(avgMonthlySpend)}
              tip="Average monthly operating expense across the months in the selected period window" />
            <KpiTile
              label="MoM Change"
              value={momChange === null ? '—' : `${momChange > 0 ? '+' : ''}${momChange.toFixed(1)}%`}
              sub={momChange === null ? undefined : momChange > 0 ? '▲ expenses up vs prior month' : '▼ expenses down vs prior month'}
              warn={momChange !== null && momChange > 10}
              tip="Percentage change in total monthly operating expenses between the two most recent months with data"
            />
            <KpiTile
              label="Expense / Revenue"
              value={expToRevRatio === null ? '—' : `${expToRevRatio.toFixed(1)}%`}
              sub={expToRevRatio !== null && expToRevRatio > 70 ? '⚠ Above 70% — review cost structure' : undefined}
              warn={expToRevRatio !== null && expToRevRatio > 70}
              tip="Expense-to-Revenue Ratio = Total Operating Expenses ÷ Total Rental Revenue for the selected period"
            />
            <KpiTile
              label="Largest Line Item"
              value={largestLineItem ? fmtUSD(largestLineItem.amount) : '—'}
              sub={largestLineItem ? `${largestLineItem.company.split(' ')[0]} · ${largestLineItem.category} · ${largestLineItem.month}` : undefined}
              tip="Single largest expense entry (company × category × month) in the selected period"
            />
          </div>

          {/* ── Sec 481(a) disclosure ─────────────────────────────────────────── */}
          {oneTimeTotal > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>Note:</span>
              <span>All Time and trend figures exclude {fmtUSD(oneTimeTotal)} in one-time Sec&nbsp;481(a) accounting-method adjustments.</span>
              <button className="exp-interactive"
                onClick={() => {
                  setShowOneTime(v => !v);
                  setTimeout(() => oneTimePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
                }}
                style={{ color: '#D4AF37', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                {showOneTime ? 'hide' : 'view'}
              </button>
              {showOneTime && (
                <div ref={oneTimePanelRef} className="w-full mt-2 overflow-x-auto">
                  <table className="w-full" style={{ fontSize: 12, borderTop: '1px solid #FDE68A' }}>
                    <thead>
                      <tr>{['Company','Label','Month','Amount'].map(h => (
                        <th key={h} className="py-1.5 px-3 text-left" style={{ fontWeight: 600, color: '#B45309' }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {oneTimeAllRows.map((r, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #FEF3C7' }}>
                          <td className="py-1.5 px-3" style={{ color: '#92400E' }}>{r.company}</td>
                          <td className="py-1.5 px-3" style={{ color: '#78716C' }}>Sec 481(a) Adjustment</td>
                          <td className="py-1.5 px-3" style={{ color: '#78716C' }}>{r.month}</td>
                          <td className="py-1.5 px-3" style={{ fontWeight: 600, color: '#92400E' }}>{fmtUSD(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '1px solid #FDE68A' }}>
                        <td colSpan={3} className="py-1.5 px-3" style={{ fontWeight: 600, color: '#92400E' }}>Total excluded</td>
                        <td className="py-1.5 px-3" style={{ fontWeight: 700, color: '#92400E' }}>{fmtUSD(oneTimeTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Charts row 1: Donut, Company bar, Trend ───────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Donut — click to filter table */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Expense by Category</p>
              {byCategory.length > 0 ? (
                <>
                  {filterCat && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: catColor(filterCat, allCats), color: '#fff', fontSize: 11, fontWeight: 600 }}>{filterCat}</span>
                      <button className="exp-interactive" onClick={() => setFilterCat(null)}
                        style={{ fontSize: 11, color: '#A8A29E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>× clear filter</button>
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={byCategory} cx="50%" cy="50%"
                        innerRadius={44} outerRadius={70} paddingAngle={2}
                        dataKey="amount" nameKey="category"
                        onClick={(d: { category: string }) => setFilterCat(filterCat === d.category ? null : d.category)}>
                        {byCategory.map((e, i) => (
                          <Cell key={i} fill={catColor(e.category, allCats)}
                            opacity={!filterCat || filterCat === e.category ? 1 : 0.35}
                            style={{ cursor: 'pointer', transition: 'opacity 0.15s ease-out' }} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-0.5 max-h-32 overflow-y-auto pr-1">
                    {byCategory.map((e, i) => (
                      <div key={i} className="exp-cat-item flex items-center justify-between px-1 py-1"
                        onClick={() => setFilterCat(filterCat === e.category ? null : e.category)}>
                        <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: filterCat === e.category ? '#1C1917' : '#57534E', fontWeight: filterCat === e.category ? 600 : 400 }}>
                          <span className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: catColor(e.category, allCats), opacity: !filterCat || filterCat === e.category ? 1 : 0.35 }} />
                          {e.category}
                        </span>
                        <span style={{ fontSize: 12, color: '#1C1917', fontWeight: 600 }}>{fmtUSD(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: '#A8A29E', marginTop: 6 }}>Click category to filter table below</p>
                </>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#A8A29E', fontSize: 13 }}>No data</div>
              )}
            </div>

            {/* By Company — click bar to drill down */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Expense by Company</p>
              <p style={{ fontSize: 11, color: '#A8A29E', marginBottom: 8 }}>Click a bar to filter to that company</p>
              {byCompany.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byCompany} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
                    onClick={(d: { activePayload?: { payload: { name: string } }[] }) => {
                      const name = d?.activePayload?.[0]?.payload?.name;
                      if (!name) return;
                      const id = nameToId[name] ?? '';
                      setFilterCompany(filterCompany === id ? '' : id);
                      setFilterCat(null);
                    }}>
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#78716C' }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#78716C' }} width={88} />
                    <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                    <Bar dataKey="amount" radius={[0, 4, 4, 0]} className="exp-bar-clickable">
                      {byCompany.map((e, i) => (
                        <Cell key={i} fill="#D4AF37"
                          opacity={!filterCompany || filterCompany === (nameToId[e.name] ?? '') ? 1 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#A8A29E', fontSize: 13 }}>No data</div>
              )}
            </div>

            {/* Trend 6 months */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Expense Trend — 6 Months</p>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData}>
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#78716C' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#78716C' }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(v: number) => fmtUSD(v)}
                      labelFormatter={(label: string, payload: { payload: { mom: number } }[]) => {
                        const mom = payload?.[0]?.payload?.mom;
                        return `${label}${mom !== undefined ? `  •  MoM: ${mom > 0 ? '+' : ''}${mom}%` : ''}`;
                      }}
                      {...TT} />
                    <Line type="monotone" dataKey="amount" stroke="#D4AF37" strokeWidth={2}
                      dot={{ fill: '#D4AF37', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: '#B8860B' }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#A8A29E', fontSize: 13 }}>No trend data</div>
              )}
            </div>
          </div>

          {/* ── Charts row 2: Category sparklines ─────────────────────────────── */}
          {sparklineData.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Top Category Trends — 6 Months</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {sparklineData.map(({ cat, data, total }) => (
                  <div key={cat} className="rounded-lg p-3" style={{ background: '#F7F1E6', border: '1px solid #E8DEC8' }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#78716C', marginBottom: 2 }}>{cat}</p>
                    <p style={{ fontSize: 16, fontWeight: 700, color: '#1C1917', marginBottom: 6 }}>{fmtUSD(total)}</p>
                    <ResponsiveContainer width="100%" height={52}>
                      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                        <Line type="monotone" dataKey="amount" stroke={catColor(cat, allCats)}
                          strokeWidth={2} dot={false} />
                        <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Charts row 3: YoY comparison + Heatmap ────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* YoY */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Year-over-Year Comparison</p>
              <p style={{ fontSize: 11, color: '#A8A29E', marginBottom: 10 }}>This year vs same months last year</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={yoyData} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#78716C' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#78716C' }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                  <Bar dataKey="thisYear" name="This Year" fill="#D4AF37" radius={[3,3,0,0]} />
                  <Bar dataKey="lastYear" name="Last Year" fill="#E8DEC8" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                {[{color:'#D4AF37',label:'This Year'},{color:'#E8DEC8',label:'Last Year'}].map(({color,label})=>(
                  <span key={label} className="flex items-center gap-1.5" style={{ fontSize: 11, color: '#78716C' }}>
                    <span className="w-3 h-2 rounded-sm" style={{ background: color, display: 'inline-block' }} />{label}
                  </span>
                ))}
              </div>
            </div>

            {/* Heatmap — company × month */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Expense Heatmap — Company × Month</p>
              <p style={{ fontSize: 11, color: '#A8A29E', marginBottom: 10 }}>Darker gold = higher spend</p>
              {heatmapCompanies.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: 11, color: '#A8A29E', fontWeight: 500, textAlign: 'left', paddingRight: 8, paddingBottom: 4 }}>Company</th>
                        {heatmapMonths.map(m => (
                          <th key={m} style={{ fontSize: 10, color: '#A8A29E', fontWeight: 500, textAlign: 'center', paddingBottom: 4, whiteSpace: 'nowrap' }}>
                            {m.split(' ')[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmapCompanies.map(co => (
                        <tr key={co}>
                          <td style={{ fontSize: 11, color: '#57534E', paddingRight: 8, paddingBottom: 3, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {co.split(' ').slice(0,2).join(' ')}
                          </td>
                          {heatmapMonths.map(m => {
                            const amt = heatmapCells.map[`${co}|${m}`] ?? 0;
                            const intensity = amt / heatmapCells.max;
                            return (
                              <td key={m} title={`${co} · ${m}: ${fmtUSD(amt)}`}
                                style={{
                                  background: amt > 0 ? `rgba(212,175,55,${Math.max(0.08, intensity * 0.9)})` : '#F7F1E6',
                                  borderRadius: 4, textAlign: 'center', fontSize: 10, color: intensity > 0.5 ? '#5C4033' : '#78716C',
                                  fontWeight: intensity > 0.5 ? 600 : 400, padding: '5px 4px', minWidth: 44,
                                  transition: 'background 0.15s ease-out',
                                }}>
                                {amt > 0 ? `$${(amt/1000).toFixed(0)}k` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-40 flex items-center justify-center" style={{ color: '#A8A29E', fontSize: 13 }}>No data</div>
              )}
            </div>
          </div>

          {/* ── All Expenses table ────────────────────────────────────────────── */}
          <div className="rounded-xl" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', overflow: 'hidden' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1C1917' }}>
                All Expenses{period ? ` — ${period}` : ''}
              </p>
              <div className="flex items-center gap-2">
                {filterCat && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: catColor(filterCat, allCats), color: '#fff', fontSize: 11 }}>{filterCat}</span>
                    <button className="exp-interactive" onClick={() => setFilterCat(null)}
                      style={{ fontSize: 11, color: '#A8A29E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>× clear</button>
                  </span>
                )}
                <span style={{ fontSize: 12, color: '#A8A29E' }}>{tableRows.length} rows</span>
              </div>
            </div>
            <div className="overflow-x-auto" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="w-full">
                <thead className="sticky top-0" style={{ background: '#F0EDE5' }}>
                  <tr style={{ borderBottom: '1px solid #E8DEC8' }}>
                    {['Company','Category','Month','Amount'].map(h => (
                      <th key={h} className="py-2 px-3 text-left"
                        style={{ fontSize: 13, fontWeight: 600, color: '#78716C' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr><td colSpan={4} className="py-10 text-center" style={{ color: '#A8A29E', fontSize: 13 }}>
                      No expenses in the selected period{filterCat ? ` for "${filterCat}"` : ''}
                    </td></tr>
                  ) : tableRows.map((r, i) => (
                    <tr key={i} className="exp-row" style={{ borderBottom: '1px solid #F7F1E6' }}>
                      <td className="py-2 px-3" style={{ fontSize: 13, color: '#92400E' }}>{r.company}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded-full"
                          style={{ fontSize: 12, fontWeight: 500, background: catColor(r.category, allCats), color: '#fff' }}>
                          {r.category}
                        </span>
                      </td>
                      <td className="py-2 px-3" style={{ fontSize: 12, color: '#78716C' }}>{r.month}</td>
                      <td className="py-2 px-3 text-right" style={{ fontSize: 13, fontWeight: 600, color: '#1C1917' }}>{fmtUSD(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {tableRows.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #E8DEC8', background: '#F0EDE5' }}>
                      <td colSpan={3} className="py-2 px-3" style={{ fontSize: 13, fontWeight: 700, color: '#1C1917' }}>Total</td>
                      <td className="py-2 px-3 text-right" style={{ fontSize: 15, fontWeight: 700, color: '#D4AF37' }}>
                        {fmtUSD(tableRows.reduce((s, r) => s + r.amount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
