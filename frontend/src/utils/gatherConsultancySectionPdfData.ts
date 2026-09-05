/**
 * Builds the Consultancy & Outsourcing "Export PDF" board pack — same SectionPdfBlock/
 * SectionPdfPayload shapes as Rentals'/Property Dev's, reusing the shared renderer
 * (sectionPdfHtml.ts) and chart builders (sectionPdfCharts.ts).
 */
import type {
  SectionPdfAlert, SectionPdfBlock, SectionPdfPayload, SectionPdfTable,
} from './gatherSectionPdfData';
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import type { ConsultancyBoardExportPayload } from './gatherConsultancyBoardExportData';
import type { ConsultFinItem } from '../pages/consultancy/ConsultancyFinancials';
import {
  svgDoughnut,
  svgGroupedBarChart,
  svgLineChart,
  svgMultiBarLineChart,
  svgSignedGroupedBarChart,
  svgSignedLineChart,
} from './sectionPdfCharts';

const CHART_COLORS = ['#5B5FEF', '#0F766E', '#166534', '#B91C1C', '#F5A623', '#1F6FEB'];

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtUsdAcct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n < 0) return `(${fmtUsd(Math.abs(n))})`;
  return fmtUsd(n);
}
function fmtPct(n: number | null): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}
function topEntries(rec: Record<string, number>, n = 8): { label: string; value: number }[] {
  return Object.entries(rec).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([label, value]) => ({ label, value }));
}

/** JSON round-trips turn year keys into strings — accept both shapes and coerce numerics. */
function yearVal(values: Record<number | string, number> | undefined, y: number): number {
  if (!values) return 0;
  // Declared type says every value is `number`, but this function exists specifically to
  // tolerate stringified numbers from JSON/DB round-trips — without this `unknown`
  // annotation, TS narrows the string branch below to `never` and .trim() fails to typecheck.
  const raw: unknown = values[y] ?? values[String(y)];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(String(raw).replace(/[,$]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function yearsFromItems(items: ConsultFinItem[]): number[] {
  const ys = new Set<number>();
  for (const item of items) {
    for (const k of Object.keys(item.values ?? {})) {
      const n = Number(k);
      if (Number.isFinite(n) && n >= 1990 && n <= 2100) ys.add(n);
    }
  }
  return [...ys].sort((a, b) => a - b);
}

/** Collect years that actually have at least one non-zero amount in the uploaded rows. */
function yearsWithNonZeroValues(items: ConsultFinItem[]): number[] {
  const ys = new Set<number>();
  for (const item of items) {
    for (const k of Object.keys(item.values ?? {})) {
      const n = Number(k);
      if (!Number.isFinite(n) || n < 1990 || n > 2100) continue;
      if (yearVal(item.values, n) !== 0) ys.add(n);
    }
  }
  return [...ys].sort((a, b) => a - b);
}

const NET_OCF_RE = /net\s+cash\s+(provided|used)\s+(by\s+)?(\(used\s+in\)\s+)?operating|net\s+cash\s+from\s+operating|net\s+cash\s+provided\s+by\s+operations/i;
const NET_ICF_RE = /net\s+cash\s+(provided|used)\s+(by\s+)?(\(used\s+in\)\s+)?investing|net\s+cash\s+from\s+investing/i;
const NET_FCF_RE = /net\s+cash\s+(provided|used)\s+(by\s+)?(\(used\s+in\)\s+)?financing|net\s+cash\s+from\s+financing/i;
const NET_CHANGE_RE = /net\s+(cash\s+)?(increase|decrease)(\s+in\s+cash)?|net\s+change\s+in\s+cash|net\s+increase\s*\(\s*decrease\s*\)(\s+in\s+cash)?/i;

/**
 * Same priority as ConsultancyFinancials / rental cfoCfTrendData:
 * 1) explicit "Net cash … operating/investing/financing" row (last match wins)
 * 2) isTotal row matching the section
 * 3) sum of detail lines whose labels match the pattern
 */
function cfSectionTotal(cf: ConsultFinItem[], section: 'operating' | 'investing' | 'financing', y: number): number {
  const netRe = section === 'operating' ? NET_OCF_RE : section === 'investing' ? NET_ICF_RE : NET_FCF_RE;
  const softRe = section === 'operating' ? /operating/i : section === 'investing' ? /investing/i : /financing/i;

  let lastNet = 0;
  let foundNet = false;
  for (const item of cf) {
    if (item.isSectionHeader) continue;
    if (netRe.test(item.label) || (/net\s+cash/i.test(item.label) && softRe.test(item.label))) {
      lastNet = yearVal(item.values, y);
      foundNet = true;
    }
  }
  if (foundNet) return lastNet;

  const totalRow = [...cf].reverse().find(i => i.isTotal && softRe.test(i.label) && !/net\s+income/i.test(i.label));
  if (totalRow) return yearVal(totalRow.values, y);

  // Sum detail lines inside the named section (header → next header/total)
  let inSection = false;
  let sum = 0;
  for (const item of cf) {
    const label = item.label.trim();
    if (item.isSectionHeader || /^(operating|investing|financing)\s+activit/i.test(label)) {
      if (softRe.test(label) && /activit/i.test(label)) {
        inSection = true;
        continue;
      }
      if (inSection) break;
      continue;
    }
    if (!inSection) continue;
    if (item.isTotal || /net\s+cash/i.test(label)) break;
    sum += yearVal(item.values, y);
  }
  if (sum !== 0) return sum;

  return cf
    .filter(i => !i.isSectionHeader && !i.isTotal && softRe.test(i.label))
    .reduce((s, i) => s + yearVal(i.values, y), 0);
}

function netCashFlowTotal(cf: ConsultFinItem[], y: number, ocf: number, icf: number, fcf: number): number {
  let last = 0;
  let found = false;
  for (const item of cf) {
    if (item.isSectionHeader) continue;
    if (NET_CHANGE_RE.test(item.label) && /cash/i.test(item.label) && !NET_OCF_RE.test(item.label) && !NET_ICF_RE.test(item.label) && !NET_FCF_RE.test(item.label)) {
      last = yearVal(item.values, y);
      found = true;
    }
  }
  if (found) return last;
  return ocf + icf + fcf;
}

function buildYoyTable(items: ConsultFinItem[], years: number[], title: string): SectionPdfTable | null {
  if (!items.length || !years.length) return null;
  // Drop QuickBooks footer/meta lines (e.g. "Accrual Basis Friday, July 17…").
  const filtered = items.filter(item => {
    const label = item.label.replace(/\s+/g, ' ').trim();
    if (!label) return false;
    if (/accrual\s+basis|cash\s+basis/i.test(label)) return false;
    if (/\bGMT\s*[+-]?\s*\d/i.test(label)) return false;
    if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(label) && /\d{4}/.test(label)) return false;
    if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b.+\d{4}.+\d{1,2}:\d{2}/i.test(label)) return false;
    if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(label)) return false;
    return true;
  });
  if (!filtered.length) return null;
  const rowKinds: SectionPdfTable['rowKinds'] = [];
  const rows = filtered.map(item => {
    rowKinds!.push(
      item.isNetIncome ? 'net'
        : item.isTotal ? 'total'
          : item.isSectionHeader ? 'header'
            : 'detail',
    );
    const label = `${'  '.repeat(Math.min(item.indent, 2))}${item.label}`;
    const amounts = years.map(y => {
      const v = yearVal(item.values, y);
      return item.isSectionHeader ? '' : fmtUsd(v);
    });
    return [label, ...amounts];
  });
  return { title, headers: ['Line Item', ...years.map(String)], rows, rowKinds };
}

/** Split long YoY statement tables so PDF pages stay aligned (no giant black gaps). */
function paginateYoyTable(table: SectionPdfTable, rowsPerPage = 26): SectionPdfTable[] {
  if (table.rows.length <= rowsPerPage) return [table];
  const pages: SectionPdfTable[] = [];
  const total = Math.ceil(table.rows.length / rowsPerPage);
  for (let part = 0; part < total; part++) {
    const start = part * rowsPerPage;
    const end = start + rowsPerPage;
    pages.push({
      ...table,
      title: total > 1 ? `${table.title} (${part + 1}/${total})` : table.title,
      rows: table.rows.slice(start, end),
      rowKinds: table.rowKinds?.slice(start, end),
    });
  }
  return pages;
}

/** Full CF statement (same rows as the live Cash Flow tab) — always visible when CF is uploaded. */
function buildFullCfStatementTable(cf: ConsultFinItem[], years: number[], title: string): SectionPdfTable | null {
  if (!cf.length || !years.length) return null;
  const cleaned = cf.filter(item => {
    const label = item.label.replace(/\s+/g, ' ').trim();
    if (!label) return false;
    if (/accrual\s+basis|cash\s+basis/i.test(label)) return false;
    if (/\bGMT\s*[+-]?\s*\d/i.test(label)) return false;
    if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(label) && /\d{4}/.test(label)) return false;
    return true;
  });
  if (!cleaned.length) return null;
  const rowKinds: SectionPdfTable['rowKinds'] = [];
  const rows = cleaned.slice(0, 250).map(item => {
    const isNet = item.isNetIncome || /net\s+cash|net\s+(increase|decrease|change)/i.test(item.label);
    const isTot = item.isTotal || /^total\s+for/i.test(item.label);
    rowKinds!.push(isNet ? 'net' : isTot ? 'total' : item.isSectionHeader ? 'header' : 'detail');
    const amounts = years.map(y => {
      const v = yearVal(item.values, y);
      return v === 0 ? (item.isSectionHeader ? '' : '—') : fmtUsd(v);
    });
    return [item.label.slice(0, 56), ...amounts];
  });
  return { title, headers: ['Line Item', ...years.map(String)], rows, rowKinds };
}

/** CF YoY — include net-cash / activity rows even when parser flags are missing. */
function buildCfYoyTable(cf: ConsultFinItem[], years: number[], title: string): SectionPdfTable | null {
  if (!cf.length || !years.length) return null;
  const flagged = buildYoyTable(cf, years, title);
  if (flagged && flagged.rows.length >= 3) return flagged;

  const interesting = cf.filter(i =>
    i.isSectionHeader || i.isTotal || i.isNetIncome
    || /net\s+cash|total\s+for|operating\s+activit|investing\s+activit|financing\s+activit|cash\s+at\s+(beginning|end)/i.test(i.label),
  );
  const rowsSrc = interesting.length ? interesting : cf.filter(i => years.some(y => yearVal(i.values, y) !== 0)).slice(0, 40);
  if (!rowsSrc.length) return null;
  const rowKinds: SectionPdfTable['rowKinds'] = [];
  const rows = rowsSrc.map(item => {
    const isNet = item.isNetIncome || /net\s+cash/i.test(item.label);
    const isTot = item.isTotal || /^total\s+for/i.test(item.label);
    rowKinds!.push(isNet ? 'net' : isTot ? 'total' : item.isSectionHeader ? 'header' : 'detail');
    const amounts = years.map(y => {
      const v = yearVal(item.values, y);
      return v === 0 ? (item.isSectionHeader ? '' : '—') : fmtUsd(v);
    });
    return [item.label.slice(0, 48), ...amounts];
  });
  return { title, headers: ['Line Item', ...years.map(String)], rows, rowKinds };
}

export function buildConsultancyCfoDashboardBoardBlocks(data: ConsultancyBoardExportPayload): SectionPdfBlock[] {
  const blocks: SectionPdfBlock[] = [];
  const last = data.snapshots[data.snapshots.length - 1] ?? null;
  const cf = Array.isArray(data.fin.cf) ? data.fin.cf : [];
  const hasCf = cf.length > 0;
  // data.years is already capped to the selected as-of year by the export payload builder.
  const maxYear = data.years.length ? data.years[data.years.length - 1] : undefined;
  const cfYears = [...new Set([...data.years, ...yearsFromItems(cf)])]
    .filter(y => maxYear == null || y <= maxYear)
    .sort((a, b) => a - b);

  // ── Financial Snapshot ──────────────────────────────────────────────────────
  const revCats = topEntries(data.latestRevenueCategories);
  const snapCharts = [];
  if (revCats.length) {
    snapCharts.push({
      title: 'Revenue Mix', subtitle: 'Sales / Services / Other',
      svg: svgDoughnut(revCats.map((c, i) => ({ label: c.label, value: c.value, color: CHART_COLORS[i % CHART_COLORS.length] })), { width: 360 }),
    });
  }
  const expCats = topEntries(data.latestExpenseCategories);
  if (expCats.length) {
    snapCharts.push({
      title: 'Opex Breakdown', subtitle: 'Payroll isolated as the dominant slice',
      svg: svgDoughnut(expCats.map((c, i) => ({ label: c.label, value: c.value, color: c.label.toLowerCase().includes('salar') || c.label.toLowerCase().includes('payroll') ? '#B91C1C' : CHART_COLORS[i % CHART_COLORS.length] })), { width: 360 }),
    });
  }
  blocks.push({
    heading: 'Financial Snapshot',
    kpis: [
      { label: 'Revenue', value: fmtUsd(last?.rev ?? 0) },
      { label: 'Net Income', value: fmtUsdAcct(last?.netInc ?? 0), accent: (last?.netInc ?? 0) < 0 ? '#B91C1C' : '#166534' },
      { label: 'Payroll % of Revenue', value: fmtPct(last?.payrollPctRev ?? null), accent: '#5B5FEF' },
      { label: 'Cash', value: fmtUsd(last?.cash ?? 0) },
      { label: 'AR Balance', value: fmtUsd(last?.ar ?? 0) },
      { label: 'Loans & Advances', value: fmtUsd(last?.loansAdvances ?? 0) },
    ],
    charts: snapCharts,
    chartsLayout: 'grid',
  });

  // ── Multi-Year Financial Snapshot (include Operating CF when uploaded) ───────
  if (data.snapshots.length) {
    const headers = hasCf
      ? ['Year', 'Revenue', 'Payroll', 'Net Income', 'Operating CF', 'Net CF']
      : ['Year', 'Revenue', 'Payroll', 'Net Income'];
    blocks.push({
      heading: 'Multi-Year Financial Snapshot',
      tables: [{
        title: `Multi-Year Financial Snapshot — ${data.entityLabel}`,
        headers,
        rows: data.snapshots.map(s => {
          const ocf = hasCf ? cfSectionTotal(cf, 'operating', s.year) : 0;
          const icf = hasCf ? cfSectionTotal(cf, 'investing', s.year) : 0;
          const fcf = hasCf ? cfSectionTotal(cf, 'financing', s.year) : 0;
          const netCf = hasCf ? netCashFlowTotal(cf, s.year, ocf, icf, fcf) : 0;
          const base = [
            String(s.year),
            fmtUsd(s.rev),
            fmtUsd(s.payroll),
            s.netInc < 0 ? `(${fmtUsd(Math.abs(s.netInc))})` : fmtUsd(s.netInc),
          ];
          if (!hasCf) return base;
          return [
            ...base,
            fmtUsdAcct(ocf),
            netCf < 0 ? `(${fmtUsd(Math.abs(netCf))})` : fmtUsd(netCf),
          ];
        }),
        rowKinds: data.snapshots.map(() => 'detail' as const),
        negativeLastCol: true,
      }],
    });
  }

  // ── Cash Flow EARLY (right after Multi-Year) so it cannot be missed / truncated ─
  if (hasCf) {
    const cfByYear = cfYears.map(y => {
      const operating = cfSectionTotal(cf, 'operating', y);
      const investing = cfSectionTotal(cf, 'investing', y);
      const financing = cfSectionTotal(cf, 'financing', y);
      const netCf = netCashFlowTotal(cf, y, operating, investing, financing);
      const rev = data.snapshots.find(s => s.year === y)?.rev ?? 0;
      return {
        year: y,
        yearLabel: String(y),
        operating,
        investing,
        financing,
        netCf,
        ocfMargin: rev > 0 ? (operating / rev) * 100 : 0,
      };
    });
    const lastCf = cfByYear[cfByYear.length - 1];
    const cfCharts = [];
    if (cfByYear.length >= 1) {
      cfCharts.push({
        title: 'Net Cash Flow Trajectory',
        svg: svgSignedLineChart(
          cfByYear.map(r => r.yearLabel),
          [{ name: 'Net Cash Flow', values: cfByYear.map(r => r.netCf), color: '#22C55E' }],
          { width: 520, height: 200 },
        ),
      });
      cfCharts.push({
        title: 'Operating CF Margin Trend',
        svg: svgSignedLineChart(
          cfByYear.map(r => r.yearLabel),
          [{ name: 'OCF ÷ Revenue %', values: cfByYear.map(r => r.ocfMargin), color: '#0F766E' }],
          { width: 520, height: 200 },
        ),
      });
    }
    if (cfByYear.length >= 2) {
      cfCharts.push({
        title: 'CF Category Comparison',
        svg: svgSignedGroupedBarChart(
          cfByYear.map(r => r.yearLabel),
          [
            { name: 'Operating', values: cfByYear.map(r => r.operating), color: '#5B5FEF' },
            { name: 'Investing', values: cfByYear.map(r => r.investing), color: '#166534' },
            { name: 'Financing', values: cfByYear.map(r => r.financing), color: '#C0392B' },
          ],
          { width: 520, height: 200 },
        ),
      });
    }
    if (lastCf) {
      const pieSlices = [
        { label: 'Operating CF', value: Math.abs(lastCf.operating), color: '#5B5FEF' },
        { label: 'Investing CF', value: Math.abs(lastCf.investing), color: '#166534' },
        { label: 'Financing CF', value: Math.abs(lastCf.financing), color: '#C0392B' },
      ].filter(s => s.value > 0);
      if (pieSlices.length) {
        cfCharts.push({
          title: `CF Breakdown (${lastCf.yearLabel})`,
          svg: svgDoughnut(pieSlices, { width: 360 }),
        });
      }
    }

    // Key totals only in early section (full line-item dump comes later as YoY)
    blocks.push({
      heading: 'Cash Flow',
      pageBreakBefore: true,
      kpis: [
        { label: 'Operating CF', value: fmtUsdAcct(lastCf?.operating ?? 0), accent: '#166534' },
        { label: 'Investing CF', value: fmtUsdAcct(lastCf?.investing ?? 0) },
        { label: 'Financing CF', value: fmtUsdAcct(lastCf?.financing ?? 0) },
        { label: 'Net Cash Flow', value: fmtUsdAcct(lastCf?.netCf ?? 0), accent: (lastCf?.netCf ?? 0) < 0 ? '#B91C1C' : '#166534' },
      ],
      charts: cfCharts,
      chartsLayout: 'grid',
      tables: [{
        title: 'Multi-Year CF Snapshot',
        headers: ['Year', 'Operating CF', 'Investing CF', 'Financing CF', 'Net CF'],
        rows: cfByYear.map(r => [
          r.yearLabel,
          fmtUsdAcct(r.operating),
          fmtUsdAcct(r.investing),
          fmtUsdAcct(r.financing),
          fmtUsdAcct(r.netCf),
        ]),
      }],
    });
  } else {
    blocks.push({
      heading: 'Cash Flow',
      pageBreakBefore: true,
      tables: [{
        title: 'Cash Flow',
        headers: ['Note'],
        rows: [['No Cash Flow statement uploaded for this company. Use Upload CF on Financials & Risk.']],
      }],
    });
  }

  // ── Trends ───────────────────────────────────────────────────────────────────
  const trendCharts = [];
  if (data.snapshots.length > 1) {
    trendCharts.push({
      title: 'Revenue vs Expenses vs Net Income',
      svg: svgMultiBarLineChart(
        data.snapshots.map(s => String(s.year)),
        [
          { name: 'Revenue', values: data.snapshots.map(s => s.rev), color: '#5B5FEF' },
          { name: 'Expenses', values: data.snapshots.map(s => s.exp), color: '#B91C1C' },
        ],
        { name: 'Net Income', values: data.snapshots.map(s => s.netInc), color: '#166534' },
        { width: 520, height: 220 },
      ),
    });
    trendCharts.push({
      title: 'Cash / AR / Loans & Advances',
      svg: svgMultiBarLineChart(
        data.snapshots.map(s => String(s.year)),
        [
          { name: 'Cash', values: data.snapshots.map(s => s.cash), color: '#166534' },
          { name: 'AR', values: data.snapshots.map(s => s.ar), color: '#1F6FEB' },
        ],
        { name: 'Loans & Advances', values: data.snapshots.map(s => s.loansAdvances), color: '#F5A623' },
        { width: 520, height: 220 },
      ),
    });
  }
  if (trendCharts.length) {
    blocks.push({
      heading: 'Trends & Breakdowns',
      charts: trendCharts,
      chartsLayout: 'grid',
    });
  }

  // ── Balance Sheet Charts ─────────────────────────────────────────────────────
  const bsSeries = data.years.map(y => {
    const bs = data.fin.bs;
    const getBS = (pat: RegExp) => Math.abs(bs.find(i => pat.test(i.label))?.values[y] ?? 0);
    const totalAssets = getBS(/^total\s+(for\s+)?assets$/i);
    const totalLiab   = getBS(/^total\s+(for\s+)?liabilit(y|ies)$/i);
    const equity      = getBS(/^total\s+(for\s+)?equity$/i);
    const loans       = data.snapshots.find(s => s.year === y)?.loansAdvances ?? 0;
    const debtToEquity = equity > 0 ? loans / equity : 0;
    return { year: String(y), totalAssets, totalLiab, equity, debtToEquity };
  });
  const hasBsData = bsSeries.some(s => s.totalAssets > 0);
  if (hasBsData && bsSeries.length > 1) {
    const labels = bsSeries.map(s => s.year);
    const bsCharts = [
      {
        title: 'Total Assets Trajectory',
        svg: svgLineChart(
          labels,
          [{ name: 'Total Assets', values: bsSeries.map(s => s.totalAssets), color: '#0F766E' }],
          { width: 480, height: 200 },
        ),
      },
      {
        title: 'Debt-to-Equity Trend',
        svg: svgLineChart(
          labels,
          [{ name: 'Debt-to-Equity', values: bsSeries.map(s => s.debtToEquity), color: '#B91C1C' }],
          { width: 480, height: 200 },
        ),
      },
      {
        title: 'Assets vs Liabilities',
        svg: svgGroupedBarChart(
          labels,
          [
            { name: 'Total Assets',      values: bsSeries.map(s => s.totalAssets), color: '#0F766E' },
            { name: 'Total Liabilities', values: bsSeries.map(s => s.totalLiab),   color: '#B91C1C' },
          ],
          { width: 480, height: 200 },
        ),
      },
      {
        title: 'Equity Trend',
        svg: svgLineChart(
          labels,
          [{ name: 'Equity', values: bsSeries.map(s => s.equity), color: '#166534' }],
          { width: 480, height: 200 },
        ),
      },
    ];
    blocks.push({
      heading: 'Balance Sheet',
      pageBreakBefore: true,
      charts: bsCharts,
      chartsLayout: 'grid',
    });
  }

  // ── YoY line-item tables (full-width) ───────────────────────────────────────
  const plYears = yearsWithNonZeroValues(data.fin.pl);
  const bsYears = yearsWithNonZeroValues(data.fin.bs);
  const plYoy = buildYoyTable(data.fin.pl, plYears, `P&L Statement — ${data.entityLabel}`);
  const bsYoy = buildYoyTable(data.fin.bs, bsYears, `Balance Sheet — ${data.entityLabel}`);
  // Full CF statement (same rows as the live Cash Flow tab)
  const cfFull = hasCf ? buildFullCfStatementTable(cf, cfYears, `Cash Flow Statement — ${data.entityLabel}`) : null;
  const cfYoy = hasCf ? buildCfYoyTable(cf, cfYears, `Cash Flow — ${data.entityLabel}`) : null;
  for (const table of [plYoy, bsYoy, cfFull ?? cfYoy]) {
    if (!table) continue;
    const pages = paginateYoyTable(table, 26);
    pages.forEach((page, idx) => {
      blocks.push({
        heading: idx === 0 ? `${table.title} — YoY Summary` : `${table.title} — YoY Summary (continued)`,
        // Always start each statement (and each continuation) on a fresh page.
        pageBreakBefore: true,
        forcePageBreak: true,
        tables: [page],
      });
    });
  }

  // ── Action Required last (after all financials; Strategy follows in HTML) ──
  const alerts: SectionPdfAlert[] = [];
  if (last?.payrollPctRev != null && last.payrollPctRev > 70) {
    alerts.push({ severity: last.payrollPctRev > 80 ? 'critical' : 'warning', title: 'Payroll % of Revenue Elevated', text: `Payroll is ${fmtPct(last.payrollPctRev)} of revenue — above the 70% healthy-margin threshold.` });
  }
  if (last) {
    const arDays = last.rev > 0 ? (last.ar / last.rev) * 365 : null;
    if (arDays != null && arDays > 60) {
      alerts.push({ severity: arDays > 90 ? 'critical' : 'warning', title: 'AR Days Above Threshold', text: `AR Days are ${arDays.toFixed(0)} — collections lagging behind billing.` });
    }
    const monthlyPayroll = last.payroll / 12;
    const cashMonths = monthlyPayroll > 0 ? last.cash / monthlyPayroll : null;
    if (cashMonths != null && cashMonths < 3) {
      alerts.push({ severity: cashMonths < 1 ? 'critical' : 'warning', title: 'Low Cash Coverage of Payroll', text: `Cash covers approximately ${cashMonths.toFixed(1)} months of payroll.` });
    }
  }
  if (alerts.length) {
    blocks.push({ heading: 'Action Required', pageBreakBefore: true, alerts });
  }

  return blocks;
}

export function buildConsultancySectionPdfPayload(
  data: ConsultancyBoardExportPayload,
  blocks: SectionPdfBlock[],
  strategy: SectionStrategyPlan,
): SectionPdfPayload {
  return {
    tab: 'consultancy-cfo-dashboard',
    sectionTitle: 'CFO Dashboard',
    fileSectionName: 'CFODashboard',
    entityLabel: data.entityLabel,
    periodLabel: data.periodLabel,
    generatedAt: data.generatedAt,
    sourceNote: `Consultancy & Outsourcing → Financials & Risk · CFO Dashboard · CF lines: ${data.fin.cf?.length ?? 0}`,
    kpis: [],
    charts: [],
    blocks,
    strategy,
  };
}
