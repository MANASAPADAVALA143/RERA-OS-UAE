import { usePropDev } from '../../contexts/PropertyDevContext';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number, total: number) => total ? `${((n / total) * 100).toFixed(1)}%` : '—';

interface Row { label: string; amount: number; note?: string; isHeader?: boolean; isTotal?: boolean; isSubtotal?: boolean; indent?: boolean }

export default function PD02DealPL() {
  const { properties, lots } = usePropDev();
  const p = properties[0];

  const totalLots = lots.length;
  const totalCostOfLand = p.landCost;
  const totalHardCost = p.hardCost;
  const totalSoftCost = p.softCost;
  const titleCharges = p.titleCharges;
  const otherCharges = p.otherCharges;
  const propertyTax = p.propertyTax;
  const loanProcessing = p.loanProcessing;
  const professionalCharges = p.professionalCharges;
  const legalFees = p.legalFees;
  const interestOnLoan = p.interestOnLoan;

  const totalProjectCost = totalCostOfLand + totalHardCost + totalSoftCost
    + titleCharges + otherCharges + propertyTax + loanProcessing
    + professionalCharges + legalFees + interestOnLoan;

  const grossProfit = p.saleConsideration - totalProjectCost;
  const managementFee = p.saleConsideration * p.managementFeeRate;
  const commission = p.saleConsideration * p.commissionRate;
  const netProfit = grossProfit - managementFee - commission;

  const perLot = (n: number) => fmt(n / totalLots);

  const rows: Row[] = [
    { label: 'A. SALE CONSIDERATION', amount: p.saleConsideration, isHeader: true },
    { label: 'Total Sale Value', amount: p.saleConsideration, indent: true, note: `${totalLots} lots` },
    { label: '', amount: 0 },

    { label: 'B. PROJECT COST', amount: totalProjectCost, isHeader: true },
    { label: 'Cost of Land', amount: totalCostOfLand, indent: true },
    { label: 'Hard Cost (Development)', amount: totalHardCost, indent: true },
    { label: 'Soft Cost (Design/Permits)', amount: totalSoftCost, indent: true },
    { label: 'Title Charges', amount: titleCharges, indent: true },
    { label: 'Other Charges', amount: otherCharges, indent: true },
    { label: 'Property Tax', amount: propertyTax, indent: true },
    { label: 'Loan Processing Fee', amount: loanProcessing, indent: true },
    { label: 'Professional Charges', amount: professionalCharges, indent: true },
    { label: 'Legal Fees', amount: legalFees, indent: true },
    { label: 'Interest on Loan', amount: interestOnLoan, indent: true },
    { label: 'Total Project Cost', amount: totalProjectCost, isSubtotal: true },
    { label: '', amount: 0 },

    { label: 'C. GROSS PROFIT  (A − B)', amount: grossProfit, isSubtotal: true },
    { label: '', amount: 0 },

    { label: 'D. DEDUCTIONS', amount: managementFee + commission, isHeader: true },
    { label: `Management Fee (${(p.managementFeeRate * 100).toFixed(0)}% of Sale)`, amount: managementFee, indent: true },
    { label: `Commission (${(p.commissionRate * 100).toFixed(1)}% of Sale)`, amount: commission, indent: true },
    { label: '', amount: 0 },

    { label: 'E. NET PROFIT  (C − D)', amount: netProfit, isTotal: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Deal P&L — {properties[0].name}</h2>
        <p className="text-sm text-gray-500 mt-0.5">Project-level profit and loss statement</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Sale Consideration', value: fmt(p.saleConsideration), color: 'text-blue-700' },
          { label: 'Total Project Cost', value: fmt(totalProjectCost), color: 'text-gray-700' },
          { label: 'Gross Profit', value: fmt(grossProfit), color: 'text-green-700' },
          { label: 'Net Profit', value: fmt(netProfit), color: netProfit >= 0 ? 'text-green-700' : 'text-red-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Full P&L Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500 font-medium w-[50%]">Particulars</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500 font-medium">Amount ($)</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500 font-medium">Per Lot ($)</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500 font-medium">% of Sale</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                if (!row.label) {
                  return <tr key={i} className="h-2"><td colSpan={4} /></tr>;
                }
                if (row.isTotal) {
                  return (
                    <tr key={i} className="bg-gray-900 text-white">
                      <td className="px-5 py-3.5 font-bold text-base">{row.label}</td>
                      <td className="px-5 py-3.5 text-right font-bold text-lg text-green-300">{fmt(row.amount)}</td>
                      <td className="px-5 py-3.5 text-right font-bold text-gray-300">{perLot(row.amount)}</td>
                      <td className="px-5 py-3.5 text-right font-bold text-gray-300">{pct(row.amount, p.saleConsideration)}</td>
                    </tr>
                  );
                }
                if (row.isSubtotal) {
                  return (
                    <tr key={i} className="bg-gray-100 border-t border-gray-200">
                      <td className="px-5 py-3 font-semibold text-gray-800">{row.label}</td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-900">{fmt(row.amount)}</td>
                      <td className="px-5 py-3 text-right text-gray-600">{perLot(row.amount)}</td>
                      <td className="px-5 py-3 text-right text-gray-600">{pct(row.amount, p.saleConsideration)}</td>
                    </tr>
                  );
                }
                if (row.isHeader) {
                  return (
                    <tr key={i} className="bg-blue-900 text-white">
                      <td className="px-5 py-2.5 font-bold text-sm" colSpan={4}>{row.label}</td>
                    </tr>
                  );
                }
                return (
                  <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className={`px-5 py-2.5 text-gray-700 ${row.indent ? 'pl-10' : ''}`}>
                      {row.label}
                      {row.note && <span className="text-xs text-gray-400 ml-2">({row.note})</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-900">{fmt(row.amount)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-500">{perLot(row.amount)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-500">{pct(row.amount, p.saleConsideration)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Margin analysis */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">Margin Analysis</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: 'Gross Margin', value: pct(grossProfit, p.saleConsideration) },
            { label: 'Net Margin', value: pct(netProfit, p.saleConsideration) },
            { label: 'Land Cost Ratio', value: pct(totalCostOfLand, p.saleConsideration) },
            { label: 'Mgmt Fee + Commission', value: pct(managementFee + commission, p.saleConsideration) },
            { label: 'Avg Revenue / Lot', value: fmt(p.saleConsideration / totalLots) },
            { label: 'Avg Cost / Lot', value: fmt(totalProjectCost / totalLots) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-lg font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
