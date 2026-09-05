/**
 * RERA OS design tokens shared across the Property Dev "new generation"
 * pages (Portfolio Command Center, Entity Dashboard, Loan Management,
 * Properties). Same shape as the EstateCFO reference's
 * `theme/propDevEnterpriseTheme`, retoned to the indigo/blue Finance
 * Command Center palette instead of the source app's navy/gold theme.
 * Scoped to these pages only via local imports — no shared app-wide
 * theme file touched, so no other module is affected.
 */
export const PD_FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

export const PD_IVORY = '#F7F8FA';
export const PD_NAVY = '#1A1D29';
export const PD_CARD_BG = '#FFFFFF';
export const PD_GOLD = '#5B5FEF';
export const PD_GOLD_LIGHT = '#EEF0FF';
export const PD_TEXT = '#1A1D29';
export const PD_SLATE = '#64748B';
export const PD_BORDER = '#E2E8F0';

export const PD_INDIGO = '#4F46E5';
export const PD_GREEN = '#16A34A';
export const PD_GREEN_BG = '#DCFCE7';
export const PD_GREEN_TEXT = '#166534';
export const PD_AMBER = '#F59E0B';
export const PD_AMBER_BG = '#FEF3C7';
export const PD_AMBER_TEXT = '#92400E';
export const PD_YELLOW = '#EAB308';
export const PD_RED = '#EF4444';
export const PD_RED_STRONG = '#DC2626';
export const PD_RED_BG = '#FEE2E2';
export const PD_GRAY_BG = '#F1F5F9';
export const PD_GRAY_TEXT = '#94A3B8';

export function pdLtlvTone(pct: number | null): { bg: string; text: string; bar: string } {
  if (pct == null) return { bg: PD_GRAY_BG, text: PD_GRAY_TEXT, bar: PD_BORDER };
  if (pct > 100) return { bg: PD_RED_BG, text: PD_RED_STRONG, bar: PD_RED };
  if (pct >= 60) return { bg: '#FEF9C3', text: PD_AMBER_TEXT, bar: PD_AMBER };
  return { bg: PD_GREEN_BG, text: PD_GREEN_TEXT, bar: '#22C55E' };
}

export function pdConcentrationColor(pct: number): string {
  if (pct >= 100) return PD_RED;
  if (pct >= 75) return PD_AMBER;
  if (pct >= 50) return PD_YELLOW;
  return '#22C55E';
}

export function pdRateTone(rate: number | null | undefined): { bg: string; text: string } {
  if (rate == null) return { bg: PD_GRAY_BG, text: PD_GRAY_TEXT };
  if (rate > 8) return { bg: PD_RED_BG, text: PD_RED_STRONG };
  if (rate >= 6) return { bg: '#FEF9C3', text: PD_AMBER_TEXT };
  return { bg: PD_GREEN_BG, text: '#16A34A' };
}

export function pdMaturityTone(days: number | null): { bg: string; text: string; bar: string } {
  if (days == null) return { bg: PD_GRAY_BG, text: PD_GRAY_TEXT, bar: PD_BORDER };
  if (days < 0) return { bg: PD_RED_BG, text: PD_RED_STRONG, bar: PD_RED };
  if (days < 365) return { bg: days < 90 ? PD_RED_BG : PD_AMBER_BG, text: days < 90 ? PD_RED_STRONG : PD_AMBER_TEXT, bar: days < 90 ? PD_RED : PD_AMBER };
  return { bg: PD_GREEN_BG, text: PD_GREEN_TEXT, bar: PD_GREEN };
}

export function PdSectionTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div
      className="text-sm font-bold mb-3 pl-3 flex items-center gap-1.5"
      style={{ color: PD_NAVY, borderLeft: `4px solid ${PD_GOLD}`, fontFamily: PD_FONT }}
    >
      {children}
      {icon}
    </div>
  );
}

export function PdSectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: PD_CARD_BG, border: `1px solid ${PD_BORDER}`, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
    >
      {children}
    </div>
  );
}

export function PdBadge({ text, tone, bold }: { text: string; tone: { bg: string; text: string }; bold?: boolean }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${bold ? 'font-bold' : 'font-semibold'}`}
      style={{ background: tone.bg, color: tone.text, fontFamily: PD_FONT }}
    >
      {text}
    </span>
  );
}
