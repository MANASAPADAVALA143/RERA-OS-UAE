import { useRentalPortfolio, computeEntityMetrics, sumMetrics } from '../contexts/RentalPortfolioContext';
import { useRentalNav } from '../contexts/RentalNavContext';

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const pct = (n: number | null) => (n == null ? '—' : (n * 100).toFixed(1) + '%');
const x2 = (n: number | null) => (n == null ? '—' : n.toFixed(2) + 'x');

function dscrClass(v: number | null) {
  if (v == null) return 'text-gray-400';
  if (v >= 1.30) return 'text-green-800 font-semibold';
  if (v >= 1.10) return 'text-amber-600 font-semibold';
  return 'text-red-700 font-semibold';
}

export default function RentalEntityRollup() {
  const { portfolio } = useRentalPortfolio();
  const { setTab } = useRentalNav();

  if (!portfolio.loaded || portfolio.entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-500 text-sm">No portfolio data loaded yet.</p>
        <button onClick={() => setTab('portfolio-upload')}
          className="bg-[#0E3B36] text-white px-5 py-2 rounded-lg text-sm hover:bg-[#1A5249]">
          ← Upload Portfolio Data
        </button>
      </div>
    );
  }

  const { entities, arAp } = portfolio;
  const port = sumMetrics(entities);
  const totalDS = entities.reduce((s, e) => s + e.debt_service_annual, 0);
  const totalUnits = entities.reduce((s, e) => s + e.units, 0);
  const weightedOcc = totalUnits > 0
    ? entities.reduce((s, e) => s + e.occupancy_pct * e.units, 0) / totalUnits : 0;

  const rows = entities.map(e => {
    const m = computeEntityMetrics(e);
    const ar = arAp.find(r => r.entity_name.toLowerCase().includes(e.entity_name.toLowerCase().split(' ')[0]));
    const arTotal = ar ? ar.ar_current + ar.ar_1_30 + ar.ar_31_60 + ar.ar_61_90 + ar.ar_90_plus : 0;
    const pastDue = ar ? ar.ar_31_60 + ar.ar_61_90 + ar.ar_90_plus : 0;
    const apTotal = ar ? ar.ap_current + ar.ap_1_30 + ar.ap_31_60 + ar.ap_60_plus : 0;
    return { e, m, arTotal, pastDue, apTotal, nwc: arTotal - apTotal };
  });

  // Portfolio total AR/AP
  const totalAr = arAp.reduce((s, r) => s + r.ar_current + r.ar_1_30 + r.ar_31_60 + r.ar_61_90 + r.ar_90_plus, 0);
  const totalAp = arAp.reduce((s, r) => s + r.ap_current + r.ap_1_30 + r.ap_31_60 + r.ap_60_plus, 0);

  return (
    <div className="space-y-8" style={{ fontFamily: 'Georgia, serif' }}>
      <div>
        <p className="text-xs uppercase tracking-wider font-sans" style={{ color: '#B8860B' }}>Entity Roll-up</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">One Row per EIN</h1>
        <p className="text-sm text-gray-400 font-sans mt-1">Each row is a separate EIN — figures editable in Upload</p>
      </div>

      {/* Main entity table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-sans">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="px-3 py-2.5 text-left whitespace-nowrap">Entity</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Units</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Occ%</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">GPR</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">EGI</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">OpEx</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">NOI</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Debt Svc</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">DSCR</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Cap%</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">LTV%</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Cash Flow</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">AR</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">AP</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Past Due</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Net WC</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, m, arTotal, pastDue, apTotal, nwc }, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{e.entity_name}</td>
                  <td className="px-3 py-2 text-right font-mono">{e.units}</td>
                  <td className="px-3 py-2 text-right font-mono">{pct(e.occupancy_pct)}</td>
                  <td className="px-3 py-2 text-right font-mono">{$(m.gpr)}</td>
                  <td className="px-3 py-2 text-right font-mono">{$(m.egi)}</td>
                  <td className="px-3 py-2 text-right font-mono">{$(m.total_opex)}</td>
                  <td className="px-3 py-2 text-right font-mono">{$(m.noi)}</td>
                  <td className="px-3 py-2 text-right font-mono">{$(e.debt_service_annual)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${dscrClass(m.dscr)}`}>{x2(m.dscr)}</td>
                  <td className="px-3 py-2 text-right font-mono">{pct(m.cap_rate)}</td>
                  <td className="px-3 py-2 text-right font-mono">{pct(m.ltv)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${m.cash_flow < 0 ? 'text-red-700' : 'text-green-800'}`}>{$(m.cash_flow)}</td>
                  <td className="px-3 py-2 text-right font-mono">{$(arTotal)}</td>
                  <td className="px-3 py-2 text-right font-mono">{$(apTotal)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${pastDue > 0 ? 'text-red-700' : ''}`}>{$(pastDue)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${nwc < 0 ? 'text-red-700' : 'text-green-800'}`}>{$(nwc)}</td>
                </tr>
              ))}
            </tbody>
            {/* Portfolio total row */}
            <tfoot>
              <tr className="bg-gray-900 text-white font-bold">
                <td className="px-3 py-2.5">Portfolio Total</td>
                <td className="px-3 py-2.5 text-right font-mono">{totalUnits}</td>
                <td className="px-3 py-2.5 text-right font-mono">{pct(weightedOcc)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(port.gpr)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(port.egi)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(port.total_opex)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(port.noi)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(totalDS)}</td>
                <td className={`px-3 py-2.5 text-right font-mono ${port.dscr != null && port.dscr < 1.20 ? 'text-red-300' : 'text-green-300'}`}>{x2(port.dscr)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{pct(port.cap_rate)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{pct(port.ltv)}</td>
                <td className={`px-3 py-2.5 text-right font-mono ${port.cash_flow < 0 ? 'text-red-300' : 'text-green-300'}`}>{$(port.cash_flow)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(totalAr)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(totalAp)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(rows.reduce((s, r) => s + r.pastDue, 0))}</td>
                <td className="px-3 py-2.5 text-right font-mono">{$(totalAr - totalAp)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* AR/AP aging detail */}
      {arAp.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900">AR & AP Aging Detail</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-sans">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left bg-gray-900 text-white">Entity</th>
                  <th colSpan={6} className="px-3 py-2 text-center text-white whitespace-nowrap" style={{ backgroundColor: '#1E3A8A' }}>Accounts Receivable</th>
                  <th colSpan={5} className="px-3 py-2 text-center text-white whitespace-nowrap" style={{ backgroundColor: '#7B1D1D' }}>Accounts Payable</th>
                </tr>
                <tr>
                  <th className="px-3 py-2 text-left bg-gray-800 text-white">Entity</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#1E3A8A' }}>Current</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#1E3A8A' }}>1-30</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#1E3A8A' }}>31-60</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#1E3A8A' }}>61-90</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#1E3A8A' }}>90+</th>
                  <th className="px-3 py-2 text-right text-white font-bold whitespace-nowrap" style={{ backgroundColor: '#1E3A8A' }}>AR Total</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#7B1D1D' }}>Current</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#7B1D1D' }}>1-30</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#7B1D1D' }}>31-60</th>
                  <th className="px-3 py-2 text-right text-white whitespace-nowrap" style={{ backgroundColor: '#7B1D1D' }}>60+</th>
                  <th className="px-3 py-2 text-right text-white font-bold whitespace-nowrap" style={{ backgroundColor: '#7B1D1D' }}>AP Total</th>
                </tr>
              </thead>
              <tbody>
                {arAp.map((r, i) => {
                  const arTotal = r.ar_current + r.ar_1_30 + r.ar_31_60 + r.ar_61_90 + r.ar_90_plus;
                  const apTotal = r.ap_current + r.ap_1_30 + r.ap_31_60 + r.ap_60_plus;
                  return (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 font-medium">{r.entity_name}</td>
                      <td className="px-3 py-2 text-right font-mono">{$(r.ar_current)}</td>
                      <td className="px-3 py-2 text-right font-mono">{$(r.ar_1_30)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${r.ar_31_60 > 0 ? 'text-red-700' : ''}`}>{$(r.ar_31_60)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${r.ar_61_90 > 0 ? 'text-red-700' : ''}`}>{$(r.ar_61_90)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${r.ar_90_plus > 0 ? 'text-red-700 font-semibold' : ''}`}>{$(r.ar_90_plus)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{$(arTotal)}</td>
                      <td className="px-3 py-2 text-right font-mono">{$(r.ap_current)}</td>
                      <td className="px-3 py-2 text-right font-mono">{$(r.ap_1_30)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${r.ap_31_60 > 0 ? 'text-red-700' : ''}`}>{$(r.ap_31_60)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${r.ap_60_plus > 0 ? 'text-red-700' : ''}`}>{$(r.ap_60_plus)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{$(apTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
