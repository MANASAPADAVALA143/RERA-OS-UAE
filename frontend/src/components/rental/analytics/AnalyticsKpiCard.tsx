import { ParchmentKpiTile } from '../../ui/ParchmentKpiTile';
import type { ExportKpiItem } from '../../utils/rentalKpiEngine';

const STATUS_ACCENT: Record<string, boolean> = { good: true };
const STATUS_WARN: Record<string, boolean> = { warn: true, bad: true };

export function AnalyticsKpiCard({ item, accent }: { item: ExportKpiItem; accent?: boolean }) {
  const warn = item.status === 'warn' || item.status === 'bad';
  return (
    <ParchmentKpiTile
      label={item.label}
      value={item.value}
      sub={`Target ${item.benchmark} · ${item.statusLabel}`}
      accent={accent ?? STATUS_ACCENT[item.status] ?? false}
      warn={!accent && (STATUS_WARN[item.status] ?? false)}
    />
  );
}

export function findKpiItem(items: ExportKpiItem[], ...labels: string[]): ExportKpiItem | undefined {
  return items.find(i => labels.some(l => i.label === l));
}
