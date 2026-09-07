import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { fmtUSD } from '../../components/ProtectedRoute';
import api from '../../services/api';
import type { CompanyData, Loan } from '../../contexts/PropertyDevContext';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { computeLtlv, isActivePropDevLoan } from '../../utils/propDevLoanMetrics';
import { PROPDEV_MARKET_RATE } from '../../hooks/usePropDevLoanTrackerData';
import { fetchPropDevFinancialsPool } from '../../utils/fetchPropDevFinancialsPool';
import type { PDFinancialsLike } from '../../utils/propDevCfoTrendData';
import { buildPropDevBoardExportPayload, pickFocusSnapshot } from '../../utils/gatherPropDevBoardExportData';
import { enrichPropDevFinWithCf } from '../../utils/propDevYearlyFinancials';
import {
  PD_FONT, PD_IVORY, PD_NAVY, PD_GOLD, PD_TEXT, PD_SLATE, PD_BORDER,
  PD_GREEN, PD_GREEN_BG, PD_GREEN_TEXT, PD_AMBER, PD_AMBER_BG, PD_AMBER_TEXT,
  PD_RED, PD_RED_BG, PD_RED_STRONG, PD_GRAY_BG, PD_GRAY_TEXT,
  PdSectionTitle, PdSectionCard, PdBadge,
} from '../../theme/propDevEnterpriseTheme';

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return fmtUSD(n);
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function nextEmiDate(emiDay: number): string {
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), emiDay);
  if (next.getTime() < now.getTime()) next = new Date(now.getFullYear(), now.getMonth() + 1, emiDay);
  return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusTone(loan: Loan): { label: string; bg: string; text: string } {
  const days = daysUntil(loan.maturityDate);
  if (days != null && days < 0) return { label: 'Overdue', bg: PD_RED_BG, text: PD_RED_STRONG };
  if (days != null && days < 365) return { label: 'Maturing Soon', bg: PD_AMBER_BG, text: PD_AMBER_TEXT };
  return { label: 'Active', bg: PD_GREEN_BG, text: PD_GREEN_TEXT };
}

function ltvTone(pct: number | null): { bg: string; text: string } {
  if (pct == null) return { bg: PD_GRAY_BG, text: PD_GRAY_TEXT };
  if (pct > 80) return { bg: PD_RED_BG, text: PD_RED_STRONG };
  if (pct >= 60) return { bg: PD_AMBER_BG, text: PD_AMBER_TEXT };
  return { bg: PD_GREEN_BG, text: PD_GREEN_TEXT };
}

function dscrTone(dscr: number | null): { bg: string; text: string } {
  if (dscr == null) return { bg: PD_GRAY_BG, text: PD_GRAY_TEXT };
  if (dscr < 1.0) return { bg: PD_RED_BG, text: PD_RED_STRONG };
  if (dscr <= 1.25) return { bg: PD_AMBER_BG, text: PD_AMBER_TEXT };
  return { bg: PD_GREEN_BG, text: PD_GREEN_TEXT };
}

function maturityBarTone(days: number | null): string {
  if (days == null) return PD_BORDER;
  if (days < 90) return PD_RED;
  if (days < 365) return PD_AMBER;
  return PD_GREEN;
}

interface LoanCalc {
  loan: Loan;
  company: CompanyData | undefined;
  ltv: number | null;
  dscr: number | null;
  noi: number | null;
  daysToMaturity: number | null;
  annualInterest: number;
}

const CHECKLIST_ITEMS = [
  { key: 'extension', label: 'Request lender extension' },
  { key: 'refinance', label: 'Initiate refinancing process' },
  { key: 'notify', label: 'Notify partners' },
  { key: 'payoff', label: 'Calculate payoff amount' },
];

function MaturityChecklist({ loan, onSaved }: { loan: Loan; onSaved: () => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>(loan.maturityChecklist ?? {});

  async function toggle(key: string) {
    const next = { ...checked, [key]: !checked[key] };
    setChecked(next);
    try {
      await api.patch(`/api/propdev/loans/${loan.id}/checklist`, { maturity_checklist: next });
      onSaved();
    } catch (e) {
      console.error('Failed to save checklist', e);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 mt-2">
      {CHECKLIST_ITEMS.map(item => (
        <label key={item.key} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: PD_TEXT }}>
          <input type="checkbox" checked={!!checked[item.key]} onChange={() => void toggle(item.key)} />
          {item.label}
        </label>
      ))}
    </div>
  );
}

function PayoffCalculator({ loan }: { loan: Loan }) {
  const [open, setOpen] = useState(false);
  const [penaltyPct, setPenaltyPct] = useState('0');
  const days = daysUntil(loan.maturityDate) ?? 0;
  const accruedInterest = loan.balance * (loan.interestRate / 100) * (Math.max(0, days) / 365);
  const penalty = loan.balance * (Number(penaltyPct || 0) / 100);
  const total = loan.balance + accruedInterest + penalty;

  return (
    <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${PD_BORDER}` }}>
      <button type="button" onClick={() => setOpen(o => !o)} className="text-[11px] font-medium" style={{ color: PD_GOLD }}>
        {open ? 'Hide' : 'Show'} payoff calculator
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between"><span style={{ color: PD_SLATE }}>Outstanding balance</span><span style={{ color: PD_TEXT }}>{fmtMoney(loan.balance)}</span></div>
          <div className="flex justify-between"><span style={{ color: PD_SLATE }}>Accrued interest to maturity</span><span style={{ color: PD_TEXT }}>{fmtMoney(accruedInterest)}</span></div>
          <div className="flex justify-between items-center">
            <span style={{ color: PD_SLATE }}>Prepayment penalty %</span>
            <input
              type="number" value={penaltyPct} onChange={e => setPenaltyPct(e.target.value)}
              className="w-16 text-right text-xs border rounded px-1.5 py-0.5" style={{ borderColor: PD_BORDER }}
            />
          </div>
          <div className="flex justify-between pt-1.5 mt-1" style={{ borderTop: `1px solid ${PD_BORDER}` }}>
            <span className="font-bold" style={{ color: PD_TEXT }}>TOTAL PAYOFF AMOUNT</span>
            <span className="font-bold" style={{ color: PD_GOLD }}>{fmtMoney(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RefinancingRow({ calc, marketRate, onSaved }: { calc: LoanCalc; marketRate: number; onSaved: () => void }) {
  const [status, setStatus] = useState(calc.loan.refinancingStatus ?? 'Not Started');
  const [notes, setNotes] = useState(calc.loan.refinancingNotes ?? '');
  const [saving, setSaving] = useState(false);
  const monthlySavings = ((calc.loan.interestRate - marketRate) / 100 / 12) * calc.loan.balance;
  const annualSavings = monthlySavings * 12;

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/propdev/loans/${calc.loan.id}/refinancing`, {
        refinancing_status: status, refinancing_notes: notes,
      });
      onSaved();
    } catch (e) {
      console.error('Failed to save refinancing status', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3" style={{ borderBottom: `1px solid ${PD_BORDER}` }}>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <span className="text-xs font-bold" style={{ color: PD_TEXT }}>{calc.company?.name ?? calc.loan.company}</span>
          <span className="text-[11px] ml-2" style={{ color: PD_SLATE }}>{calc.loan.bank}</span>
        </div>
        <span className="text-xs font-semibold" style={{ color: PD_RED }}>{calc.loan.interestRate.toFixed(2)}% vs {marketRate.toFixed(2)}% market</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] mb-2">
        <div><span style={{ color: PD_SLATE }}>Monthly savings: </span><span className="font-semibold" style={{ color: PD_GREEN }}>{fmtMoney(monthlySavings)}</span></div>
        <div><span style={{ color: PD_SLATE }}>Annual savings: </span><span className="font-semibold" style={{ color: PD_GREEN }}>{fmtMoney(annualSavings)}</span></div>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="text-xs border rounded px-2 py-1" style={{ borderColor: PD_BORDER }}
        >
          {['Not Started', 'Exploring', 'Applied', 'Approved', 'Closed'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)}
          className="flex-1 text-xs border rounded px-2 py-1" style={{ borderColor: PD_BORDER }}
        />
        <button
          type="button" onClick={() => void save()} disabled={saving}
          className="text-xs font-medium px-2.5 py-1 rounded text-white disabled:opacity-60" style={{ background: PD_NAVY }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function PDLoanManagementTab({
  loans, companies, allLoans,
}: {
  loans: Loan[]; companies: CompanyData[]; allLoans: Loan[];
}) {
  const { refetchCompanies } = usePropDev();
  const [uploadedFin, setUploadedFin] = useState<Record<string, PDFinancialsLike>>({});
  const [marketRate, setMarketRate] = useState(PROPDEV_MARKET_RATE);

  useEffect(() => {
    if (!companies.length) return;
    let cancelled = false;
    fetchPropDevFinancialsPool(
      companies.map(c => c.id),
      (_id, d) => ({
        years: d.years ?? [],
        pl: (d.pl ?? []) as PDFinancialsLike['pl'],
        bs: (d.bs ?? []) as PDFinancialsLike['bs'],
        cf: (d.cf ?? []) as PDFinancialsLike['cf'],
      }),
      { onItem: (id, item) => { if (!cancelled) setUploadedFin(prev => ({ ...prev, [id]: item })); } },
    ).then(merged => { if (!cancelled) setUploadedFin(prev => ({ ...prev, ...merged })); });
    return () => { cancelled = true; };
  }, [companies]);

  const active = useMemo(() => loans.filter(isActivePropDevLoan), [loans]);

  const noiByCompany = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const c of companies) {
      const fin = uploadedFin[c.id];
      if (!fin || (!fin.pl.length && !fin.bs.length)) { map[c.id] = null; continue; }
      try {
        const enriched = enrichPropDevFinWithCf(fin, c);
        const payload = buildPropDevBoardExportPayload(enriched, c, allLoans, null, new Date().getFullYear(), 'Current');
        const snap = pickFocusSnapshot(payload.plSnapshots, payload.focusYear);
        map[c.id] = snap?.noi ?? null;
      } catch {
        map[c.id] = null;
      }
    }
    return map;
  }, [companies, uploadedFin, allLoans]);

  const calcs: LoanCalc[] = useMemo(() => active.map(loan => {
    const company = companies.find(c => c.id === loan.companyId);
    const ltv = company ? computeLtlv(loan, company) : null;
    const noi = company ? (noiByCompany[company.id] ?? null) : null;
    const annualDebtService = loan.emi * 12;
    const dscr = noi != null && annualDebtService > 0 ? noi / annualDebtService : null;
    return {
      loan, company,
      ltv, dscr, noi,
      daysToMaturity: daysUntil(loan.maturityDate),
      annualInterest: loan.balance * (loan.interestRate / 100),
    };
  }), [active, companies, noiByCompany]);

  const refinanceCandidates = useMemo(
    () => calcs.filter(c => c.loan.interestRate > marketRate),
    [calcs, marketRate],
  );

  if (!active.length) {
    return (
      <div className="text-sm text-center py-10" style={{ color: PD_SLATE }}>
        No active loans to manage. Import loans on the Overview tab first.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: PD_FONT, background: PD_IVORY, padding: 20, borderRadius: 12 }}>
      <div className="mb-6">
        <PdSectionTitle>Loans</PdSectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {calcs.map(calc => {
            const tone = statusTone(calc.loan);
            return (
              <PdSectionCard key={calc.loan.id}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-bold" style={{ color: PD_TEXT }}>{calc.loan.property || calc.company?.name}</p>
                    <p className="text-xs" style={{ color: PD_SLATE }}>{calc.loan.bank}</p>
                    <div className="flex gap-1.5 mt-1.5">
                      <PdBadge text={calc.loan.loanPurpose || '—'} tone={{ bg: '#F1F5F9', text: PD_SLATE }} />
                      <PdBadge text={tone.label} tone={{ bg: tone.bg, text: tone.text }} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs mb-3 pb-3" style={{ borderBottom: `1px solid ${PD_BORDER}` }}>
                  <div><p style={{ color: PD_SLATE }}>Loan amount</p><p className="font-semibold" style={{ color: PD_TEXT }}>{fmtMoney(calc.loan.amount)}</p></div>
                  <div><p style={{ color: PD_SLATE }}>Outstanding</p><p className="font-semibold" style={{ color: PD_TEXT }}>{fmtMoney(calc.loan.balance)}</p></div>
                  <div><p style={{ color: PD_SLATE }}>EMI</p><p className="font-semibold" style={{ color: PD_TEXT }}>{fmtMoney(calc.loan.emi)}</p></div>
                  <div><p style={{ color: PD_SLATE }}>Rate</p><p className="font-semibold" style={{ color: PD_TEXT }}>{calc.loan.interestRate.toFixed(2)}%</p></div>
                  <div><p style={{ color: PD_SLATE }}>EMI day</p><p className="font-semibold" style={{ color: PD_TEXT }}>{calc.loan.emiDate}</p></div>
                  <div><p style={{ color: PD_SLATE }}>Next EMI</p><p className="font-semibold" style={{ color: PD_TEXT }}>{nextEmiDate(calc.loan.emiDate)}</p></div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg p-2" style={{ background: '#F8FAFC' }}>
                    <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>LTV</p>
                    {calc.ltv != null
                      ? <PdBadge text={`${calc.ltv.toFixed(1)}%`} tone={ltvTone(calc.ltv)} />
                      : <p className="text-[10px]" style={{ color: PD_SLATE }}>Add property value to calculate</p>}
                  </div>
                  <div className="rounded-lg p-2" style={{ background: '#F8FAFC' }}>
                    <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>DSCR</p>
                    {calc.dscr != null
                      ? <PdBadge text={`${calc.dscr.toFixed(2)}x`} tone={dscrTone(calc.dscr)} />
                      : <p className="text-[10px]" style={{ color: PD_SLATE }}>Upload P&amp;L to calculate</p>}
                  </div>
                  <div className="rounded-lg p-2" style={{ background: '#F8FAFC' }}>
                    <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Days to maturity</p>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: calc.daysToMaturity != null && calc.daysToMaturity < 90 ? PD_RED : calc.daysToMaturity != null && calc.daysToMaturity < 365 ? PD_AMBER : PD_GREEN }}>
                      {calc.daysToMaturity != null && calc.daysToMaturity < 90 && <AlertTriangle size={11} />}
                      {calc.daysToMaturity != null ? `${calc.daysToMaturity}d` : '—'}
                    </span>
                  </div>
                  <div className="rounded-lg p-2" style={{ background: '#F8FAFC' }}>
                    <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Annual interest</p>
                    <p className="text-xs font-semibold" style={{ color: PD_TEXT }}>Est. {fmtMoney(calc.annualInterest)}/yr</p>
                  </div>
                </div>
              </PdSectionCard>
            );
          })}
        </div>
      </div>

      <div className="mb-6">
        <PdSectionTitle>Covenant monitoring</PdSectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {calcs.map(calc => {
            const ltvPass = calc.ltv != null && calc.ltv < 75;
            const dscrPass = calc.dscr != null && calc.dscr > 1.25;
            const maturityPass = calc.daysToMaturity != null && calc.daysToMaturity > 90;
            const hasInsurance = !!calc.loan.insuranceExpiryDate;
            const anyBreach = (calc.ltv != null && !ltvPass) || (calc.dscr != null && !dscrPass);
            const breachCount = [calc.ltv != null && !ltvPass, calc.dscr != null && !dscrPass].filter(Boolean).length;
            return (
              <PdSectionCard key={calc.loan.id}>
                <p className="text-xs font-bold mb-2" style={{ color: PD_TEXT }}>{calc.loan.property || calc.company?.name}</p>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ color: PD_SLATE }}>
                      <th className="text-left font-semibold pb-1">Covenant</th>
                      <th className="text-center font-semibold pb-1">Status</th>
                      <th className="text-right font-semibold pb-1">Value</th>
                      <th className="text-right font-semibold pb-1">Threshold</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderTop: `1px solid ${PD_BORDER}` }}>
                      <td className="py-1.5" style={{ color: PD_TEXT }}>LTV Ratio</td>
                      <td className="text-center">{calc.ltv == null ? '⚪' : ltvPass ? '🟢' : '🔴'}</td>
                      <td className="text-right" style={{ color: PD_TEXT }}>{calc.ltv != null ? `${calc.ltv.toFixed(1)}%` : '—'}</td>
                      <td className="text-right" style={{ color: PD_SLATE }}>Must be &lt;75%</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${PD_BORDER}` }}>
                      <td className="py-1.5" style={{ color: PD_TEXT }}>DSCR</td>
                      <td className="text-center">{calc.dscr == null ? '⚪' : dscrPass ? '🟢' : '🔴'}</td>
                      <td className="text-right" style={{ color: PD_TEXT }}>{calc.dscr != null ? `${calc.dscr.toFixed(2)}x` : '—'}</td>
                      <td className="text-right" style={{ color: PD_SLATE }}>Must be &gt;1.25x</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${PD_BORDER}` }}>
                      <td className="py-1.5" style={{ color: PD_TEXT }}>Insurance Current</td>
                      <td className="text-center">{hasInsurance ? '🟢' : '⚪'}</td>
                      <td className="text-right" style={{ color: PD_TEXT }}>{calc.loan.insuranceExpiryDate ?? '—'}</td>
                      <td className="text-right" style={{ color: PD_SLATE }}>Required</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${PD_BORDER}` }}>
                      <td className="py-1.5" style={{ color: PD_TEXT }}>Maturity &gt;90 days</td>
                      <td className="text-center">{calc.daysToMaturity == null ? '⚪' : maturityPass ? '🟢' : '🟡'}</td>
                      <td className="text-right" style={{ color: PD_TEXT }}>{calc.daysToMaturity != null ? `${calc.daysToMaturity} days` : '—'}</td>
                      <td className="text-right" style={{ color: PD_SLATE }}>Must be &gt;90 days</td>
                    </tr>
                  </tbody>
                </table>
                <div
                  className="mt-3 rounded-lg px-3 py-2 text-xs font-medium"
                  style={anyBreach ? { background: '#FEE2E2', color: '#DC2626' } : { background: '#DCFCE7', color: '#166534' }}
                >
                  {anyBreach ? `⚠️ ${breachCount} covenant breach${breachCount > 1 ? 'es' : ''} — review required` : '✅ All covenants healthy'}
                </div>
              </PdSectionCard>
            );
          })}
        </div>
      </div>

      <div className="mb-6">
        <PdSectionTitle>Maturity management</PdSectionTitle>
        <PdSectionCard>
          {calcs
            .filter(c => c.daysToMaturity != null)
            .sort((a, b) => (a.daysToMaturity ?? 0) - (b.daysToMaturity ?? 0))
            .map(calc => {
              const days = calc.daysToMaturity ?? 0;
              const barColor = maturityBarTone(days);
              const barPct = Math.max(2, Math.min(100, 100 - (days / 1095) * 100));
              return (
                <div key={calc.loan.id} className="py-3" style={{ borderBottom: `1px solid ${PD_BORDER}` }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold" style={{ color: PD_TEXT }}>{calc.loan.property || calc.company?.name}</span>
                    <span className="text-xs font-semibold" style={{ color: barColor }}>{days < 0 ? `${Math.abs(days)}d overdue` : `${days} days remaining`}</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: PD_BORDER }}>
                    <div className="h-2 rounded-full" style={{ width: `${barPct}%`, background: barColor }} />
                  </div>
                  {days < 365 && (
                    <>
                      <MaturityChecklist loan={calc.loan} onSaved={refetchCompanies} />
                      <PayoffCalculator loan={calc.loan} />
                    </>
                  )}
                </div>
              );
            })}
        </PdSectionCard>
      </div>

      <div>
        <PdSectionTitle>Refinancing tracker</PdSectionTitle>
        <PdSectionCard>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs" style={{ color: PD_SLATE }}>Market rate</span>
            <input
              type="number" step="0.1" value={marketRate}
              onChange={e => setMarketRate(Number(e.target.value) || 0)}
              className="w-20 text-xs border rounded px-2 py-1" style={{ borderColor: PD_BORDER }}
            />
            <span className="text-xs" style={{ color: PD_SLATE }}>%</span>
          </div>
          {refinanceCandidates.length ? (
            refinanceCandidates.map(calc => (
              <RefinancingRow key={calc.loan.id} calc={calc} marketRate={marketRate} onSaved={refetchCompanies} />
            ))
          ) : (
            <div className="text-xs text-center py-4" style={{ color: '#166534' }}>
              ✅ All loans at or below market rate — no refinancing needed
            </div>
          )}
        </PdSectionCard>
      </div>
    </div>
  );
}
