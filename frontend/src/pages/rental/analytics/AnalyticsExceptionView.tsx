import type { ExceptionRow } from '../../../utils/rentalAnalyticsBullets';

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Review: { bg: '#FEE2E2', color: '#B91C1C' },
  Monitor: { bg: '#FEF3C7', color: '#92400E' },
  Info: { bg: '#DBEAFE', color: '#1D4ED8' },
  Healthy: { bg: '#DCFCE7', color: '#166534' },
};

export default function AnalyticsExceptionView({
  rows,
}: {
  rows: ExceptionRow[];
}) {
  return (
    <div className="space-y-4">
      <p style={{ fontSize: 13, color: '#78716C' }}>
        All companies — KPIs in Review, Monitor, N/A, or negative margin. Worst status rows first.
      </p>

      <div style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr style={{ background: '#F5EFE0', borderBottom: '1px solid #E2E8F0', textAlign: 'left' }}>
              {['Company', 'KPI', 'Value', 'Status', 'Benchmark Target'].map(h => (
                <th key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 600, color: '#78716C', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#166534' }}>
                  No exceptions — all KPIs across all companies are healthy for the selected period.
                </td>
              </tr>
            ) : rows.map((r, i) => {
              const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.Info;
              return (
                <tr key={`${r.companyId}-${r.kpi}-${i}`} style={{ borderBottom: '1px solid rgba(232,222,200,0.6)' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 500, color: '#1C1917' }}>{r.companyName}</td>
                  <td style={{ padding: '10px 16px' }}>{r.kpi}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'monospace' }}>{r.value}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                      fontSize: 11, fontWeight: 600, background: st.bg, color: st.color,
                    }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', color: '#78716C' }}>{r.benchmark}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
