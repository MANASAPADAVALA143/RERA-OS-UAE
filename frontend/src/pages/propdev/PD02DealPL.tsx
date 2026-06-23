import { useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import CompanyComparisonPanel from '../../components/propdev/CompanyComparisonPanel';
import { Edit3 } from 'lucide-react';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number, total: number) => total ? `${((n / total) * 100).toFixed(1)}%` : '—';

interface EditableRowProps {
  label: string;
  value: number;
  indent?: boolean;
  onChange: (v: number) => void;
  saleConsideration: number;
}
function EditableRow({ label, value, indent, onChange, saleConsideration }: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(Math.round(value)));
  return (
    <tr className="border-t border-gray-50 hover:bg-gray-50 group">
      <td className={`px-5 py-2.5 text-gray-700 ${indent ? 'pl-10' : ''}`}>{label}</td>
      <td className="px-5 py-2.5 text-right text-gray-900">
        {editing ? (
          <input autoFocus className="w-28 border rounded px-2 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={raw} onChange={e => setRaw(e.target.value)}
            onBlur={() => { const v = parseFloat(raw.replace(/,/g,'')); if (!isNaN(v)) onChange(v); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(raw.replace(/,/g,'')); if (!isNaN(v)) onChange(v); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <button className="flex items-center justify-end gap-1 w-full hover:text-blue-600" onClick={() => { setRaw(String(Math.round(value))); setEditing(true); }}>
            {fmt(value)}
            <Edit3 size={11} className="opacity-0 group-hover:opacity-50" />
          </button>
        )}
      </td>
      <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{fmt(value / 27)}</td>
      <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{pct(value, saleConsideration)}</td>
    </tr>
  );
}

export default function PD02DealPL() {
  const { properties, lots } = usePropDev();
  const p = properties[0];

  const [costs, setCosts] = useState({
    hardCost: p?.hardCost ?? 120000,
    softCost: p?.softCost ?? 85000,
    titleCharges: p?.titleCharges ?? 42000,
    otherCharges: p?.otherCharges ?? 18000,
    propertyTax: p?.propertyTax ?? 26514,
    loanProcessing: p?.loanProcessing ?? 12000,
    professionalCharges: p?.professionalCharges ?? 9000,
    legalFees: p?.legalFees ?? 15000,
    interestOnLoan: p?.interestOnLoan ?? 108000,
  });

  if (!p) return <div className="p-4 text-gray-500">No data</div>;

  const totalOther = Object.values(costs).reduce((s, v) => s + v, 0);
  // Management fee: 9% of Land Cost (per Annexure I Note 4)
  const managementFee = p.landCost * p.managementFeeRate;
  const totalExclLandComm = totalOther + managementFee;
  // Commission: use explicit amount if set, otherwise rate × sale consideration
  const commission = p.commission ?? (p.saleConsideration * p.commissionRate);
  const totalExclLand = totalExclLandComm + commission;
  const totalExpenses = p.landCost + totalExclLand;
  const netProfit = p.saleConsideration - totalExpenses;
  const grossMargin = ((netProfit / p.saleConsideration) * 100).toFixed(1);

  const totalLots = lots.length || p.totalLots;

  // Scenario analysis
  const scenarios = [
    { name: 'Current', priceMultiplier: 1.0 },
    { name: 'Target (+5%)', priceMultiplier: 1.05 },
    { name: 'Stressed (−10%)', priceMultiplier: 0.90 },
  ].map(s => {
    const rev = p.saleConsideration * s.priceMultiplier;
    const comm = p.commission ?? (rev * p.commissionRate);
    const mgmtFee = p.landCost * p.managementFeeRate;
    const np = rev - p.landCost - totalOther - mgmtFee - comm;
    return { name: s.name, revenue: fmt(rev), netProfit: fmt(np), margin: `${((np / rev) * 100).toFixed(1)}%` };
  });

  type CostKey = keyof typeof costs;
  const setField = (key: CostKey) => (v: number) => setCosts(prev => ({ ...prev, [key]: v }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Deal P&L — {p.name}</h2>
        <p className="text-xs text-gray-400 mt-0.5">Click any expense line to edit · recalculates instantly</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Sale Consideration', value: fmt(p.saleConsideration), color: 'text-blue-700' },
          { label: 'Total Expenses', value: fmt(totalExpenses), color: 'text-red-600' },
          { label: 'Net Profit', value: fmt(netProfit), color: netProfit >= 0 ? 'text-green-700' : 'text-red-700' },
          { label: 'Net Margin', value: `${grossMargin}%`, color: parseFloat(grossMargin) >= 35 ? 'text-green-700' : 'text-amber-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* P&L Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500 w-[45%]">Particulars</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Amount ($)</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Per Lot</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">% of Sale</th>
              </tr>
            </thead>
            <tbody>
              {/* A. INCOME */}
              <tr className="bg-blue-900 text-white"><td className="px-5 py-2.5 font-bold" colSpan={4}>A. INCOME</td></tr>
              <tr className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-2.5 pl-10 text-gray-700">Sale Consideration (all lots) <span className="text-xs text-gray-400 ml-1">({totalLots} lots)</span></td>
                <td className="px-5 py-2.5 text-right font-semibold text-green-700">{fmt(p.saleConsideration)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{fmt(p.saleConsideration / totalLots)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">100%</td>
              </tr>
              <tr className="h-1"><td colSpan={4} /></tr>

              {/* B. COST OF LAND */}
              <tr className="bg-blue-900 text-white"><td className="px-5 py-2.5 font-bold" colSpan={4}>B. COST OF LAND</td></tr>
              <tr className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-2.5 pl-10 text-gray-700">Land Cost</td>
                <td className="px-5 py-2.5 text-right">{fmt(p.landCost)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{fmt(p.landCost / totalLots)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{pct(p.landCost, p.saleConsideration)}</td>
              </tr>
              <tr className="h-1"><td colSpan={4} /></tr>

              {/* C. OTHER EXPENSES */}
              <tr className="bg-blue-900 text-white"><td className="px-5 py-2.5 font-bold" colSpan={4}>C. OTHER EXPENSES</td></tr>
              {([
                ['hardCost', 'Hard Cost (Development)'],
                ['softCost', 'Soft Cost (Design/Permits)'],
                ['titleCharges', 'Title Company Charges'],
                ['otherCharges', 'Other Charges'],
                ['propertyTax', 'Property Tax'],
                ['loanProcessing', 'Loan Processing Charges'],
                ['professionalCharges', 'Professional Charges'],
                ['legalFees', 'Legal Fees'],
                ['interestOnLoan', 'Interest on Mortgage Loan'],
              ] as [CostKey, string][]).map(([key, label]) => (
                <EditableRow key={key} label={label} value={costs[key]} indent onChange={setField(key)} saleConsideration={p.saleConsideration} />
              ))}
              {/* Total Other */}
              <tr className="bg-gray-100 border-t border-gray-200">
                <td className="px-5 py-2.5 font-semibold">Total Expenses (excl. Land & Commission)</td>
                <td className="px-5 py-2.5 text-right font-semibold">{fmt(totalOther)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{fmt(totalOther / totalLots)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{pct(totalOther, p.saleConsideration)}</td>
              </tr>
              {/* Management Fee */}
              <tr className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-2.5 pl-10 text-gray-700">Management Fee ({(p.managementFeeRate*100).toFixed(0)}% of Land Cost — Note 4)</td>
                <td className="px-5 py-2.5 text-right">{fmt(managementFee)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{fmt(managementFee / totalLots)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{pct(managementFee, p.saleConsideration)}</td>
              </tr>
              <tr className="bg-gray-100 border-t border-gray-200">
                <td className="px-5 py-2.5 font-semibold">Total Expenses (excl. Land)</td>
                <td className="px-5 py-2.5 text-right font-semibold">{fmt(totalExclLandComm)}</td>
                <td colSpan={2} />
              </tr>
              {/* Commission */}
              <tr className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-2.5 pl-10 text-gray-700">
                  {p.commission != null
                    ? `Sale Commission (6% for 1 lot & 3% for 26 lots — Note 2)`
                    : `Sale Commission (${(p.commissionRate*100).toFixed(1)}% of Sale)`}
                </td>
                <td className="px-5 py-2.5 text-right">{fmt(commission)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{fmt(commission / totalLots)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{pct(commission, p.saleConsideration)}</td>
              </tr>
              <tr className="bg-gray-100 border-t border-gray-200">
                <td className="px-5 py-2.5 font-semibold">Total Expenses (excl. Land) incl. Commission</td>
                <td className="px-5 py-2.5 text-right font-semibold">{fmt(totalExclLand)}</td>
                <td colSpan={2} />
              </tr>
              <tr className="bg-gray-100 border-t border-gray-200">
                <td className="px-5 py-2.5 font-semibold">Total Expenses</td>
                <td className="px-5 py-2.5 text-right font-semibold">{fmt(totalExpenses)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{fmt(totalExpenses / totalLots)}</td>
                <td className="px-5 py-2.5 text-right text-xs text-gray-500">{pct(totalExpenses, p.saleConsideration)}</td>
              </tr>
              <tr className="h-2"><td colSpan={4} /></tr>
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-5 py-4 font-bold text-base">NET PROFIT / LOSS</td>
                <td className={`px-5 py-4 text-right font-bold text-xl ${netProfit >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(netProfit)}</td>
                <td className="px-5 py-4 text-right font-bold text-gray-300">{fmt(netProfit / totalLots)}</td>
                <td className="px-5 py-4 text-right font-bold text-gray-300">{grossMargin}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Per-unit metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Net Profit / Lot', value: fmt(netProfit / totalLots) },
          { label: 'Net Profit / Acre', value: p.totalAcres > 0 ? fmt(netProfit / p.totalAcres) : '—' },
          { label: 'Net Profit / Sq Ft', value: lots.length > 0 ? `$${(netProfit / lots.reduce((s,l) => s+l.sizeSqft,0)).toFixed(2)}` : '—' },
          { label: 'Land Cost / Lot', value: fmt(p.landCost / totalLots) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="text-lg font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Scenario Analysis */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Scenario Analysis</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Scenario', 'Sale Revenue', 'Net Profit', 'Net Margin'].map(h => (
                  <th key={h} className="px-5 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scenarios.map((s, i) => (
                <tr key={s.name} className={`hover:bg-gray-50 ${i === 0 ? 'bg-blue-50' : ''}`}>
                  <td className="px-5 py-3 font-medium">{s.name} {i === 0 && <span className="ml-1 text-xs text-blue-600">active</span>}</td>
                  <td className="px-5 py-3 text-right">{s.revenue}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${s.netProfit.startsWith('($') ? 'text-red-600' : 'text-green-700'}`}>{s.netProfit}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${parseFloat(s.margin) >= 30 ? 'text-green-700' : 'text-amber-700'}`}>{s.margin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Consolidated comparison */}
      <CompanyComparisonPanel
        title="P&L Comparison — All Companies"
        columns={[
          { label: 'Revenue', getValue: c => c.property.saleConsideration },
          { label: 'Land Cost', getValue: c => c.property.landCost, higherIsBetter: false },
          { label: 'Net Margin', getValue: c => {
              const p = c.property;
              const tot = p.hardCost + p.softCost + p.titleCharges + p.otherCharges
                + p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan;
              const mgmt = p.landCost * p.managementFeeRate;
              const comm = p.commission ?? (p.saleConsideration * p.commissionRate);
              const np = p.saleConsideration - p.landCost - tot - mgmt - comm;
              return p.saleConsideration > 0 ? (np / p.saleConsideration) * 100 : 0;
            },
            format: v => `${v.toFixed(1)}%`,
          },
        ]}
      />
    </div>
  );
}
