import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { ParchmentKpiTile } from '../ui/ParchmentKpiTile';
import type { FinItem, LiveFin } from '../../utils/financialRatioCalc';
import { debtRatiosFromLoanTracker } from '../../utils/rentalKpiEngine';
import { fmtMarginPctCapped } from '../../utils/rentalKpiEngine';

function getYV(items: FinItem[], pat: RegExp, year: number): number {
  return items.find(i => pat.test(i.label))?.values[year] ?? 0;
}
function sumI(items: FinItem[], pat: RegExp, year: number): number {
  return items.filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label)).reduce((s, i) => s + (i.values[year] ?? 0), 0);
}
function fmtV(n: number) {
  if (n === 0) return '—';
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `$${(a / 1_000_000).toFixed(2)}M` : a >= 1_000 ? `$${(a / 1_000).toFixed(0)}K` : `$${a.toFixed(0)}`;
  return n < 0 ? `(${s})` : s;
}

export function LiveFinancialSummary({ fin, activeYear, totalDebt }: { fin: LiveFin; activeYear?: number; totalDebt?: number | null }) {
  const lastY = activeYear && fin.years.includes(activeYear) ? activeYear : fin.years[fin.years.length - 1];
  const lastYIdx = fin.years.indexOf(lastY);
  const prevY = lastYIdx > 0 ? fin.years[lastYIdx - 1] : null;
  const pl = fin.pl;
  const bs = fin.bs;
  const totalRevenue = getYV(pl, /^total\s+(for\s+)?income$/i, lastY) || sumI(pl, /income|revenue|rent|sales/i, lastY);
  const totalExpenses = getYV(pl, /^total\s+(for\s+)?expenses?$/i, lastY);
  const netIncome = getYV(pl, /^net\s+income$/i, lastY);
  const interestExpense = Math.abs(sumI(pl, /interest/i, lastY));
  const noi = totalRevenue - totalExpenses + interestExpense;
  const totalAssets = getYV(bs, /^total\s+(for\s+)?assets$/i, lastY);
  const equity = getYV(bs, /^total\s+(for\s+)?equity$/i, lastY);
  const cash = getYV(bs, /^total\s+(for\s+)?bank/i, lastY) || sumI(bs, /^bank|checking|savings/i, lastY);
  const buildings = Math.abs(
    getYV(bs, /^buildings$/i, lastY) ||
    getYV(bs, /^property\s*(and|&)?\s*equipment/i, lastY) ||
    getYV(bs, /^fixed\s*assets/i, lastY) ||
    getYV(bs, /^land\s*(and|&)?\s*buildings/i, lastY) ||
    getYV(bs, /^wwbl\s*\(land\)/i, lastY) ||
    getYV(bs, /^real\s+estate/i, lastY)
  );
  const loans = Math.abs(getYV(bs, /^total\s+for\s+long.term/i, lastY) || sumI(bs, /long.term.*loan|business\s+loan/i, lastY));
  const kLike = {
    noi, totalRevenue, netIncome, totalExpenses, interestExpense, equity, totalAssets,
    totalLiabilities: 0, rentalIncome: 0, managementFee: 0, repairs: 0, cash, buildings,
    longTermLoans: loans, depreciation: 0, securityDeposits: 0, legalFees: 0,
    utilities: 0, hoa: 0, propertyTax: 0, insurance: 0, accumDep: 0, otherOpex: 0,
  };
  const noiM = totalRevenue > 0 ? noi / totalRevenue * 100 : 0;
  const netM = totalRevenue > 0 ? netIncome / totalRevenue * 100 : 0;
  const ltv = buildings > 0 ? loans / buildings * 100 : 0;
  const { debtToEquity: dte } = debtRatiosFromLoanTracker(totalDebt ?? null, kLike);
  const iCov = interestExpense > 0 ? noi / interestExpense : 0;
  const expR = totalRevenue > 0 ? totalExpenses / totalRevenue * 100 : 0;

  const trendRows = fin.years.map(y => {
    const rev = getYV(pl, /^total\s+(for\s+)?income$/i, y) || sumI(pl, /income|revenue|rent|sales/i, y);
    const exp = getYV(pl, /^total\s+(for\s+)?expenses?$/i, y);
    const ni = getYV(pl, /^net\s+income$/i, y);
    const ie = Math.abs(sumI(pl, /interest/i, y));
    const n = rev - exp + ie;
    return { year: String(y), NOI: n, Revenue: rev, 'Net Income': ni, 'NOI Margin %': rev > 0 ? +(n / rev * 100).toFixed(1) : 0 };
  });

  const prevRevenue = prevY ? (getYV(pl, /^total\s+(for\s+)?income$/i, prevY) || sumI(pl, /income|revenue|rent|sales/i, prevY)) : null;
  const revGrowth = prevRevenue && prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue * 100) : null;

  const metrics = [
    { label: 'NOI Margin', value: totalRevenue > 0 ? fmtMarginPctCapped(noiM) : '—', accent: noiM >= 0, warn: noiM < 0 && noiM >= -100, danger: noiM < -100 },
    { label: 'Net Margin', value: `${netM.toFixed(1)}%`, warn: netM < 0 },
    { label: 'Revenue', value: fmtV(totalRevenue) },
    { label: 'NOI', value: fmtV(noi), warn: noi < 0 },
    { label: 'LTV', value: ltv > 0 ? `${ltv.toFixed(1)}%` : buildings === 0 ? 'No asset value' : '—', warn: ltv > 85 },
    { label: 'Int. Coverage', value: iCov > 0 ? `${iCov.toFixed(2)}x` : '—', warn: iCov > 0 && iCov < 1.2 },
    { label: 'D/E Ratio', value: dte != null ? `${dte.toFixed(1)}x` : '— no loan data', warn: dte != null && dte > 6 },
    { label: 'Expense Ratio', value: expR > 0 ? `${expR.toFixed(1)}%` : '—', warn: expR > 70 },
    { label: 'Cash', value: fmtV(cash), warn: cash <= 0 },
    { label: 'Total Assets', value: fmtV(totalAssets) },
    { label: 'Equity', value: fmtV(equity), warn: equity <= 0 },
    { label: 'Revenue Growth', value: revGrowth !== null ? `${revGrowth >= 0 ? '+' : ''}${revGrowth.toFixed(1)}%` : 'N/A', warn: revGrowth !== null && revGrowth < 0 },
  ];

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 12, padding: 20 }} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#92400E' }}>
            Live Data — {fin.company_name}
          </span>
          <p style={{ fontSize: 12, color: '#A8A29E', marginTop: 4 }}>
            {fin.filename} · Latest year: <strong style={{ color: '#1C1917' }}>{lastY}</strong> · {fin.years.length} years of data
          </p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {fin.years.map(y => (
            <span key={y} style={{
              fontSize: 11, background: '#F7F8FA', color: '#78716C',
              border: '1px solid #E8E9ED', borderRadius: 20, padding: '3px 10px', fontWeight: 600,
            }}>
              {y}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {metrics.map(m => (
          <ParchmentKpiTile
            key={m.label}
            label={m.label}
            value={m.value}
            accent={'accent' in m && !!m.accent}
            warn={'warn' in m && !!m.warn}
            danger={'danger' in m && !!m.danger}
            compact
          />
        ))}
      </div>

      {trendRows.length >= 2 && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Multi-Year P&amp;L Trend</p>
          <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 12 }}>Revenue, NOI, and Net Income across all available years</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendRows} margin={{ left: 20, right: 10, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#78716C' }} />
              <YAxis tickFormatter={v => fmtV(v as number)} tick={{ fontSize: 10, fill: '#78716C' }} />
              <Tooltip
                formatter={(v: number) => fmtV(v)}
                contentStyle={{ background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 8, fontSize: 13 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#78716C' }} />
              <Line type="monotone" dataKey="Revenue" stroke="#5B5FEF" strokeWidth={2} dot={{ r: 3, fill: '#5B5FEF' }} />
              <Line type="monotone" dataKey="NOI" stroke="#4F46E5" strokeWidth={2} dot={{ r: 3, fill: '#4F46E5' }} />
              <Line type="monotone" dataKey="Net Income" stroke="#8B6914" strokeWidth={1.5} strokeDasharray="5 3" dot={{ r: 3, fill: '#8B6914' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
