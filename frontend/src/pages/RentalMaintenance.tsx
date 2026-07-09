import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Building2, Wrench } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import api from '../services/api';
import {
  type FinItem,
  type MaintPlRow,
  buildMaintenancePlRows,
  monthSortKey,
  parseMonthKey,
  MNAMES,
  EXP_PALETTE,
} from '../utils/rentalExpenseUtils';

interface CompanyOption { id: string; company_name: string; }

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

const PARCH_CARD: React.CSSProperties = {
  background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden',
};

const SEL: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: 8,
  fontSize: 13, background: '#F1F5F9', color: '#1C1917', outline: 'none',
};

const TT = { contentStyle: { background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13 } };

function PlCompanyCard({ company, rows }: { company: string; rows: MaintPlRow[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byAccount: Record<string, number> = {};
  for (const r of rows) byAccount[r.account] = (byAccount[r.account] ?? 0) + r.amount;
  const accounts = Object.entries(byAccount).sort((a, b) => b[1] - a[1]);
  const maxAmt = accounts[0]?.[1] ?? 1;

  return (
    <div style={PARCH_CARD}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Building2 size={16} style={{ color: '#92400E' }} />
        </div>
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#1C1917' }}>{company}</p>
          <p style={{ fontSize: 13, color: '#78716C', marginTop: 2 }}>{accounts.length} P&amp;L account{accounts.length !== 1 ? 's' : ''} · {fmt(total)}</p>
        </div>
      </div>
      <div style={{ padding: '16px 20px' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>P&amp;L Accounts</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {accounts.map(([account, amount], i) => (
            <div key={account} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ fontSize: 13, color: '#1C1917', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={account}>{account}</p>
              <div style={{ flex: 1, height: 8, background: '#E2E8F0', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(amount / maxAmt) * 100}%`, background: EXP_PALETTE[i % EXP_PALETTE.length], borderRadius: 99 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1C1917', width: 72, textAlign: 'right', flexShrink: 0 }}>{fmt(amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RentalMaintenance() {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [allPl, setAllPl] = useState<Record<string, FinItem[]>>({});
  const [allNames, setAllNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | ''>('');

  useEffect(() => {
    api.get<CompanyOption[]>('/api/rentals/companies')
      .then(r => setCompanies(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  const loadFinancials = useCallback(async (list: CompanyOption[]) => {
    setLoading(true);
    const results = await Promise.all(
      list.map(co =>
        api.get<{ company_name: string; pl: FinItem[] }>(`/api/rentals/financials/${co.id}`)
          .then(r => ({ id: co.id, name: r.data.company_name, pl: r.data.pl ?? [] }))
          .catch(() => ({ id: co.id, name: co.company_name, pl: [] as FinItem[] })),
      ),
    );
    const plMap: Record<string, FinItem[]> = {};
    const nameMap: Record<string, string> = {};
    results.forEach(r => { plMap[r.id] = r.pl; nameMap[r.id] = r.name; });
    setAllPl(plMap);
    setAllNames(nameMap);
    setLoading(false);
  }, []);

  useEffect(() => { if (companies.length) loadFinancials(companies); }, [companies, loadFinancials]);

  const allRows = useMemo<MaintPlRow[]>(() => {
    const ids = filterCompany ? [filterCompany] : Object.keys(allPl);
    return ids.flatMap(id => buildMaintenancePlRows(allNames[id] ?? id, allPl[id] ?? []));
  }, [allPl, allNames, filterCompany]);

  const availableYears = useMemo(() => {
    const years = new Set(allRows.map(r => parseMonthKey(r.month).year));
    return [...years].sort((a, b) => b - a);
  }, [allRows]);

  // Default year to latest with data
  useEffect(() => {
    if (availableYears.length && !availableYears.includes(filterYear)) {
      setFilterYear(availableYears[0]);
    }
  }, [availableYears, filterYear]);

  const monthsInYear = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach(r => {
      const { year, month } = parseMonthKey(r.month);
      if (year === filterYear) set.add(r.month);
    });
    return [...set].sort((a, b) => monthSortKey(a) - monthSortKey(b));
  }, [allRows, filterYear]);

  const filteredRows = useMemo(() => allRows.filter(r => {
    const { year, month } = parseMonthKey(r.month);
    if (year !== filterYear) return false;
    if (filterMonth !== '' && month !== filterMonth) return false;
    return true;
  }), [allRows, filterYear, filterMonth]);

  const byCompany = useMemo(() => {
    const map: Record<string, MaintPlRow[]> = {};
    for (const row of filteredRows) {
      if (!map[row.company]) map[row.company] = [];
      map[row.company].push(row);
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredRows]);

  const accountChart = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredRows) map[r.account] = (map[r.account] ?? 0) + r.amount;
    return Object.entries(map)
      .map(([account, amount]) => ({ account: account.length > 28 ? account.slice(0, 28) + '…' : account, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12);
  }, [filteredRows]);

  const summary = useMemo(() => ({
    total: filteredRows.reduce((s, r) => s + r.amount, 0),
    accounts: new Set(filteredRows.map(r => r.account)).size,
    companies: new Set(filteredRows.map(r => r.company)).size,
    lineItems: filteredRows.length,
  }), [filteredRows]);

  const periodLabel = filterMonth !== ''
    ? `${MNAMES[filterMonth - 1]} ${filterYear}`
    : `YTD ${filterYear}`;

  if (loading) return (
    <div className="space-y-5">
      <div className="h-8 w-48 bg-gray-100 animate-pulse rounded" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 animate-pulse rounded-xl" />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1C1917' }}>Maintenance</h1>
        <p style={{ fontSize: 13, color: '#78716C', marginTop: 2 }}>
          Repairs &amp; maintenance from uploaded P&amp;L · {periodLabel}
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)} style={SEL}>
          <option value="">All Companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select value={filterYear} onChange={e => { setFilterYear(Number(e.target.value)); setFilterMonth(''); }} style={SEL}>
          {(availableYears.length ? availableYears : [new Date().getFullYear()]).map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value === '' ? '' : Number(e.target.value))} style={SEL}>
          <option value="">All Months ({filterYear})</option>
          {monthsInYear.map(m => {
            const { month } = parseMonthKey(m);
            return <option key={m} value={month}>{m}</option>;
          })}
        </select>
        <button onClick={() => loadFinancials(companies)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, background: '#F1F5F9', color: '#78716C', cursor: 'pointer' }}>
          <RefreshCw size={13} /> Refresh
        </button>
        <span style={{ fontSize: 11, color: '#78716C', background: '#F7F1E6', border: '1px solid #E2E8F0', borderRadius: 20, padding: '3px 12px' }}>
          {periodLabel}
        </span>
      </div>

      {allRows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Wrench size={40} style={{ margin: '0 auto 16px', color: '#D4C4A0' }} />
          <p style={{ fontSize: 16, fontWeight: 600, color: '#78716C' }}>No maintenance data in P&amp;L</p>
          <p style={{ fontSize: 14, color: '#A8A29E', marginTop: 4 }}>
            Upload company financials (P&amp;L with repair/maintenance lines) under <strong>Financials</strong>.
          </p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <p style={{ fontSize: 14, color: '#A8A29E' }}>No maintenance expenses for {periodLabel}.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            {[
              { label: 'Total Spend', value: fmt(summary.total) },
              { label: 'Companies', value: String(summary.companies) },
              { label: 'P&L Accounts', value: String(summary.accounts) },
              { label: 'Line Items', value: String(summary.lineItems) },
            ].map(t => (
              <div key={t.label} style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 28, fontWeight: 700, color: '#1C1917', lineHeight: 1.1 }}>{t.value}</p>
                <p style={{ fontSize: 13, color: '#78716C', marginTop: 4 }}>{t.label}</p>
              </div>
            ))}
          </div>

          {accountChart.length > 0 && (
            <div style={{ ...PARCH_CARD, padding: 20 }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 14 }}>Spend by P&amp;L Account — {periodLabel}</p>
              <ResponsiveContainer width="100%" height={Math.max(200, accountChart.length * 28)}>
                <BarChart data={accountChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="account" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={TT.contentStyle} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {accountChart.map((_, i) => <Cell key={i} fill={EXP_PALETTE[i % EXP_PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detail table */}
          <div style={{ ...PARCH_CARD, padding: 0 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917' }}>Maintenance P&amp;L Detail</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#78716C', textAlign: 'left' }}>
                    <th className="py-2 px-4 font-medium">Company</th>
                    <th className="py-2 px-4 font-medium">P&amp;L Account</th>
                    <th className="py-2 px-4 font-medium">Month</th>
                    <th className="py-2 px-4 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows
                    .sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month) || b.amount - a.amount)
                    .map((r, i) => (
                      <tr key={`${r.company}-${r.account}-${r.month}-${i}`} style={{ borderBottom: '1px solid #F0EDE5' }}>
                        <td className="py-2 px-4">{r.company}</td>
                        <td className="py-2 px-4">{r.account}</td>
                        <td className="py-2 px-4">{r.month}</td>
                        <td className="py-2 px-4 text-right font-mono font-medium">{fmt(r.amount)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`grid gap-4 ${byCompany.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
            {byCompany.map(([company, rows]) => (
              <PlCompanyCard key={company} company={company} rows={rows} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
