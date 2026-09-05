import type { CSSProperties } from 'react';
import { PT as TypographyPT } from '../utils/parchmentTypography';

/**
 * Indigo/blue palette — same token shape as the EstateCFO reference's
 * `theme/parchmentTheme`, retoned to RERA OS's Finance Command Center
 * colors (see theme/demoPalette.ts) instead of cream/gold.
 */
export const PT = {
  pageBg: TypographyPT.pageBg,       // #F7F8FA
  cardBg: TypographyPT.cardBg,       // #FFFFFF
  cardAlt: TypographyPT.cardBg,
  stripeOdd: '#F7F8FA',
  stripeEven: '#FFFFFF',
  border: TypographyPT.border,       // #E8E9ED
  borderLight: TypographyPT.border,
  hdrBg: '#EEF0FF',
  hdrDark: '#DDE0FA',
  hdrText: '#1A1D29',
  text: TypographyPT.text,           // #1A1D29
  muted: TypographyPT.muted,         // #8B8D98
  accent: TypographyPT.gold,         // #5B5FEF
  accentDark: '#4F46E5',
} as const;

export const parchmentStyles = {
  page: { background: PT.pageBg, minHeight: '100%', fontSize: 13, color: PT.text } satisfies CSSProperties,
  stickyBar: {
    background: PT.pageBg,
    borderBottom: `1px solid ${PT.border}`,
    boxShadow: '0 1px 3px rgba(26,29,41,0.06)',
  } satisfies CSSProperties,
  card: {
    background: PT.cardBg,
    border: `1px solid ${PT.border}`,
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(26,29,41,0.06)',
  } satisfies CSSProperties,
  cardSm: {
    background: PT.cardBg,
    border: `1px solid ${PT.border}`,
    borderRadius: 8,
  } satisfies CSSProperties,
  uploadBar: {
    background: PT.hdrBg,
    border: `1px solid ${PT.border}`,
    borderRadius: 8,
  } satisfies CSSProperties,
  tabStrip: {
    display: 'inline-flex',
    flexWrap: 'wrap' as const,
    gap: 2,
    background: PT.stripeOdd,
    border: `1px solid ${PT.borderLight}`,
    borderRadius: 8,
    padding: 3,
  } satisfies CSSProperties,
  tabActive: {
    background: PT.accent,
    color: '#fff',
    fontWeight: 700,
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  } satisfies CSSProperties,
  tabInactive: {
    background: 'transparent',
    color: PT.muted,
    fontWeight: 500,
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  } satisfies CSSProperties,
  select: {
    background: PT.cardBg,
    border: `1px solid ${PT.border}`,
    borderRadius: 8,
    color: PT.text,
    fontSize: 13,
  } satisfies CSSProperties,
  btnSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 8,
    border: `1px solid ${PT.border}`,
    background: PT.cardBg,
    color: PT.muted,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  } satisfies CSSProperties,
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 8,
    border: `1px solid ${PT.accent}`,
    background: `linear-gradient(135deg, ${PT.accent}, ${PT.accentDark})`,
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  } satisfies CSSProperties,
};
