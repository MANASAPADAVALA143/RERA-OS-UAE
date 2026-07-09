import { useMemo } from 'react';
import { type Period, periodChipText } from '../../utils/periodWindow';

const MONTHS_LABEL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

interface PeriodToggleProps {
  period: Period | null;
  month: number;
  year: number;
  onChange: (p: Period | null, m: number, y: number) => void;
  availableKeys: string[]; // "MMM YYYY" strings that have actual data
}

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
    // clicking active period deselects (returns to Annual)
    if (period === p) { onChange(null, month, year); return; }
    // clamp month to available months for the year
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
      {/* Segmented control */}
      <div style={{
        display: 'inline-flex', background: '#F7F1E6',
        border: '1px solid #E2E8F0', borderRadius: 8, padding: 3,
      }}>
        {PERIODS.map(p => (
          <button key={p} onClick={() => handlePeriodClick(p)} style={{
            fontSize: 13,
            fontWeight: period === p ? 700 : 500,
            color: period === p ? '#1C1917' : '#78716C',
            background: period === p ? '#6366F1' : 'transparent',
            borderRadius: period === p ? 6 : 0,
            padding: '4px 16px',
            border: 'none',
            cursor: 'pointer',
            boxShadow: period === p ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s',
          }}>
            {p}
          </button>
        ))}
      </div>

      {/* Month dropdown */}
      {period && (
        <select
          value={month}
          onChange={e => handleMonthChange(Number(e.target.value))}
          style={{ fontSize: 13, border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 10px', background: '#F1F5F9', color: '#1C1917', cursor: 'pointer' }}
        >
          {availableMonthsForYear.map(m => (
            <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>
          ))}
        </select>
      )}

      {/* Year dropdown */}
      {period && (
        <select
          value={year}
          onChange={e => handleYearChange(Number(e.target.value))}
          style={{ fontSize: 13, border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 10px', background: '#F1F5F9', color: '#1C1917', cursor: 'pointer' }}
        >
          {availableYears.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}

      {/* Summary chip */}
      {period && (
        <span style={{
          fontSize: 11, color: '#78716C', background: '#F7F1E6',
          border: '1px solid #E2E8F0', borderRadius: 20, padding: '3px 12px',
          whiteSpace: 'nowrap',
        }}>
          {periodChipText(period, month, year)}
        </span>
      )}

      {/* Reset link */}
      {period && (
        <button
          onClick={() => onChange(null, month, year)}
          style={{ fontSize: 11, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          ✕ Annual view
        </button>
      )}
    </div>
  );
}
