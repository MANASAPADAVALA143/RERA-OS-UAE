/**
 * RERA OS — Finance Command Center design tokens (main content area).
 * Sidebar uses --sidebar-navy; everything right of nav uses these.
 */
export const FCC = {
  sidebar: '#0B1437',
  pageBg: '#F7F8FA',
  cardBg: '#FFFFFF',
  cardBorder: '#E8E9ED',
  textPrimary: '#1A1D29',
  textSecondary: '#8B8D98',
  accent: '#5B5FEF',
  accentSoft: '#EEF0FF',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  cardShadow: '0 1px 2px rgba(0,0,0,0.04)',
  chart: ['#5B5FEF', '#22C55E', '#F59E0B', '#8B8D98'] as const,
} as const;

/** @deprecated Use FCC — kept for gradual migration */
export const DEMO = {
  accent: FCC.accent,
  accentDark: '#4F46E5',
  purple: '#7C3AED',
  teal: '#14B8A6',
  tealDark: '#0D9488',
  pageBg: FCC.pageBg,
  cardBg: FCC.cardBg,
  surfaceMuted: FCC.pageBg,
  border: FCC.cardBorder,
  borderStrong: '#D1D5DB',
  sidebar: FCC.sidebar,
  sidebarText: '#E8EAED',
  sidebarMuted: '#9CA3AF',
  text: FCC.textPrimary,
  textMuted: FCC.textSecondary,
  heroGradient: `linear-gradient(135deg, ${FCC.accent}, #7C3AED)`,
  accentRgb: '91, 95, 239',
} as const;

export const FCC_CARD = {
  background: FCC.cardBg,
  border: `1px solid ${FCC.cardBorder}`,
  borderRadius: 10,
  padding: 16,
  boxShadow: FCC.cardShadow,
} as const;
