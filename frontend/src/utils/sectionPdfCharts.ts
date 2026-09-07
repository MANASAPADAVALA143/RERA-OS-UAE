/** Inline SVG chart builders for section PDF exports — vector charts, not screenshots. */

const C = {
  pageBg: '#F7F8FA',
  cardBg: '#FFFFFF',
  border: '#E8E9ED',
  gold: '#5B5FEF',
  text: '#1C1917',
  muted: '#78716C',
  green: '#166534',
  teal: '#0F766E',
  red: '#B91C1C',
  amber: '#F5A623',
  blue: '#1F6FEB',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtK(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

function fmtPct(v: number): string {
  return `${v.toFixed(0)}%`;
}

/**
 * Largest-remainder rounding: rounds each share to a whole percent so the
 * displayed slices always sum to exactly 100%, instead of each slice rounding
 * independently (which can make the total read 101% or a single slice read
 * one point higher/lower than its true share, e.g. 86% instead of 85%).
 */
function roundPercentsTo100(fracs: number[]): number[] {
  const raw = fracs.map(f => f * 100);
  const floors = raw.map(Math.floor);
  let remainder = Math.max(0, 100 - floors.reduce((a, b) => a + b, 0));
  const order = raw
    .map((v, i) => ({ i, rem: v - floors[i] }))
    .sort((a, b) => b.rem - a.rem);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    result[order[k].i]! += 1;
  }
  return result;
}

interface ChartOpts {
  width?: number;
  height?: number;
  /** @deprecated Ignored for PDF donuts — card HTML owns the section title. */
  title?: string;
  subtitle?: string;
  /** Cap for horizontal bar rows (default 8). */
  maxItems?: number;
  /** Smaller donut + legend for PDF mix cards (Expense / Revenue Breakdown). */
  compact?: boolean;
  /** Y-axis tick format for line/bar charts. Default 'currency' ($44, $-8k). */
  valueFormat?: 'currency' | 'percent';
}

function signedBounds(values: number[]): { min: number; max: number } {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  if (min === max) return { min: Math.min(0, min), max: Math.max(1, max) };
  return { min, max };
}

function signedY(value: number, min: number, max: number, padT: number, chartH: number): number {
  const span = Math.max(1, max - min);
  return padT + chartH - ((value - min) / span) * chartH;
}

export function svgGroupedBarChart(
  labels: string[],
  series: { name: string; values: number[]; color: string }[],
  opts: ChartOpts = {},
): string {
  const W = opts.width ?? 520;
  const H = opts.height ?? 220;
  const padL = 48;
  const padR = 12;
  // Card HTML already shows the title — SVG only draws a legend row (no stacked title).
  const padT = 28;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxVal = Math.max(1, ...series.flatMap(s => s.values));
  const groupW = chartW / Math.max(labels.length, 1);
  const barW = Math.min(18, (groupW - 8) / Math.max(series.length, 1));

  let bars = '';
  labels.forEach((lbl, gi) => {
    const gx = padL + gi * groupW + groupW / 2;
    series.forEach((s, si) => {
      const v = s.values[gi] ?? 0;
      const bh = (v / maxVal) * chartH;
      const x = gx - (series.length * barW) / 2 + si * barW;
      const y = padT + chartH - bh;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${s.color}" rx="2"/>`;
    });
    const tx = gx;
    bars += `<text x="${tx}" y="${H - 8}" text-anchor="middle" font-size="13" fill="${C.muted}">${esc(lbl.slice(0, 6))}</text>`;
  });

  const yTicks = [0, maxVal * 0.5, maxVal].map(v => {
    const y = padT + chartH - (v / maxVal) * chartH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${C.border}" stroke-width="1"/>
      <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtK(v)}</text>`;
  }).join('');

  const legend = series.map((s, i) =>
    `<rect x="${padL + i * 90}" y="8" width="10" height="10" fill="${s.color}" rx="2"/>
     <text x="${padL + i * 90 + 14}" y="17" font-size="13" fill="${C.muted}">${esc(s.name)}</text>`,
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${legend}
    ${yTicks}
    <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="${C.border}" stroke-width="1"/>
    ${bars}
  </svg>`;
}

export function svgLineChart(
  labels: string[],
  series: { name: string; values: number[]; color: string; dashed?: boolean }[],
  opts: ChartOpts = {},
): string {
  const W = opts.width ?? 520;
  const H = opts.height ?? 200;
  const padL = 48;
  const padR = 12;
  const padT = series.length > 1 ? 28 : 16;
  const padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxVal = Math.max(1, ...series.flatMap(s => s.values));
  const step = labels.length > 1 ? chartW / (labels.length - 1) : chartW;

  const lines = series.map(s => {
    const pts = s.values.map((v, i) => {
      const x = padL + i * step;
      const y = padT + chartH - (v / maxVal) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const dash = s.dashed ? ' stroke-dasharray="5 3"' : '';
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"${dash}/>`;
  }).join('');

  const xLabels = labels.map((lbl, i) => {
    const x = padL + i * step;
    return `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="13" fill="${C.muted}">${esc(lbl.slice(0, 5))}</text>`;
  }).join('');

  const yTicks = [0, maxVal].map(v => {
    const y = padT + chartH - (v / maxVal) * chartH;
    return `<text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtK(v)}</text>`;
  }).join('');

  const legend = series.length > 1
    ? series.map((s, i) =>
      `<rect x="${padL + i * 100}" y="8" width="10" height="10" fill="${s.color}" rx="2"/>
       <text x="${padL + i * 100 + 14}" y="17" font-size="13" fill="${C.muted}">${esc(s.name)}</text>`,
    ).join('')
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${legend}
    <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="${C.border}" stroke-width="1"/>
    ${yTicks}${lines}${xLabels}
  </svg>`;
}

export function svgBarChart(
  labels: string[],
  values: number[],
  color: string,
  opts: ChartOpts = {},
): string {
  return svgGroupedBarChart(labels, [{ name: opts.title ?? 'Value', values, color }], opts);
}

export function svgComboBarLine(
  labels: string[],
  barValues: number[],
  lineValues: number[],
  opts: ChartOpts & { barLabel?: string; lineLabel?: string } = {},
): string {
  const W = opts.width ?? 520;
  const H = opts.height ?? 220;
  const padL = 48;
  const padR = 44;
  // Legend only — card HTML owns the chart title (avoids stacked overlapping labels).
  const padT = 28;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxBar = Math.max(1, ...barValues);
  const maxLine = Math.max(1, ...lineValues, 100);
  const groupW = chartW / Math.max(labels.length, 1);
  const barW = Math.min(28, groupW * 0.55);

  let content = '';
  labels.forEach((lbl, i) => {
    const gx = padL + i * groupW + groupW / 2;
    const v = barValues[i] ?? 0;
    const bh = (v / maxBar) * chartH;
    const x = gx - barW / 2;
    const y = padT + chartH - bh;
    content += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${C.gold}" opacity="0.85" rx="2"/>`;
    content += `<text x="${gx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(lbl.slice(0, 8))}</text>`;
  });

  const linePts = lineValues.map((v, i) => {
    const x = padL + i * groupW + groupW / 2;
    const y = padT + chartH - (v / maxLine) * chartH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  lineValues.forEach((v, i) => {
    const x = padL + i * groupW + groupW / 2;
    const y = padT + chartH - (v / maxLine) * chartH;
    content += `<circle cx="${x}" cy="${y}" r="3" fill="${C.blue}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    <rect x="${padL + 4}" y="8" width="10" height="10" fill="${C.gold}" rx="2"/>
    <text x="${padL + 18}" y="17" font-size="13" fill="${C.muted}">${esc(opts.barLabel ?? 'Lost Rent')}</text>
    <circle cx="${padL + 110}" cy="13" r="4" fill="${C.blue}"/>
    <text x="${padL + 118}" y="17" font-size="13" fill="${C.muted}">${esc(opts.lineLabel ?? 'Occupancy %')}</text>
    <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="${C.border}" stroke-width="1"/>
    <text x="${padL - 4}" y="${padT + 8}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtK(maxBar)}</text>
    <text x="${W - 6}" y="${padT + 8}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtPct(maxLine)}</text>
    ${content}
    <polyline points="${linePts}" fill="none" stroke="${C.blue}" stroke-width="2"/>
  </svg>`;
}

export function svgMultiBarLineChart(
  labels: string[],
  bars: { name: string; values: number[]; color: string }[],
  line: { name: string; values: number[]; color: string },
  opts: ChartOpts = {},
): string {
  const W = opts.width ?? 520;
  const H = opts.height ?? 220;
  const padL = 52;
  const padR = 48;
  const padT = 32;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxBar = Math.max(1, ...bars.flatMap(s => s.values.map(v => Math.abs(v))));
  const minLine = Math.min(0, ...line.values);
  const maxLine = Math.max(Math.abs(minLine), ...line.values.map(v => Math.abs(v)), 1);
  const lineLo = Math.min(0, minLine);
  const lineHi = Math.max(maxLine, 1);
  const lineSpan = Math.max(1, lineHi - lineLo);
  const groupW = chartW / Math.max(labels.length, 1);
  const barW = Math.min(18, (groupW - 8) / Math.max(bars.length, 1));
  const lineIsPct = /%|ltlv|ltv|ratio|margin/i.test(line.name);
  const fmtRight = (v: number) => (lineIsPct ? `${Math.round(v)}%` : fmtK(v));

  let content = '';
  labels.forEach((lbl, gi) => {
    const gx = padL + gi * groupW + groupW / 2;
    bars.forEach((s, si) => {
      const v = s.values[gi] ?? 0;
      const bh = (Math.abs(v) / maxBar) * chartH;
      const x = gx - (bars.length * barW) / 2 + si * barW;
      const y = padT + chartH - bh;
      content += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${s.color}" rx="2"/>`;
    });
    content += `<text x="${gx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(lbl.slice(0, 10))}</text>`;
  });

  const linePts = line.values.map((v, i) => {
    const x = padL + i * groupW + groupW / 2;
    const y = padT + chartH - ((v - lineLo) / lineSpan) * chartH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  line.values.forEach((v, i) => {
    const x = padL + i * groupW + groupW / 2;
    const y = padT + chartH - ((v - lineLo) / lineSpan) * chartH;
    content += `<circle cx="${x}" cy="${y}" r="3" fill="${line.color}"/>`;
  });

  // Legend: space items by label length so "Improvements/WIP" never overlaps "LTLV %".
  let legendX = padL;
  const legendParts: string[] = [];
  bars.forEach(s => {
    const itemW = Math.max(72, 18 + s.name.length * 6.8);
    legendParts.push(
      `<rect x="${legendX}" y="8" width="10" height="10" fill="${s.color}" rx="2"/>
       <text x="${legendX + 14}" y="17" font-size="12" fill="${C.muted}">${esc(s.name)}</text>`,
    );
    legendX += itemW;
  });
  {
    const itemW = Math.max(64, 20 + line.name.length * 6.8);
    legendParts.push(
      `<circle cx="${legendX + 5}" cy="13" r="4" fill="${line.color}"/>
       <text x="${legendX + 14}" y="17" font-size="12" fill="${C.muted}">${esc(line.name)}</text>`,
    );
    void itemW;
  }
  const legend = legendParts.join('');

  const leftTicks = [0, maxBar * 0.5, maxBar].map(v => {
    const y = padT + chartH - (v / maxBar) * chartH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${C.border}" stroke-width="1"/>
      <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtK(v)}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${legend}
    ${leftTicks}
    <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="${C.border}" stroke-width="1"/>
    <text x="${W - 6}" y="${padT + 8}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtRight(lineHi)}</text>
    <text x="${W - 6}" y="${padT + chartH + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtRight(lineLo)}</text>
    ${content}
    <polyline points="${linePts}" fill="none" stroke="${line.color}" stroke-width="2"/>
  </svg>`;
}

export function svgHorizontalBarChart(
  items: { label: string; value: number; color: string }[],
  opts: ChartOpts & { valueFormat?: 'money' | 'pct'; labelChars?: number } = {},
): string {
  const W = opts.width ?? 520;
  const rowH = 24;
  const H = opts.height ?? Math.max(220, items.length * rowH + 74);
  // Keep leading words visible (Memberships / Accounting / Bank…) — previous padL≈104
  // clipped the start of right-anchored labels outside the SVG viewBox.
  const maxLabelChars = opts.labelChars ?? 24;
  const padL = Math.max(148, Math.min(240, Math.round(maxLabelChars * 7.4 + 20)));
  const padR = 48;
  const padT = 20;
  const padB = 28;
  const chartW = W - padL - padR;
  const maxVal = Math.max(1, ...items.map(i => i.value));
  const rows = items.slice(0, opts.maxItems ?? 8);
  const fmt = opts.valueFormat === 'pct' ? fmtPct : fmtK;

  const ticks = [0.25, 0.5, 0.75, 1].map(r => {
    const x = padL + chartW * r;
    return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="${C.border}" stroke-dasharray="3 3"/>
      <text x="${x}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.muted}">${fmt(maxVal * r)}</text>`;
  }).join('');

  const bars = rows.map((item, i) => {
    const y = padT + i * rowH;
    const w = (item.value / maxVal) * chartW;
    const label = item.label.length > maxLabelChars
      ? `${item.label.slice(0, maxLabelChars - 1).trimEnd()}…`
      : item.label;
    return `
      <text x="${padL - 8}" y="${y + 11}" text-anchor="end" font-size="12" fill="${C.text}">${esc(label)}</text>
      <rect x="${padL}" y="${y}" width="${w.toFixed(1)}" height="14" fill="${item.color}" rx="2"/>
      <text x="${(padL + w + 4).toFixed(1)}" y="${y + 11}" font-size="11" fill="${C.muted}">${esc(fmt(item.value))}</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${ticks}
    ${bars}
  </svg>`;
}

/**
 * Horizontal signed bars (project names on Y, value on X) — for 20 categorical items
 * without overlapping x-axis labels. Supports money or percent tick labels.
 */
export function svgSignedHorizontalBarChart(
  items: { label: string; value: number; color: string }[],
  opts: ChartOpts & { valueFormat?: 'money' | 'pct' } = {},
): string {
  const W = opts.width ?? 520;
  const rowH = 22;
  const rows = items.slice(0, opts.maxItems ?? 24);
  const H = opts.height ?? Math.max(240, rows.length * rowH + 56);
  const padL = 152;
  const padR = 64;
  const padT = 16;
  const padB = 28;
  const chartW = W - padL - padR;
  const { min, max } = signedBounds(rows.map(r => r.value));
  const span = Math.max(1, max - min);
  const zeroX = padL + ((0 - min) / span) * chartW;
  const fmt = opts.valueFormat === 'pct'
    ? (v: number) => `${v.toFixed(0)}%`
    : fmtK;

  const tickVals = [min, 0, max].filter((v, i, arr) => arr.indexOf(v) === i);
  const ticks = tickVals.map(v => {
    const x = padL + ((v - min) / span) * chartW;
    return `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${H - padB}" stroke="${C.border}" stroke-dasharray="3 3"/>
      <text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(fmt(v))}</text>`;
  }).join('');

  const bars = rows.map((item, i) => {
    const y = padT + i * rowH;
    const xVal = padL + ((item.value - min) / span) * chartW;
    const left = Math.min(zeroX, xVal);
    const w = Math.max(1.5, Math.abs(xVal - zeroX));
    const label = item.label.length > 18 ? `${item.label.slice(0, 16)}…` : item.label;

    // Keep value labels inside the plot (right of padL) so they never cover project names.
    let valueX: number;
    let valueAnchor: 'start' | 'end' | 'middle';
    if (item.value >= 0) {
      valueX = left + w + 4;
      valueAnchor = 'start';
      if (valueX > W - 8) {
        valueX = Math.max(padL + 2, left + w - 4);
        valueAnchor = 'end';
      }
    } else {
      // Negatives: put %/$ just to the RIGHT of zero (readable, no name collision).
      valueX = zeroX + 4;
      valueAnchor = 'start';
      // If almost no positive room, place inside the bar near zero instead.
      if (valueX + 36 > W - 4 && w > 40) {
        valueX = zeroX - 4;
        valueAnchor = 'end';
      }
    }
    valueX = Math.max(padL + 12, Math.min(W - 8, valueX));

    return `
      <text x="${padL - 8}" y="${y + 12}" text-anchor="end" font-size="11" fill="${C.text}">${esc(label)}</text>
      <rect x="${left.toFixed(1)}" y="${y + 3}" width="${w.toFixed(1)}" height="12" fill="${item.color}" rx="2"/>
      <text x="${valueX.toFixed(1)}" y="${y + 12}" text-anchor="${valueAnchor}" font-size="10" font-weight="600" fill="${C.text}">${esc(fmt(item.value))}</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${ticks}
    <line x1="${zeroX.toFixed(1)}" y1="${padT}" x2="${zeroX.toFixed(1)}" y2="${H - padB}" stroke="${C.border}" stroke-width="1.2"/>
    ${bars}
  </svg>`;
}

export function svgStackedBarChart(
  labels: string[],
  series: { name: string; values: number[]; color: string }[],
  opts: ChartOpts = {},
): string {
  const W = opts.width ?? 520;
  const H = opts.height ?? 220;
  const padL = 48;
  const padR = 12;
  const padT = 28;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const maxVal = Math.max(1, ...totals);
  const groupW = chartW / Math.max(labels.length, 1);
  const barW = Math.min(30, groupW * 0.6);

  let bars = '';
  labels.forEach((lbl, gi) => {
    const gx = padL + gi * groupW + groupW / 2;
    let stacked = 0;
    series.forEach(s => {
      const v = Math.max(0, s.values[gi] ?? 0);
      const bh = (v / maxVal) * chartH;
      const x = gx - barW / 2;
      const y = padT + chartH - bh - stacked;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${s.color}" rx="2"/>`;
      stacked += bh;
    });
    bars += `<text x="${gx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(lbl.slice(0, 10))}</text>`;
  });

  const yTicks = [0, maxVal * 0.5, maxVal].map(v => {
    const y = padT + chartH - (v / maxVal) * chartH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${C.border}" stroke-width="1"/>
      <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtK(v)}</text>`;
  }).join('');

  const legend = series.map((s, i) =>
    `<rect x="${padL + i * 92}" y="8" width="10" height="10" fill="${s.color}" rx="2"/>
     <text x="${padL + i * 92 + 14}" y="17" font-size="13" fill="${C.muted}">${esc(s.name)}</text>`,
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${legend}
    ${yTicks}
    <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="${C.border}" stroke-width="1"/>
    ${bars}
  </svg>`;
}

export function svgSignedLineChart(
  labels: string[],
  series: { name: string; values: number[]; color: string; dashed?: boolean }[],
  opts: ChartOpts = {},
): string {
  const W = opts.width ?? 520;
  const H = opts.height ?? 200;
  const padL = 48;
  const padR = 12;
  const padT = series.length > 1 ? 28 : 16;
  const padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const { min, max } = signedBounds(series.flatMap(s => s.values));
  const step = labels.length > 1 ? chartW / (labels.length - 1) : chartW;
  const zeroY = signedY(0, min, max, padT, chartH);

  const lines = series.map(s => {
    const pts = s.values.map((v, i) => {
      const x = padL + i * step;
      const y = signedY(v, min, max, padT, chartH);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const dots = s.values.map((v, i) => {
      const x = padL + i * step;
      const y = signedY(v, min, max, padT, chartH);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${s.color}"/>`;
    }).join('');
    const dash = s.dashed ? ' stroke-dasharray="5 3"' : '';
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"${dash}/>${dots}`;
  }).join('');

  const xLabels = labels.map((lbl, i) => {
    const x = padL + i * step;
    return `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="13" fill="${C.muted}">${esc(lbl.slice(0, 10))}</text>`;
  }).join('');

  const tickFmt = opts.valueFormat === 'percent' ? fmtPct : fmtK;
  const yVals = [min, 0, max].filter((v, i, arr) => arr.indexOf(v) === i);
  const yTicks = yVals.map(v => {
    const y = signedY(v, min, max, padT, chartH);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${v === 0 ? C.border : C.border}" stroke-width="1"/>
      <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${tickFmt(v)}</text>`;
  }).join('');

  const legend = series.length > 1
    ? series.map((s, i) =>
      `<rect x="${padL + i * 100}" y="8" width="10" height="10" fill="${s.color}" rx="2"/>
       <text x="${padL + i * 100 + 14}" y="17" font-size="13" fill="${C.muted}">${esc(s.name)}</text>`,
    ).join('')
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${legend}
    ${yTicks}
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="${C.border}" stroke-width="1.2"/>
    ${lines}${xLabels}
  </svg>`;
}

export function svgSignedGroupedBarChart(
  labels: string[],
  series: { name: string; values: number[]; color: string }[],
  opts: ChartOpts = {},
): string {
  const W = opts.width ?? 520;
  const H = opts.height ?? 220;
  const padL = 48;
  const padR = 12;
  const padT = 28;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const { min, max } = signedBounds(series.flatMap(s => s.values));
  const zeroY = signedY(0, min, max, padT, chartH);
  const groupW = chartW / Math.max(labels.length, 1);
  const barW = Math.min(18, (groupW - 8) / Math.max(series.length, 1));

  let bars = '';
  labels.forEach((lbl, gi) => {
    const gx = padL + gi * groupW + groupW / 2;
    series.forEach((s, si) => {
      const v = s.values[gi] ?? 0;
      const y = signedY(Math.max(0, v), min, max, padT, chartH);
      const yNeg = signedY(Math.min(0, v), min, max, padT, chartH);
      const x = gx - (series.length * barW) / 2 + si * barW;
      const top = Math.min(y, yNeg);
      const h = Math.abs(yNeg - y);
      bars += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}" rx="2"/>`;
    });
    bars += `<text x="${gx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(lbl.slice(0, 10))}</text>`;
  });

  const yVals = [min, 0, max].filter((v, i, arr) => arr.indexOf(v) === i);
  const yTicks = yVals.map(v => {
    const y = signedY(v, min, max, padT, chartH);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${C.border}" stroke-width="1"/>
      <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtK(v)}</text>`;
  }).join('');

  const legend = series.map((s, i) =>
    `<rect x="${padL + i * 92}" y="8" width="10" height="10" fill="${s.color}" rx="2"/>
     <text x="${padL + i * 92 + 14}" y="17" font-size="13" fill="${C.muted}">${esc(s.name)}</text>`,
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${legend}
    ${yTicks}
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="${C.border}" stroke-width="1.2"/>
    ${bars}
  </svg>`;
}

export function svgSignedStackedBarChart(
  labels: string[],
  series: { name: string; values: number[]; color: string }[],
  opts: ChartOpts = {},
): string {
  const W = opts.width ?? 520;
  const H = opts.height ?? 220;
  const padL = 48;
  const padR = 12;
  const padT = 28;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const totalsPos = labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0));
  const totalsNeg = labels.map((_, i) => series.reduce((s, x) => s + Math.min(0, x.values[i] ?? 0), 0));
  const { min, max } = signedBounds([...totalsPos, ...totalsNeg]);
  const zeroY = signedY(0, min, max, padT, chartH);
  const groupW = chartW / Math.max(labels.length, 1);
  const barW = Math.min(30, groupW * 0.6);

  let bars = '';
  labels.forEach((lbl, gi) => {
    const gx = padL + gi * groupW + groupW / 2;
    let pos = 0;
    let neg = 0;
    series.forEach(s => {
      const v = s.values[gi] ?? 0;
      const x = gx - barW / 2;
      if (v >= 0) {
        const yTop = signedY(pos + v, min, max, padT, chartH);
        const yBottom = signedY(pos, min, max, padT, chartH);
        bars += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.abs(yBottom - yTop).toFixed(1)}" fill="${s.color}" rx="2"/>`;
        pos += v;
      } else {
        const yTop = signedY(neg, min, max, padT, chartH);
        const yBottom = signedY(neg + v, min, max, padT, chartH);
        bars += `<rect x="${x.toFixed(1)}" y="${Math.min(yTop, yBottom).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.abs(yBottom - yTop).toFixed(1)}" fill="${s.color}" rx="2"/>`;
        neg += v;
      }
    });
    bars += `<text x="${gx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(lbl.slice(0, 10))}</text>`;
  });

  const yVals = [min, 0, max].filter((v, i, arr) => arr.indexOf(v) === i);
  const yTicks = yVals.map(v => {
    const y = signedY(v, min, max, padT, chartH);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${C.border}" stroke-width="1"/>
      <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmtK(v)}</text>`;
  }).join('');

  const legend = series.map((s, i) =>
    `<rect x="${padL + i * 92}" y="8" width="10" height="10" fill="${s.color}" rx="2"/>
     <text x="${padL + i * 92 + 14}" y="17" font-size="13" fill="${C.muted}">${esc(s.name)}</text>`,
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${legend}
    ${yTicks}
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="${C.border}" stroke-width="1.2"/>
    ${bars}
  </svg>`;
}

/**
 * PDF donut chart.
 * IMPORTANT: never draws opts.title — card HTML owns section headers.
 * Giant "Mix" / "Capital" / "Assets" labels came from opts.title + CSS width:100% scaling.
 * Legend is drawn below the ring (2-column), matching live-dashboard readability.
 */
export function svgDoughnut(
  slices: { label: string; value: number; color: string }[],
  opts: ChartOpts = {},
): string {
  const compact = opts.compact === true || (opts.width != null && opts.width <= 260);
  const W = opts.width ?? (compact ? 240 : 360);
  // Prefer 2-column legends so Asset Composition isn't tiny + tall empty card.
  const legendCols = slices.length <= 2 ? 1 : 2;
  const legendRowH = compact ? 15 : 18;
  const rows = Math.max(1, Math.ceil(slices.length / legendCols));
  const legendH = rows * legendRowH + (compact ? 6 : 10);
  const donutArea = compact
    ? Math.min(130, Math.max(110, Math.round(W * 0.48)))
    : Math.min(168, Math.max(130, Math.round(W * 0.55)));
  // Keep extra headroom above the ring so thick arc strokes never clip at top.
  const donutTopPad = compact ? 10 : 12;
  const legendTop = donutTopPad + donutArea + (compact ? 4 : 8);
  const minH = donutTopPad + donutArea + legendH + 4;
  const H = Math.max(minH, opts.height ?? minH);

  const cx = W / 2;
  const cy = donutTopPad + donutArea / 2;
  const r = Math.min(W * (compact ? 0.30 : 0.34), donutArea / 2 - 10);
  const ir = r * 0.52;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;

  // html2canvas is inconsistent with filled wedge paths.
  // Render a donut using ARCTROKE segments + an explicit inner "hole" circle,
  // which generally rasterizes reliably in PDF capture.
  const strokeW = Math.max(1, r - ir);
  let donut = '';
  let angle = -Math.PI / 2;
  slices.forEach(sl => {
    const frac = sl.value / total;
    if (!(frac > 0)) return;
    const sweep = frac * Math.PI * 2;
    if (sweep < 0.001) return;

    // Degenerate ~full ring: draw a solid circle and later punch the hole.
    if (sweep >= Math.PI * 2 - 0.0005) {
      donut += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${sl.color}"/>`;
      angle += sweep;
      return;
    }

    const a2 = angle + sweep;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = sweep > Math.PI ? 1 : 0;
    // Use a thick arc stroke; the center is "cut out" by the hole circle below.
    donut += `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${sl.color}" stroke-width="${strokeW.toFixed(2)}" stroke-linecap="round" shape-rendering="geometricPrecision"/>`;
    angle = a2;
  });
  const hole = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${ir.toFixed(2)}" fill="${C.cardBg}"/>`;
  const paths = `${donut}${hole}`;

  // opts.title is intentionally ignored — never render center/top labels inside the SVG.
  void opts.title;

  const colW = (W - 24) / legendCols;
  const maxLabel = legendCols === 1 ? 28 : (W < 280 ? 22 : 18);
  const legendPcts = roundPercentsTo100(slices.map(sl => sl.value / total));
  const legend = slices.map((sl, i) => {
    const col = i % legendCols;
    const row = Math.floor(i / legendCols);
    const x = 12 + col * colW;
    const y = legendTop + row * legendRowH;
    const pct = legendPcts[i];
    const label = sl.label.length > maxLabel ? `${sl.label.slice(0, maxLabel - 1)}…` : sl.label;
    return `<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${sl.color}"/>
      <text x="${x + 14}" y="${y + 9}" font-size="${compact ? 10 : 12}" fill="${C.muted}">${esc(label)} (${pct}%)</text>`;
  }).join('');

  return `<svg class="pdf-doughnut${compact ? ' pdf-doughnut-compact' : ''}" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:${W}px;height:${H}px;max-width:100%;display:block;margin:0 auto">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${paths}
    ${legend}
  </svg>`;
}

/** Semi-circle gauge for occupancy vs target (e.g. 92%). */
export function svgOccupancyGauge(
  occupancyPct: number,
  targetPct = 92,
  opts: ChartOpts = {},
): string {
  const W = opts.width ?? 260;
  const H = opts.height ?? 160;
  const cx = W / 2;
  const cy = H - 28;
  const r = 90;
  const clamp = Math.max(0, Math.min(100, occupancyPct));
  const toRad = (p: number) => Math.PI * (1 - p / 100);
  const arc = (from: number, to: number, color: string, width = 14) => {
    const a0 = toRad(from);
    const a1 = toRad(to);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    const large = to - from > 50 ? 1 : 0;
    return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  };
  const fillColor = clamp >= targetPct ? C.green : clamp >= targetPct - 10 ? C.amber : C.red;
  const tx = cx + (r + 4) * Math.cos(toRad(targetPct));
  const ty = cy - (r + 4) * Math.sin(toRad(targetPct));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${C.cardBg}" rx="8"/>
    ${arc(0, 100, C.border, 14)}
    ${clamp > 0 ? arc(0, clamp, fillColor, 14) : ''}
    <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3" fill="${C.gold}"/>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="22" font-weight="700" fill="${C.text}">${clamp.toFixed(1)}%</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="13" fill="${C.muted}">Target ${targetPct}%</text>
  </svg>`;
}
