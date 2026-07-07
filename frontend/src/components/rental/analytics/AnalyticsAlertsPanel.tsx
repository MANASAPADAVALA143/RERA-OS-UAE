import type { AnalyticsAlert } from '../../../utils/rentalAnalyticsBullets';
import { AlertTriangle, Info, XCircle } from 'lucide-react';

const SEV = {
  bad: { bg: '#FFF0F0', border: '#FECACA', icon: XCircle, color: '#B91C1C' },
  warn: { bg: '#FFFBF0', border: '#FDE68A', icon: AlertTriangle, color: '#92400E' },
  info: { bg: '#F0F6FF', border: '#BFDBFE', icon: Info, color: '#1D4ED8' },
};

export function AnalyticsAlertsPanel({ alerts }: { alerts: AnalyticsAlert[] }) {
  return (
    <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Alerts</div>
      <div style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>
        KPIs in Review/Monitor status or with missing data
      </div>
      {alerts.length === 0 ? (
        <p style={{ fontSize: 13, color: '#166534', margin: 0 }}>No alerts — all tracked KPIs are healthy for this selection.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((a, i) => {
            const s = SEV[a.severity];
            const Icon = s.icon;
            return (
              <li key={`${a.kpi}-${i}`} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '10px 12px',
              }}>
                <Icon size={16} color={s.color} style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#1C1917', lineHeight: 1.4 }}>{a.message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
