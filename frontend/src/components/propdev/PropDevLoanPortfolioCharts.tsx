import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, LabelList } from 'recharts';
import { fmtUSD } from '../ProtectedRoute';
import { PT } from '../../theme/parchmentTheme';
import { PROPDEV_MARKET_RATE } from '../../hooks/usePropDevLoanTrackerData';

interface Props {
  scopeLabel: string;
  debtByProperty: { name: string; value: number; label: string }[];
  emiByBank: { name: string; value: number }[];
  maturityLadder: { year: string; amount: number }[];
  rateVariance: { name: string; bps: number; rate: number }[];
}

export default function PropDevLoanPortfolioCharts({
  scopeLabel,
  debtByProperty,
  emiByBank,
  maturityLadder,
  rateVariance,
}: Props) {
  const hasData = debtByProperty.length > 0 || emiByBank.length > 0;
  if (!hasData) return null;

  const nowYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">
        {scopeLabel} — aggregated from the same loan records as the entity detail view
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text, marginBottom: 4 }}>Debt by Property</h3>
          <p style={{ fontSize: 12, color: PT.muted, marginBottom: 16 }}>Outstanding balance ranked highest to lowest</p>
          {debtByProperty.length === 0 ? (
            <p style={{ fontSize: 13, color: PT.muted }}>No loan data</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, debtByProperty.length * 38)}>
              <BarChart data={debtByProperty} layout="vertical" margin={{ left: 0, right: 60, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PT.border} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: PT.muted }} tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12, fill: PT.text }} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} labelFormatter={(_l, payload) => payload?.[0]?.payload?.name ?? ''} />
                <Bar dataKey="value" name="Balance" radius={[0, 4, 4, 0]}>
                  {debtByProperty.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#5B5FEF' : i === 1 ? '#F2C94C' : '#E8E9ED'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text, marginBottom: 16 }}>EMI Breakdown by Lender</h3>
          {emiByBank.length === 0 ? (
            <p style={{ fontSize: 13, color: PT.muted }}>No EMI data</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={emiByBank} margin={{ left: 0, right: 10, top: 16, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PT.border} />
                <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11, fill: PT.muted }} />
                <YAxis tick={{ fontSize: 11, fill: PT.muted }} tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} />
                <Bar dataKey="value" fill="#5B5FEF" name="Monthly EMI" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="value" position="top" formatter={(v: number) => fmtUSD(v)} style={{ fontSize: 10, fill: PT.text }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text, marginBottom: 4 }}>Maturity Ladder</h3>
          <p style={{ fontSize: 12, color: PT.muted, marginBottom: 16 }}>Total debt maturing per calendar year</p>
          {maturityLadder.length === 0 ? (
            <p style={{ fontSize: 13, color: PT.muted }}>No maturity dates recorded</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={maturityLadder} margin={{ left: 0, right: 10, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PT.border} />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: PT.muted }} />
                <YAxis tick={{ fontSize: 11, fill: PT.muted }} tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} labelFormatter={l => `Year ${l}`} />
                <Bar dataKey="amount" name="Maturing Balance" radius={[4, 4, 0, 0]}>
                  {maturityLadder.map((d, i) => {
                    const yr = parseInt(String(d.year), 10);
                    return (
                      <Cell
                        key={i}
                        fill={yr - nowYear <= 1 ? '#C0392B' : yr - nowYear <= 2 ? '#F2C94C' : '#5B5FEF'}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: PT.text, marginBottom: 4 }}>
            Rate Variance vs Market ({PROPDEV_MARKET_RATE.toFixed(1)}%)
          </h3>
          <p style={{ fontSize: 12, color: PT.muted, marginBottom: 16 }}>
            Basis points above (↑ costly) or below (↓ good) the {PROPDEV_MARKET_RATE.toFixed(1)}% benchmark
          </p>
          {rateVariance.length === 0 ? (
            <p style={{ fontSize: 13, color: PT.muted }}>No interest rate data</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={rateVariance} margin={{ left: 0, right: 10, top: 8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PT.border} />
                <XAxis dataKey="name" angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11, fill: PT.muted }} />
                <YAxis tick={{ fontSize: 11, fill: PT.muted }} tickFormatter={v => `${Number(v) > 0 ? '+' : ''}${v}bps`} />
                <Tooltip formatter={(v: number) => [`${Number(v) > 0 ? '+' : ''}${v} bps`, 'Rate vs Market']} />
                <ReferenceLine y={0} stroke={PT.border} strokeWidth={2} />
                <Bar dataKey="bps" name="Rate vs Market" radius={[4, 4, 0, 0]}>
                  {rateVariance.map((d, i) => (
                    <Cell key={i} fill={d.bps <= 0 ? '#166534' : d.bps <= 50 ? '#F2C94C' : '#C0392B'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
