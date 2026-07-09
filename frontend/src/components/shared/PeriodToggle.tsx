import { useMemo } from 'react';
import { type Period, periodChipText } from '../../utils/periodWindow';
import { FCC } from '../../theme/demoPalette';

const MONTHS_LABEL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

interface PeriodToggleProps {
  period: Period | null;
  month: number;
  year: number;
  onChange: (p: Period | null, m: number, y: number) => void;
  availableKeys: string[];
}

const selectStyle: React.CSSProperties = {
  fontSize: 13,
  border: `1px solid ${FCC.cardBorder}`,
  borderRadius: 6,
  padding: '5px 10px',
  background: FCC.cardBg,
  color: FCC.textPrimary,
  cursor: 'pointer',
};

export default function PeriodToggle({ period, month, year, onChange, availableKeys }: PeriodToggleProps) {
  const availableYears = useMemo(
    () => [...new Set(availableKeys.map(k => parseInt(k.split(' ')[1])).filter(y => !isNaN(y)))].sort(),
    [availableKeys],
  );

  const availableMonthsForYear = useMemo(
    () => availableKeys
      .filter(k => k.endsWith(` ${year}`))
      .map(k => MONTHS_LABEL.indexOf(k.split(' ')[0]) + 1)
      .filter(m => m > 0)
      .sort((a, b) => a - b),
    [availableKeys, year],
  );

  const handlePeriodClick = (p: Period) => {
    if (period === p) { onChange(null, month, year); return; }
    const m = availableMonthsForYear.includes(month) ? month : availableMonthsForYear[availableMonthsForYear.length - 1] ?? month;
    onChange(p, m, year);
  };

  const handleYearChange = (y: number) => {
    const monthsForY = availableKeys
      .filter(k => k.endsWith(` ${y}`))
      .map(k => MONTHS_LABEL.indexOf(k.split(' ')[0]) + 1)
      .filter(m => m > 0)
      .sort((a, b) => a - b);
    const m = monthsForY.includes(month) ? month : monthsForY[monthsForY.length - 1] ?? month;
    onChange(period, m, y);
  };

  const handleMonthChange = (m: number) => onChange(period, m, year);

  const PERIODS: Period[] = ['MoM', 'YTD', 'TTM'];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{
        display: 'inline-flex',
        background: FCC.cardBg,
        border: `1px solid ${FCC.cardBorder}`,
        borderRadius: 999,
        padding: 3,
      }}>
        {PERIODS.map(p => (
          <button key={p} onClick={() => handlePeriodClick(p)} style={{
            fontSize: 12,
            fontWeight: period === p ? 600 : 500,
            color: period === p ? '#FFFFFF' : FCC.textSecondary,
            background: period === p ? FCC.accent : 'transparent',
            borderRadius: 999,
            padding: '5px 14px',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}>
            {p}
          </button>
        ))}
      </div>

      {period && (
        <select value={month} onChange={e => handleMonthChange(Number(e.target.value))} style={selectStyle}>
          {availableMonthsForYear.map(m => (
            <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>
          ))}
        </select>
      )}

      {period && (
        <select value={year} onChange={e => handleYearChange(Number(e.target.value))} style={selectStyle}>
          {availableYears.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}

      {period && (
        <span style={{
          fontSize: 11,
          color: FCC.textSecondary,
          background: FCC.cardBg,
          border: `1px solid ${FCC.cardBorder}`,
          borderRadius: 999,
          padding: '4px 12px',
          whiteSpace: 'nowrap',
        }}>
          {periodChipText(period, month, year)}
        </span>
      )}

      {period && (
        <button
          onClick={() => onChange(null, month, year)}
          style={{ fontSize: 11, color: FCC.textSecondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          ✕ Annual view
        </button>
      )}
    </div>
  );
}
