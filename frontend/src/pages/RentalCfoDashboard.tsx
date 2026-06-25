import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const fmt$ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const COMPANIES = [
  { name: 'Sunstone Rentals LLC',     units: 6, occupied: 5, rent: 9885,  collected: 7535, noi: 164,  margin: 1.7  },
  { name: 'Meridian Residential LLC', units: 6, occupied: 5, rent: 11140, collected: 9850, noi: 2480, margin: 22.3 },
  { name: 'Cornerstone Housing LLC',  units: 6, occupied: 5, rent: 9535,  collected: 8420, noi: 1820, margin: 19.1 },
  { name: 'Pinnacle Rentals I LLC',   units: 6, occupied: 5, rent: 10645, collected: 9400, noi: 2100, margin: 19.7 },
  { name: 'Summit Living LLC',        units: 6, occupied: 5, rent: 9635,  collected: 8500, noi: 1640, margin: 17.0 },
  { name: 'Heritage Residential LLC', units: 6, occupied: 5, rent: 9635,  collected: 8200, noi: 1420, margin: 14.7 },
  { name: 'Riverview Rentals LLC',    units: 6, occupied: 5, rent: 10345, collected: 9100, noi: 2260, margin: 21.8 },
  { name: 'Landmark Housing LLC',     units: 6, occupied: 5, rent: 9940,  collected: 8750, noi: 1980, margin: 19.9 },
  { name: 'Horizon Rentals LLC',      units: 6, occupied: 5, rent: 10345, collected: 9200, noi: 2040, margin: 19.7 },
  { name: 'Crestview Living LLC',     units: 6, occupied: 5, rent: 10195, collected: 9100, noi: 2080, margin: 20.4 },
];

const PIE_COLORS = [
  '#dc2626','#1d4ed8','#16a34a','#7c3aed','#d97706',
  '#0891b2','#65a30d','#db2777','#ea580c','#4338ca',
];

function statusInfo(margin: number) {
  if (margin > 20) return { label: '🟢 Healthy', cls: 'bg-green-100 text-green-800' };
  if (margin >= 15) return { label: '🟡 Watch',   cls: 'bg-amber-100 text-amber-800' };
  return               { label: '⚠️ Low NOI',   cls: 'bg-red-100 text-red-800' };
}

export default function RentalCfoDashboard() {
  const barData = COMPANIES.map(c => ({
    name: c.name.split(' ').slice(0, 2).join(' '),
    Rent: c.rent,
    Collected: c.collected,
  }));

  const pieData = COMPANIES.map(c => ({
    name: c.name.split(' ').slice(0, 2).join(' '),
    value: Math.max(c.noi, 0),
  }));

  const TILES = [
    { label: 'Total Rent Roll',  value: fmt$(108060) + '/mo', sub: 'EGI excl. vacant'  },
    { label: 'Rent Collected',   value: fmt$(95535),           sub: 'Current month'     },
    { label: 'Collection Rate',  value: '88.4%',               sub: 'vs 90% target'     },
    { label: 'NOI (Portfolio)',  value: fmt$(42180),            sub: 'EGI − OpEx'        },
    { label: 'Vacancy Loss',     value: fmt$(9885),             sub: '10 units vacant'   },
    { label: 'Total Units',      value: '60',                  sub: '50 occupied'        },
  ];

  const ACTIONS = [
    { icon: '⚠️', cls: 'bg-red-50 border-red-200',    text: 'Sunstone NOI at $164 — expenses exceed collections this month. Review HOA + maintenance costs.' },
    { icon: '⚠️', cls: 'bg-amber-50 border-amber-200', text: 'Portfolio collection rate 88.4% — below 90% target. 3 units have outstanding AR.' },
    { icon: 'ℹ️', cls: 'bg-blue-50 border-blue-200',   text: '10 units currently vacant across portfolio. At avg $1,897/mo = $18,970 monthly revenue opportunity.' },
    { icon: '✅', cls: 'bg-green-50 border-green-200', text: '8 of 10 companies above 15% NOI margin — portfolio health strong.' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-wider" style={{ color: '#B8860B' }}>CFO VIEW</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">CFO Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">10 entities · 60 units · Rental Portfolio</p>
      </div>

      {/* Section A — 6 KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {TILES.map(t => (
          <div key={t.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{t.label}</p>
            <p className="text-lg font-bold font-mono text-gray-900">{t.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>

      {/* Section B — Company Performance Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Company Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-center px-3 py-3">Units</th>
                <th className="text-center px-3 py-3">Occ</th>
                <th className="text-center px-3 py-3">Occ%</th>
                <th className="text-right px-3 py-3">Monthly Rent</th>
                <th className="text-right px-3 py-3">Collected</th>
                <th className="text-right px-3 py-3">NOI</th>
                <th className="text-center px-3 py-3">NOI Margin</th>
                <th className="text-center px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {COMPANIES.map(c => {
                const s = statusInfo(c.margin);
                return (
                  <tr key={c.name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 text-xs whitespace-nowrap">{c.name}</td>
                    <td className="px-3 py-3 text-center text-gray-600">{c.units}</td>
                    <td className="px-3 py-3 text-center text-gray-600">{c.occupied}</td>
                    <td className="px-3 py-3 text-center text-gray-600">83.3%</td>
                    <td className="px-3 py-3 text-right font-mono">{fmt$(c.rent)}</td>
                    <td className="px-3 py-3 text-right font-mono">{fmt$(c.collected)}</td>
                    <td className={`px-3 py-3 text-right font-mono font-bold ${c.noi < 500 ? 'text-red-600' : 'text-gray-900'}`}>
                      {fmt$(c.noi)}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-gray-700">{c.margin.toFixed(1)}%</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section C — Two charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">Monthly Rent vs Collected</h2>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={barData} margin={{ left: 0, right: 0, top: 5, bottom: 45 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number, n: string) => [fmt$(v), n]} />
              <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Rent"      fill="#1a3a2a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Collected" fill="#B8860B" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">NOI Distribution by Company</h2>
          <ResponsiveContainer width="100%" height={270}>
            <PieChart>
              <Pie
                data={pieData} cx="50%" cy="45%"
                outerRadius={85} dataKey="value" nameKey="name"
              >
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [fmt$(v), 'NOI']} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 9 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Section D — CFO Action Items */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-base font-bold text-gray-900 mb-4">CFO Action Items</h2>
        <div className="space-y-3">
          {ACTIONS.map((a, i) => (
            <div key={i} className={`flex gap-3 items-start rounded-lg border p-3 ${a.cls}`}>
              <span className="text-base mt-0.5 shrink-0">{a.icon}</span>
              <p className="text-sm text-gray-700">{a.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
