import { PARCHMENT_THEME, type PdfTheme } from './pdfTheme';
import type { SectionPdfAlert, SectionPdfBlock, SectionPdfChart, SectionPdfKpi, SectionPdfPayload, SectionPdfRowKind, SectionPdfTable } from './gatherSectionPdfData';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderKpiGrid(kpis: SectionPdfKpi[], theme: PdfTheme): string {
  if (!kpis.length) return '';
  const cols = kpis.length <= 3 ? kpis.length : kpis.length === 5 ? 3 : 4;
  const colStyle = `grid-template-columns: repeat(${cols}, 1fr);`;
  const accentSide = theme.kpiAccentSide === 'bottom' ? 'border-bottom' : 'border-left';
  return `<div class="kpi-grid" style="${colStyle}">${kpis.map(k => `
    <div class="kpi-card" style="${accentSide}: ${theme.kpiAccentSide === 'bottom' ? '3px' : '4px'} solid ${k.accent ?? theme.accent}">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value" style="color:${k.accent ?? theme.text}">${esc(k.value)}</div>
      ${k.sub ? `<div class="kpi-sub">${esc(k.sub)}</div>` : ''}
    </div>
  `).join('')}</div>`;
}

function renderCharts(charts: SectionPdfChart[], layout: 'grid' | 'stack' = 'grid'): string {
  if (!charts.length) return '';
  const cards = charts.map(c => `
    <div class="chart-card">
      <div class="chart-title">${esc(c.title)}</div>
      ${c.subtitle ? `<div class="chart-sub">${esc(c.subtitle)}</div>` : ''}
      <div class="chart-svg">${c.svg}</div>
    </div>
  `).join('');
  const rowClass = charts.length === 1
    ? 'charts-row single'
    : layout === 'stack'
      ? 'charts-row stacked'
      : 'charts-row';
  return `<div class="${rowClass}">${cards}</div>`;
}

function rowKindClass(kind: SectionPdfRowKind | undefined, fallbackAlt: boolean): string {
  if (kind === 'header') return 'row-header';
  if (kind === 'total') return 'row-total';
  if (kind === 'net') return 'row-net';
  return fallbackAlt ? 'alt' : '';
}

function renderTables(tables: SectionPdfTable[], layout: 'grid' | 'stack' = 'stack', theme: PdfTheme): string {
  if (!tables.length) return '';
  const cards = tables.map(t => {
    const colCount = t.headers.length;
    const snapshot = Boolean(t.keepTogether)
      || /multi-year|snapshot/i.test(`${t.title ?? ''} ${t.headers.join(' ')}`);
    const statement = /statement|yoy|line item|cash flow —|balance sheet|p&l/i.test(`${t.title ?? ''} ${t.headers.join(' ')}`);
    // Compact multi-year KPI snapshots + paginated YoY page-chunks must stay on one page.
    // Only unsliced giant statements may flow via table-wide (avoid for Prop Dev/Construction).
    const wide = !t.dense && !snapshot && (colCount > 5 || statement);
    const yearCols = Math.max(1, colCount - 1);
    const labelPct = statement
      ? Math.max(30, Math.min(40, 100 - yearCols * 12))
      : wide
        ? Math.max(14, Math.min(34, 100 - yearCols * 8))
        : 34;
    const navy = t.headerStyle === 'navy';
    const cardClass = [
      'table-card',
      wide ? 'table-wide' : '',
      t.dense ? 'table-dense' : '',
      snapshot ? 'table-snapshot' : '',
      statement ? 'table-statement' : '',
      navy ? 'table-navy' : '',
    ].filter(Boolean).join(' ');
    const titleHtml = navy
      ? `<div class="section-h-navy">${esc(t.title ?? 'Data Summary')}</div>`
      : `<div class="section-h">${esc(t.title ?? 'Data Summary')}</div>`;
    const denseColWidths = t.dense
      ? (t.colWidthPct && t.colWidthPct.length === colCount ? t.colWidthPct : t.headers.map(() => 100 / colCount))
      : null;
    const colgroupHtml = denseColWidths
      ? `<colgroup>${denseColWidths.map(w => `<col style="width:${w}%">`).join('')}</colgroup>`
      : '';
    return `
    <div class="${cardClass}" style="--label-col-pct:${labelPct}%; --year-col-count:${yearCols}">
      ${titleHtml}
      <table>
        ${colgroupHtml}
        <thead><tr>${t.headers.map((h, hi) => `<th class="${hi === 0 || t.textCols?.includes(hi) ? 'col-label' : t.centerCols?.includes(hi) ? 'col-center' : 'col-num'}">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.map((row, i) => {
          const cls = rowKindClass(t.rowKinds?.[i], i % 2 === 1);
          const lastIdx = row.length - 1;
          return `<tr class="${cls}">${row.map((cell, ci) => {
            const isNegLast = t.negativeLastCol && ci === lastIdx && cell.startsWith('(');
            const style = isNegLast ? ` style="color:${theme.negative}"` : '';
            const colClass = ci === 0 || t.textCols?.includes(ci) ? 'col-label' : t.centerCols?.includes(ci) ? 'col-center' : 'col-num';
            return `<td class="${colClass}"${style}>${esc(cell)}</td>`;
          }).join('')}</tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }).join('');
  if (layout === 'grid' && tables.length >= 2) {
    return `<div class="tables-row">${cards}</div>`;
  }
  return cards;
}

function renderAlerts(alerts: SectionPdfAlert[], title: string | null, theme: PdfTheme): string {
  if (!alerts.length) return '';
  return `<div class="alerts-block">
    ${title ? `<div class="section-h">${esc(title)}</div>` : ''}
    ${alerts.map(a => `
      <div class="alert-card ${a.severity}">
        <div class="alert-title">${esc(a.title)}</div>
        <div class="alert-text">${esc(a.text)}</div>
      </div>
    `).join('')}
  </div>`;
}

function blockHasContent(block: SectionPdfBlock): boolean {
  return (
    (block.kpis?.length ?? 0) > 0 ||
    (block.alerts?.length ?? 0) > 0 ||
    (block.charts?.length ?? 0) > 0 ||
    (block.tables?.length ?? 0) > 0
  );
}

function renderBlock(block: SectionPdfBlock, theme: PdfTheme): string {
  if (!blockHasContent(block)) return '';
  const breakClass = [
    block.pageBreakBefore || block.forcePageBreak ? 'pdf-section-break' : '',
    block.forcePageBreak ? 'pdf-force-page' : '',
  ].filter(Boolean).map(c => ` ${c}`).join('');
  const slug = block.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const alertsOnly = (block.alerts?.length ?? 0) > 0
    && !(block.kpis?.length)
    && !(block.charts?.length)
    && !(block.tables?.length);
  // Avoid double titles: section header "Attention Now" + inner "Attention Now"
  const alertTitle = alertsOnly && /attention\s*now|action.{0,10}required/i.test(block.heading)
    ? null
    : 'Attention Now';
  const headerHtml = `<div class="pdf-section-header">${esc(block.heading === 'Action Required' ? 'Attention Now' : block.heading)}</div>`;
  const kpisHtml = renderKpiGrid(block.kpis ?? [], theme);
  const alertsHtml = renderAlerts(block.alerts ?? [], alertTitle, theme);
  const chartsHtml = renderCharts(block.charts ?? [], block.chartsLayout ?? 'grid');
  const tablesHtml = renderTables(block.tables ?? [], block.tablesLayout ?? 'stack', theme);

  // Snapshot / table-only sections: keep header + table as one atom so the slicer
  // cannot leave a lone section title above a blank half-page.
  const tableOnly = (block.tables?.length ?? 0) > 0
    && !(block.kpis?.length)
    && !(block.charts?.length)
    && !(block.alerts?.length);
  // KPI bands (e.g. Finance & Profitability): keep title + cards together —
  // kpi-grid is atomic, so an unbound header was getting orphaned on the prior page.
  const kpiLead = (block.kpis?.length ?? 0) > 0;
  let body: string;
  if (tableOnly) {
    body = `<div class="pdf-keep-together">${headerHtml}${tablesHtml}</div>`;
  } else if (kpiLead) {
    body = `<div class="pdf-keep-together">${headerHtml}${kpisHtml}</div>${alertsHtml}${chartsHtml}${tablesHtml}`;
  } else {
    body = `${headerHtml}${kpisHtml}${alertsHtml}${chartsHtml}${tablesHtml}`;
  }

  return `<section class="pdf-section${breakClass}" data-section="${esc(slug)}">
    ${body}
  </section>`;
}

export function buildSectionPdfHtml(payload: SectionPdfPayload): string {
  const theme = payload.theme ?? PARCHMENT_THEME;
  // Strategy block: commentary is required by the HTML renderer; also show when
  // actions exist so modules that only supply bullets still appear in the pack.
  const actions = (payload.strategy?.actions ?? []).map(a => `<li>${esc(a)}</li>`).join('');
  const hasStrategy = Boolean(payload.strategy?.commentary || actions);
  const strategyHtml = hasStrategy ? `<div class="strategy-block">
    <div class="strategy-title">Strategy &amp; Recommendations</div>
    ${payload.strategy?.commentary ? `<div class="strategy-commentary">${esc(payload.strategy.commentary)}</div>` : ''}
    ${actions ? `<ul class="strategy-actions">${actions}</ul>` : ''}
  </div>` : '';

  const legacyBody = (() => {
    const allTables = [
      ...(payload.tables ?? []),
      ...(payload.table && !(payload.tables?.length) ? [payload.table] : []),
    ];
    const alerts = payload.alerts ?? [];
    const actionTail = alerts.length
      ? renderBlock({ heading: 'Action Required', pageBreakBefore: true, alerts }, theme)
      : '';
    return `
      ${renderKpiGrid(payload.kpis, theme)}
      ${renderCharts(payload.charts, payload.chartsLayout ?? 'grid')}
      ${renderTables(allTables, payload.tablesLayout ?? 'stack', theme)}
      ${actionTail}
      ${strategyHtml}
    `;
  })();

  let bodyContent: string;
  if (payload.blocks?.length) {
    const blks = payload.blocks;
    const actionIdx = blks.findIndex(b => /attention\s*now|action.{0,10}required/i.test(b.heading));
    if (actionIdx >= 0) {
      // Action Required + Strategy at the end of financials (or immediately after Action block)
      const pre = blks.slice(0, actionIdx + 1).map(b => renderBlock(b, theme)).join('\n');
      const post = blks.slice(actionIdx + 1).map(b => renderBlock(b, theme)).join('\n');
      bodyContent = `${pre}\n${strategyHtml}\n${post}`;
    } else {
      bodyContent = `${blks.map(b => renderBlock(b, theme)).join('\n')}\n${strategyHtml}`;
    }
  } else {
    bodyContent = legacyBody;
  }

  const headerBandStyle = theme.headerBg.startsWith('linear-gradient')
    ? `background: ${theme.headerBg};`
    : `background: ${theme.headerBg}; border: 1px solid ${theme.border};`;
  const kpiCardAccentCss = theme.kpiAccentSide === 'bottom'
    ? `border-bottom: 3px solid ${theme.accent};${theme.kpiShadow ? ' box-shadow: 0 1px 3px rgba(0,0,0,0.08);' : ''}`
    : `border-left: 4px solid ${theme.accent};`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html {
      width: 816px;
      background: ${theme.pageBg};
    }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: ${theme.pageBg};
      color: ${theme.text};
      padding: 20px 24px 28px;
      width: 816px;
      margin: 0 auto;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: geometricPrecision;
    }
    .pdf-section {
      width: 100%;
      margin-bottom: 22px;
      break-inside: auto;
      page-break-inside: auto;
    }
    .pdf-keep-together {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .header-band {
      ${headerBandStyle}
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 20px;
      color: ${theme.headerTitle};
    }
    .brand { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: ${theme.headerBrand}; font-weight: 700; }
    .section-name { font-size: 26px; font-weight: 700; margin-top: 4px; color: ${theme.headerTitle}; }
    .meta { font-size: 12px; color: ${theme.headerMeta}; margin-top: 8px; display: flex; gap: 16px; flex-wrap: wrap; }
    .meta span::before { content: '· '; opacity: 0.5; }
    .meta span:first-child::before { content: ''; }
    .pdf-section-break {
      /* Marker for the slicer only — avoid CSS forced breaks that leave blank bands */
      padding-top: 10px;
      margin-top: 20px;
      border-top: 2px solid ${theme.border};
    }
    .pdf-section-header {
      font-size: 16px;
      font-weight: 700;
      color: ${theme.sectionHeaderText};
      letter-spacing: 0.02em;
      margin-bottom: 12px;
      padding: 8px 12px;
      background: ${theme.sectionHeaderBg};
      border-left: 4px solid ${theme.accent};
      border-radius: ${theme.sectionHeaderBg === 'transparent' ? '0' : '6px'};
      break-after: avoid;
      page-break-after: avoid;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }
    .kpi-grid.kpi-grid-8 {
      grid-template-columns: repeat(4, 1fr);
    }
    .kpi-card {
      background: ${theme.cardBg};
      border: 1px solid ${theme.border};
      border-radius: 10px;
      padding: 12px 14px;
      ${kpiCardAccentCss}
    }
    .kpi-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${theme.muted}; }
    .kpi-value { font-size: 22px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .kpi-sub { font-size: 11px; color: ${theme.mutedLight}; margin-top: 3px; }
    .charts-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 20px;
      align-items: stretch;
      break-inside: auto;
      page-break-inside: auto;
    }
    .charts-row.single { grid-template-columns: 1fr; }
    .charts-row.stacked { grid-template-columns: 1fr; }
    .tables-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 20px;
      align-items: start;
    }
    .tables-row .table-card { margin-bottom: 0; }
    .chart-card {
      background: ${theme.cardBg};
      border: 1px solid ${theme.border};
      border-radius: 12px;
      padding: 16px 16px 18px;
      overflow: visible;
      break-inside: avoid;
      page-break-inside: avoid;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .chart-title {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
      padding: 2px 0 8px;
      margin: 0;
      color: ${theme.text};
      overflow: visible;
      white-space: normal;
    }
    .chart-sub {
      font-size: 11px;
      color: ${theme.mutedLight};
      margin: 0 0 8px;
      line-height: 1.35;
    }
    .chart-svg { overflow: visible; flex: 0 0 auto; }
    .chart-svg svg {
      width: 100%;
      height: auto;
      display: block;
      overflow: visible;
    }
    /* Donut mix charts — same display size in side-by-side cards. */
    .chart-svg svg.pdf-doughnut {
      width: 280px !important;
      max-width: 100%;
      height: auto !important;
      margin: 0 auto;
      display: block;
    }
    .chart-svg svg.pdf-doughnut-compact {
      width: 240px !important;
    }
    .table-card {
      background: ${theme.cardBg};
      border: 1px solid ${theme.border};
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 16px;
      break-inside: avoid;
      page-break-inside: avoid;
      overflow: visible;
    }
    /* Compact multi-year snapshots stay atomic (never row-sliced across pages). */
    .table-snapshot:not(.table-wide) {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    /* Wide YoY tables have many rows — allow them to flow across pages */
    .table-wide {
      break-inside: auto !important;
      page-break-inside: auto !important;
      overflow: hidden;
      width: 100%;
      margin-left: 0;
      margin-right: 0;
    }
    .table-wide tr { break-inside: avoid; page-break-inside: avoid; }
    .table-wide table { table-layout: fixed; width: 100%; }
    /* Do not ellipsis-truncate labels — CF/P&L names were cut mid-word (ADJUSTMENTS TO R…) */
    .table-wide td.col-label,
    .table-wide th.col-label {
      width: var(--label-col-pct, 34%);
      max-width: none;
      white-space: normal;
      word-break: break-word;
      overflow: visible;
      text-overflow: unset;
      line-height: 1.35;
      font-size: 10px;
      text-align: left;
      padding-left: 6px;
      padding-right: 8px;
    }
    .table-wide th.col-num,
    .table-wide td.col-num {
      width: calc((100% - var(--label-col-pct, 34%)) / var(--year-col-count, 4));
      text-align: right;
      font-variant-numeric: tabular-nums;
      padding-left: 4px;
      padding-right: 6px;
      font-size: 10px;
    }
    .table-wide td.col-num {
      white-space: nowrap;
    }
    /* Header words (e.g. "LOAN OUTSTANDING") must wrap onto 2 lines in narrow columns —
       never get silently cut off by the row's overflow:hidden like data cells can. */
    .table-wide th.col-num {
      white-space: normal;
      word-break: break-word;
      line-height: 1.25;
      vertical-align: bottom;
    }
    /* Many short-text-column register tables (Loan Portfolio, etc.) -- auto column
       sizing by content instead of table-wide's label-col + N-equal-numeric-col
       split, and every cell wraps instead of the numeric columns' forced nowrap. */
    .table-dense {
      break-inside: auto !important;
      page-break-inside: auto !important;
      width: 100%;
      margin-left: 0;
      margin-right: 0;
    }
    .table-dense tr { break-inside: avoid; page-break-inside: avoid; }
    /* fixed, not auto -- auto sizes columns to content and lets the table's total
       width exceed its container, silently clipping the rightmost columns off the
       rasterized PDF page instead of wrapping. Widths come from the <colgroup>. */
    .table-dense table { table-layout: fixed; width: 100%; font-size: 10px; }
    .table-dense th {
      font-size: 9px; padding: 6px 4px; white-space: normal; word-break: break-word;
      line-height: 1.25; vertical-align: bottom;
    }
    .table-dense td {
      padding: 6px 4px; white-space: normal; word-break: break-word; line-height: 1.3;
    }
    .table-dense td.col-label, .table-dense th.col-label { text-align: left; }
    .table-dense td.col-num, .table-dense th.col-num { text-align: right; font-variant-numeric: tabular-nums; }
    .table-statement {
      padding: 12px 12px 14px;
      width: 100%;
    }
    .table-statement .section-h {
      margin-bottom: 8px;
    }
    .table-statement table {
      width: 100%;
    }
    .table-statement td.col-label,
    .table-statement th.col-label {
      width: var(--label-col-pct, 36%);
      max-width: none;
      white-space: normal;
      word-break: break-word;
      font-size: 11px;
      text-align: left;
    }
    .table-statement th.col-num,
    .table-statement td.col-num {
      font-size: 11px;
      text-align: right;
      width: calc((100% - var(--label-col-pct, 36%)) / var(--year-col-count, 4));
    }
    .section-h { font-size: 14px; font-weight: 600; margin-bottom: 10px; line-height: 1.35; padding-top: 2px; color: ${theme.text}; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
    .table-wide table { font-size: 12px; }
    .table-wide th { font-size: 10px; padding: 6px 5px; white-space: nowrap; }
    .table-wide td { padding: 6px 5px; }
    .table-snapshot {
      padding: 18px 20px;
    }
    .table-snapshot .section-h { font-size: 15px; margin-bottom: 12px; }
    .table-snapshot table {
      font-size: 14px;
      table-layout: auto;
      width: 100%;
    }
    .table-snapshot th {
      font-size: 10px;
      padding: 8px 6px;
      letter-spacing: 0.02em;
      white-space: normal;
      line-height: 1.25;
      vertical-align: bottom;
      overflow: visible;
      word-break: normal;
      hyphens: none;
    }
    .table-snapshot td {
      padding: 10px 8px;
      font-size: 13px;
      white-space: nowrap;
    }
    th {
      padding: 8px 8px;
      background: ${theme.tableHeaderBg};
      color: ${theme.tableHeaderText};
      font-weight: 600;
      text-transform: uppercase;
      font-size: 9px;
      letter-spacing: 0.03em;
      border-bottom: ${theme.tableHeaderBg === 'transparent' ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`};
      white-space: nowrap;
    }
    th.col-label, td.col-label { text-align: left; }
    th.col-num, td.col-num { text-align: right; white-space: nowrap; }
    th.col-center, td.col-center { text-align: center; }
    td { padding: 7px 8px; border-bottom: 1px solid ${theme.border}; font-variant-numeric: tabular-nums; color: ${theme.text}; }
    /* Gold-light title bar + header row — Entity Dashboard card accent. A solid dark
       navy fill here renders as a black blob in the html2canvas PDF capture, so this
       uses the same light-background pattern as every other section header instead. */
    .section-h-navy {
      background: #EEF0FF;
      color: #1A1D29;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 8px 18px;
      margin: -16px -18px 12px -18px;
      border-left: 4px solid #5B5FEF;
      border-radius: 0;
    }
    .table-navy th {
      background: #1A1D29;
      color: #FFFFFF;
      border-bottom: none;
    }
    tr.alt td { background: ${theme.cardBg === '#FFFFFF' ? theme.rowHeaderBg : 'rgba(247, 241, 230, 0.6)'}; }
    tr.row-header td {
      background: ${theme.rowHeaderBg};
      color: ${theme.rowHeaderText};
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 11px;
    }
    tr.row-total td {
      background: ${theme.rowTotalBg};
      color: ${theme.text};
      font-weight: 600;
      border-top: 2px solid ${theme.strongBorder};
    }
    tr.row-net td {
      background: ${theme.rowNetBg};
      color: ${theme.text};
      font-weight: 700;
      border-top: 2px solid ${theme.strongBorder};
      border-bottom: 3px double ${theme.strongBorder};
    }
    .alerts-block { margin-bottom: 16px; }
    .alert-card {
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 8px;
      border: 1px solid ${theme.border};
      border-left-width: 4px;
      background: ${theme.cardBg};
      break-inside: avoid;
    }
    .alert-card.critical { border-left-color: ${theme.negative}; background: #FFF5F5; }
    .alert-card.warning { border-left-color: #F5A623; background: #FFFBF0; }
    .alert-card.info { border-left-color: #2F80ED; background: #F0F6FF; }
    .alert-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; color: ${theme.text}; }
    .alert-text { font-size: 12px; color: ${theme.muted}; line-height: 1.45; }
    .strategy-block {
      background: ${theme.cardBg};
      border: 1px solid ${theme.border};
      border-left: 4px solid ${theme.accent};
      border-radius: 12px;
      padding: 18px 22px;
      margin-top: 16px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .strategy-title { font-size: 15px; font-weight: 700; color: ${theme.sectionHeaderText}; margin-bottom: 10px; }
    .strategy-commentary { font-size: 13px; line-height: 1.65; color: ${theme.text}; margin-bottom: 14px; }
    .strategy-actions { font-size: 13px; line-height: 1.6; padding-left: 18px; color: ${theme.text}; }
    .strategy-actions li { margin-bottom: 6px; }
    .footer {
      margin-top: 18px;
      padding: ${theme.footerBg === 'transparent' ? '0' : '8px 12px'};
      background: ${theme.footerBg};
      font-size: 10px;
      color: ${theme.mutedLight};
      text-align: ${theme.footerBg === 'transparent' ? 'right' : 'left'};
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .footer .watermark { letter-spacing: 1.5px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header-band">
    <div class="brand">EstateCFO</div>
    <div class="section-name">${esc(payload.sectionTitle)}</div>
    <div class="meta">
      <span>${esc(payload.entityLabel)}</span>
      <span>${esc(payload.periodLabel)}</span>
      <span>Generated ${esc(new Date(payload.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</span>
    </div>
  </div>

  ${bodyContent}

  <div class="footer">
    <span>${esc(payload.sourceNote)}</span>
    <span class="watermark">CONFIDENTIAL</span>
  </div>
</body>
</html>`;
}
