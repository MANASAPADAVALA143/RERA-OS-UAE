import type { RatioCard, RatioStatus } from '../../utils/financialRatioCalc';

const S: Record<RatioStatus, { borderColor: string; bg: string; pillBg: string; pillColor: string }> = {
  good:     { borderColor: '#166534', bg: '#F4FFF3', pillBg: '#166534', pillColor: '#fff' },
  watch:    { borderColor: '#F5A623', bg: '#FFFBF0', pillBg: '#F5A623', pillColor: '#fff' },
  critical: { borderColor: '#B91C1C', bg: '#FFF0F0', pillBg: '#B91C1C', pillColor: '#fff' },
  monitor:  { borderColor: '#F2994A', bg: '#FFF7EE', pillBg: '#F2994A', pillColor: '#fff' },
  info:     { borderColor: '#2F80ED', bg: '#F0F6FF', pillBg: '#2F80ED', pillColor: '#fff' },
};

function RatioCardComp({ card }: { card: RatioCard }) {
  const st = S[card.status];
  return (
    <div style={{
      position: 'relative',
      background: st.bg,
      borderLeft: `4px solid ${st.borderColor}`,
      borderRadius: 6,
      padding: '10px 12px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#262626', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.2 }}>{card.name}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#262626', fontFamily: 'monospace', margin: '4px 0 4px' }}>{card.value}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10, color: '#6B7280' }}>{card.formula}</span>
        <span style={{ fontSize: 10, fontWeight: 600, background: st.pillBg, color: st.pillColor, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>{card.statusLabel}</span>
      </div>
      {card.note && <p style={{ fontSize: 10, color: '#78716C', marginTop: 6, lineHeight: 1.4 }}>{card.note}</p>}
      {card.benchmark && <p style={{ fontSize: 10, color: '#A8A29E', marginTop: 4 }}>Benchmark: {card.benchmark}</p>}
    </div>
  );
}

export function RatioCardGrid({ cards }: { cards: RatioCard[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
      {cards.map(c => <RatioCardComp key={c.name} card={c} />)}
    </div>
  );
}
