import { CheckCircle2 } from 'lucide-react';
import { useConsultancy, consultancyMoney as money } from '../../contexts/ConsultancyContext';

function StatementTable({ title, rows }: { title: string; rows: { label: string; value: number; bold?: boolean; indent?: boolean }[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
        {title}
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {rows.map(r => (
            <tr key={r.label} className={r.bold ? 'font-semibold bg-gray-50/50' : ''}>
              <td className={`px-4 py-2 text-gray-700 ${r.indent ? 'pl-8' : ''}`}>{r.label}</td>
              <td className={`px-4 py-2 text-right font-mono ${r.value < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                {r.value < 0 ? `(${money(-r.value)})` : money(r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CN06Financials() {
  const { current, balanceSheet: bs, totalAssets, totalLiabilities } = useConsultancy();
  const equity = totalAssets - totalLiabilities;
  const balances = equity === bs.equity && totalAssets === totalLiabilities + bs.equity;

  const incomeRows = [
    { label: 'Revenue', value: current.revenue, bold: true },
    { label: 'Payroll & benefits', value: -current.payroll },
    { label: 'Other operating expenses', value: -current.otherOpex },
    { label: 'Operating income', value: current.revenue - current.payroll - current.otherOpex, bold: true },
    { label: 'Other income', value: current.otherIncome },
    { label: 'Net income', value: current.netIncome, bold: true },
  ];

  const assetRows = [
    { label: 'Cash & equivalents', value: bs.cash, indent: true },
    { label: 'Accounts receivable', value: bs.receivables, indent: true },
    { label: 'Prepaid expenses', value: bs.prepaid, indent: true },
    { label: 'Fixed assets, net', value: bs.fixedAssetsNet, indent: true },
    { label: 'Total assets', value: totalAssets, bold: true },
  ];

  const liabEquityRows = [
    { label: 'Accounts payable', value: bs.accountsPayable, indent: true },
    { label: 'Accrued payroll', value: bs.accruedPayroll, indent: true },
    { label: 'Deferred revenue', value: bs.deferredRevenue, indent: true },
    { label: 'Bank loan', value: bs.bankLoan, indent: true },
    { label: 'Total liabilities', value: totalLiabilities, bold: true },
    { label: "Shareholders' equity", value: equity, indent: true },
    { label: 'Total liabilities & equity', value: totalLiabilities + equity, bold: true },
  ];

  const cashFlowRows = [
    { label: 'Net income', value: current.netIncome },
    { label: 'Depreciation', value: 40_000 },
    { label: 'Increase in receivables', value: -48_000 },
    { label: 'Increase in deferred revenue', value: 22_000 },
    { label: 'Cash from operations', value: current.netIncome + 40_000 - 48_000 + 22_000, bold: true },
    { label: 'Capital expenditure', value: -35_000 },
    { label: 'Loan repayment', value: -50_000 },
    { label: 'Dividends paid', value: -120_000 },
    { label: 'Net change in cash', value: current.netIncome + 40_000 - 48_000 + 22_000 - 35_000 - 50_000 - 120_000, bold: true },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Financial Statements</h2>
          <p className="text-sm text-gray-500 mt-0.5">FY2025 — USD</p>
        </div>
        {balances && (
          <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
            <CheckCircle2 size={13} /> Balance sheet balances
          </span>
        )}
      </div>

      <StatementTable title="Income Statement" rows={incomeRows} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <StatementTable title="Balance Sheet — Assets" rows={assetRows} />
        <StatementTable title="Balance Sheet — Liabilities & Equity" rows={liabEquityRows} />
      </div>

      <StatementTable title="Cash Flow Statement" rows={cashFlowRows} />
    </div>
  );
}
