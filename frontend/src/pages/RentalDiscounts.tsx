import { useState, useMemo } from 'react';
import { Plus, X, Lightbulb, Calculator, Zap } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
type DiscountType   = 'promotional' | 'fixed' | 'percentage';
type DiscountStatus = 'active' | 'expired' | 'pending';
type DiscountReason = 'Long vacancy' | 'Tenant loyalty' | 'Maintenance issue' | 'Market adjustment' | 'Early renewal' | 'Move-in incentive';

interface Discount {
  id: string; unit: string; building: string; company: string;
  type: DiscountType; value: string; startDate: string; endDate: string;
  reason: string; status: DiscountStatus; monthlyImpact: number; notes?: string;
}

// ── Static data ───────────────────────────────────────────────────────────────
const SEED_DISCOUNTS: Discount[] = [];

const UNIT_OPTIONS = [
  { id:'U02', label:'Unit 01-02 — Desert Vista Townhomes',  rent:2100, vacant:true  },
  { id:'U04', label:'Unit 02-03 — Crestline Apartments',    rent:2050, vacant:true  },
  { id:'U01', label:'Unit 01-01 — Desert Vista Townhomes',  rent:2000, vacant:false },
  { id:'U03', label:'Unit 02-01 — Crestline Apartments',    rent:1950, vacant:false },
  { id:'U05', label:'Unit 03-01 — Oakwood Commons',         rent:1800, vacant:false },
  { id:'U06', label:'Unit 04-02 — Pinnacle Ridge Homes',    rent:2200, vacant:false },
  { id:'U07', label:'Unit 05-01 — Summit Park Flats',       rent:1750, vacant:false },
  { id:'U08', label:'Unit 06-03 — Heritage Glen Suites',    rent:1850, vacant:false },
];

const VACANT_RECS: { unit:string; building:string; company:string; marketRent:number; vacantMonths:number; lost:number }[] = [];

const PROMOTIONS: string[] = ['First month free','2 weeks free','Refer a friend — $200 off first month','Custom promotion'];
const REASONS: DiscountReason[] = ['Long vacancy','Tenant loyalty','Maintenance issue','Market adjustment','Early renewal','Move-in incentive'];
const STORAGE_KEY = 'estatecfo_discounts_v1';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => '$' + n.toLocaleString('en-US');

function loadDiscounts(): Discount[] {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : SEED_DISCOUNTS; }
  catch { return SEED_DISCOUNTS; }
}
function saveDiscounts(d: Discount[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }

const TYPE_BADGE: Record<DiscountType,string>   = { promotional:'bg-purple-100 text-purple-700', fixed:'bg-blue-100 text-blue-700', percentage:'bg-amber-100 text-amber-700' };
const STATUS_BADGE: Record<DiscountStatus,string> = { active:'bg-green-100 text-green-700', expired:'bg-gray-100 text-gray-500', pending:'bg-blue-100 text-blue-700' };

// ── AI mock recommendation ────────────────────────────────────────────────────
function buildAiRec(u: typeof VACANT_RECS[0]): string {
  return (
    `Based on ${u.vacantMonths} months of vacancy and market rent of ${fmt(u.marketRent)}/month:\n\n` +
    `OPTION A — First Month Free  ✅ Recommended\n` +
    `Cost: ${fmt(u.marketRent)} once-off. Units with this offer fill 3–4× faster.\n` +
    `Net benefit vs. staying vacant: ${fmt(u.lost - u.marketRent)}.\n\n` +
    `OPTION B — 10% off for 3 months (${fmt(Math.round(u.marketRent * 0.1))}/mo)\n` +
    `Total cost: ${fmt(Math.round(u.marketRent * 0.1 * 3))}. Appeals to stability-seeking tenants.\n\n` +
    `OPTION C — $200 off first 3 months\n` +
    `Total cost: $600. Low-risk entry-point discount, easy to communicate.\n\n` +
    `Verdict: Option A wins. Every month this unit stays vacant costs ${fmt(u.marketRent)}.` +
    ` The one-month incentive is recovered within the first lease year.`
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RentalDiscounts() {
  const [discounts, setDiscounts] = useState<Discount[]>(loadDiscounts);

  // Filters
  const [fCo,     setFCo]     = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fType,   setFType]   = useState('');

  // Modal
  const [showModal,  setShowModal]  = useState(false);
  const [modalType,  setModalType]  = useState<DiscountType>('promotional');
  const [fUnit,      setFUnit]      = useState(UNIT_OPTIONS[0].id);
  const [fPromo,     setFPromo]     = useState(PROMOTIONS[0]);
  const [fPromoDesc, setFPromoDesc] = useState('');
  const [fAmount,    setFAmount]    = useState('');
  const [fAmtType,   setFAmtType]   = useState<'monthly'|'one-time'>('monthly');
  const [fPct,       setFPct]       = useState('');
  const [fDuration,  setFDuration]  = useState('3');
  const [fReason,    setFReason]    = useState<DiscountReason>('Long vacancy');
  const [fStart,     setFStart]     = useState('2025-07-01');
  const [fEnd,       setFEnd]       = useState('2025-09-30');
  const [fNotes,     setFNotes]     = useState('');

  // AI advisor
  const [aiUnit,    setAiUnit]    = useState<typeof VACANT_RECS[0]|null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult,  setAiResult]  = useState<string|null>(null);

  // Calculator
  const [calcRent,   setCalcRent]   = useState('2100');
  const [calcPct,    setCalcPct]    = useState('10');
  const [calcMonths, setCalcMonths] = useState('3');

  const companies = [...new Set(discounts.map(d => d.company).filter(Boolean))];

  const filtered = useMemo(() => discounts.filter(d => {
    if (fCo     && d.company !== fCo)     return false;
    if (fStatus && d.status  !== fStatus) return false;
    if (fType   && d.type    !== fType)   return false;
    return true;
  }), [discounts, fCo, fStatus, fType]);

  const active = discounts.filter(d => d.status === 'active');
  const kpis = {
    count:      active.length,
    value:      active.reduce((s,d) => s+d.monthlyImpact, 0),
    units:      new Set(active.map(d => d.unit)).size,
    avgPct:     Math.round(
      active.filter(d=>d.type==='percentage').reduce((s,d)=>s+parseFloat(d.value),0) /
      (active.filter(d=>d.type==='percentage').length||1)
    ),
  };

  // ── Add discount ──────────────────────────────────────────────────────────
  function addDiscount() {
    const opt = UNIT_OPTIONS.find(u => u.id === fUnit)!;
    const unitLabel = opt.label.split('—')[0].trim().replace('Unit ','');
    const building  = opt.label.split('—')[1]?.trim() ?? '';
    let value = ''; let impact = 0;
    if (modalType === 'promotional') { value = fPromo === 'Custom promotion' ? fPromoDesc : fPromo; impact = opt.rent; }
    if (modalType === 'fixed')       { value = `${fmt(Number(fAmount))} ${fAmtType}`; impact = Number(fAmount); }
    if (modalType === 'percentage')  { value = `${fPct}%`; impact = Math.round(opt.rent*Number(fPct)/100); }
    const d: Discount = {
      id: `d${Date.now()}`, unit: unitLabel, building, company: '',
      type: modalType, value, startDate: fStart, endDate: fEnd,
      reason: fReason, status: 'active', monthlyImpact: impact, notes: fNotes,
    };
    const next = [...discounts, d]; setDiscounts(next); saveDiscounts(next);
    setShowModal(false); setFNotes(''); setFAmount(''); setFPct('');
  }

  function removeDiscount(id: string) {
    const next = discounts.filter(d => d.id !== id); setDiscounts(next); saveDiscounts(next);
  }

  function triggerAi(u: typeof VACANT_RECS[0]) {
    setAiUnit(u); setAiLoading(true); setAiResult(null);
    setTimeout(() => { setAiLoading(false); setAiResult(buildAiRec(u)); }, 1600);
  }

  // ── Calculator ────────────────────────────────────────────────────────────
  const cRent   = Number(calcRent)   || 0;
  const cPct    = Number(calcPct)    || 0;
  const cMonths = Number(calcMonths) || 0;
  const cDisMo  = Math.round(cRent * cPct / 100);
  const cCost   = cDisMo * cMonths;
  const cVac    = cRent  * cMonths;
  const cBenefit= cVac - cCost;

  // ── Selected unit rent (for % calculator preview) ─────────────────────────
  const selOpt = UNIT_OPTIONS.find(u => u.id === fUnit);
  const calcPreviewMo  = selOpt && fPct ? Math.round(selOpt.rent * Number(fPct) / 100) : 0;
  const calcPreviewTot = calcPreviewMo * Number(fDuration || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Discount Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Promotions, fixed reductions, and rate discounts across all units</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors">
          <Plus size={15} /> Add Discount
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Active Discounts',    value:String(kpis.count),       sub:'currently running',       color:'text-gray-900' },
          { label:'Total Discount Value',value:fmt(kpis.value)+'/mo',    sub:'monthly revenue impact',  color:'text-red-600'  },
          { label:'Units with Discount', value:String(kpis.units),       sub:'across portfolio',        color:'text-gray-900' },
          { label:'Avg Discount %',      value:`${kpis.avgPct}%`,        sub:'percentage-type only',    color:'text-amber-600'},
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm text-gray-500">{k.label}</p>
            <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
            <p className="text-xs text-gray-400 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={fCo}     onChange={e=>setFCo(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-green-600">
          <option value="">All Companies</option>
          {companies.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fStatus} onChange={e=>setFStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-green-600">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="pending">Pending</option>
        </select>
        <select value={fType}   onChange={e=>setFType(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-green-600">
          <option value="">All Types</option>
          <option value="promotional">Promotional</option>
          <option value="fixed">Fixed Amount</option>
          <option value="percentage">Percentage</option>
        </select>
      </div>

      {/* Discount table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="font-semibold text-gray-900 text-sm">Discounts ({filtered.length})</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-900 text-white">
                {['Unit','Building','Company','Type','Value','Start','End','Reason','Status','Monthly Impact',''].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left whitespace-nowrap font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center py-10 text-gray-400">
                  {discounts.length === 0
                    ? 'No discounts added yet. Click + Add Discount to create one.'
                    : 'No discounts match the filters.'}
                </td></tr>
              )}
              {filtered.map(d=>(
                <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono font-medium">{d.unit}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[130px] truncate">{d.building}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[130px] truncate">{d.company || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full font-medium capitalize ${TYPE_BADGE[d.type]}`}>{d.type}</span>
                  </td>
                  <td className="px-3 py-2 font-medium">{d.value}</td>
                  <td className="px-3 py-2 text-gray-500">{d.startDate}</td>
                  <td className="px-3 py-2 text-gray-500">{d.endDate}</td>
                  <td className="px-3 py-2 text-gray-600">{d.reason}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_BADGE[d.status]}`}>{d.status}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-right text-red-600 font-medium">{fmt(d.monthlyImpact)}</td>
                  <td className="px-3 py-2">
                    <button onClick={()=>removeDiscount(d.id)} title="Remove" className="text-gray-300 hover:text-red-500 transition-colors">
                      <X size={14}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strategic recommendations — only shown when there are vacant units with data */}
      {VACANT_RECS.length > 0 && <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb size={16} className="text-amber-500"/>
          <p className="font-semibold text-gray-900 text-sm">💡 Recommended Discounts</p>
          <span className="text-xs text-gray-400">Based on vacancy history and market analysis</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {VACANT_RECS.map(u=>(
            <div key={u.unit} className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div>
                <p className="font-semibold text-gray-900">Unit {u.unit} — Vacant {u.vacantMonths} months</p>
                <p className="text-sm text-red-600 font-medium">Revenue lost: {fmt(u.lost)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{u.building} · Market rent: {fmt(u.marketRent)}/mo</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recommended Options</p>
                {[
                  { label:`A) 1 month free`,                     sub:`fills faster · cost: ${fmt(u.marketRent)}` },
                  { label:`B) 10% off (${fmt(Math.round(u.marketRent*.1))}/mo)`, sub:`${fmt(Math.round(u.marketRent*.1*12))}/yr tenant saving` },
                  { label:`C) $200 off first 3 months`,          sub:`low-risk · total cost: $600` },
                ].map((opt,i)=>(
                  <div key={i} className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg">
                    <span className="text-xs font-semibold text-green-700 whitespace-nowrap">{opt.label}</span>
                    <span className="text-xs text-gray-500">→ {opt.sub}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setShowModal(true)}
                  className="flex-1 px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs font-medium hover:bg-green-800 transition-colors">
                  Apply Discount →
                </button>
                <button onClick={()=>triggerAi(u)} disabled={aiLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 text-amber-700 bg-amber-50 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors disabled:opacity-50">
                  <Zap size={12}/> AI Advisor
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* AI result */}
      {(aiLoading || aiResult) && (
        <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} className="text-amber-600"/>
            <p className="font-semibold text-amber-800">AI Discount Advisor</p>
            {aiUnit && <span className="text-xs text-gray-400">— Unit {aiUnit.unit}</span>}
          </div>
          {aiLoading ? (
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"/>
              Analysing vacancy data and market conditions…
            </div>
          ) : (
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{aiResult}</pre>
          )}
        </div>
      )}

      {/* Impact calculator */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calculator size={16} className="text-gray-600"/>
          <p className="font-semibold text-gray-900 text-sm">Discount Impact Calculator</p>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label:'Current Rent ($/mo)', val:calcRent,   set:setCalcRent   },
            { label:'Discount %',          val:calcPct,    set:setCalcPct    },
            { label:'Duration (months)',   val:calcMonths, set:setCalcMonths },
          ].map(f=>(
            <div key={f.label}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
              <input type="number" value={f.val} onChange={e=>f.set(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600"/>
            </div>
          ))}
        </div>
        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Current rent</span><span className="font-mono">{fmt(cRent)}/mo</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Discount ({calcPct}% = {fmt(cDisMo)}/mo)</span>
            <span className="font-mono text-red-600">−{fmt(cDisMo)}/mo</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Duration</span><span className="font-mono">{cMonths} months</span>
          </div>
          <div className="border-t border-gray-200 pt-2 mt-2 space-y-1.5">
            <div className="flex justify-between font-medium">
              <span>Cost of discount</span><span className="font-mono text-red-600">{fmt(cCost)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>vs. Staying vacant {cMonths} months</span>
              <span className="font-mono text-gray-500">{fmt(cVac)}</span>
            </div>
          </div>
          <div className={`flex justify-between text-base font-bold pt-1 border-t border-gray-200 ${cBenefit>0?'text-green-700':'text-red-700'}`}>
            <span>Net benefit of discounting</span>
            <span>{fmt(cBenefit)} {cBenefit>0?'✅':'❌'}</span>
          </div>
        </div>
      </div>

      {/* Add Discount Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <p className="font-semibold text-gray-900">Add Discount</p>
              <button onClick={()=>setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Type */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Discount Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['promotional','fixed','percentage'] as DiscountType[]).map(t=>(
                    <button key={t} onClick={()=>setModalType(t)}
                      className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${modalType===t?'bg-green-700 text-white border-green-700':'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {t==='promotional'?'🎁 Promo':t==='fixed'?'$ Fixed':'% Rate'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Unit */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
                <select value={fUnit} onChange={e=>setFUnit(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600">
                  <optgroup label="⚠ Vacant Units (Priority)">
                    {UNIT_OPTIONS.filter(u=>u.vacant).map(u=><option key={u.id} value={u.id}>{u.label}</option>)}
                  </optgroup>
                  <optgroup label="Occupied Units">
                    {UNIT_OPTIONS.filter(u=>!u.vacant).map(u=><option key={u.id} value={u.id}>{u.label}</option>)}
                  </optgroup>
                </select>
              </div>

              {/* Promotional */}
              {modalType==='promotional' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Promotion</label>
                    <select value={fPromo} onChange={e=>setFPromo(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600">
                      {PROMOTIONS.map(p=><option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  {fPromo==='Custom promotion' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Promotion Description</label>
                      <input value={fPromoDesc} onChange={e=>setFPromoDesc(e.target.value)}
                        placeholder="e.g. Free parking for 6 months"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600"/>
                    </div>
                  )}
                </>
              )}

              {/* Fixed */}
              {modalType==='fixed' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount ($)</label>
                    <input type="number" value={fAmount} onChange={e=>setFAmount(e.target.value)}
                      placeholder="200"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Frequency</label>
                    <select value={fAmtType} onChange={e=>setFAmtType(e.target.value as 'monthly'|'one-time')}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600">
                      <option value="monthly">Per month</option>
                      <option value="one-time">One-time</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Percentage */}
              {modalType==='percentage' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Percentage (%)</label>
                      <input type="number" value={fPct} onChange={e=>setFPct(e.target.value)}
                        placeholder="10"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600"/>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Duration (months)</label>
                      <input type="number" value={fDuration} onChange={e=>setFDuration(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600"/>
                    </div>
                  </div>
                  {fPct && selOpt && (
                    <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-800 space-y-1">
                      <p>Monthly savings for tenant: <strong>{fmt(calcPreviewMo)}</strong></p>
                      <p>Total over {fDuration} months: <strong>{fmt(calcPreviewTot)}</strong></p>
                    </div>
                  )}
                </>
              )}

              {/* Common fields */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
                <select value={fReason} onChange={e=>setFReason(e.target.value as DiscountReason)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600">
                  {REASONS.map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                  <input type="date" value={fStart} onChange={e=>setFStart(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                  <input type="date" value={fEnd} onChange={e=>setFEnd(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600"/>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={fNotes} onChange={e=>setFNotes(e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-600"/>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={addDiscount}
                  className="flex-1 px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors">
                  Save Discount
                </button>
                <button onClick={()=>setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
