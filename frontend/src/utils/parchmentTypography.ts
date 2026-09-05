/**
 * Shared typography/token set consumed by the ported Consultancy and
 * Property Dev "exec summary" pages. Same shape as the EstateCFO reference
 * (`utils/parchmentTypography`), retoned to RERA OS's indigo/blue Finance
 * Command Center palette instead of the source app's cream/gold theme.
 */
export const PT = {
  pageBg: '#F7F8FA',
  cardBg: '#FFFFFF',
  border: '#E8E9ED',
  gold: '#5B5FEF',
  text: '#1A1D29',
  muted: '#8B8D98',
  mutedLight: '#A6A8B3',
  green: '#16A34A',
  amber: '#B45309',
  red: '#C0392B',
  teal: '#0F766E',
  blue: '#2563EB',
} as const;

export const PT_FONT = {
  pageTitle: { fontSize: 26, fontWeight: 700 as const, color: PT.text, margin: 0 },
  pageSubtitle: { fontSize: 13, color: PT.mutedLight, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: 600 as const, color: PT.text, margin: 0 },
  sectionSubtitle: { fontSize: 12, color: PT.mutedLight, margin: '4px 0 0' },
  chartTitle: { fontSize: 16, fontWeight: 600 as const, color: PT.text, margin: '0 0 4px' },
  chartSubtitle: { fontSize: 12, color: PT.mutedLight, margin: '0 0 12px' },
  body: { fontSize: 13, color: PT.text },
  bodyMuted: { fontSize: 13, color: PT.muted },
  caption: { fontSize: 12, color: PT.mutedLight },
  table: { fontSize: 13 },
  tableHeader: {
    fontSize: 13,
    fontWeight: 600 as const,
    color: PT.muted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  tableCell: { fontSize: 13, color: PT.text },
  tab: { fontSize: 13, fontWeight: 500 as const },
  tabActive: { fontSize: 13, fontWeight: 700 as const },
  control: { fontSize: 13 },
  button: { fontSize: 13, fontWeight: 600 as const },
  chartTick: { fontSize: 12, fill: PT.muted },
  legend: { fontSize: 12 },
  tooltip: {
    background: PT.cardBg,
    border: `1px solid ${PT.border}`,
    borderRadius: 8,
    fontSize: 13,
  },
} as const;

export const PT_CARD = {
  background: PT.cardBg,
  border: `1px solid ${PT.border}`,
  borderRadius: 12,
  padding: '20px 24px',
  boxShadow: '0 1px 3px rgba(26,29,41,0.06)',
} as const;
