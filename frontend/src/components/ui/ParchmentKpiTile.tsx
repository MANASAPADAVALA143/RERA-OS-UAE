import type { ReactNode } from 'react';
import { FCC } from '../../theme/demoPalette';

export type ParchmentKpiSize = 'default' | 'compact' | 'relaxed';

export interface ParchmentKpiTileProps {
  label: string;
  value: string;
  sub?: string;
  /** One highlighted metric per page — indigo accent background */
  accent?: boolean;
  /** Warning flag — amber text on white card, not filled background */
  warn?: boolean;
  /** Strong red value text (e.g. NOI Margin capped at -100%+). */
  danger?: boolean;
  tip?: string;
  /** @deprecated use size="compact" */
  compact?: boolean;
  size?: ParchmentKpiSize;
  children?: ReactNode;
  onClick?: () => void;
  drillable?: boolean;
}

const SIZE_STYLES: Record<ParchmentKpiSize, { radius: number; pad: string; label: number; value: number; sub: number; labelMb: number; subMt: number }> = {
  default: { radius: 10, pad: '16px 18px', label: 11, value: 26, sub: 12, labelMb: 6, subMt: 6 },
  compact: { radius: 10, pad: '12px 14px', label: 10, value: 22, sub: 11, labelMb: 4, subMt: 4 },
  relaxed: { radius: 11, pad: '14px 16px', label: 12, value: 26, sub: 13, labelMb: 6, subMt: 6 },
};

/** White KPI tile — Finance Command Center style; shared by Expenses, Financials, Ratios. */
export function ParchmentKpiTile({
  label, value, sub, accent, warn, danger, tip, compact, size, children, onClick, drillable,
}: ParchmentKpiTileProps) {
  const resolvedSize: ParchmentKpiSize = size ?? (compact ? 'compact' : 'default');
  const s = SIZE_STYLES[resolvedSize];
  const interactive = Boolean(onClick);
  const useAccent = Boolean(accent) && !danger;
  const valueColor = useAccent ? '#fff' : danger ? '#B91C1C' : warn ? FCC.warning : FCC.textPrimary;

  return (
    <div
      className="fcc-kpi-tile"
      title={tip}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      } : undefined}
      style={{
        background: useAccent ? `linear-gradient(135deg, ${FCC.accent}, #4F46E5)` : danger ? '#FEF2F2' : warn ? '#FEF3C7' : FCC.cardBg,
        border: useAccent ? 'none' : `1px solid ${danger ? '#FECACA' : warn ? '#FDE68A' : FCC.cardBorder}`,
        borderLeft: accent && !danger ? undefined : undefined,
        borderRadius: s.radius,
        padding: s.pad,
        boxShadow: FCC.cardShadow,
        cursor: interactive ? 'pointer' : 'default',
        transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
      }}
      onMouseEnter={interactive ? (e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(26,29,41,0.12)';
      } : undefined}
      onMouseLeave={interactive ? (e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = FCC.cardShadow;
      } : undefined}
    >
      <p style={{
        fontSize: s.label,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
        color: useAccent ? 'rgba(255,255,255,0.8)' : danger ? '#991B1B' : warn ? '#92400E' : FCC.textSecondary,
        marginBottom: s.labelMb,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
      }}>
        <span>{label}</span>
        {drillable && (
          <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>View detail</span>
        )}
      </p>
      <p style={{
        fontSize: s.value,
        fontWeight: 600,
        color: valueColor,
        lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </p>
      {sub && (
        <p style={{
          fontSize: s.sub,
          color: useAccent ? 'rgba(255,255,255,0.7)' : warn ? FCC.warning : FCC.textSecondary,
          marginTop: s.subMt,
          lineHeight: 1.35,
        }}>
          {sub}
        </p>
      )}
      {children}
    </div>
  );
}
