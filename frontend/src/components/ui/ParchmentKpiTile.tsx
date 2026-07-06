import type { ReactNode } from 'react';

export interface ParchmentKpiTileProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  warn?: boolean;
  tip?: string;
  compact?: boolean;
  children?: ReactNode;
}

/** Parchment / gold KPI tile — shared by Expenses, Financials, and Ratios. */
export function ParchmentKpiTile({
  label, value, sub, accent, warn, tip, compact, children,
}: ParchmentKpiTileProps) {
  return (
    <div
      className="parchment-kpi-tile"
      title={tip}
      style={{
        background: accent ? 'linear-gradient(135deg,#D4AF37,#B8860B)' : warn ? '#FEF3C7' : '#FBF6EE',
        border: `1px solid ${warn ? '#FDE68A' : '#E8DEC8'}`,
        borderRadius: 12,
        padding: compact ? '12px 14px' : '16px 18px',
        cursor: 'default',
        transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
      }}
    >
      <p style={{
        fontSize: compact ? 11 : 13,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: accent ? 'rgba(255,255,255,0.8)' : warn ? '#92400E' : '#78716C',
        marginBottom: 4,
      }}>
        {label}
      </p>
      <p style={{
        fontSize: compact ? 22 : 28,
        fontWeight: 700,
        color: accent ? '#fff' : warn ? '#92400E' : '#1C1917',
        lineHeight: 1.1,
      }}>
        {value}
      </p>
      {sub && (
        <p style={{
          fontSize: 12,
          color: accent ? 'rgba(255,255,255,0.7)' : '#A8A29E',
          marginTop: 4,
        }}>
          {sub}
        </p>
      )}
      {children}
    </div>
  );
}
