import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../../../theme/execSummaryPremium.css';

/** Animates a numeric value from 0 to `value` on mount/change, ease-out. */
export function useCountUp(value: number, durationMs = 600): number {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const to = value;
    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return display;
}

export function CountUpUsd({ value, durationMs = 600 }: { value: number; durationMs?: number }) {
  const display = useCountUp(value, durationMs);
  return <>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(display)}</>;
}

export function CountUpNumber({ value, durationMs = 600, suffix = '' }: { value: number; durationMs?: number; suffix?: string }) {
  const display = useCountUp(value, durationMs);
  return <>{Math.round(display)}{suffix}</>;
}

export function ScoreBar({ score, colorFor }: { score: number; colorFor: (s: number) => string }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(Math.max(0, Math.min(100, score))));
    return () => cancelAnimationFrame(id);
  }, [score]);
  return (
    <div className="esp-bar-track" style={{ width: '100%' }}>
      <div className="esp-bar-fill" style={{ width: `${width}%`, background: colorFor(score) }} />
    </div>
  );
}

export function MiniBar({ pct, color }: { pct: number; color: string }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(Math.max(0, Math.min(100, pct))));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div className="esp-mini-bar-track">
      <div className="esp-mini-bar-fill" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

export function EmptyState({ icon, title, ctaLabel, onCta, note }: {
  icon: ReactNode; title: string; ctaLabel?: string; onCta?: () => void; note?: string;
}) {
  return (
    <div className="esp-empty">
      <div style={{ color: 'var(--slate)' }}>{icon}</div>
      <div className="esp-empty-title">{title}</div>
      {ctaLabel && (
        <button type="button" className="esp-btn-ghost" onClick={onCta}>{ctaLabel}</button>
      )}
      {note && <div className="esp-empty-note">{note}</div>}
    </div>
  );
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, 3000);
    return () => clearTimeout(id);
  }, [onClose]);
  return (
    <div
      className="esp-toast"
      style={{
        position: 'fixed', top: 20, right: 20, zIndex: 1000,
        background: 'var(--navy)', color: '#fff', borderLeft: '3px solid var(--gold)',
        borderRadius: 8, padding: '12px 20px', fontSize: 13, fontWeight: 500,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      }}
    >
      {message}
    </div>
  );
}

/** Tri-state status used throughout Executive Summary — replaces red/green entirely. */
export type EspStatus = 'Active' | 'Pending' | 'Overdue';

/** Categorical palette for donut/pie chart segments (up to 8 partners). */
export const DONUT_PALETTE = [
  '#1B3A6B', '#2E7D5E', '#5BB5A2', '#F5A623',
  '#E8821A', '#7C3AED', '#1D6FA4', '#C79A2B',
];

export function statusColor(status: EspStatus): string {
  if (status === 'Active') return 'var(--active)';
  if (status === 'Pending') return 'var(--pending)';
  return 'var(--overdue)';
}

export function statusBg(status: EspStatus): string {
  if (status === 'Active') return 'var(--active-bg)';
  if (status === 'Pending') return 'var(--pending-bg)';
  return 'var(--overdue-bg)';
}

export function statusCardBg(status: EspStatus): string {
  if (status === 'Active') return 'var(--active-card-bg)';
  if (status === 'Pending') return 'var(--pending-card-bg)';
  return 'var(--overdue-card-bg)';
}

/** @deprecated kept only as an alias during migration off the old severity model */
export function severityColor(sev: 'critical' | 'warning' | 'info'): string {
  if (sev === 'critical') return 'var(--overdue)';
  if (sev === 'warning') return 'var(--pending)';
  return 'var(--active)';
}

export function scoreColor(score: number): string {
  if (score > 75) return 'var(--active)';
  if (score >= 50) return 'var(--pending)';
  return 'var(--overdue)';
}

export function scoreStatus(score: number): EspStatus {
  if (score > 75) return 'Active';
  if (score >= 50) return 'Pending';
  return 'Overdue';
}

export function BadgePill({ badge }: { badge: EspStatus }) {
  return (
    <span className="esp-pill" style={{ background: statusBg(badge), color: statusColor(badge) }}>
      {badge}
    </span>
  );
}
