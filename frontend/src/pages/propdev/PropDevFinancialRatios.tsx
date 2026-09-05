import { useState, useEffect, useMemo } from 'react';
import { api } from '../../services/api';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { LiveFinancialSummary } from '../../components/financials/LiveFinancialSummary';
import { RatioCardGrid } from '../../components/financials/RatioCardGrid';
import {
  ProfitabilityAnalysis,
  LiquidityAnalysis,
  SolvencyAnalysis,
  buildCostOfCapitalCards,
} from '../../components/financials/RatioTabAnalysis';
import { calcAllRatios, type LiveFin } from '../../utils/financialRatioCalc';
import PeriodToggle from '../../components/shared/PeriodToggle';
import { getPeriodFilterKeys, periodChipText, type Period } from '../../utils/periodWindow';
import { getPropDevAvailableKeys, resolveTotalDebt, type PDFinancialsLike } from '../../utils/propDevCfoTrendData';

type RatioTab = 'Profitability' | 'Liquidity' | 'Solvency' | 'Cost of Capital';
const RATIO_TABS: RatioTab[] = ['Profitability', 'Liquidity', 'Solvency', 'Cost of Capital'];
const NOW = new Date();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt$(n: number) {
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `$${(a / 1_000_000).toFixed(2)}M` : a >= 1_000 ? `$${(a / 1_000).toFixed(0)}K` : `$${a.toFixed(0)}`;
  return n < 0 ? `(${s})` : s;
}

function liveFinToKeys(fin: LiveFin): string[] {
  return getPropDevAvailableKeys(fin as unknown as PDFinancialsLike);
}

export default function PropDevFinancialRatios() {
  const { companies, loans, selectedCompanyId } = usePropDev();
  const [activeTab, setActiveTab] = useState<RatioTab>('Profitability');
  const [liveData, setLiveData] = useState<LiveFin | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number>(NOW.getFullYear());
  const [period, setPeriod] = useState<Period | null>(null);
  const [pMonth, setPMonth] = useState<number>(NOW.getMonth() + 1);
  const [pYear, setPYear] = useState<number>(NOW.getFullYear());

  const financialCompanyId = selectedCompanyId !== 'all' && companies.some(c => c.id === selectedCompanyId)
    ? selectedCompanyId
    : '';

  const availableYears = liveData?.years.length
    ? [...liveData.years].sort((a, b) => b - a)
    : Array.from({ length: 5 }, (_, i) => NOW.getFullYear() - i);

  const availableKeys = useMemo(
    () => (liveData ? liveFinToKeys(liveData) : []),
    [liveData],
  );

  useEffect(() => {
    if (!financialCompanyId) { setLiveData(null); return; }
    setLoadingLive(true);
    api.get<LiveFin>(`/api/propdev/financials/${financialCompanyId}`)
      .then(res => {
        setLiveData(res.data);
        const years = res.data?.years ?? [];
        if (years.length) {
          const latest = years[years.length - 1];
          setSelectedYear(latest);
          setPYear(latest);
        }
      })
      .catch(() => setLiveData(null))
      .finally(() => setLoadingLive(false));
  }, [financialCompanyId]);

  const selectedCompany = companies.find(c => c.id === financialCompanyId);
  const selectedCompanyName = selectedCompany?.name;
  const scopedLoans = useMemo(() => {
    if (!financialCompanyId) return loans;
    return loans.filter(l => l.companyId === financialCompanyId);
  }, [loans, financialCompanyId]);

  const selectedTotalDebt = useMemo(() => {
    if (liveData?.bs?.length) {
      const y = period ? pYear : selectedYear;
      const year = liveData.years.includes(y) ? y : liveData.years[liveData.years.length - 1];
      if (year != null) {
        const fromBs = resolveTotalDebt(
          selectedCompany ?? null,
          liveData as unknown as PDFinancialsLike,
          year,
          year === liveData.years[liveData.years.length - 1],
        );
        if (fromBs.amount > 0) return fromBs.amount;
      }
    }
    if (scopedLoans.length === 0) return null;
    return scopedLoans.reduce((s, l) => s + (l.balance ?? 0), 0);
  }, [liveData, selectedCompany, scopedLoans, period, pYear, selectedYear]);

  const periodKeys = useMemo(() => {
    if (!period || availableKeys.length === 0) return undefined;
    const keys = getPeriodFilterKeys(period, pMonth, pYear).filter(k => availableKeys.includes(k));
    return keys.length ? keys : undefined;
  }, [period, pMonth, pYear, availableKeys]);

  const activeYear = period ? pYear : selectedYear;
  const liveRatios = liveData
    ? calcAllRatios(liveData, activeYear, selectedTotalDebt, periodKeys)
    : null;

  const periodLabel = period
    ? periodChipText(period, pMonth, pYear)
    : `Annual · ${liveData?.years.includes(selectedYear) ? selectedYear : liveData?.years[liveData.years.length - 1] ?? selectedYear}`;

  const costCards = useMemo(() => buildCostOfCapitalCards(scopedLoans), [scopedLoans]);

  const solvencyCoData = useMemo(() => {
    if (!liveRatios || !selectedCompanyName) return [];
    const dscrCard = liveRatios.solvency.find(c => /DSCR/i.test(c.name));
    const icrCard = liveRatios.solvency.find(c => /Interest Coverage/i.test(c.name));
    const dscr = parseFloat(dscrCard?.value ?? '') || 0;
    const icr = parseFloat(icrCard?.value ?? '') || 0;
    if (dscr <= 0 && icr <= 0) return [];
    return [{ name: selectedCompanyName.split(' ').slice(0, 2).join(' '), dscr, icr }];
  }, [liveRatios, selectedCompanyName]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{ color: '#4F46E5' }}>FINANCIALS & RISK</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Financial Ratios & Analysis</h1>
        <p className="text-sm text-gray-500 mt-1">Property Development — Solvency, Profitability, Liquidity &amp; Cost of Capital</p>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <PeriodToggle
          period={period}
          month={pMonth}
          year={pYear}
          onChange={(p, m, y) => {
            setPeriod(p);
            setPMonth(m);
            setPYear(y);
            setSelectedYear(y);
          }}
          availableKeys={
            availableKeys.length > 0
              ? availableKeys
              : availableYears.flatMap(y => MONTHS.map(m => `${m} ${y}`))
          }
          compact
        />

        {!period && (
          <select
            value={selectedYear}
            onChange={e => {
              const y = Number(e.target.value);
              setSelectedYear(y);
              setPYear(y);
            }}
            className="px-3 py-1.5 rounded-lg border border-amber-300 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
            style={{ minWidth: 80 }}
          >
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}

        {financialCompanyId && !liveData && !loadingLive && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            No financials uploaded for this company — go to Financials to upload P&amp;L/B/S
          </span>
        )}
        {loadingLive && <span className="text-xs text-gray-400">Loading live data…</span>}
        {liveData && availableKeys.length === 0 && period && (
          <span className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5">
            No monthly columns in upload — ratios still use full-year {pYear} totals until a monthly P&amp;L is uploaded
          </span>
        )}
      </div>

      {liveData && <LiveFinancialSummary fin={liveData} activeYear={activeYear} totalDebt={selectedTotalDebt} />}

      {liveData && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#92400E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>● Live Data Active</span>
          <span style={{ fontSize: 12, color: '#78716C' }}>
            Ratio cards below are calculated from <strong style={{ color: '#1C1917' }}>{liveData.company_name}</strong>
            {' · '}<strong style={{ color: '#1C1917' }}>{periodLabel}</strong>
          </span>
        </div>
      )}

      {!financialCompanyId && (
        <div style={{ background: '#FFF7EE', border: '1px solid #F2994A', borderRadius: 8, padding: '8px 14px' }}>
          <span style={{ fontSize: 12, color: '#92400E' }}>Select a company in the top bar to show ratio cards calculated from uploaded P&amp;L + Balance Sheet data.</span>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {RATIO_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              fontSize: 13, fontWeight: activeTab === tab ? 600 : 500,
              color: activeTab === tab ? '#92400E' : '#6B6B6B',
              borderBottom: activeTab === tab ? '2px solid #92400E' : '2px solid transparent',
              padding: '8px 16px', marginBottom: -1, background: 'none',
              whiteSpace: 'nowrap', transition: 'color 0.15s',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'Profitability' && liveRatios && (
          <ProfitabilityAnalysis cards={liveRatios.profitability} liveFin={liveData} />
        )}
        {activeTab === 'Liquidity' && liveRatios && (
          <LiquidityAnalysis cards={liveRatios.liquidity} liveFin={liveData} />
        )}
        {activeTab === 'Solvency' && liveRatios && (
          <SolvencyAnalysis cards={liveRatios.solvency} coData={solvencyCoData} />
        )}
        {activeTab === 'Cost of Capital' && (
          <div className="space-y-6">
            <RatioCardGrid cards={costCards} />
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>
                  Loan Schedule — {selectedCompanyName ?? 'All Companies'}
                </h3>
              </div>
              {scopedLoans.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-500">No loans found for this company</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: '#EFE0C8' }}>
                        {['Bank', 'Loan Amount', 'Rate', 'Monthly Pmt', 'Balance', 'Maturity', 'Status'].map(h => (
                          <th key={h} style={{ fontSize: 11, fontWeight: 600, color: '#5C5043', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 12px', textAlign: h === 'Bank' ? 'left' : 'center' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {scopedLoans.map(l => (
                        <tr key={l.id} className="hover:bg-gray-50">
                          <td style={{ fontSize: 12, fontWeight: 500, color: '#262626', padding: '8px 12px', whiteSpace: 'nowrap' }}>{l.bank}</td>
                          <td style={{ fontSize: 12, color: '#262626', fontFamily: 'monospace', padding: '8px 12px', textAlign: 'right' }}>{fmt$(l.amount)}</td>
                          <td style={{ fontSize: 12, color: l.interestRate > 7 ? '#B91C1C' : l.interestRate > 5.5 ? '#F5A623' : '#166534', fontFamily: 'monospace', fontWeight: 600, padding: '8px 12px', textAlign: 'center' }}>{l.interestRate.toFixed(2)}%</td>
                          <td style={{ fontSize: 12, color: '#262626', fontFamily: 'monospace', padding: '8px 12px', textAlign: 'right' }}>{fmt$(l.emi)}</td>
                          <td style={{ fontSize: 12, color: '#262626', fontFamily: 'monospace', padding: '8px 12px', textAlign: 'right' }}>{fmt$(l.balance)}</td>
                          <td style={{ fontSize: 12, color: '#262626', padding: '8px 12px', textAlign: 'center' }}>{l.maturityDate ? new Date(l.maturityDate).getFullYear() : '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: l.status === 'Active' ? '#D4EDDA' : '#FFF3CD', color: l.status === 'Active' ? '#155724' : '#92400E' }}>
                              {l.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {scopedLoans.length > 0 && (
              <div className="space-y-3">
                {[
                  { icon: '💡', text: 'Review active loans and refinancing opportunities at current market rates.' },
                  { icon: '💡', text: 'Monitor loans approaching maturity and plan refinance strategy ahead of balloon risk.' },
                  { icon: '💡', text: 'Track LTLV vs Land Value — lower LTLV supports better refinance terms and partner optics.' },
                ].map((item, i) => (
                  <div key={i} className="flex gap-3 items-start bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <span className="text-base shrink-0">{item.icon}</span>
                    <p className="text-sm text-amber-900">{item.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab !== 'Cost of Capital' && !liveRatios && financialCompanyId && !loadingLive && (
          <p className="text-sm text-gray-500 py-8 text-center">Upload financial statements in the Financials tab to see live ratio calculations.</p>
        )}
      </div>
    </div>
  );
}
