import type { ReactNode } from 'react';
import { FCC } from '../../theme/demoPalette';

export interface ParchmentKpiTileProps {
  label: string;
  value: string;
  sub?: string;
  /** One highlighted metric per page — soft indigo background */
  accent?: boolean;
  /** Warning flag — amber text on white card, not filled background */
  warn?: boolean;
  tip?: string;
  compact?: boolean;
  children?: ReactNode;
}

/** White KPI card — Finance Command Center style */
export function ParchmentKpiTile({
  label, value, sub, accent, warn, tip, compact, children,
}: ParchmentKpiTileProps) {
  const valueColor = accent ? FCC.accent : warn ? FCC.warning : FCC.textPrimary;

  return (
    <div
      className="fcc-kpi-tile"
      title={tip}
      style={{
        background: accent ? FCC.accentSoft : FCC.cardBg,
        border: accent
          ? `1px solid rgba(91,95,239,0.2)`
          : `1px solid ${FCC.cardBorder}`,
        borderLeft: accent ? `3px solid ${FCC.accent}` : undefined,
        borderRadius: 10,
        padding: compact ? '12px 14px' : '16px 18px',
        boxShadow: FCC.cardShadow,
        cursor: 'default',
      }}
    >
      <p style={{
        fontSize: compact ? 10 : 11,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
        color: FCC.textSecondary,
        marginBottom: 6,
      }}>
        {label}
      </p>
      <p style={{
        fontSize: compact ? 22 : 26,
        fontWeight: 600,
        color: valueColor,
        lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </p>
      {sub && (
        <p style={{
          fontSize: 12,
          color: warn ? FCC.warning : FCC.textSecondary,
          marginTop: 6,
          lineHeight: 1.35,
        }}>
          {sub}
        </p>
      )}
      {children}
    </div>
  );
}
