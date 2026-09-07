/**
 * Entity Dashboard tab — command-center view for a single Property Dev entity.
 * Moved into Entity Executive Summary from the standalone PDEntityDashboard page;
 * entity selection now lives at the PDEntityExecutiveSummary page level.
 */
import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { fmtUSD } from '../../ProtectedRoute';
import type { CompanyData, Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { pickFocusSnapshot, type PropDevBoardExportPayload } from '../../../utils/gatherPropDevBoardExportData';
import { computeCashRunwayHero } from '../../../utils/propDevCfoTrendData';
import { isActivePropDevLoan, resolveLandValue } from '../../../utils/propDevLoanMetrics';
import {
  PD_FONT, PD_NAVY, PD_GOLD, PD_TEXT, PD_SLATE, PD_BORDER, PD_RED_STRONG, PD_RED_BG,
  PD_AMBER_TEXT, PD_GREEN_TEXT, PD_GREEN_BG,
  pdLtlvTone, pdMaturityTone,
} from '../../../theme/propDevEnterpriseTheme';

function fmtMoney(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return fmtUSD(v);
}

function fmtAcct(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  const abs = fmtUSD(Math.abs(v));
  return v < 0 ? `(${abs})` : abs;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const body = `${Math.abs(n).toFixed(1)}%`;
  return n < 0 ? `(${body})` : body;
}

function ltlvTone(pct: number | null): { text: string; label: string } {
  const tone = pdLtlvTone(pct);
  const label = pct == null ? 'No data' : pct > 100 ? 'High risk' : pct >= 60 ? 'Monitor' : 'Healthy';
  return { text: tone.text, label };
}

function maturityBadge(dateStr: string | undefined): { bg: string; text: string; label: string } {
  const fallback = { bg: PD_GREEN_BG, text: PD_GREEN_TEXT, label: '—' };
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return fallback;
  const days = Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const dateLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  const tone = pdMaturityTone(days);
  return { bg: tone.bg, text: tone.text, label: days < 365 ? `${dateLabel} !` : dateLabel };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold mb-2 pl-2.5" style={{ color: PD_NAVY, borderLeft: `3px solid ${PD_GOLD}`, fontFamily: PD_FONT }}>
      {children}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs" style={{ borderBottom: `0.5px solid ${PD_BORDER}` }}>
      <span style={{ color: PD_SLATE }}>{label}</span>
      <span className="font-medium" style={{ color: tone ?? PD_TEXT }}>{value}</span>
    </div>
  );
}

interface Props {
  company: CompanyData;
  kpis: PropDevCompanyOverviewKpis | undefined;
  loans: Loan[];
  payload: PropDevBoardExportPayload | null;
}

export default function PDEntityDashboardTab({ company, kpis, loans, payload }: Props) {
  const pl = payload ? pickFocusSnapshot(payload.plSnapshots, payload.focusYear) : null;
  const bs = payload ? pickFocusSnapshot(payload.bsSnapshots, payload.focusYear) : null;
  const cf = payload ? pickFocusSnapshot(payload.cfSnapshots, payload.focusYear) : null;
  const cashRunway = payload ? computeCashRunwayHero(payload.cfSnapshots, company, payload.focusYear) : null;

  const selectedLoans = useMemo(() => loans.filter(isActivePropDevLoan), [loans]);

  const overdueLoans = useMemo(
    () => selectedLoans.filter(l => {
      if (!l.maturityDate) return false;
      const d = new Date(l.maturityDate);
      return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
    }),
    [selectedLoans],
  );

  const activePartners = useMemo(
    () => company.partners.filter(p => p.status !== 'Exited'),
    [company],
  );

  // Mirrors the Portfolio Overview hero cards (PDPortfolioOverviewTab.tsx), scoped to
  // this single entity instead of summed across the portfolio.
  const unrealisedGainLoss = kpis?.fmv != null && kpis?.bookValue != null ? kpis.fmv - kpis.bookValue : null;

  const capitalCallAgg = useMemo(() => {
    const calls = company.capitalCalls ?? [];
    const totalCalled = calls.reduce((s, cc) => s + (cc.totalDue || 0), 0);
    const received = calls.reduce((s, cc) => s + (cc.received || 0), 0);
    const overdueCount = calls.filter(cc => cc.status === 'Overdue').length;
    return { outstanding: totalCalled - received, overdueCount };
  }, [company]);

  const distributionRatio = useMemo(() => {
    let classACapital = 0, classADist = 0, classBCapital = 0, classBDist = 0;
    for (const p of activePartners) {
      if (p.type === 'Class A') { classACapital += p.capitalContributed || 0; classADist += p.distributionsReceived || 0; }
      else { classBCapital += p.capitalContributed || 0; classBDist += p.distributionsReceived || 0; }
    }
    return {
      classAPct: classACapital > 0 ? (classADist / classACapital) * 100 : null,
      classBPct: classBCapital > 0 ? (classBDist / classBCapital) * 100 : null,
    };
  }, [activePartners]);

  const selectedLocation =
    [company.property.city, company.property.state].filter(Boolean).join(', ')
    || company.property.address
    || activePartners.find(p => p.propertyAddress)?.propertyAddress
    || null;
  const selectedLand = resolveLandValue(company);
  const selectedImprovements =
    bs?.landImprovements
    || company.property.improvements
    || (kpis?.costBasis != null && selectedLand != null ? kpis.costBasis - selectedLand : null);
  const selectedStatus = selectedLand != null && selectedLand !== 0 ? 'Active' : 'Closed';
  const selectedOutstanding = selectedLoans.reduce((s, l) => s + l.balance, 0);

  return (
    <div style={{ fontFamily: PD_FONT, color: PD_TEXT }}>
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: PD_BORDER }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ background: PD_NAVY }}>
          <div>
            <div className="text-sm font-medium" style={{ color: PD_GOLD }}>ESTATECFO</div>
            <div className="text-[11px] mt-0.5" style={{ color: '#B8B8C4' }}>Entity dashboard</div>
          </div>
        </div>

        <div className="p-4" style={{ background: '#FFFFFF' }}>
          {overdueLoans.length > 0 && (
            <div
              className="rounded-lg px-3 py-2 mb-4 text-xs flex items-center gap-2"
              style={{ background: PD_RED_BG, color: PD_RED_STRONG, border: `0.5px solid #F7C1C1` }}
            >
              <AlertTriangle size={13} />
              {company.name} &mdash; {overdueLoans.length} loan{overdueLoans.length > 1 ? 's' : ''} ({fmtMoney(overdueLoans.reduce((s, l) => s + l.balance, 0))}) past maturity. Immediate refinancing action required.
            </div>
          )}

          <SectionTitle>{company.name} &mdash; command center</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-4">
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Land value</p>
              <p className="text-base font-bold mt-1" style={{ color: PD_TEXT }}>{fmtMoney(payload?.landValue)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Total assets</p>
              <p className="text-base font-bold mt-1" style={{ color: PD_TEXT }}>{fmtMoney(bs?.totalAssets)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Total debt</p>
              <p className="text-base font-bold mt-1" style={{ color: PD_RED_STRONG }}>{fmtMoney(bs?.totalDebt ?? payload?.totalDebt)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>LTLV</p>
              <p className="text-base font-bold mt-1" style={{ color: ltlvTone(bs?.ltlv ?? null).text }}>{fmtPct(bs?.ltlv)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Monthly EMI</p>
              <p className="text-base font-bold mt-1" style={{ color: PD_TEXT }}>{fmtMoney(payload?.totalMonthlyEmi)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Book value</p>
              <p className="text-base font-bold mt-1" style={{ color: PD_TEXT }}>{fmtMoney(kpis?.bookValue)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Loan tracker outstanding</p>
              <p className="text-base font-bold mt-1" style={{ color: PD_RED_STRONG }}>{fmtMoney(kpis?.loanTrackerOutstanding)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Total bank</p>
              <p className="text-base font-bold mt-1" style={{ color: PD_TEXT }}>{fmtMoney(kpis?.cash)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Unrealised gain/(loss)</p>
              <p className="text-base font-bold mt-1" style={{ color: (unrealisedGainLoss ?? 0) < 0 ? PD_RED_STRONG : PD_GREEN_TEXT }}>{fmtAcct(unrealisedGainLoss)}</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Capital calls pending</p>
              <p className="text-base font-bold mt-1" style={{ color: capitalCallAgg.outstanding > 0 ? PD_AMBER_TEXT : PD_TEXT }}>{fmtMoney(capitalCallAgg.outstanding)}</p>
              <p className="text-[10px] mt-0.5" style={{ color: PD_SLATE }}>{capitalCallAgg.overdueCount} overdue</p>
            </div>
            <div className="rounded-lg p-3" style={{ border: `1px solid ${PD_BORDER}`, borderBottom: `2px solid ${PD_GOLD}` }}>
              <p className="text-[10px] uppercase" style={{ color: PD_SLATE }}>Distribution ratio</p>
              <p className="text-base font-bold mt-1" style={{ color: PD_TEXT }}>
                A: {distributionRatio.classAPct != null ? `${distributionRatio.classAPct.toFixed(0)}%` : '—'} &middot; B: {distributionRatio.classBPct != null ? `${distributionRatio.classBPct.toFixed(0)}%` : '—'}
              </p>
            </div>
          </div>

          <div className="mb-4">
            <SectionTitle>Property details</SectionTitle>
            <div className="rounded-lg overflow-hidden border" style={{ borderColor: PD_BORDER }}>
              <div className="flex items-center justify-between px-4 py-2.5" style={{ background: PD_NAVY }}>
                <div>
                  <div className="text-sm font-semibold" style={{ color: '#FFFFFF' }}>{company.property.name || company.name}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: '#B8B8C4' }}>{company.name}</div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.15)', color: '#FFFFFF' }}>
                  {ltlvTone(kpis?.ltlv ?? null).label}
                </span>
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-x-6" style={{ background: '#FFFFFF' }}>
                {[
                  ['Location', selectedLocation || '—'],
                  ['Acres', company.property.totalAcres > 0 ? `${company.property.totalAcres} acres` : '—'],
                  ['Land cost', fmtMoney(selectedLand)],
                  ['Improvements', fmtMoney(selectedImprovements)],
                  ['Total debt', fmtMoney(selectedOutstanding)],
                  ['LTLV', fmtPct(kpis?.ltlv ?? null)],
                  ['Previous owner', company.property.previousOwnerName || '—'],
                  ['Tax payable', company.property.propertyTaxAnnual != null ? fmtMoney(company.property.propertyTaxAnnual) : '—'],
                  ['Partners', activePartners.length > 0 ? `${activePartners.length} investors` : '—'],
                  ['Status', selectedStatus],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between py-1 text-xs" style={{ borderBottom: `0.5px solid ${PD_BORDER}` }}>
                    <span style={{ color: PD_SLATE }}>{label}</span>
                    <span className="font-medium" style={{ color: label === 'Total debt' ? PD_RED_STRONG : PD_TEXT }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <SectionTitle>Financial snapshot</SectionTitle>
              <div className="rounded-lg overflow-hidden border" style={{ borderColor: PD_BORDER }}>
                <div className="px-4 py-2.5" style={{ background: PD_NAVY }}>
                  <span className="text-xs font-semibold" style={{ color: '#FFFFFF' }}>Financial snapshot</span>
                </div>
                <div className="p-3" style={{ background: '#FFFFFF' }}>
                  {pl?.rev !== 0 && <Row label="Revenue" value={fmtMoney(pl?.rev)} />}
                  <Row label="Total expenses" value={fmtMoney(pl?.exp)} />
                  <Row label="Gross profit" value={fmtAcct((pl?.rev ?? 0) - (pl?.exp ?? 0))} tone={PD_GREEN_TEXT} />
                  <Row label="Interest paid" value={fmtMoney(pl?.interest)} />
                  <Row label="Net income" value={fmtAcct(pl?.netInc)} tone={(pl?.netInc ?? 0) < 0 ? PD_RED_STRONG : PD_TEXT} />
                  <Row label="Net margin" value={fmtPct(pl?.margin)} tone={(pl?.margin ?? 0) < 0 ? PD_RED_STRONG : PD_TEXT} />
                  <Row label="Bank" value={fmtMoney(bs?.cash)} />
                  <Row label="Cash runway" value={cashRunway?.label ?? '—'} tone={PD_AMBER_TEXT} />
                </div>
              </div>
            </div>

            <div>
              <SectionTitle>Loan register</SectionTitle>
              <div className="rounded-lg overflow-hidden border" style={{ borderColor: PD_BORDER }}>
                <div className="px-4 py-2.5" style={{ background: PD_NAVY }}>
                  <span className="text-xs font-semibold" style={{ color: '#FFFFFF' }}>Loan register</span>
                </div>
                <div className="p-3 overflow-x-auto" style={{ background: '#FFFFFF' }}>
                <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Lender', 'Outstanding', 'Rate', 'EMI', 'Maturity'].map((h, i) => (
                        <th key={h} className={`pb-1 text-[9px] font-semibold uppercase ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: PD_SLATE }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLoans.map(l => {
                      const badge = maturityBadge(l.maturityDate);
                      return (
                        <tr key={l.id} style={{ borderTop: `0.5px solid ${PD_BORDER}` }}>
                          <td className="py-1" style={{ color: PD_TEXT }}>{l.bank}</td>
                          <td className="py-1 text-right font-medium" style={{ color: PD_RED_STRONG }}>{fmtMoney(l.balance)}</td>
                          <td className="py-1 text-right" style={{ color: PD_TEXT }}>{l.interestRate.toFixed(2)}%</td>
                          <td className="py-1 text-right" style={{ color: PD_TEXT }}>{fmtMoney(l.emi)}</td>
                          <td className="py-1 text-right">
                            <span className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-medium" style={{ background: badge.bg, color: badge.text }}>{badge.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {!selectedLoans.length && (
                      <tr><td colSpan={5} className="py-3 text-center" style={{ color: PD_SLATE }}>No active loans</td></tr>
                    )}
                  </tbody>
                </table>
                {selectedLoans.length > 0 && (
                  <div className="flex items-center justify-between pt-2 mt-2 text-[11px]" style={{ borderTop: `1px solid ${PD_BORDER}` }}>
                    <span style={{ color: PD_SLATE }}>Total outstanding</span>
                    <span className="font-semibold" style={{ color: PD_RED_STRONG }}>{fmtMoney(selectedLoans.reduce((s, l) => s + l.balance, 0))}</span>
                  </div>
                )}
                </div>
              </div>

              <div className="mt-3">
                <SectionTitle>Cash flow</SectionTitle>
                <div className="rounded-lg overflow-hidden border" style={{ borderColor: PD_BORDER }}>
                  <div className="px-4 py-2.5" style={{ background: PD_NAVY }}>
                    <span className="text-xs font-semibold" style={{ color: '#FFFFFF' }}>Cash flow</span>
                  </div>
                  <div className="p-3" style={{ background: '#FFFFFF' }}>
                    <Row label="Operating CF" value={fmtAcct(cf?.operatingCf)} tone={(cf?.operatingCf ?? 0) < 0 ? PD_RED_STRONG : PD_GREEN_TEXT} />
                    <Row label="Investing CF" value={fmtAcct(cf?.investingCf)} tone={(cf?.investingCf ?? 0) < 0 ? PD_RED_STRONG : PD_GREEN_TEXT} />
                    <Row label="Financing CF" value={fmtAcct(cf?.financingCf)} tone={(cf?.financingCf ?? 0) < 0 ? PD_RED_STRONG : PD_GREEN_TEXT} />
                    <Row label="Net cash change" value={fmtAcct(cf?.netCashFlow)} tone={(cf?.netCashFlow ?? 0) < 0 ? PD_RED_STRONG : PD_TEXT} />
                    <Row label="Closing cash" value={fmtMoney(cf?.closingCash)} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <SectionTitle>Ownership — partner investments</SectionTitle>
              <div className="rounded-lg border p-3 overflow-x-auto" style={{ borderColor: PD_BORDER }}>
                <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Partner', 'Capital', 'Share'].map((h, i) => (
                        <th key={h} className={`pb-1 text-[9px] font-semibold uppercase ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: PD_SLATE }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activePartners.map(p => {
                      const totalPartnerCapital = activePartners.reduce((s, pt) => s + pt.capitalContributed, 0);
                      const share = totalPartnerCapital > 0 ? (p.capitalContributed / totalPartnerCapital) * 100 : p.sharePercent;
                      return (
                        <tr key={p.id} style={{ borderTop: `0.5px solid ${PD_BORDER}` }}>
                          <td className="py-1" style={{ color: PD_TEXT }}>{p.name}</td>
                          <td className="py-1 text-right font-medium" style={{ color: PD_TEXT }}>{fmtMoney(p.capitalContributed)}</td>
                          <td className="py-1 text-right" style={{ color: PD_AMBER_TEXT }}>{share.toFixed(share % 1 === 0 ? 0 : 2)}%</td>
                        </tr>
                      );
                    })}
                    {!activePartners.length && (
                      <tr><td colSpan={3} className="py-3 text-center" style={{ color: PD_SLATE }}>No partners on file</td></tr>
                    )}
                  </tbody>
                </table>
                {activePartners.length > 0 && (
                  <div className="flex items-center justify-between pt-2 mt-2 text-[11px]" style={{ borderTop: `1px solid ${PD_BORDER}` }}>
                    <span style={{ color: PD_SLATE }}>Total partner capital ({activePartners.length} partners)</span>
                    <span className="font-semibold" style={{ color: PD_TEXT }}>{fmtMoney(activePartners.reduce((s, p) => s + p.capitalContributed, 0))}</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <SectionTitle>Balance sheet snapshot</SectionTitle>
              <div className="rounded-lg border p-3" style={{ borderColor: PD_BORDER }}>
                <p className="text-[9px] uppercase mb-1" style={{ color: PD_SLATE }}>Assets</p>
                <Row label="Bank" value={fmtMoney(bs?.cash)} />
                <Row label="Land" value={fmtMoney(bs?.landValue)} />
                <Row label="Improvements/WIP" value={fmtMoney(bs?.improvementsWip)} />
                <Row label="Other assets" value={fmtMoney(bs?.otherAssets)} />
                <div className="flex items-center justify-between py-1.5 mt-1 text-xs font-semibold" style={{ borderTop: `1px solid ${PD_BORDER}` }}>
                  <span style={{ color: PD_TEXT }}>Total assets</span>
                  <span style={{ color: PD_TEXT }}>{fmtMoney(bs?.totalAssets)}</span>
                </div>
                <p className="text-[9px] uppercase mb-1 mt-2" style={{ color: PD_SLATE }}>Liabilities and equity</p>
                <Row label="Total debt" value={fmtMoney(bs?.totalDebt)} tone={PD_RED_STRONG} />
                <Row label="Total equity" value={fmtMoney(bs?.equity)} tone={PD_GREEN_TEXT} />
                <div className="flex items-center justify-between py-1.5 mt-1 text-xs font-semibold" style={{ borderTop: `1px solid ${PD_BORDER}` }}>
                  <span style={{ color: PD_TEXT }}>Total L + E</span>
                  <span style={{ color: PD_TEXT }}>{fmtMoney((bs?.totalDebt ?? 0) + (bs?.equity ?? 0))}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 pt-2 text-[10px]" style={{ borderTop: `1px solid ${PD_BORDER}`, color: PD_SLATE }}>
            <span>EstateCFO &middot; {company.name}</span>
            <span className="font-semibold tracking-widest" style={{ color: PD_GOLD }}>CONFIDENTIAL</span>
            <span>Generated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
