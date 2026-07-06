export interface BulletDef {
  names:     string[];
  benchmark: number;
  unit:      string;
  reversed:  boolean;
  max:       number;
  extract:   (raw: string) => number;
}

export type BulletStatus = 'good' | 'watch' | 'critical' | 'monitor' | 'info';

export interface BulletCard {
  name:   string;
  value:  string;
  status: BulletStatus;
}

export const STATUS_BAR: Record<BulletStatus, string> = {
  good:     '#166534',
  watch:    '#F2C94C',
  critical: '#C0392B',
  monitor:  '#C0392B',
  info:     '#78716C',
};

export function BulletChartStrip({ cards, defs, title = 'Benchmark Comparison', subtitle }: {
  cards: BulletCard[];
  defs: BulletDef[];
  title?: string;
  subtitle?: string;
}) {
  const rows = defs.flatMap(def => {
    const card = cards.find(c => def.names.some(n => c.name === n));
    if (!card) return [];
    const current      = def.extract(card.value);
    const pctCurrent   = current > 0 ? Math.min(100, current   / def.max * 100) : 0;
    const pctBenchmark = Math.min(100, def.benchmark / def.max * 100);
    return [{ card, def, current, pctCurrent, pctBenchmark, fill: STATUS_BAR[card.status] }];
  });
  if (!rows.length) return null;

  return (
    <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917' }}>{title}</div>
      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3, marginBottom: 18 }}>
        {subtitle ?? 'Current metric health vs benchmark — bar colour reflects card status · ▎ marker = target'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px', gap: 12, paddingBottom: 8, borderBottom: '1px solid #E8DEC8', marginBottom: 4 }}>
        {['Metric', 'vs Benchmark', 'Current'].map((h, i) => (
          <div key={h} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: i === 2 ? 'right' : 'left' }}>{h}</div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {rows.map(({ card, def, current, pctCurrent, pctBenchmark, fill }, idx) => (
          <div key={card.name} style={{
            display: 'grid', gridTemplateColumns: '180px 1fr 80px', gap: 12, alignItems: 'center',
            padding: '8px 0', borderBottom: idx < rows.length - 1 ? '1px solid rgba(232,222,200,0.5)' : 'none',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#1C1917', lineHeight: 1.3 }}>{card.name}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>
                {def.reversed ? `< ${def.benchmark}${def.unit}` : `> ${def.benchmark}${def.unit}`} target
              </div>
            </div>

            <div style={{ position: 'relative', height: 22 }}>
              <div style={{ position: 'absolute', top: 6, left: 0, right: 0, height: 10, background: '#E8DEC8', borderRadius: 5 }} />
              {[25, 50, 75].map(t => (
                <div key={t} style={{ position: 'absolute', top: 6, left: `${t}%`, width: 1, height: 10, background: 'rgba(120,113,108,0.18)' }} />
              ))}
              {pctCurrent > 0 && (
                <div style={{ position: 'absolute', top: 6, left: 0, width: `${pctCurrent}%`, height: 10, background: fill, borderRadius: 5 }} />
              )}
              <div style={{
                position: 'absolute', top: 2, left: `${pctBenchmark}%`,
                width: 2, height: 18, background: '#5C5043', borderRadius: 1,
                transform: 'translateX(-1px)',
              }} />
            </div>

            <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: fill, fontVariantNumeric: 'tabular-nums lining-nums' }}>
              {card.value && card.value !== '0%' && card.value !== '0' ? card.value : '—'}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingLeft: 192, fontSize: 11, color: '#9CA3AF' }}>
        <span>0</span><span>25%</span><span>50%</span><span>75%</span><span>max</span>
      </div>
    </div>
  );
}
