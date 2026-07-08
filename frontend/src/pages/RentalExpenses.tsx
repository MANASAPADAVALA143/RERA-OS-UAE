import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Upload } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { ParchmentKpiTile } from '../components/ui/ParchmentKpiTile';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';
import PeriodToggle from '../components/shared/PeriodToggle';
import { type Period, getPeriodKeys, trailingMonthsWithData, monthKeyFromParts } from '../utils/periodWindow';
import {
  type FinItem,
  ONE_TIME_CAT, ONE_TIME_RE, EXPENSE_CATS,
  SKIP_RE, REVENUE_LINE_RE, REVENUE_SKIP_RE,
  classifyLabel, flattenItems,
  MNAMES, monthSortKey, allMonthKeys,
  EXP_PALETTE, catColor,
  prevMonthKey, safeMomPct, safeRatioPct, parseMonthKey,
} from '../utils/rentalExpenseUtils';
interface CompanyOption { id: string; company_name: string }
interface ExpRow { company: string; category: string; month: string; amount: number }
interface ExpenseMatrixCompany {
  id: string;
  company_name: string;
  monthly_expense_data: Record<string, number>;
}
interface ExpenseMatrixResponse {
  companies: ExpenseMatrixCompany[];
  portfolio_monthly_totals: Record<string, number>;
  has_matrix: boolean;
}
interface ExpenseUploadPreview {
  companies: { company: string; monthly_totals: Record<string, number>; months_with_data: number }[];
  month_columns: string[];
  portfolio_monthly_totals: Record<string, number>;
  skipped_empty_rows: string[];
  companies_parsed: number;
  temp_file_id: string;
}

const MATRIX_CAT = 'Company Total';

function normMonthKey(k: string): string {
  return k.replace(/-/g, ' ');
}

function buildMatrixRows(
  matrixCompanies: ExpenseMatrixCompany[],
  filterCompanyId: string,
  nameById: Record<string, string>,
): ExpRow[] {
  const rows: ExpRow[] = [];
  const ids = filterCompanyId ? [filterCompanyId] : matrixCompanies.map(c => c.id);
  const idSet = new Set(ids);
  for (const co of matrixCompanies) {
    if (!idSet.has(co.id)) continue;
    const companyName = nameById[co.id] ?? co.company_name;
    for (const [month, val] of Object.entries(co.monthly_expense_data ?? {})) {
      const amount = Math.abs(Number(val) || 0);
      if (amount > 0) {
        rows.push({
          company: companyName,
          category: MATRIX_CAT,
          month: normMonthKey(month),
          amount,
        });
      }
    }
  }
  return rows;
}

// ── dev debug ─────────────────────────────────────────────────────────────────
const DEBUG_EXPENSES = false;

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

const TT = { contentStyle: { background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: '0.5rem', fontSize: 13 } };

// ── component ─────────────────────────────────────────────────────────────────
export default function RentalExpenses() {
  const [companies, setCompanies]         = useState<CompanyOption[]>([]);
  const [expenseMatrix, setExpenseMatrix] = useState<ExpenseMatrixCompany[]>([]);
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
  const uploadRef                         = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]         = useState(false);
  const [uploadPreview, setUploadPreview] = useState<ExpenseUploadPreview | null>(null);
  const [confirmingUpload, setConfirmingUpload] = useState(false);
  const [uploadToast, setUploadToast]     = useState('');

  useEffect(() => {
    api.get<CompanyOption[]>('/api/rentals/companies')
      .then(r => setCompanies(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  const loadExpenseMatrix = useCallback(async () => {
    try {
      const r = await api.get<ExpenseMatrixResponse>('/api/rentals/company-expenses');
      setExpenseMatrix(r.data.companies ?? []);
    } catch {
      setExpenseMatrix([]);
    }
  }, []);

  useEffect(() => { loadExpenseMatrix(); }, [loadExpenseMatrix]);

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

  async function handleMatrixUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post<ExpenseUploadPreview>(
        '/api/rentals/upload-company-expenses/preview',
        formData,
      );
      setUploadPreview(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Upload failed — check file format';
      setUploadToast(msg);
      setTimeout(() => setUploadToast(''), 5000);
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }

  async function confirmMatrixUpload() {
    if (!uploadPreview) return;
    setConfirmingUpload(true);
    try {
      const res = await api.post<{ message: string; unmatched_companies: string[] }>(
        '/api/rentals/upload-company-expenses/confirm',
        { temp_file_id: uploadPreview.temp_file_id },
      );
      const unmatched = res.data.unmatched_companies?.length
        ? ` (${res.data.unmatched_companies.length} unmatched)`
        : '';
      setUploadToast(`${res.data.message}${unmatched}`);
      setUploadPreview(null);
      await loadExpenseMatrix();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Save failed';
      setUploadToast(msg);
    } finally {
      setConfirmingUpload(false);
      setTimeout(() => setUploadToast(''), 5000);
    }
  }

  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    companies.forEach(c => { m[c.id] = c.company_name; });
    Object.entries(allNames).forEach(([id, name]) => { m[id] = name; });
    return m;
  }, [companies, allNames]);

  // company name → id (for bar chart drill-down)
  const nameToId = useMemo(() => {
    const m: Record<string, string> = {};
    companies.forEach(c => { m[c.company_name] = c.id; });
    return m;
  }, [companies]);

  // ── core rows ───────────────────────────────────────────────────────────────
  const plRows = useMemo<ExpRow[]>(() => {
    const ids = filterCompany ? [filterCompany] : Object.keys(allPl);
    return ids.flatMap(id => buildExpRows(allNames[id] ?? id, allPl[id] ?? []));
  }, [allPl, allNames, filterCompany]);

  const matrixRows = useMemo(
    () => buildMatrixRows(expenseMatrix, filterCompany, nameById),
    [expenseMatrix, filterCompany, nameById],
  );

  const useMatrixSource = matrixRows.length > 0;

  const allRows = useMatrixSource ? matrixRows : plRows;

  const availableKeys = useMemo(() => {
    const keys = new Set<string>();
    if (useMatrixSource) {
      matrixRows.forEach(r => keys.add(r.month));
    } else {
      Object.values(allPl).forEach(pl => allMonthKeys(pl).forEach(k => keys.add(k)));
    }
    return Array.from(keys).sort((a, b) => monthSortKey(a) - monthSortKey(b));
  }, [allPl, matrixRows, useMatrixSource]);

  const filteredRows = useMemo<ExpRow[]>(() => {
    if (!period) return allRows;
    const keys = new Set(getPeriodKeys(period, pMonth, pYear));
    return allRows.filter(r => keys.has(r.month));
  }, [allRows, period, pMonth, pYear]);

  const operatingRows         = useMemo(() => allRows.filter(r => r.category !== ONE_TIME_CAT), [allRows]);
  const plOperatingRows       = useMemo(() => plRows.filter(r => r.category !== ONE_TIME_CAT), [plRows]);
  const filteredOperatingRows = useMemo(() => filteredRows.filter(r => r.category !== ONE_TIME_CAT), [filteredRows]);
  const plFilteredOperatingRows = useMemo(() => {
    if (!period) return plOperatingRows;
    const keys = new Set(getPeriodKeys(period, pMonth, pYear));
    return plOperatingRows.filter(r => keys.has(r.month));
  }, [plOperatingRows, period, pMonth, pYear]);

  // applies the active category chip on top of the period window —
  // category filter applies to P&L rows only; matrix totals ignore category
  const catFilteredRows = useMemo(
    () => {
      if (useMatrixSource) return filteredOperatingRows;
      return filterCat ? filteredOperatingRows.filter(r => r.category === filterCat) : filteredOperatingRows;
    },
    [filteredOperatingRows, filterCat, useMatrixSource],
  );

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
  // Use latest month with actual data rather than today's calendar month —
  // P&L uploads are typically 1-2 months behind the current date, so
  // hardcoding to "Jul 2026" when data only goes to "Jun 2026" showed $0.
  const currentMonthKey = useMemo(() => {
    const calendarKey = `${MNAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
    const months = [...new Set(operatingRows.map(r => r.month))].sort((a, b) => monthSortKey(a) - monthSortKey(b));
    // If the calendar month exists in data use it; otherwise fall back to latest available
    return months.includes(calendarKey) ? calendarKey : (months[months.length - 1] ?? calendarKey);
  }, [operatingRows]);
  const periodLabel = period ?? (currentMonthKey === `${MNAMES[new Date().getMonth()]} ${new Date().getFullYear()}` ? 'This Month' : `Latest · ${currentMonthKey}`);

  // Trailing-6-month window anchored to selected period month (or latest data month)
  const trendEndAnchor = useMemo(() => {
    if (period) return { month: pMonth, year: pYear };
    return parseMonthKey(currentMonthKey);
  }, [period, pMonth, pYear, currentMonthKey]);

  const trendEndLabel = useMemo(
    () => monthKeyFromParts(trendEndAnchor.month, trendEndAnchor.year),
    [trendEndAnchor],
  );

  const trendMonthKeys = useMemo(() => {
    const dataMonths = new Set(operatingRows.map(r => r.month));
    return trailingMonthsWithData(trendEndAnchor.month, trendEndAnchor.year, 6, dataMonths);
  }, [operatingRows, trendEndAnchor]);

  const plTrendMonthKeys = useMemo(() => {
    const dataMonths = new Set(plOperatingRows.map(r => r.month));
    return trailingMonthsWithData(trendEndAnchor.month, trendEndAnchor.year, 6, dataMonths);
  }, [plOperatingRows, trendEndAnchor]);

  const periodTotal = useMemo(() =>
    period
      ? catFilteredRows.reduce((s, r) => s + r.amount, 0)
      : operatingRows.filter(r => r.month === currentMonthKey && (!filterCat || r.category === filterCat)).reduce((s, r) => s + r.amount, 0),
  [period, catFilteredRows, operatingRows, currentMonthKey, filterCat]);

  // ── KPI 2: all time ──────────────────────────────────────────────────────────
  const totalAllTime = useMemo(() => operatingRows.reduce((s, r) => s + r.amount, 0), [operatingRows]);

  // ── KPI 3: top category ──────────────────────────────────────────────────────
  const topCategory = useMemo(() => {
    if (useMatrixSource) {
      if (plFilteredOperatingRows.length === 0) return '—';
      const byCat: Record<string, number> = {};
      const src = filterCat
        ? plFilteredOperatingRows.filter(r => r.category === filterCat)
        : plFilteredOperatingRows;
      src.forEach(r => { byCat[r.category] = (byCat[r.category] ?? 0) + r.amount; });
      return Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
    }
    const byCat: Record<string, number> = {};
    catFilteredRows.forEach(r => { byCat[r.category] = (byCat[r.category] ?? 0) + r.amount; });
    return Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  }, [catFilteredRows, useMatrixSource, plFilteredOperatingRows, filterCat]);

  // ── KPI 4: avg monthly spend ─────────────────────────────────────────────────
  const avgMonthlySpend = useMemo(() => {
    const byMonth: Record<string, number> = {};
    catFilteredRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    const months = Object.keys(byMonth);
    return months.length > 0 ? Object.values(byMonth).reduce((s, v) => s + v, 0) / months.length : 0;
  }, [catFilteredRows]);

  // ── KPI 5: MoM change — same period window + company scope as other KPIs ─────
  const momChange = useMemo(() => {
    const rows = filterCat
      ? (period ? filteredOperatingRows : operatingRows).filter(r => r.category === filterCat)
      : (period ? filteredOperatingRows : operatingRows);

    const sumForMonth = (key: string) =>
      rows.filter(r => r.month === key).reduce((s, r) => s + r.amount, 0);

    let currKey: string;
    let prevKey: string;

    if (period === 'MoM') {
      const keys = getPeriodKeys('MoM', pMonth, pYear);
      prevKey = keys[0];
      currKey = keys[1];
    } else if (period) {
      const windowKeys = getPeriodKeys(period, pMonth, pYear);
      if (windowKeys.length < 2) return null;
      prevKey = windowKeys[windowKeys.length - 2];
      currKey = windowKeys[windowKeys.length - 1];
    } else {
      currKey = currentMonthKey;
      prevKey = prevMonthKey(currentMonthKey);
    }

    const curr = sumForMonth(currKey);
    const prev = sumForMonth(prevKey);

    if (DEBUG_EXPENSES) {
      console.log('[ExpenseKPI] MoM', {
        period: period ?? `Latest · ${currentMonthKey}`,
        currKey, prevKey, curr, prev,
        filterCompany: filterCompany || 'all',
        filterCat: filterCat ?? 'all',
      });
    }

    return safeMomPct(curr, prev);
  }, [operatingRows, filteredOperatingRows, filterCat, period, pMonth, pYear, currentMonthKey, filterCompany]);

  // ── KPI 6: expense-to-revenue ratio — matched period + company scope ─────────
  const expToRevRatio = useMemo(() => {
    const expenseRows = period
      ? catFilteredRows
      : operatingRows.filter(r => r.month === currentMonthKey && (!filterCat || r.category === filterCat));
    const revRows = period
      ? filteredRevRows
      : allRevRows.filter(r => r.month === currentMonthKey);

    const exp = expenseRows.reduce((s, r) => s + r.amount, 0);
    const rev = revRows.reduce((s, r) => s + r.amount, 0);

    if (DEBUG_EXPENSES) {
      console.log('[ExpenseKPI] Exp/Rev', {
        period: period ?? `Latest · ${currentMonthKey}`,
        exp, rev,
        filterCompany: filterCompany || 'all',
        filterCat: filterCat ?? 'all',
      });
    }

    return safeRatioPct(exp, rev);
  }, [period, catFilteredRows, operatingRows, currentMonthKey, filterCat, filteredRevRows, allRevRows, filterCompany]);

  // One-time diagnostic: log old (misaligned) vs new inputs when data loads
  useEffect(() => {
    if (!DEBUG_EXPENSES || loading || operatingRows.length === 0) return;
    const oldExpAll = operatingRows.reduce((s, r) => s + r.amount, 0);
    const oldRevAll = allRevRows.reduce((s, r) => s + r.amount, 0);
    const newExp = operatingRows.filter(r => r.month === currentMonthKey).reduce((s, r) => s + r.amount, 0);
    const newRev = allRevRows.filter(r => r.month === currentMonthKey).reduce((s, r) => s + r.amount, 0);
    const byMonth: Record<string, number> = {};
    operatingRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    const months = Object.keys(byMonth).sort((a, b) => monthSortKey(a) - monthSortKey(b));
    const oldPrev = months.length >= 2 ? byMonth[months[months.length - 2]] : 0;
    const oldCurr = months.length >= 1 ? byMonth[months[months.length - 1]] : 0;
    const newPrev = operatingRows.filter(r => r.month === prevMonthKey(currentMonthKey)).reduce((s, r) => s + r.amount, 0);
    const newCurr = operatingRows.filter(r => r.month === currentMonthKey).reduce((s, r) => s + r.amount, 0);
    console.group('[ExpenseKPI] Diagnosis — old vs fixed inputs');
    console.log('Expense/Revenue (OLD: all months summed)', { exp: oldExpAll, rev: oldRevAll, ratioPct: oldRevAll > 0 ? (oldExpAll / oldRevAll) * 100 : null });
    console.log('Expense/Revenue (FIXED: same month)', { month: currentMonthKey, exp: newExp, rev: newRev, ratioPct: safeRatioPct(newExp, newRev) });
    console.log('MoM (OLD: last two months in data)', { prevMonth: months[months.length - 2], prev: oldPrev, currMonth: months[months.length - 1], curr: oldCurr, momPct: safeMomPct(oldCurr, oldPrev) });
    console.log('MoM (FIXED: current vs prior calendar month)', { prevMonth: prevMonthKey(currentMonthKey), prev: newPrev, currMonth: currentMonthKey, curr: newCurr, momPct: safeMomPct(newCurr, newPrev) });
    console.groupEnd();
  }, [loading, operatingRows, allRevRows, currentMonthKey]);

  // ── KPI 7: largest single line item — within active category if filtered ──────
  const largestLineItem = useMemo(() => {
    if (catFilteredRows.length === 0) return null;
    // aggregate to company × category × month first, then pick max
    const agg: Record<string, ExpRow> = {};
    catFilteredRows.forEach(r => {
      const key = `${r.company}|${r.category}|${r.month}`;
      if (agg[key]) agg[key] = { ...agg[key], amount: agg[key].amount + r.amount };
      else agg[key] = { ...r };
    });
    return Object.values(agg).reduce((max, r) => r.amount > max.amount ? r : max, Object.values(agg)[0]);
  }, [catFilteredRows]);

  // ── chart data ───────────────────────────────────────────────────────────────
  const allCats = useMemo(() => {
    const src = useMatrixSource ? plFilteredOperatingRows : filteredOperatingRows;
    return [...new Set(src.map(r => r.category))].sort();
  }, [filteredOperatingRows, plFilteredOperatingRows, useMatrixSource]);

  const byCategory = useMemo(() => {
    const src = useMatrixSource ? plFilteredOperatingRows : filteredOperatingRows;
    const byCat: Record<string, number> = {};
    const rows = filterCat && !useMatrixSource
      ? src.filter(r => r.category === filterCat)
      : filterCat && useMatrixSource
        ? src.filter(r => r.category === filterCat)
        : src;
    rows.forEach(r => { byCat[r.category] = (byCat[r.category] ?? 0) + r.amount; });
    return Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount }));
  }, [filteredOperatingRows, plFilteredOperatingRows, useMatrixSource, filterCat]);

  const byCompany = useMemo(() => {
    const byCo: Record<string, number> = {};
    catFilteredRows.forEach(r => { byCo[r.company] = (byCo[r.company] ?? 0) + r.amount; });
    return Object.entries(byCo).sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount }));
  }, [catFilteredRows]);

  // trend — 6 months trailing the selected reference month
  const trendData = useMemo(() => {
    const byMonth: Record<string, number> = {};
    operatingRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    return trendMonthKeys.map(month => {
      const prevKey = prevMonthKey(month);
      const momVal = safeMomPct(byMonth[month] ?? 0, byMonth[prevKey] ?? 0);
      return { month, amount: parseFloat((byMonth[month] ?? 0).toFixed(2)), mom: momVal };
    });
  }, [operatingRows, trendMonthKeys]);

  // top-5 categories for stacked trend chart
  const top5cats = useMemo(() => byCategory.slice(0, 5).map(c => c.category), [byCategory]);

  // stacked column chart: top-5 cats × trailing 6 months ending at reference month
  const stackedTrendData = useMemo(() => {
    const src = useMatrixSource ? plOperatingRows : operatingRows;
    const monthKeys = useMatrixSource ? plTrendMonthKeys : trendMonthKeys;
    const byMonth: Record<string, Record<string, number>> = {};
    src.forEach(r => {
      if (!top5cats.includes(r.category)) return;
      if (!byMonth[r.month]) byMonth[r.month] = {};
      byMonth[r.month][r.category] = (byMonth[r.month][r.category] ?? 0) + r.amount;
    });
    return monthKeys.map(m => ({ month: m.split(' ')[0], ...byMonth[m] }));
  }, [top5cats, operatingRows, plOperatingRows, useMatrixSource, trendMonthKeys, plTrendMonthKeys]);

  // single-category trend when a filter is active
  const singleCatTrend = useMemo(() => {
    if (!filterCat) return [];
    const src = useMatrixSource ? plOperatingRows : operatingRows;
    const monthKeys = useMatrixSource ? plTrendMonthKeys : trendMonthKeys;
    const byMonth: Record<string, number> = {};
    src.forEach(r => { if (r.category === filterCat) byMonth[r.month] = (byMonth[r.month] ?? 0) + r.amount; });
    return monthKeys.map(m => ({ month: m.split(' ')[0], amount: byMonth[m] ?? 0 }));
  }, [filterCat, operatingRows, plOperatingRows, useMatrixSource, trendMonthKeys, plTrendMonthKeys]);

  // category sparklines — top 4 by filtered spend, trailing 6 months
  const sparklineData = useMemo(() => {
    const srcRows = useMatrixSource ? plFilteredOperatingRows : filteredOperatingRows;
    const top4 = byCategory.slice(0, 4).map(c => c.category);
    const monthKeys = useMatrixSource ? plTrendMonthKeys : trendMonthKeys;
    return top4.map(cat => {
      const catByMonth: Record<string, number> = {};
      (useMatrixSource ? plOperatingRows : operatingRows).filter(r => r.category === cat).forEach(r => {
        catByMonth[r.month] = (catByMonth[r.month] ?? 0) + r.amount;
      });
      const data = monthKeys.map(m => ({ month: m.split(' ')[0], amount: catByMonth[m] ?? 0 }));
      const total = srcRows.filter(r => r.category === cat).reduce((s, r) => s + r.amount, 0);
      return { cat, data, total };
    });
  }, [byCategory, operatingRows, plOperatingRows, plFilteredOperatingRows, filteredOperatingRows, useMatrixSource, trendMonthKeys, plTrendMonthKeys]);

  // YoY comparison — this year vs last year for the same months
  const yoyMonths = useMemo(() => {
    if (period) return getPeriodKeys(period, pMonth, pYear);
    return trendMonthKeys;
  }, [period, pMonth, pYear, trendMonthKeys]);

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
  const heatmapMonths = useMemo(() => {
    if (period === 'TTM') return yoyMonths.slice(-6);
    if (period) return yoyMonths;
    return trendMonthKeys;
  }, [yoyMonths, period, trendMonthKeys]);

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

  const noData = !loading && operatingRows.length === 0 && plOperatingRows.length === 0;

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* scoped CSS */}
      <style>{`
        .exp-kpi-card, .parchment-kpi-tile { transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out; }
        .exp-kpi-card:hover, .parchment-kpi-tile:hover { transform: scale(1.03); box-shadow: 0 6px 12px rgba(0,0,0,0.08); }
        .exp-kpi-card:active, .parchment-kpi-tile:active { transform: scale(0.98); }
        .exp-row:hover td { background: #F7F1E6 !important; }
        .exp-interactive:focus-visible { outline: 2px solid #D4AF37; outline-offset: 2px; }
        .exp-bar-clickable:hover { cursor: pointer; filter: brightness(1.08); }
        .exp-cat-item:hover { background: #F7F1E6; border-radius: 6px; cursor: pointer; }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1C1917' }}>Expenses</h1>
          <p style={{ fontSize: 13, color: '#A8A29E', marginTop: 2 }}>
            {useMatrixSource
              ? 'Company monthly totals from expense matrix upload'
              : 'Pulled from P&L financials — all categories, all companies'}
            {useMatrixSource && plOperatingRows.length > 0 ? ' · category charts from P&L' : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <input ref={uploadRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={handleMatrixUpload} />
          <button
            type="button"
            className="exp-interactive flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', color: '#57534E', fontSize: 13, fontWeight: 600 }}
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={16} />
            {uploading ? 'Parsing…' : 'Import Company Expenses'}
          </button>
          {uploadToast && (
            <span style={{ fontSize: 12, color: '#78716C', maxWidth: 280, textAlign: 'right' }}>{uploadToast}</span>
          )}
        </div>
      </div>

      {uploadPreview && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#92400E' }}>
            Preview — {uploadPreview.companies_parsed} companies, {uploadPreview.month_columns.length} months
          </p>
          <div className="overflow-x-auto max-h-48">
            <table className="w-full" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th className="text-left py-1 pr-3" style={{ color: '#B45309' }}>Company</th>
                  <th className="text-left py-1 pr-3" style={{ color: '#B45309' }}>Months</th>
                  <th className="text-right py-1" style={{ color: '#B45309' }}>Sample total</th>
                </tr>
              </thead>
              <tbody>
                {uploadPreview.companies.slice(0, 12).map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #FEF3C7' }}>
                    <td className="py-1 pr-3" style={{ color: '#92400E' }}>{c.company}</td>
                    <td className="py-1 pr-3" style={{ color: '#78716C' }}>{c.months_with_data}</td>
                    <td className="py-1 text-right" style={{ color: '#92400E' }}>
                      {fmtUSD(Object.values(c.monthly_totals).reduce((s, v) => s + v, 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button type="button" className="exp-interactive px-4 py-2 rounded-lg"
              style={{ background: '#D4AF37', color: '#fff', fontWeight: 600, fontSize: 13 }}
              onClick={confirmMatrixUpload} disabled={confirmingUpload}>
              {confirmingUpload ? 'Saving…' : 'Confirm import'}
            </button>
            <button type="button" className="exp-interactive px-4 py-2 rounded-lg"
              style={{ background: 'transparent', border: '1px solid #E8DEC8', color: '#78716C', fontSize: 13 }}
              onClick={() => setUploadPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters + PeriodToggle */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-xl"
        style={{ background: '#F0EDE5', border: '1px solid #E8DEC8' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Company</span>
        <select
          value={filterCompany}
          onChange={e => { setFilterCompany(e.target.value); setFilterCat(null); }}
          className="exp-interactive"
          style={{ background: '#FBF6EE', color: '#1C1917', border: '1px solid #E8DEC8',
            borderRadius: 8, padding: '6px 12px', fontSize: 14 }}
        >
          <option value="">All Companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        {filterCompany && (
          <button className="exp-interactive" onClick={() => setFilterCompany('')}
            style={{ fontSize: 12, color: '#D4AF37', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            × clear
          </button>
        )}
        <div className="ml-auto">
          <PeriodToggle period={period} month={pMonth} year={pYear} availableKeys={availableKeys}
            onChange={(p, m, y) => { setPeriod(p); setPMonth(m); setPYear(y); }} />
        </div>
      </div>

      {loading ? <LoadingSkeleton rows={8} /> : noData ? (
        <div className="p-6 rounded-xl text-center space-y-3"
          style={{ background: '#F0EDE5', border: '1px solid #E8DEC8', color: '#A8A29E', fontSize: 15 }}>
          <p>No expense data yet.</p>
          <p style={{ fontSize: 13 }}>
            Upload a company × month matrix (rows = companies, columns = Dec 2021, Jan 2022, …)
            or upload P&amp;L financials in the Financials tab for category breakdown.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI row 1 ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ParchmentKpiTile label={typeof periodLabel === 'string' ? periodLabel : 'Period'} value={fmtUSD(periodTotal)} accent
              tip={`Total operating expenses for the selected ${period ?? 'current month'} window`} />
            <ParchmentKpiTile label="All Time (all years)" value={fmtUSD(totalAllTime)}
              tip="Sum of all recurring operating expenses across every uploaded period. Excludes Sec 481(a) one-time adjustments." />
            <ParchmentKpiTile label="Top Category" value={topCategory}
              tip={useMatrixSource
                ? 'From P&L category breakdown when available; matrix upload provides company totals only'
                : 'Category with highest spend in the selected period. Matches the largest slice in the Expense by Category donut below.'} />
          </div>

          {/* ── KPI row 2 ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ParchmentKpiTile label="Avg Monthly Spend" value={fmtUSD(avgMonthlySpend)}
              tip="Average monthly operating expense across the months in the selected period window" />
            <ParchmentKpiTile
              label="MoM Change"
              value={momChange === null ? 'N/A' : `${momChange > 0 ? '+' : ''}${momChange.toFixed(1)}%`}
              sub={momChange === null ? 'Insufficient prior data' : momChange > 0 ? '▲ expenses up vs prior month' : '▼ expenses down vs prior month'}
              warn={momChange !== null && momChange > 10}
              tip={filterCat
                ? `MoM change for "${filterCat}" only — % change in that category's total between the prior and current month in the selected period`
                : 'Percentage change in total monthly operating expenses between the prior and current month (same company scope as other KPIs)'}
            />
            <ParchmentKpiTile
              label="Expense / Revenue"
              value={expToRevRatio === null ? 'N/A' : `${expToRevRatio.toFixed(1)}%`}
              sub={expToRevRatio === null ? 'Insufficient revenue data' : expToRevRatio > 70 ? '⚠ Above 70% — review cost structure' : undefined}
              warn={expToRevRatio !== null && expToRevRatio > 70}
              tip={filterCat
                ? `"${filterCat}" spend ÷ total rental revenue for the same period and company scope. Category-scoped when a filter is active.`
                : 'Expense-to-Revenue Ratio = Operating Expenses ÷ Rental Revenue for the same period and company scope'}
            />
            <ParchmentKpiTile
              label="Largest Line Item"
              value={largestLineItem ? fmtUSD(largestLineItem.amount) : '—'}
              sub={largestLineItem ? `${largestLineItem.company.split(' ')[0]} · ${largestLineItem.category} · ${largestLineItem.month}` : undefined}
              tip={filterCat
                ? `Largest single entry within "${filterCat}" (company × month) in the selected period`
                : 'Single largest expense entry (company × category × month) in the selected period'}
            />
          </div>

          {/* ── Sec 481(a) disclosure ─────────────────────────────────────────── */}
          {oneTimeTotal > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', fontSize: 13 }}>
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
                  <table className="w-full" style={{ fontSize: 13, borderTop: '1px solid #FDE68A' }}>
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
            {/* Horizontal bar chart — click to filter table */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 8 }}>Expense by Category</p>
              {filterCat && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded-full" style={{ background: catColor(filterCat, allCats), color: '#fff', fontSize: 12, fontWeight: 600 }}>{filterCat}</span>
                  <button className="exp-interactive" onClick={() => setFilterCat(null)}
                    style={{ fontSize: 12, color: '#A8A29E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>× clear</button>
                </div>
              )}
              {byCategory.length > 0 ? (
                <>
                  <div className="max-h-72 overflow-y-auto pr-1">
                    {(() => {
                      const maxAmt = byCategory[0]?.amount ?? 1;
                      return byCategory.map((e, i) => {
                        const pct  = (e.amount / maxAmt) * 100;
                        const active   = !filterCat || filterCat === e.category;
                        const selected = filterCat === e.category;
                        return (
                          <div key={i} className="flex items-center gap-2 py-1 rounded cursor-pointer"
                            style={{ opacity: active ? 1 : 0.4, transition: 'opacity 0.15s' }}
                            onClick={() => setFilterCat(filterCat === e.category ? null : e.category)}>
                            <span style={{ width: 108, fontSize: 12, color: '#57534E', flexShrink: 0,
                              textAlign: 'right', fontWeight: selected ? 700 : 400, lineHeight: 1.3 }}>
                              {e.category}
                            </span>
                            <div style={{ flex: 1, height: 16, borderRadius: 3, background: '#F0EDE5', position: 'relative' }}>
                              <div style={{
                                position: 'absolute', left: 0, top: 0, height: '100%',
                                width: `${pct}%`, borderRadius: 3,
                                background: catColor(e.category, allCats),
                                transition: 'width 0.3s ease',
                              }} />
                            </div>
                            <span style={{ width: 76, fontSize: 12, color: '#1C1917', flexShrink: 0,
                              textAlign: 'right', fontWeight: 600,
                              fontVariantNumeric: 'tabular-nums lining-nums' }}>
                              {fmtUSD(e.amount)}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                  <p style={{ fontSize: 12, color: '#A8A29E', marginTop: 8 }}>Click bar to filter table below</p>
                </>
              ) : (
                <div className="h-60 flex items-center justify-center text-center px-4" style={{ color: '#A8A29E', fontSize: 13 }}>
                  {useMatrixSource
                    ? 'Category breakdown requires P&L upload in Financials. Matrix import provides company monthly totals.'
                    : 'No data'}
                </div>
              )}
            </div>

            {/* By Company — click bar to drill down */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Expense by Company</p>
              <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 2 }}>Click a bar to filter to that company</p>
              <p style={{ fontSize: 11, color: '#B8A99A', marginBottom: 8 }}>
                Formula: {useMatrixSource ? 'monthly company total from expense matrix' : 'sum of leaf-level expense lines per company'} ·{' '}
                <span style={{ fontWeight: 600, color: filterCat ? '#78716C' : '#B8A99A' }}>
                  {filterCat ? `category: ${filterCat}` : 'all categories'}
                </span>
                {' · '}
                <span style={{ fontWeight: 600, color: period ? '#78716C' : '#B8A99A' }}>
                  {period ?? 'all periods'}
                </span>
                {' · excludes Sec 481(a)'}
              </p>
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
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#78716C' }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#78716C' }} width={88} />
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
                <div className="h-60 flex items-center justify-center" style={{ color: '#A8A29E', fontSize: 14 }}>No data</div>
              )}
            </div>

            {/* Trend 6 months */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>
                Expense Trend — 6 Months to {trendEndLabel}
              </p>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData}>
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#78716C' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#78716C' }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(v: number) => fmtUSD(v)}
                      labelFormatter={(label: string, payload: { payload: { mom: number | null } }[]) => {
                        const mom = payload?.[0]?.payload?.mom;
                        return `${label}${mom !== null && mom !== undefined ? `  •  MoM: ${mom > 0 ? '+' : ''}${mom.toFixed(1)}%` : ''}`;
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

          {/* ── Top Category Trends — stacked column (default) / single line (filter active) ── */}
          {(stackedTrendData.length > 0 || singleCatTrend.length > 0) && (
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>
                Top Category Trends — 6 Months to {trendEndLabel}
              </p>
              {filterCat ? (
                <>
                  <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 10 }}>
                    Showing: <span style={{ fontWeight: 600, color: catColor(filterCat, allCats) }}>{filterCat}</span>
                    <button onClick={() => setFilterCat(null)}
                      style={{ marginLeft: 8, fontSize: 12, color: '#A8A29E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      × show all
                    </button>
                  </p>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={singleCatTrend} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#78716C' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#78716C' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                      <Line type="monotone" dataKey="amount" name={filterCat}
                        stroke={catColor(filterCat, allCats)} strokeWidth={2.5}
                        dot={{ fill: catColor(filterCat, allCats), r: 4, strokeWidth: 0 }}
                        activeDot={{ r: 6, fill: catColor(filterCat, allCats) }} />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 10 }}>Top 5 categories — click a bar or segment to drill in</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={stackedTrendData} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#78716C' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#78716C' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                      {top5cats.map(cat => (
                        <Bar key={cat} dataKey={cat} stackId="cats" name={cat}
                          fill={catColor(cat, allCats)} radius={cat === top5cats[top5cats.length - 1] ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                          onClick={() => setFilterCat(cat)} style={{ cursor: 'pointer' }} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-4 mt-3">
                    {top5cats.map(cat => (
                      <span key={cat} className="flex items-center gap-1.5 cursor-pointer"
                        style={{ fontSize: 12, color: '#78716C' }}
                        onClick={() => setFilterCat(cat)}>
                        <span className="w-3 h-2 rounded-sm" style={{ background: catColor(cat, allCats), display: 'inline-block' }} />
                        {cat}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Charts row 3: YoY comparison + Heatmap ────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* YoY */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Year-over-Year Comparison</p>
              <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 10 }}>This year vs same months last year</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={yoyData} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#78716C' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#78716C' }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                  <Bar dataKey="thisYear" name="This Year" fill="#D4AF37" radius={[3,3,0,0]} />
                  <Bar dataKey="lastYear" name="Last Year" fill="#E8DEC8" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                {[{color:'#D4AF37',label:'This Year'},{color:'#E8DEC8',label:'Last Year'}].map(({color,label})=>(
                  <span key={label} className="flex items-center gap-1.5" style={{ fontSize: 12, color: '#78716C' }}>
                    <span className="w-3 h-2 rounded-sm" style={{ background: color, display: 'inline-block' }} />{label}
                  </span>
                ))}
              </div>
            </div>

            {/* Heatmap — company × month */}
            <div className="rounded-xl p-4" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Expense Heatmap — Company × Month</p>
              <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 10 }}>Darker gold = higher spend</p>
              {heatmapCompanies.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: 12, color: '#A8A29E', fontWeight: 500, textAlign: 'left', paddingRight: 8, paddingBottom: 4 }}>Company</th>
                        {heatmapMonths.map(m => (
                          <th key={m} style={{ fontSize: 11, color: '#A8A29E', fontWeight: 500, textAlign: 'center', paddingBottom: 4, whiteSpace: 'nowrap' }}>
                            {m.split(' ')[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmapCompanies.map(co => (
                        <tr key={co}>
                          <td style={{ fontSize: 12, color: '#57534E', paddingRight: 8, paddingBottom: 3, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {co.split(' ').slice(0,2).join(' ')}
                          </td>
                          {heatmapMonths.map(m => {
                            const amt = heatmapCells.map[`${co}|${m}`] ?? 0;
                            const intensity = amt / heatmapCells.max;
                            return (
                              <td key={m} title={`${co} · ${m}: ${fmtUSD(amt)}`}
                                style={{
                                  background: amt > 0 ? `rgba(212,175,55,${Math.max(0.08, intensity * 0.9)})` : '#F7F1E6',
                                  borderRadius: 4, textAlign: 'center', fontSize: 11, color: intensity > 0.5 ? '#5C4033' : '#78716C',
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
                <div className="h-40 flex items-center justify-center" style={{ color: '#A8A29E', fontSize: 14 }}>No data</div>
              )}
            </div>
          </div>

          {/* ── All Expenses table ────────────────────────────────────────────── */}
          <div className="rounded-xl" style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', overflow: 'hidden' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #E8DEC8' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917' }}>
                All Expenses{period ? ` — ${period}` : ''}
              </p>
              <div className="flex items-center gap-2">
                {filterCat && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: catColor(filterCat, allCats), color: '#fff', fontSize: 12 }}>{filterCat}</span>
                    <button className="exp-interactive" onClick={() => setFilterCat(null)}
                      style={{ fontSize: 12, color: '#A8A29E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>× clear</button>
                  </span>
                )}
                <span style={{ fontSize: 13, color: '#A8A29E' }}>{tableRows.length} rows</span>
              </div>
            </div>
            <div className="overflow-x-auto" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="w-full">
                <thead className="sticky top-0" style={{ background: '#F0EDE5' }}>
                  <tr style={{ borderBottom: '1px solid #E8DEC8' }}>
                    {['Company','Category','Month','Amount'].map(h => (
                      <th key={h} className="py-2 px-3 text-left"
                        style={{ fontSize: 14, fontWeight: 600, color: '#78716C' }}>{h}</th>
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
                      <td className="py-2 px-3" style={{ fontSize: 14, color: '#92400E' }}>{r.company}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded-full"
                          style={{ fontSize: 13, fontWeight: 500, background: catColor(r.category, allCats), color: '#fff' }}>
                          {r.category}
                        </span>
                      </td>
                      <td className="py-2 px-3" style={{ fontSize: 13, color: '#78716C' }}>{r.month}</td>
                      <td className="py-2 px-3 text-right" style={{ fontSize: 14, fontWeight: 600, color: '#1C1917' }}>{fmtUSD(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {tableRows.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #E8DEC8', background: '#F0EDE5' }}>
                      <td colSpan={3} className="py-2 px-3" style={{ fontSize: 14, fontWeight: 700, color: '#1C1917' }}>Total</td>
                      <td className="py-2 px-3 text-right" style={{ fontSize: 17, fontWeight: 700, color: '#D4AF37' }}>
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
