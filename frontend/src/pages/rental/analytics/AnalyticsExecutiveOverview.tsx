import { AnalyticsKpiCard, findKpiItem } from '../../../components/rental/analytics/AnalyticsKpiCard';
import { RevenueExpNoiComboChart } from '../../../components/rental/analytics/RevenueExpNoiComboChart';
import { AnalyticsAlertsPanel } from '../../../components/rental/analytics/AnalyticsAlertsPanel';
import type { AnalyticsSnapshot, MonthlyTrendPoint } from '../../../hooks/useRentalAnalyticsData';
import type { AnalyticsAlert } from '../../../utils/rentalAnalyticsBullets';

export default function AnalyticsExecutiveOverview({
  selected, ttmTrend, alerts,
}: {
  selected: AnalyticsSnapshot | null;
  ttmTrend: MonthlyTrendPoint[];
  alerts: AnalyticsAlert[];
}) {
  if (!selected?.sets) {
    return <p style={{ color: '#78716C', fontSize: 14 }}>Select a company with financial data to view analytics.</p>;
  }

  const items = selected.allItems;
  const cards = [
    findKpiItem(items, 'NOI Margin'),
    findKpiItem(items, 'Occupancy Rate'),
    findKpiItem(items, 'Cash Balance'),
    findKpiItem(items, 'DSCR (Est.)'),
    findKpiItem(items, 'Revenue Growth YoY'),
    findKpiItem(items, 'Rent Collection Rate'),
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <p style={{ fontSize: 13, color: '#78716C' }}>
        Executive overview for <strong style={{ color: '#1C1917' }}>{selected.companyName}</strong>
        {selected.label ? <> · <strong style={{ color: '#1C1917' }}>{selected.label}</strong></> : null}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((item, i) => item && <AnalyticsKpiCard key={item.label} item={item} accent={i === 0} />)}
      </div>

      <RevenueExpNoiComboChart data={ttmTrend} />
      <AnalyticsAlertsPanel alerts={alerts} />
    </div>
  );
}
