/**
 * Smoke-test pptxgenjs charts used by CEO Board Review (Node-safe).
 * Run: node scripts/smokeCeoPptCharts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, '..', 'tmp-ceo-board-charts.pptx');

const C = {
  gold: 'D4AF37', green: '166534', amber: 'F5A623', red: 'B91C1C',
  blue: '1F6FEB', teal: '0F766E', parchment: 'FBF6EE',
};

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';

{
  const s = pptx.addSlide();
  s.addText('Slide 3 charts', { x: 0.4, y: 0.2, w: 9, h: 0.3 });
  s.addChart(pptx.ChartType.doughnut, [{ name: 'Units', labels: ['Occupied', 'Vacant'], values: [106, 27] }], {
    x: 0.4, y: 0.7, w: 4, h: 3.5, chartColors: [C.green, C.amber], holeSize: 55, showPercent: true,
  });
  s.addChart(pptx.ChartType.bar, [{ name: 'Units', labels: ['N', 'S', 'E', 'W'], values: [40, 35, 30, 28] }], {
    x: 5, y: 0.7, w: 4.5, h: 3.5, barDir: 'col', chartColors: [C.gold],
  });
}

{
  const s = pptx.addSlide();
  s.addText('Slide 4 combo', { x: 0.4, y: 0.2, w: 9, h: 0.3 });
  const labels = ['Mar', 'Apr', 'May', 'Jun'];
  s.addChart([
    {
      type: pptx.ChartType.bar,
      data: [
        { name: 'GPR', labels, values: [170, 175, 178, 180] },
        { name: 'Collected', labels, values: [150, 152, 154, 155] },
      ],
      options: { barDir: 'col', chartColors: [C.gold, C.green] },
    },
    {
      type: pptx.ChartType.line,
      data: [{ name: 'Occupancy %', labels, values: [78, 79, 80, 79.7] }],
      options: { lineSize: 2, chartColors: [C.blue], secondaryValAxis: true },
    },
  ], { x: 0.4, y: 0.7, w: 9, h: 4, secondaryValAxis: true });
}

{
  const s = pptx.addSlide();
  s.addText('Slide 5 waterfall + trend', { x: 0.4, y: 0.2, w: 9, h: 0.3 });
  s.addChart(pptx.ChartType.bar, [
    { name: 'Base', labels: ['GPR', 'Opex', 'NOI', 'Int', 'NI'], values: [0, 55, 0, 37, 0] },
    { name: 'Amount', labels: ['GPR', 'Opex', 'NOI', 'Int', 'NI'], values: [155, 100, 55, 18, 37] },
  ], {
    x: 0.4, y: 0.7, w: 4.4, h: 4, barDir: 'col', barGrouping: 'stacked',
    chartColors: [C.parchment, C.gold], showLegend: false,
  });
  const m = ['Mar', 'Apr', 'May', 'Jun'];
  s.addChart([
    {
      type: pptx.ChartType.bar,
      data: [
        { name: 'Revenue', labels: m, values: [170, 175, 178, 180] },
        { name: 'Expenses', labels: m, values: [100, 102, 101, 100] },
      ],
      options: { barDir: 'col', chartColors: [C.gold, C.red] },
    },
    {
      type: pptx.ChartType.line,
      data: [{ name: 'NOI', labels: m, values: [50, 52, 54, 55] }],
      options: { lineSize: 2, chartColors: [C.green] },
    },
  ], { x: 5.1, y: 0.7, w: 4.4, h: 4 });
}

{
  const s = pptx.addSlide();
  s.addText('Slide 6 cash line', { x: 0.4, y: 0.2, w: 9, h: 0.3 });
  s.addChart(pptx.ChartType.line, [{
    name: 'Cash', labels: ['Mar', 'Apr', 'May', 'Jun'], values: [180, 190, 200, 220],
  }], { x: 0.5, y: 0.7, w: 9, h: 4, chartColors: [C.blue], lineSize: 3 });
}

{
  const s = pptx.addSlide();
  s.addText('Slide 8 DSCR/LTV', { x: 0.4, y: 0.2, w: 9, h: 0.3 });
  const props = ['N', 'S', 'E', 'W'];
  s.addChart([
    {
      type: pptx.ChartType.bar,
      data: [{ name: 'DSCR', labels: props, values: [1.05, 1.4, 1.25, 0.95] }],
      options: { barDir: 'col', chartColors: [C.teal] },
    },
    {
      type: pptx.ChartType.line,
      data: [{ name: '1.2x', labels: props, values: [1.2, 1.2, 1.2, 1.2] }],
      options: { lineSize: 2, chartColors: [C.red] },
    },
  ], { x: 0.4, y: 0.7, w: 4.5, h: 4 });
  s.addChart(pptx.ChartType.bar, [
    { name: 'Healthy', labels: props, values: [0, 55, 68, 0] },
    { name: 'At Risk', labels: props, values: [78, 0, 0, 82] },
  ], { x: 5.2, y: 0.7, w: 4.4, h: 4, barDir: 'col', chartColors: [C.gold, C.red] });
}

{
  const s = pptx.addSlide();
  s.addText('Slide 9 ownership + Slide 10 scatter', { x: 0.4, y: 0.2, w: 9, h: 0.3 });
  s.addChart(pptx.ChartType.doughnut, [{
    name: 'Own', labels: ['A', 'B', 'C'], values: [4, 3, 2],
  }], { x: 0.4, y: 0.7, w: 4, h: 3.5, chartColors: [C.gold, C.blue, C.green], holeSize: 55 });
  s.addChart(pptx.ChartType.scatter, [
    { name: 'X-Axis', values: [82, 91, 75, 70] },
    { name: 'NOI Margin', values: [28, 32, 18, 12], labels: [['N', 'S', 'E', 'W']] },
  ], {
    x: 5, y: 0.7, w: 4.5, h: 3.5, chartColors: [C.teal],
    lineDataSymbol: 'circle', lineDataSymbolSize: 10, lineSize: 0, showLabel: false,
  });
}

const buf = await pptx.write({ outputType: 'nodebuffer' });
fs.writeFileSync(out, buf);

const zip = await JSZip.loadAsync(buf);
const chartFiles = Object.keys(zip.files).filter(f => /ppt\/charts\/chart\d+\.xml$/i.test(f));
const hasDrawing = Object.keys(zip.files).some(f => /ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(f));

let emptyCharts = 0;
for (const cf of chartFiles) {
  const xml = await zip.file(cf).async('string');
  if (!xml.includes('<c:chart') || xml.length < 500) emptyCharts += 1;
}

console.log(JSON.stringify({
  ok: emptyCharts === 0 && chartFiles.length >= 8,
  file: out,
  bytes: buf.length,
  chartCount: chartFiles.length,
  emptyCharts,
  hasDrawing,
}, null, 2));

if (!chartFiles.length) process.exit(1);
