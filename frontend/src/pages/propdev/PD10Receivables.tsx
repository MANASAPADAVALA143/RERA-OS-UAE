import { useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

const INST_STATUS: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
  paid: { color: 'text-green-600 bg-green-50', icon: CheckCircle2 },
  pending: { color: 'text-blue-600 bg-blue-50', icon: Clock },
  overdue: { color: 'text-amber-600 bg-amber-50', icon: AlertCircle },
  bounced: { color: 'text-red-600 bg-red-50', icon: XCircle },
};

export default function PD10Receivables() {
  const { customers } = usePropDev();
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalContractValue = customers.reduce((s, c) => s + c.contractValue, 0);
  const totalCollected = customers.reduce((s, c) => s + c.collected, 0);
  const totalPending = totalContractValue - totalCollected;

  const overdueCustomers = customers.filter(c => c.installments.some(i => i.status === 'overdue'));
  const bouncedCustomers = customers.filter(c => c.installments.some(i => i.status === 'bounced'));

  const collectionRatio = totalContractValue > 0 ? ((totalCollected / totalContractValue) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Receivables / Customer Tracker</h2>
        <p className="text-sm text-gray-500 mt-0.5">Installment schedule and collection status per buyer</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Contract Value', value: fmt(totalContractValue), color: 'text-gray-900' },
          { label: 'Collected', value: fmt(totalCollected), color: 'text-green-700' },
          { label: 'Pending', value: fmt(totalPending), color: 'text-blue-700' },
          { label: 'Collection Ratio', value: `${collectionRatio}%`, color: parseFloat(collectionRatio) >= 80 ? 'text-green-700' : 'text-amber-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {(overdueCustomers.length > 0 || bouncedCustomers.length > 0) && (
        <div className="space-y-2">
          {bouncedCustomers.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              <XCircle size={15} className="shrink-0" />
              <strong>{c.name}</strong> — bounced cheque on lot {c.lotNo}.
              Outstanding: {fmt(c.contractValue - c.collected)}
            </div>
          ))}
          {overdueCustomers.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertCircle size={15} className="shrink-0" />
              <strong>{c.name}</strong> — overdue installment on lot {c.lotNo}.
              Balance: {fmt(c.contractValue - c.collected)}
            </div>
          ))}
        </div>
      )}

      {/* Customer Cards */}
      <div className="space-y-4">
        {customers.map(c => {
          const balance = c.contractValue - c.collected;
          const collPct = c.contractValue > 0 ? (c.collected / c.contractValue) * 100 : 0;
          const hasIssue = c.installments.some(i => i.status === 'bounced' || i.status === 'overdue');
          const isExpanded = expanded === c.id;

          return (
            <div key={c.id} className={`bg-white rounded-xl border overflow-hidden ${hasIssue ? 'border-red-200' : 'border-gray-200'}`}>
              {/* Header */}
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 text-left"
                onClick={() => setExpanded(isExpanded ? null : c.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
                    {c.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500">Lot {c.lotNo} · Contract: {fmt(c.contractValue)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-green-700">{fmt(c.collected)} collected</p>
                  <p className={`text-xs ${balance > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {balance > 0 ? `${fmt(balance)} pending` : 'Fully paid'}
                  </p>
                </div>
              </button>

              {/* Progress bar */}
              <div className="px-4 pb-3">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${Math.min(collPct, 100)}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{collPct.toFixed(0)}% collected</p>
              </div>

              {/* Installment schedule */}
              {isExpanded && (
                <div className="border-t border-gray-100">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
                        <tr>
                          {['Installment', 'Due Date', 'Amount', 'Status'].map(h => (
                            <th key={h} className="px-5 py-2.5 text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {c.installments.map((inst, i) => {
                          const cfg = INST_STATUS[inst.status];
                          const Icon = cfg.icon;
                          return (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-5 py-3 font-medium text-gray-700">Installment {i + 1}</td>
                              <td className="px-5 py-3 text-gray-600">{inst.dueDate}</td>
                              <td className="px-5 py-3 font-semibold text-gray-900">{fmt(inst.amount)}</td>
                              <td className="px-5 py-3">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
                                  <Icon size={12} />
                                  {inst.status.charAt(0).toUpperCase() + inst.status.slice(1)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50">
                          <td className="px-5 py-2.5 font-semibold text-sm text-gray-700" colSpan={2}>Total</td>
                          <td className="px-5 py-2.5 font-bold text-gray-900">{fmt(c.contractValue)}</td>
                          <td className="px-5 py-2.5">
                            <span className="text-xs text-gray-500">Collected: {fmt(c.collected)}</span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
