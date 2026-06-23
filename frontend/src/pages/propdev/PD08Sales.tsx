import { usePropDev } from '../../contexts/PropertyDevContext';
import { CheckCircle2, DollarSign, Home } from 'lucide-react';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function PD08Sales() {
  const { lots, properties } = usePropDev();
  const p = properties[0];

  const soldLots = lots.filter(l => l.status === 'sold');
  const totalSaleValue = soldLots.reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const totalLandCost = soldLots.reduce((s, l) => s + l.landCost, 0);
  const commission = totalSaleValue * p.commissionRate;
  const grossProfit = totalSaleValue - totalLandCost - commission;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Sale of Property</h2>
        <p className="text-sm text-gray-500 mt-0.5">Closed lot sales and profit attribution</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Lots Closed', value: `${soldLots.length}`, icon: Home, color: 'text-blue-700' },
          { label: 'Total Sale Value', value: fmt(totalSaleValue), icon: DollarSign, color: 'text-green-700' },
          { label: 'Commission Paid', value: fmt(commission), icon: DollarSign, color: 'text-amber-700' },
          { label: 'Gross Profit (Sold)', value: fmt(grossProfit), icon: CheckCircle2, color: grossProfit >= 0 ? 'text-green-700' : 'text-red-700' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={15} className={color} />
              <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            </div>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Sales Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Closed Sales — {p.name}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['#', 'Lot No', 'Block', 'Buyer', 'Size (sqft)', 'List Price', 'Sale Price', 'Discount', 'Land Cost', 'Commission', 'Net Gain', 'Close Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {soldLots.map((lot, idx) => {
                const discount = lot.listPrice - (lot.salePrice ?? 0);
                const lotCommission = (lot.salePrice ?? 0) * p.commissionRate;
                const netGain = (lot.salePrice ?? 0) - lot.landCost - lotCommission;
                return (
                  <tr key={lot.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{lot.lotNo}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{lot.block}</td>
                    <td className="px-4 py-3 text-right">{lot.buyerName}</td>
                    <td className="px-4 py-3 text-right">{lot.sizeSqft.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{fmt(lot.listPrice)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">{fmt(lot.salePrice ?? 0)}</td>
                    <td className="px-4 py-3 text-right text-red-500">{discount > 0 ? `(${fmt(discount)})` : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{fmt(lot.landCost)}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{fmt(lotCommission)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">{fmt(netGain)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{lot.closeDate}</td>
                  </tr>
                );
              })}
              {soldLots.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">No closed sales yet.</td></tr>
              )}
            </tbody>
            {soldLots.length > 0 && (
              <tfoot>
                <tr className="bg-gray-900 text-white">
                  <td className="px-4 py-3 font-bold" colSpan={4}>TOTAL ({soldLots.length} lots)</td>
                  <td className="px-4 py-3 text-right font-bold">{soldLots.reduce((s,l) => s + l.sizeSqft, 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-bold">{fmt(soldLots.reduce((s,l) => s + l.listPrice, 0))}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-300">{fmt(totalSaleValue)}</td>
                  <td />
                  <td className="px-4 py-3 text-right font-bold text-gray-300">{fmt(totalLandCost)}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-300">{fmt(commission)}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-300">{fmt(grossProfit)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Per-buyer detail */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Buyer Summary</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {soldLots.map(lot => {
            const salePrice = lot.salePrice ?? 0;
            const gain = salePrice - lot.landCost - salePrice * p.commissionRate;
            const gainPct = salePrice > 0 ? ((gain / salePrice) * 100).toFixed(1) : '0';
            return (
              <div key={lot.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                <div>
                  <p className="font-medium text-gray-900">{lot.buyerName}</p>
                  <p className="text-xs text-gray-500">{lot.lotNo} · {lot.block} · {lot.sizeSqft.toLocaleString()} sqft · closed {lot.closeDate}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{fmt(salePrice)}</p>
                  <p className="text-xs text-green-600">+{gainPct}% net gain</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
