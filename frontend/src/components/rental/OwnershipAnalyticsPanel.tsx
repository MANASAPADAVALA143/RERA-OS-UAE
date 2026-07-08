import {
  Bar, BarChart, Cell, Legend, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { useOwnershipAnalyticsData } from '../../hooks/useOwnershipAnalyticsData';
import { fmtOwnershipK, OWNERSHIP_CHART_COLORS } from '../../utils/ownershipFinancials';

const P = {
  cardBg: '#FBF6EE',
  border: '#E8DEC8',
  text: '#1C1917',
  muted: '#78716C',
} as const;

interface Props {
  entityCompanyId?: string;
  scopeLabel?: string;
}

export default function OwnershipAnalyticsPanel({ entityCompanyId = 'portfolio', scopeLabel }: Props) {
  const {
    loading, error, partners, financials, portfolioMarketValue, avgROI,
    scatterMode, setScatterMode, scatterPoints,
  } = useOwnershipAnalyticsData(entityCompanyId);

  if (loading) {
    return <p style={{ fontSize: 13, color: P.muted }}>Loading ownership analytics…</p>;
  }
  if (error) {
    return <p style={{ fontSize: 13, color: '#B91C1C' }}>{error}</p>;
  }
  if (partners.length === 0) {
    return (
      <p style={{ fontSize: 13, color: P.muted }}>
        No ownership data for {scopeLabel ?? 'this scope'}. Add partners under Rentals → Ownership.
      </p>
    );
  }

  return (
    <div style={{ background: P.cardBg, borderRadius: 12, border: `1px solid ${P.border}`, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${P.border}` }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: P.text, margin: 0 }}>Ownership Analytics</h3>
        <p style={{ fontSize: 12, color: P.muted, marginTop: 4 }}>
          {scopeLabel ? `${scopeLabel} · ` : ''}Equity distribution, return and gain/loss comparison
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px" style={{ background: P.border }}>
        <ChartCard title="Ownership Distribution">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={partners.map(p => ({
                  name: p.partner_name,
                  value: portfolioMarketValue > 0
                    ? parseFloat((((financials[p.partner_name]?.marketValue ?? 0) / portfolioMarketValue) * 100).toFixed(1))
                    : 0,
                }))}
                dataKey="value" cx="45%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}
              >
                {partners.map((_, i) => <Cell key={i} fill={OWNERSHIP_CHART_COLORS[i % OWNERSHIP_CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Portfolio Equity']} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Capital vs Market Value per Partner">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={partners.map(p => {
              const f = financials[p.partner_name];
              return {
                name: p.partner_name.split(' ')[0],
                costBasis: Math.round((f?.costBasis ?? 0) / 1000),
                marketValue: Math.round((f?.marketValue ?? 0) / 1000),
              };
            })} barCategoryGap="30%" barGap={2}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}K`} />
              <Tooltip formatter={(v: number) => [`$${v}K`, '']} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="costBasis" name="Cost Basis" fill="#2563EB" radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Bar dataKey="marketValue" name="Market Value" fill="#16A34A" radius={[3, 3, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="ROI Comparison — Sorted Highest First">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              layout="vertical"
              data={[...partners].sort((a, b) => (financials[b.partner_name]?.roi ?? 0) - (financials[a.partner_name]?.roi ?? 0)).map(p => ({
                name: p.partner_name.split(' ')[0],
                roi: parseFloat((financials[p.partner_name]?.roi ?? 0).toFixed(1)),
              }))}
              barSize={16} margin={{ left: 4, right: 40 }}
            >
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip formatter={(v: number) => [`${v}%`, 'ROI']} />
              <ReferenceLine x={avgROI} stroke="#D97706" strokeDasharray="4 2"
                label={{ value: `Avg ${avgROI.toFixed(1)}%`, fontSize: 9, fill: '#D97706', position: 'insideTopRight' }} />
              <Bar dataKey="roi" fill="#1E3A8A" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Unrealized Gain / Loss per Partner">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={partners.map(p => {
              const f = financials[p.partner_name];
              return { name: p.partner_name.split(' ')[0], gain: Math.round((f?.unrealizedGain ?? 0) / 1000) };
            })} barSize={28}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}K`} />
              <Tooltip formatter={(v: number) => [`$${v}K`, 'Unrealized G/L']} />
              <ReferenceLine y={0} stroke="#9CA3AF" />
              <Bar dataKey="gain" name="Unrealized G/L" radius={[3, 3, 0, 0]}>
                {partners.map((p, i) => (
                  <Cell key={i} fill={(financials[p.partner_name]?.unrealizedGain ?? 0) >= 0 ? '#16A34A' : '#DC2626'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="bg-white p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {scatterMode === 'partner' ? 'IRR vs LTV — by Partner' : 'Effective Cap Rate vs LTV — by Property'}
            </p>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {(['partner', 'property'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setScatterMode(mode)}
                  className={`px-2.5 py-1 capitalize ${scatterMode === mode ? 'bg-amber-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  By {mode}
                </button>
              ))}
            </div>
          </div>
          {scatterPoints.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <XAxis type="number" dataKey="risk" name="LTV %" tick={{ fontSize: 10 }} unit="%" />
                <YAxis
                  type="number"
                  dataKey="irr"
                  name={scatterMode === 'partner' ? 'IRR %' : 'Cap Rate %'}
                  tick={{ fontSize: 10 }}
                  unit="%"
                />
                <ZAxis type="number" dataKey="size" range={[60, 400]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  formatter={(v: number, name: string) => [
                    scatterMode === 'partner' && name === 'IRR %' ? `${v.toFixed(1)}%`
                      : scatterMode === 'property' && name === 'Cap Rate %' ? `${v.toFixed(2)}%`
                        : name === 'LTV %' ? `${v.toFixed(1)}%`
                          : fmtOwnershipK(v),
                    name,
                  ]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.name ?? ''}
                />
                <Scatter data={scatterPoints} fill="#B8860B" fillOpacity={0.75} />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-16">
              {scatterMode === 'partner'
                ? 'IRR scatter requires dated contribution/distribution cash flows and uploaded financials for LTV.'
                : 'Property scatter requires P&L NOI and balance-sheet LTV per company.'}
            </p>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Bubble size = market value · Risk proxy = portfolio LTV % (Financial Ratios formula)</p>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white p-4">
      <p style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
        {title}
      </p>
      {children}
    </div>
  );
}
