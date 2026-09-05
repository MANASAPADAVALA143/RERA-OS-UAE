import { useEffect, useMemo, useRef, useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import { Sparkles, Download, RefreshCw, ChevronDown, Building2 } from 'lucide-react';
import { PT, parchmentStyles } from '../../theme/parchmentTheme';
import { PT_FONT } from '../../utils/parchmentTypography';
import { requestPropDevExportPdf } from '../../utils/propDevExportEvents';
import { PROPDEV_FINANCIALS_PDF_SCOPE_OPTIONS } from '../../utils/gatherPropDevSectionPdfData';
import PeriodToggle from '../shared/PeriodToggle';

interface Props {
  onAiInsights: () => void;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function defaultTrailingMonthKeys(months = 36): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`);
  }
  return keys;
}

export default function PropDevCommandStrip({ onAiInsights }: Props) {
  const {
    companies, selectedCompanyId, setSelectedCompanyId,
    financialPeriod, financialMonth, financialYear,
    setFinancialPeriodAnchor,
  } = usePropDev();
  const { tab } = usePropDevNav();
  const [lastUpdated] = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const isFinancials = tab === 'financials';
  const isCapitalCalls = tab === 'capital-calls';
  const isOwnership = tab === 'partners';
  const isLoans = tab === 'loans';
  const periodKeys = useMemo(() => defaultTrailingMonthKeys(), []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [exportMenuOpen]);

  const PAGE_LABELS: Record<string, string> = {
    dashboard: 'Command Center',
    partners: 'Ownership', 'capital-calls': 'Capital Calls',
    loans: 'Loan Tracker',
    'cash-flow': 'Cash Flow',
    financials: 'Financials', 'financial-ratios': 'Financial Ratios',
    upload: 'Upload Data', companies: 'Companies',
  };

  return (
    <div className="sticky top-0 z-30 px-4 lg:px-6 py-3" style={parchmentStyles.stickyBar}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={16} style={{ color: PT.accent }} className="shrink-0" />
          <div className="min-w-0" style={PT_FONT.control}>
            <span style={{ color: PT.muted }}>Property Dev</span>
            <span className="mx-1.5" style={{ color: PT.border }}>/</span>
            <span style={{ ...PT_FONT.button, color: PT.text }}>{PAGE_LABELS[tab] ?? tab}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <select
              value={selectedCompanyId}
              onChange={e => setSelectedCompanyId(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 rounded-lg cursor-pointer min-w-[200px] max-w-[320px] focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              style={{ ...parchmentStyles.select, fontWeight: 500 }}
            >
              <option value="all">All Companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id} title={c.name}>{c.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: PT.muted }} />
          </div>

          <div className="relative">
            <PeriodToggle
              compact
              period={financialPeriod}
              month={financialMonth}
              year={financialYear}
              availableKeys={periodKeys}
              onChange={setFinancialPeriodAnchor}
            />
          </div>

          <div className="w-px h-6" style={{ background: PT.border }} />

          <button type="button" onClick={onAiInsights} style={parchmentStyles.btnPrimary}>
            <Sparkles size={13} />
            AI Insights
          </button>

          <div ref={exportMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => {
                if (isFinancials && selectedCompanyId === 'all') {
                  requestPropDevExportPdf({ scope: 'portfolio' });
                } else if (isFinancials) setExportMenuOpen(o => !o);
                else if (isCapitalCalls) requestPropDevExportPdf({ scope: 'capital-calls' });
                else if (isOwnership) requestPropDevExportPdf({ scope: 'ownership' });
                else if (isLoans) requestPropDevExportPdf({ scope: 'loans' });
                else window.alert('Open Property Dev → Financials, Capital Calls, Ownership, or Loan Tracker, then use Export PDF.');
              }}
              style={parchmentStyles.btnSecondary}
              title={
                isFinancials && selectedCompanyId === 'all'
                  ? 'Export portfolio financials PDF (subtotals per company)'
                  : isCapitalCalls ? 'Export Capital Calls PDF'
                    : isOwnership ? 'Export Ownership PDF'
                      : isLoans ? 'Export Loan Tracker PDF'
                        : 'Export Financials PDF'
              }
            >
              <Download size={13} />
              {isFinancials && selectedCompanyId === 'all' ? 'Export Portfolio PDF' : 'Export PDF'}
              {isFinancials && selectedCompanyId !== 'all' && <ChevronDown size={13} />}
            </button>
            {exportMenuOpen && isFinancials && selectedCompanyId !== 'all' && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  minWidth: 260,
                  background: PT.cardBg,
                  border: `1px solid ${PT.border}`,
                  borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(58,47,31,0.14)',
                  zIndex: 60,
                  padding: 6,
                }}
              >
                {PROPDEV_FINANCIALS_PDF_SCOPE_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      requestPropDevExportPdf({ scope: opt.id });
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 12px',
                      border: 'none',
                      borderRadius: 7,
                      background: 'transparent',
                      cursor: 'pointer',
                      ...PT_FONT.button,
                      fontWeight: opt.id === 'combined' ? 700 : 500,
                      color: PT.text,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#EEF0FF'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1" style={{ ...PT_FONT.caption, color: PT.muted }}>
            <RefreshCw size={11} />
            {lastUpdated}
          </div>
        </div>
      </div>

      {selectedCompanyId === 'all' && companies.length > 0 && (
        <div
          className="mt-2 px-3 py-1.5 flex items-center gap-2 rounded-lg"
          style={{
            background: PT.cardBg,
            border: `1px solid ${PT.border}`,
            ...PT_FONT.caption,
            color: PT.muted,
          }}
        >
          <span style={{ fontWeight: 600, color: PT.text }}>Portfolio View:</span>
          <span>{companies.length} companies · {companies.length} properties</span>
          <span style={{ color: PT.border }}>·</span>
          <span>Select a company to drill in</span>
        </div>
      )}
    </div>
  );
}
