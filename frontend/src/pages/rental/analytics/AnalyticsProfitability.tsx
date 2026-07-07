import { useMemo } from 'react';
import { BulletChartStrip } from '../../../components/shared/BulletChartStrip';
import { ProfitWaterfallChart } from '../../../components/rental/analytics/ProfitWaterfallChart';
import {
  PROFITABILITY_BULLET_DEFS, RENTAL_PERF_BULLET_DEFS, exportItemsToBulletCards,
} from '../../../utils/rentalAnalyticsBullets';
import { buildProfitWaterfall } from '../../../utils/rentalAnalyticsCharts';
import type { AnalyticsSnapshot } from '../../../hooks/useRentalAnalyticsData';

export default function AnalyticsProfitability({
  selected,
}: {
  selected: AnalyticsSnapshot | null;
}) {
  const waterfall = useMemo(
    () => (selected?.k ? buildProfitWaterfall(selected.k) : []),
    [selected],
  );

  if (!selected?.sets || !selected.k) {
    return <p style={{ color: '#78716C', fontSize: 14 }}>Select a company with financial data to view profitability analytics.</p>;
  }

  const profCards = exportItemsToBulletCards(
    selected.sets.profitability.filter(i =>
      ['NOI Margin', 'Expense Ratio'].includes(i.label),
    ),
  );
  const rentalCards = exportItemsToBulletCards(
    selected.sets.profitability.filter(i =>
      ['Interest Coverage', 'Repair % of Revenue'].includes(i.label),
    ),
  );

  const profDefs = PROFITABILITY_BULLET_DEFS.filter(d =>
    d.names.some(n => ['NOI Margin', 'Expense Ratio'].includes(n)),
  );
  const rentalDefs = RENTAL_PERF_BULLET_DEFS.filter(d =>
    d.names.some(n => ['Interest Coverage', 'Repair % of Revenue'].includes(n)),
  );

  return (
    <div className="space-y-6">
      <p style={{ fontSize: 13, color: '#78716C' }}>
        Profitability & rental performance · <strong style={{ color: '#1C1917' }}>{selected.label}</strong>
      </p>
      <ProfitWaterfallChart data={waterfall} />
      <BulletChartStrip
        cards={profCards}
        defs={profDefs}
        title="Profitability Benchmarks"
        subtitle="NOI Margin and Expense Ratio vs targets from KPI Dashboard thresholds"
      />
      <BulletChartStrip
        cards={rentalCards}
        defs={rentalDefs}
        title="Rental Performance Benchmarks"
        subtitle="Interest Coverage and Repair % of Revenue vs targets"
      />
    </div>
  );
}
