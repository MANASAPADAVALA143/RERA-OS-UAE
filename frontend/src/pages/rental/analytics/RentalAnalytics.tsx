import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import PeriodToggle from '../../../components/shared/PeriodToggle';
import type { Period } from '../../../utils/periodWindow';
import { getAvailableKeys } from '../../../utils/rentalKpiEngine';
import { useRentalAnalyticsData } from '../../../hooks/useRentalAnalyticsData';
import AnalyticsExecutiveOverview from './AnalyticsExecutiveOverview';
import AnalyticsProfitability from './AnalyticsProfitability';
import AnalyticsCashDebt from './AnalyticsCashDebt';
import AnalyticsPropertyPerformance from './AnalyticsPropertyPerformance';
import AnalyticsExceptionView from './AnalyticsExceptionView';

const SUB_PAGES = [
  { path: '/rental/analytics', label: 'Executive Overview' },
  { path: '/rental/analytics/profitability', label: 'Profitability' },
  { path: '/rental/analytics/cash-debt', label: 'Cash & Debt' },
  { path: '/rental/analytics/property', label: 'Property' },
  { path: '/rental/analytics/exceptions', label: 'Exceptions' },
] as const;

export default function RentalAnalytics() {
  const location = useLocation();
  const navigate = useNavigate();
  const now = new Date();
  const [period, setPeriod] = useState<Period | null>('MoM');
  const [pMonth, setPMonth] = useState(now.getMonth() + 1);
  const [pYear, setPYear] = useState(now.getFullYear());

  const {
    companies, selectedCompanyId, setSelectedCompanyId,
    selected, ttmTrend, alerts, propertySlices, exceptionRows, loading,
  } = useRentalAnalyticsData(period, pMonth, pYear);

  const availableKeys = useMemo(() => {
    if (!selected?.fin) return [];
    return getAvailableKeys(selected.fin);
  }, [selected]);

  const activeSub = SUB_PAGES.find(p => location.pathname === p.path)?.path ?? '/rental/analytics';

  return (
    <div className="space-y-6">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart3 size={28} color="#B8860B" />
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1C1917', margin: 0 }}>Analytics</h1>
          </div>
          <p style={{ fontSize: 13, color: '#78716C', marginTop: 6, marginBottom: 0 }}>
            Power BI-style visual layer — same live KPI data as KPI Dashboard, new presentation only
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <select
            value={selectedCompanyId ?? ''}
            onChange={e => setSelectedCompanyId(e.target.value || null)}
            style={{
              fontSize: 13, padding: '8px 12px', borderRadius: 8,
              border: '1px solid #E8DEC8', background: '#FBF6EE', minWidth: 200,
            }}
          >
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
          <PeriodToggle
            period={period}
            month={pMonth}
            year={pYear}
            availableKeys={availableKeys}
            onChange={(p, m, y) => { setPeriod(p); setPMonth(m); setPYear(y); }}
          />
        </div>
      </div>

      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid #E8DEC8', paddingBottom: 0 }}>
        {SUB_PAGES.map(sp => {
          const active = activeSub === sp.path;
          return (
            <button
              key={sp.path}
              type="button"
              onClick={() => navigate(sp.path)}
              style={{
                fontSize: 13, fontWeight: active ? 600 : 500,
                color: active ? '#92400E' : '#78716C',
                background: active ? '#FBF6EE' : 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid #B8860B' : '2px solid transparent',
                padding: '10px 14px', cursor: 'pointer', marginBottom: -1,
              }}
            >
              {sp.label}
            </button>
          );
        })}
      </nav>

      {loading ? (
        <p style={{ color: '#78716C', fontSize: 14 }}>Loading analytics data…</p>
      ) : (
        <>
          {activeSub === '/rental/analytics' && (
            <AnalyticsExecutiveOverview selected={selected} ttmTrend={ttmTrend} alerts={alerts} />
          )}
          {activeSub === '/rental/analytics/profitability' && (
            <AnalyticsProfitability selected={selected} />
          )}
          {activeSub === '/rental/analytics/cash-debt' && (
            <AnalyticsCashDebt selected={selected} ttmTrend={ttmTrend} />
          )}
          {activeSub === '/rental/analytics/property' && (
            <AnalyticsPropertyPerformance propertySlices={propertySlices} />
          )}
          {activeSub === '/rental/analytics/exceptions' && (
            <AnalyticsExceptionView rows={exceptionRows} />
          )}
        </>
      )}
    </div>
  );
}
