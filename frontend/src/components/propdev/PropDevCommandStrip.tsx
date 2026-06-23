import { useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import { Sparkles, Download, RefreshCw, ChevronDown, Building2 } from 'lucide-react';

interface Props {
  onAiInsights: () => void;
}

const PERIODS = ['All Time', 'Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'FY 2025', 'FY 2026'];

export default function PropDevCommandStrip({ onAiInsights }: Props) {
  const { companies, selectedCompanyId, setSelectedCompanyId } = usePropDev();
  const { tab } = usePropDevNav();
  const [period, setPeriod] = useState('All Time');
  const [lastUpdated] = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  const selectedName = selectedCompanyId === 'all'
    ? 'All Companies'
    : companies.find(c => c.id === selectedCompanyId)?.name ?? 'All Companies';

  const PAGE_LABELS: Record<string, string> = {
    dashboard: 'Command Center', 'deal-pl': 'Deal P&L', pricing: 'Lot Pricing',
    inventory: 'Lot Inventory', partners: 'Partners / JV', 'capital-calls': 'Capital Calls',
    loans: 'Loan Tracker', sales: 'Sale of Property', performance: 'Performance',
    'cash-flow': 'Cash Flow', documents: 'Documents',
  };

  return (
    <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
      <div className="flex items-center justify-between gap-4 px-2 py-2.5">
        {/* Page title + breadcrumb */}
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={16} className="text-blue-600 shrink-0" />
          <div className="text-sm min-w-0">
            <span className="text-gray-500">Property Dev</span>
            <span className="text-gray-300 mx-1.5">/</span>
            <span className="font-semibold text-gray-900">{PAGE_LABELS[tab] ?? tab}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Company selector */}
          <div className="relative">
            <select
              value={selectedCompanyId}
              onChange={e => setSelectedCompanyId(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[200px] truncate"
            >
              <option value="all">🏢 All Companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Period selector */}
          <div className="relative">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 bg-white hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {PERIODS.map(p => <option key={p}>{p}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200" />

          {/* AI Insights */}
          <button
            onClick={onAiInsights}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-blue-600 text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <Sparkles size={13} />
            AI Insights
          </button>

          {/* Export */}
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
            <Download size={13} />
            Export
          </button>

          {/* Last updated */}
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <RefreshCw size={11} />
            {lastUpdated}
          </div>
        </div>
      </div>

      {/* Consolidated banner */}
      {selectedCompanyId === 'all' && (
        <div className="px-3 py-1.5 bg-blue-50 border-t border-blue-100 flex items-center gap-2 text-xs text-blue-700">
          <span className="font-semibold">Portfolio View:</span>
          <span>{companies.length} companies · {companies.reduce((s, c) => s + c.property.totalLots, 0)} lots total</span>
          <span className="text-blue-400">·</span>
          <span>Click any company below to drill in</span>
        </div>
      )}
    </div>
  );
}
