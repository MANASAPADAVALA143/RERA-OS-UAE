import { usePropDev } from '../../contexts/PropertyDevContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

export default function PD09Performance() {
  const { properties, lots, partners } = usePropDev();
  const p = properties[0];

  const totalCapital = partners.reduce((s, x) => s + x.capitalContributed, 0);
  const soldLots = lots.filter(l => l.status === 'sold');
  const contractedLots = lots.filter(l => l.status === 'contracted');

  const revenueToDate = soldLots.reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const projectedRevenue = p.saleConsideration;
  const totalCost = p.landCost + p.hardCost + p.softCost + p.titleCharges + p.otherCharges
    + p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan;
  // Management fee: 9% of Land Cost per Note 4 (NOT of revenue)
  const managementFee = p.landCost * p.managementFeeRate;
  // Commission: use explicit amount if set, otherwise rate × sale consideration
  const commission = p.commission ?? (p.saleConsideration * p.commissionRate);
  const netProfit = p.saleConsideration - totalCost - managementFee - commission;

  // Metrics
  const roi = totalCapital > 0 ? ((netProfit / totalCapital) * 100) : 0;
  const equityMultiple = totalCapital > 0 ? ((totalCapital + netProfit) / totalCapital) : 0;
  const grossMargin = (((projectedRevenue - totalCost) / projectedRevenue) * 100);
  const netMargin = ((netProfit / projectedRevenue) * 100);
  const soldPct = ((soldLots.length / lots.length) * 100);
  const contractedPct = ((contractedLots.length / lots.length) * 100);
  const velocityPerMonth = soldLots.length / 6; // 6 months of data

  const lotComparisons = ['Land Cost', 'Hard Cost', 'Soft Cost', 'Other Costs'].map((name, i) => {
    const amounts = [p.landCost, p.hardCost, p.softCost, p.titleCharges + p.otherCharges + p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan];
    return { name, amount: amounts[i], perLot: Math.round(amounts[i] / lots.length) };
  });

  const scorecard = [
    { label: 'Lots Sold', value: `${soldLots.length}/${lots.length}`, status: soldPct >= 50 ? 'good' : soldPct >= 30 ? 'warn' : 'bad' },
    { label: 'Lots Contracted', value: `${contractedLots.length}`, status: contractedLots.length >= 3 ? 'good' : 'warn' },
    { label: 'Sales Velocity', value: `${velocityPerMonth.toFixed(1)} lots/mo`, status: velocityPerMonth >= 1.5 ? 'good' : 'warn' },
    { label: 'Net Margin', value: pct(netMargin), status: netMargin >= 25 ? 'good' : netMargin >= 15 ? 'warn' : 'bad' },
    { label: 'ROI on Capital', value: pct(roi), status: roi >= 20 ? 'good' : roi >= 10 ? 'warn' : 'bad' },
    { label: 'Equity Multiple', value: `${equityMultiple.toFixed(2)}x`, status: equityMultiple >= 1.5 ? 'good' : equityMultiple >= 1.2 ? 'warn' : 'bad' },
  ];

  const statusColor = { good: 'text-green-700 bg-green-50', warn: 'text-amber-700 bg-amber-50', bad: 'text-red-700 bg-red-50' };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Performance Analytics</h2>
        <p className="text-sm text-gray-500 mt-0.5">IRR proxy, ROI, equity multiple and project scorecard</p>
      </div>

      {/* Core KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Projected ROI', value: pct(roi), color: roi >= 20 ? 'text-green-700' : 'text-amber-700' },
          { label: 'Equity Multiple', value: `${equityMultiple.toFixed(2)}x`, color: 'text-blue-700' },
          { label: 'Gross Margin', value: pct(grossMargin), color: 'text-purple-700' },
          { label: 'Net Profit (Proj)', value: fmt(netProfit), color: 'text-green-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Scorecard */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">Project Scorecard</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {scorecard.map(({ label, value, status }) => (
            <div key={label} className={`rounded-lg p-3 ${statusColor[status]}`}>
              <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
              <p className="text-xl font-bold mt-1">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Breakdown Bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Cost Breakdown per Lot</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={lotComparisons} layout="vertical" barSize={18}>
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
              <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Per Lot']} />
              <Bar dataKey="perLot" fill="#2563EB" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue vs Cost Waterfall */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Revenue → Profit Waterfall</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={[
                { name: 'Revenue', value: projectedRevenue },
                { name: 'Total Cost', value: -totalCost },
                { name: 'Mgmt+Comm', value: -(managementFee + commission) },
                { name: 'Net Profit', value: netProfit },
              ]}
              barSize={32}
            >
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(Math.abs(v)/1_000_000).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => [`$${Math.abs(v).toLocaleString()}`, '']} />
              <ReferenceLine y={0} stroke="#E5E7EB" />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}
                fill="#16A34A"
                label={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Metrics Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Detailed Financial Metrics</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {[
                { label: 'Total Equity Invested', value: fmt(totalCapital), sub: 'All partner contributions' },
                { label: 'Total Project Cost', value: fmt(totalCost), sub: 'Land + Dev + All charges' },
                { label: 'Projected Revenue', value: fmt(projectedRevenue), sub: `27 lots × avg ${fmt(projectedRevenue/lots.length)}` },
                { label: 'Revenue Collected (Sold)', value: fmt(revenueToDate), sub: `${soldLots.length} lots closed` },
                { label: 'Gross Profit', value: fmt(projectedRevenue - totalCost), sub: 'Before Mgmt fee & Commission' },
                { label: 'Management Fee', value: fmt(managementFee), sub: `${(p.managementFeeRate*100).toFixed(0)}% of land cost (Note 4)` },
                { label: 'Commission', value: fmt(commission), sub: p.commission != null ? '6% for 1 lot, 3% for 26 lots (Note 2)' : `${(p.commissionRate*100).toFixed(1)}% of revenue` },
                { label: 'Net Profit', value: fmt(netProfit), sub: 'After all deductions', bold: true },
                { label: 'Profit per Lot', value: fmt(netProfit / lots.length), sub: '' },
                { label: 'Revenue per Sqft', value: `$${(projectedRevenue / lots.reduce((s,l) => s + l.sizeSqft, 0)).toFixed(2)}`, sub: '' },
              ].map(({ label, value, sub, bold }) => (
                <tr key={label} className={`hover:bg-gray-50 ${bold ? 'bg-gray-50' : ''}`}>
                  <td className="px-5 py-3 text-gray-700 font-medium">{label}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${bold ? 'text-green-700 text-base' : 'text-gray-900'}`}>{value}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">{sub}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
