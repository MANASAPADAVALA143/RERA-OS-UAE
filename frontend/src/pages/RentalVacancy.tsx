import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../services/api';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';

interface VacantUnit extends Record<string, unknown> {
  id: string;
  unit_number: string;
  company_name: string | null;
  property_name: string | null;
  days_vacant: number | null;
  monthly_rent: number;
  status_changed_at: string | null;
}

interface CompanyOption { id: string; company_name: string }

// ── shared styles ─────────────────────────────────────────────────────────────
const CARD: React.CSSProperties = {
  background: '#F1F5F9',
  border: '1px solid #E2E8F0',
  borderRadius: 12,
  padding: '18px 20px',
};
const TT = {
  contentStyle: { background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13 },
};

function VKpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      ...CARD,
      background: accent ? '#1E1B4B' : '#F1F5F9',
      border: accent ? '1px solid #6366F1' : '1px solid #E2E8F0',
    }}>
      <p style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: accent ? '#6366F1' : '#92400E', marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 34, fontWeight: 700, color: accent ? '#fff' : '#1C1917', lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums lining-nums' }}>{value}</p>
    </div>
  );
}

const SEL: React.CSSProperties = {
  background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#1C1917',
  borderRadius: 8, padding: '6px 12px', fontSize: 14,
};

export default function RentalVacancy() {
  const [units, setUnits]           = useState<VacantUnit[]>([]);
  const [companies, setCompanies]   = useState<CompanyOption[]>([]);
  const [filterCo, setFilterCo]     = useState('');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [sortKey, setSortKey]       = useState<keyof VacantUnit>('days_vacant');
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('desc');

  // load companies once for the dropdown
  useEffect(() => {
    api.get<CompanyOption[]>('/api/rentals/companies')
      .then(r => setCompanies(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params: Record<string, string> = { status: 'vacant' };
      if (filterCo) params.company_id = filterCo;
      const res = await api.get<VacantUnit[]>('/api/rentals/units', { params });
      setUnits(res.data);
    } catch {
      setError('Failed to load vacant units.');
    } finally {
      setLoading(false);
    }
  }, [filterCo]);

  useEffect(() => { load(); }, [load]);

  const totalLoss    = units.reduce((s, u) => s + u.monthly_rent, 0);
  const avgDays      = units.length > 0
    ? units.reduce((s, u) => s + (u.days_vacant ?? 0), 0) / units.length
    : 0;

  const byCompany: Record<string, number> = {};
  units.forEach(u => { const k = u.company_name ?? 'Unknown'; byCompany[k] = (byCompany[k] ?? 0) + u.monthly_rent; });
  const chartData = Object.entries(byCompany)
    .map(([name, loss]) => ({ name: name.length > 14 ? name.slice(0, 12) + '…' : name, loss }))
    .sort((a, b) => b.loss - a.loss);

  const sorted = [...units].sort((a, b) => {
    const av = a[sortKey] ?? (typeof a[sortKey] === 'number' ? 0 : '');
    const bv = b[sortKey] ?? (typeof b[sortKey] === 'number' ? 0 : '');
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const toggleSort = (key: keyof VacantUnit) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ k }: { k: keyof VacantUnit }) =>
    sortKey === k ? <span style={{ marginLeft: 4, opacity: 0.7 }}>{sortDir === 'asc' ? '↑' : '↓'}</span> : null;

  const TH = ({ label, k, right }: { label: string; k: keyof VacantUnit; right?: boolean }) => (
    <th onClick={() => toggleSort(k)} style={{
      padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#78716C', textAlign: right ? 'right' : 'left',
      textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
    }}>
      {label}<SortIcon k={k} />
    </th>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1C1917' }}>Vacancy &amp; Loss</h1>
          <p style={{ fontSize: 13, color: '#A8A29E', marginTop: 2 }}>Vacant units — real-time from unit records</p>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em' }}>COMPANY</span>
          <select value={filterCo} onChange={e => setFilterCo(e.target.value)} style={SEL}>
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
      </div>

      {loading ? <LoadingSkeleton rows={6} /> : error ? (
        <p style={{ color: '#B91C1C' }}>{error}</p>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-4">
            <VKpi label="Total Vacant Units"    value={String(units.length)} />
            <VKpi label="Monthly Vacancy Loss"  value={fmtUSD(totalLoss)} accent />
            <VKpi label="Avg Days Vacant"       value={avgDays > 0 ? `${avgDays.toFixed(0)}d` : '—'} />
          </div>

          {/* Vacant Units table */}
          <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0' }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: '#92400E' }}>Vacant Units</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead style={{ background: '#F0EDE5' }}>
                  <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <TH label="Unit"           k="unit_number" />
                    <TH label="Company"        k="company_name" />
                    <TH label="Property"       k="property_name" />
                    <TH label="Days Vacant"    k="days_vacant" right />
                    <TH label="Rent Lost/Month" k="monthly_rent" right />
                    <TH label="Vacant Since"   k="status_changed_at" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', fontSize: 14, color: '#A8A29E' }}>No vacant units</td></tr>
                  ) : sorted.map((u, i) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #F0EDE5', background: i % 2 === 0 ? '#F1F5F9' : '#F7F1E6' }}>
                      <td style={{ padding: '10px 14px', fontSize: 14, fontWeight: 500, color: '#1C1917' }}>{u.unit_number}</td>
                      <td style={{ padding: '10px 14px', fontSize: 14, color: '#92400E' }}>{u.company_name ?? '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 14, color: '#92400E' }}>{u.property_name ?? '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 14, textAlign: 'right', color: u.days_vacant ? '#B91C1C' : '#A8A29E', fontWeight: u.days_vacant ? 600 : 400, fontVariantNumeric: 'tabular-nums lining-nums' }}>
                        {u.days_vacant != null ? `${u.days_vacant}d` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums', color: u.monthly_rent > 0 ? '#B91C1C' : '#A8A29E', fontWeight: u.monthly_rent > 0 ? 600 : 400 }}>
                        {fmtUSD(u.monthly_rent)}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13, color: '#78716C' }}>
                        {u.status_changed_at ? new Date(u.status_changed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {sorted.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #E2E8F0', background: '#F0EDE5' }}>
                      <td colSpan={4} style={{ padding: '10px 14px', fontSize: 14, fontWeight: 700, color: '#1C1917' }}>Total Monthly Loss</td>
                      <td style={{ padding: '10px 14px', fontSize: 17, fontWeight: 700, color: '#B91C1C', textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>
                        {fmtUSD(totalLoss)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Vacancy Loss by Company chart */}
          {chartData.length > 0 && (
            <div style={CARD}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 16 }}>Vacancy Loss by Company</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#78716C' }} />
                  <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12, fill: '#78716C' }} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                  <Bar dataKey="loss" name="Vacancy Loss" fill="#C0392B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
