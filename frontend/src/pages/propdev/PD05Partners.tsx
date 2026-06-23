import { useState, useMemo } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Calculator, FileText, ChevronDown, ChevronRight } from 'lucide-react';

const COLORS = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DC2626'];
const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

// ── Distribution Calculator ──────────────────────────────────────────────────

function DistributionCalculator({ partners }: { partners: ReturnType<typeof usePropDev>['partners'] }) {
  const [distributableAmount, setDistributableAmount] = useState('');
  const [showCalc, setShowCalc] = useState(true);
  const [showStatements, setShowStatements] = useState(false);

  const totalCapital = partners.reduce((s, p) => s + p.capitalContributed, 0);

  const result = useMemo(() => {
    const total = parseFloat(distributableAmount.replace(/,/g, '') || '0');
    if (total <= 0 || partners.length === 0) return null;

    // Step 1: Return of capital (pro-rata by capital contributed)
    const step1 = Math.min(total, totalCapital);
    let remaining1 = total - step1;

    // Step 2: Preferred return @ 8% on capital contributed
    const prefTotal = partners.reduce((s, p) => s + p.capitalContributed * (p.preferredReturn / 100), 0);
    const step2 = Math.min(remaining1, prefTotal);
    let remaining2 = remaining1 - step2;

    // Step 3: Remaining split by equity %
    const step3 = remaining2;

    const perPartner = partners.map(p => {
      const rocShare   = totalCapital > 0 ? (p.capitalContributed / totalCapital) * step1 : 0;
      const prefShare  = totalCapital > 0 ? (p.capitalContributed * (p.preferredReturn / 100) / Math.max(1, prefTotal)) * step2 : 0;
      const splitShare = (p.sharePercent / 100) * step3;
      return {
        ...p,
        rocShare,
        prefShare,
        splitShare,
        total: rocShare + prefShare + splitShare,
      };
    });

    return { total, step1, step2, step3, perPartner };
  }, [distributableAmount, partners, totalCapital]);

  return (
    <div className="bg-white rounded-xl border border-blue-200">
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-blue-50 rounded-xl"
        onClick={() => setShowCalc(c => !c)}
      >
        <div className="flex items-center gap-2">
          <Calculator size={16} className="text-blue-600" />
          <h3 className="font-semibold text-gray-800">Distribution Calculator</h3>
        </div>
        {showCalc ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </button>

      {showCalc && (
        <div className="border-t border-blue-100 p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 mb-1 block">Total Distributable Amount ($)</label>
              <input
                type="text"
                value={distributableAmount}
                onChange={e => setDistributableAmount(e.target.value)}
                placeholder="e.g. 2,500,000"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="pt-5">
              <span className="text-xs text-gray-400">Total Capital: <strong>{fmt(totalCapital)}</strong></span>
            </div>
          </div>

          {result && (
            <>
              {/* Waterfall Steps */}
              <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wide">Distribution Waterfall</h4>
                {[
                  { step: '① Return of Capital',       amount: result.step1, note: 'Pro-rata by capital contributed',    color: 'text-blue-800'  },
                  { step: '② Preferred Return (8%)',   amount: result.step2, note: "On each partner's capital balance",  color: 'text-purple-700' },
                  { step: '③ Remaining (Equity Split)',amount: result.step3, note: 'Pro-rata by ownership %',            color: 'text-green-700' },
                ].map(({ step, amount, note, color }) => (
                  <div key={step} className="flex items-center justify-between">
                    <div>
                      <p className={`text-sm font-semibold ${color}`}>{step}</p>
                      <p className="text-xs text-gray-500">{note}</p>
                    </div>
                    <span className={`text-sm font-bold ${color}`}>{fmt(amount)}</span>
                  </div>
                ))}
              </div>

              {/* Per-Partner Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Partner</th>
                      <th className="px-3 py-2 text-right">Equity %</th>
                      <th className="px-3 py-2 text-right">① ROC</th>
                      <th className="px-3 py-2 text-right">② Pref Return</th>
                      <th className="px-3 py-2 text-right">③ Split</th>
                      <th className="px-3 py-2 text-right font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {result.perPartner.map((p, i) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                            <span className="font-medium">{p.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{p.sharePercent}%</td>
                        <td className="px-3 py-2 text-right text-blue-700">{fmt(p.rocShare)}</td>
                        <td className="px-3 py-2 text-right text-purple-700">{fmt(p.prefShare)}</td>
                        <td className="px-3 py-2 text-right text-green-700">{fmt(p.splitShare)}</td>
                        <td className="px-3 py-2 text-right font-bold">{fmt(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-900 text-white text-xs">
                      <td className="px-3 py-2 font-bold" colSpan={2}>TOTAL</td>
                      <td className="px-3 py-2 text-right font-bold">{fmt(result.step1)}</td>
                      <td className="px-3 py-2 text-right font-bold">{fmt(result.step2)}</td>
                      <td className="px-3 py-2 text-right font-bold">{fmt(result.step3)}</td>
                      <td className="px-3 py-2 text-right font-bold">{fmt(result.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Settlement Statements */}
              <div>
                <button
                  onClick={() => setShowStatements(s => !s)}
                  className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800"
                >
                  <FileText size={14} />
                  {showStatements ? 'Hide' : 'Generate'} Settlement Statements
                </button>
                {showStatements && (
                  <div className="mt-3 space-y-3">
                    {result.perPartner.map((p, i) => (
                      <div key={p.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                              style={{ background: COLORS[i % COLORS.length] }}>
                              {p.name.charAt(0)}
                            </div>
                            <span className="font-semibold text-gray-900">{p.name}</span>
                          </div>
                          <span className="text-xs text-gray-400">Settlement Statement · {new Date().toLocaleDateString()}</span>
                        </div>
                        <div className="space-y-1 text-sm">
                          {[
                            ['Capital Contributed',     fmt(p.capitalContributed)  ],
                            ['① Return of Capital',    fmt(p.rocShare)            ],
                            ['② Preferred Return',     fmt(p.prefShare)           ],
                            ['③ Equity Distribution',  fmt(p.splitShare)          ],
                          ].map(([label, val]) => (
                            <div key={label} className="flex justify-between">
                              <span className="text-gray-500">{label}</span>
                              <span className="font-medium">{val}</span>
                            </div>
                          ))}
                          <div className="flex justify-between pt-2 border-t border-gray-100 font-bold text-base">
                            <span>Total Distribution</span>
                            <span className="text-green-700">{fmt(p.total)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PD05Partners() {
  const { partners, capitalCalls } = usePropDev();

  const totalCapital = partners.reduce((s, p) => s + p.capitalContributed, 0);
  const totalDistributed = partners.reduce((s, p) => s + p.distributionsReceived, 0);
  const totalShareOfProfit = partners.reduce((s, p) => s + p.shareOfProfit, 0);
  const avgROI = totalCapital > 0 ? ((totalShareOfProfit / totalCapital) * 100) : 0;

  const pieData = partners.map(p => ({ name: p.name, value: p.sharePercent }));

  const overdueByPartner = (partnerId: string) =>
    capitalCalls
      .filter(c => c.partnerId === partnerId && (c.status === 'Overdue' || c.status === 'Partial'))
      .reduce((s, c) => s + (c.totalDue - c.received), 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Partners / JV Ledger</h2>
        <p className="text-sm text-gray-500 mt-0.5">Equity structure, contributions, distributions and settlement</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Partners',              value: `${partners.length}`,     sub: 'active JV partners' },
          { label: 'Total Capital',         value: fmt(totalCapital),        sub: 'contributed to date' },
          { label: 'Total Distributions',   value: fmt(totalDistributed),    sub: fmt(totalCapital - totalDistributed) + ' pending' },
          { label: 'Portfolio ROI',         value: pct(avgROI),              sub: 'return on invested capital' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Distribution Calculator */}
      <DistributionCalculator partners={partners} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equity Pie */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Equity Split</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v}%`, 'Equity']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Partner Cards */}
        <div className="space-y-3">
          {partners.map((p, i) => {
            const overdue = overdueByPartner(p.id);
            const roi = p.capitalContributed > 0 ? (p.shareOfProfit / p.capitalContributed) * 100 : 0;
            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                      style={{ background: COLORS[i % COLORS.length] }}>
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-500">{p.type} · {p.sharePercent}% equity · {p.preferredReturn}% pref</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>{p.status}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Contributed</p>
                    <p className="font-semibold text-gray-900">{fmt(p.capitalContributed)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Distributed</p>
                    <p className="font-semibold text-green-700">{fmt(p.distributionsReceived)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">ROI</p>
                    <p className={`font-semibold ${roi >= 8 ? 'text-green-700' : 'text-amber-600'}`}>{pct(roi)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Overdue</p>
                    <p className={`font-semibold ${overdue > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {overdue > 0 ? fmt(overdue) : '—'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Partner Ledger Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Partner Ledger</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Partner', 'Type', 'Equity %', 'Pref %', 'Capital In', 'Profit Share', 'ROI', 'Distributed', 'Net Pending', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {partners.map((p, i) => {
                const roi = p.capitalContributed > 0 ? (p.shareOfProfit / p.capitalContributed) * 100 : 0;
                const netPending = (p.capitalContributed + p.shareOfProfit) - p.distributionsReceived;
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="font-medium">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">{p.type}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{p.sharePercent}%</td>
                    <td className="px-4 py-3 text-right">{p.preferredReturn}%</td>
                    <td className="px-4 py-3 text-right">{fmt(p.capitalContributed)}</td>
                    <td className="px-4 py-3 text-right text-blue-700">{fmt(p.shareOfProfit)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${roi >= 8 ? 'text-green-700' : 'text-amber-600'}`}>{pct(roi)}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-green-700">{fmt(p.distributionsReceived)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-amber-700">{netPending > 0 ? fmt(netPending) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>{p.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-4 py-3 font-bold" colSpan={4}>TOTAL</td>
                <td className="px-4 py-3 text-right font-bold">{fmt(totalCapital)}</td>
                <td className="px-4 py-3 text-right font-bold">{fmt(totalShareOfProfit)}</td>
                <td className="px-4 py-3 text-right font-bold">{pct(avgROI)}</td>
                <td className="px-4 py-3 text-right font-bold text-green-300">{fmt(totalDistributed)}</td>
                <td className="px-4 py-3 text-right font-bold text-amber-300">
                  {fmt(partners.reduce((s,p) => s + Math.max(0, (p.capitalContributed + p.shareOfProfit) - p.distributionsReceived), 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
