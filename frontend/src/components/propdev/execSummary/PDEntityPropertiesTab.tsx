import { useEffect, useMemo, useState } from 'react';
import { Building2, AlertTriangle } from 'lucide-react';
import type { CompanyData, Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { isActivePropDevLoan, sumActiveMonthlyEmi, resolveLandValue, cashEmiStatus } from '../../../utils/propDevLoanMetrics';
import api from '../../../services/api';
import type { PDFinancialsLike } from '../../../utils/propDevCfoTrendData';
import { buildPropDevBoardExportPayload, pickFocusSnapshot } from '../../../utils/gatherPropDevBoardExportData';
import { enrichPropDevFinWithCf } from '../../../utils/propDevYearlyFinancials';
import { EmptyState, type EspStatus } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}
function fmtUsd2(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtPct(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

function riskBadge(ltlv: number | null): { label: string; status: EspStatus } {
  if (ltlv == null) return { label: 'No data', status: 'Active' };
  if (ltlv > 80) return { label: 'High risk', status: 'Overdue' };
  if (ltlv >= 50) return { label: 'Monitor', status: 'Pending' };
  return { label: 'Healthy', status: 'Active' };
}

function statusPillStyle(status: EspStatus): { bg: string; color: string } {
  if (status === 'Active') return { bg: 'var(--active-bg)', color: 'var(--active)' };
  if (status === 'Pending') return { bg: 'var(--pending-bg)', color: 'var(--pending-dark)' };
  return { bg: 'var(--overdue-bg)', color: '#6D28D9' };
}

interface Props {
  company: CompanyData;
  kpis: PropDevCompanyOverviewKpis | undefined;
  loans: Loan[];
}

export default function PDEntityPropertiesTab({ company, kpis, loans }: Props) {
  const [fin, setFin] = useState<PDFinancialsLike | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ company_name: string; years: number[]; pl: PDFinancialsLike['pl']; bs: PDFinancialsLike['bs']; cf?: PDFinancialsLike['cf'] }>(
      `/api/propdev/financials/${company.id}`,
    ).then(res => {
      if (cancelled) return;
      if (!res.data?.pl?.length && !res.data?.bs?.length) { setFin(null); return; }
      setFin({ companyName: res.data.company_name, years: res.data.years, pl: res.data.pl, bs: res.data.bs, cf: res.data.cf });
    }).catch(() => { if (!cancelled) setFin(null); });
    return () => { cancelled = true; };
  }, [company.id]);

  const payload = useMemo(() => {
    if (!fin) return null;
    try {
      const enriched = enrichPropDevFinWithCf(fin, company);
      return buildPropDevBoardExportPayload(enriched, company, loans, null, new Date().getFullYear(), 'YTD');
    } catch { return null; }
  }, [fin, company, loans]);

  const pl = payload ? pickFocusSnapshot(payload.plSnapshots, payload.focusYear) : null;
  const bs = payload ? pickFocusSnapshot(payload.bsSnapshots, payload.focusYear) : null;
  const cf = payload ? pickFocusSnapshot(payload.cfSnapshots, payload.focusYear) : null;

  const p = company.property;
  const land = resolveLandValue(company);
  const risk = riskBadge(kpis?.ltlv ?? null);
  const activeLoans = loans.filter(isActivePropDevLoan);
  const totalOutstanding = activeLoans.reduce((s, l) => s + (l.balance || 0), 0);
  const monthlyEmi = sumActiveMonthlyEmi(activeLoans);
  const emiStatus = cashEmiStatus(kpis?.cash ?? 0, monthlyEmi);
  const activePartners = company.partners.filter(pt => (pt.status as string) !== 'Exited');
  // Falls back to the Ownership sheet's Property Address (per-partner, imported via
  // Annexure/Ownership upload) when the Property Profile itself has no address on file.
  const location = [p.city, p.state].filter(Boolean).join(', ')
    || p.address
    || activePartners.find(pt => pt.propertyAddress)?.propertyAddress
    || '—';
  const improvementsValue = p.improvements ?? (kpis?.costBasis != null && land != null ? kpis.costBasis - land : null);

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Property card */}
      <div className="esp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{p.name || company.name}</div>
            <div className="esp-sub">{company.name}</div>
          </div>
          <span className="esp-pill" style={{ ...statusPillStyle(risk.status) }}>{risk.label}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '4px 24px' }}>
          {[
            ['Location', location],
            ['Acres', p.totalAcres > 0 ? `${p.totalAcres} acres` : '—'],
            ['Land cost', fmtUsd(land)],
            ['Improvements', fmtUsd(improvementsValue)],
            ['Total debt', fmtUsd(totalOutstanding)],
            ['LTLV', kpis?.ltlv != null ? fmtPct(kpis.ltlv) : '—'],
            ['Previous owner', p.previousOwnerName || '—'],
            ['Tax payable', p.propertyTaxAnnual != null ? fmtUsd(p.propertyTaxAnnual) : '—'],
            ['Partners', activePartners.length > 0 ? `${activePartners.length} investors` : '—'],
            ['Status', p.currentStatus || '—'],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '0.5px solid var(--border)', fontSize: 12 }}>
              <span style={{ color: 'var(--slate)' }}>{label}</span>
              <span style={{
                fontWeight: label === 'Land cost' || label === 'LTLV' ? 600 : 400,
                color: label === 'Total debt' || (label === 'LTLV' && kpis?.ltlv != null && kpis.ltlv > 80) ? 'var(--overdue)'
                  : label === 'Tax payable' && p.propertyTaxAnnual ? 'var(--pending-dark)' : 'var(--navy-text)',
              }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Financial snapshot + loan register */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="esp-card">
          <div className="esp-section-title">Financial Snapshot</div>
          {!pl ? (
            <EmptyState icon={<AlertTriangle size={28} />} title="Financial data not available" note="Upload P&L under Financials to populate." />
          ) : (
            <div>
              {[
                ['Revenue', fmtUsd(pl.rev), 'var(--navy-text)'],
                ['Total expenses', fmtUsd(pl.exp), 'var(--pending)'],
                ['Net income', fmtUsd(pl.netInc), pl.netInc >= 0 ? 'var(--growth)' : 'var(--overdue)'],
                ['Cash', fmtUsd(kpis?.cash ?? null), 'var(--navy-text)'],
                ['Cash runway', emiStatus.months != null ? `${emiStatus.months.toFixed(1)} months` : 'N/A', emiStatus.kind === 'critical' ? 'var(--overdue)' : emiStatus.kind === 'warning' ? 'var(--pending)' : 'var(--navy-text)'],
              ].map(([label, value, color]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '0.5px solid var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'var(--slate)' }}>{label}</span>
                  <span style={{ color: color as string, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="esp-card">
          <div className="esp-section-title">Loan Register</div>
          {activeLoans.length === 0 ? (
            <EmptyState icon={<AlertTriangle size={28} />} title="No active loans" />
          ) : (
            <table className="esp-table">
              <thead><tr><th>Lender</th><th style={{ textAlign: 'right' }}>Outstanding</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>EMI</th><th>Maturity</th></tr></thead>
              <tbody>
                {activeLoans.map(l => (
                  <tr key={l.id}>
                    <td>{l.bank}</td>
                    <td style={{ textAlign: 'right', color: 'var(--overdue)' }}>{fmtUsd(l.balance)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--pending-dark)' }}>{l.interestRate.toFixed(2)}%</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(l.emi)}</td>
                    <td>{fmtDate(l.maturityDate)}</td>
                  </tr>
                ))}
                <tr className="esp-total-row"><td>Total</td><td style={{ textAlign: 'right' }}>{fmtUsd(totalOutstanding)}</td><td /><td style={{ textAlign: 'right' }}>{fmtUsd(monthlyEmi)}</td><td /></tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Ownership + Balance sheet */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="esp-card">
          <div className="esp-section-title">Ownership / Partner Investments</div>
          {activePartners.length === 0 ? (
            <EmptyState icon={<Building2 size={28} />} title="No partners recorded" />
          ) : (
            <table className="esp-table">
              <thead><tr><th>Partner</th><th style={{ textAlign: 'right' }}>Capital</th><th style={{ textAlign: 'right' }}>Share %</th></tr></thead>
              <tbody>
                {activePartners.map(pt => (
                  <tr key={pt.id}><td>{pt.name}</td><td style={{ textAlign: 'right' }}>{fmtUsd(pt.capitalContributed)}</td><td style={{ textAlign: 'right' }}>{fmtPct(pt.sharePercent > 1 ? pt.sharePercent : pt.sharePercent * 100)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="esp-card">
          <div className="esp-section-title">Balance Sheet Snapshot</div>
          {!bs ? (
            <EmptyState icon={<AlertTriangle size={28} />} title="Balance sheet not available" />
          ) : (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--slate)', textTransform: 'uppercase', marginTop: 4, marginBottom: 4 }}>Assets</div>
              {[['Cash', bs.cash], ['Land', bs.landValue], ['Improvements/WIP', bs.improvementsWip], ['Total assets', bs.totalAssets]].map(([label, value]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12, fontWeight: label === 'Total assets' ? 700 : 400 }}>
                  <span style={{ color: 'var(--slate)' }}>{label}</span><span style={{ color: label === 'Total assets' ? 'var(--active)' : 'var(--navy-text)' }}>{fmtUsd(value as number)}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--slate)', textTransform: 'uppercase', marginTop: 10, marginBottom: 4 }}>Liabilities &amp; Equity</div>
              {[['Total liabilities', bs.totalDebt, 'var(--overdue)'], ['Total equity', bs.equity, 'var(--gold)']].map(([label, value, color]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12, fontWeight: 700 }}>
                  <span style={{ color: 'var(--slate)' }}>{label}</span><span style={{ color: color as string }}>{fmtUsd(value as number)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cash flow */}
      <div className="esp-card">
        <div className="esp-section-title">Cash Flow</div>
        {!cf ? (
          <EmptyState icon={<AlertTriangle size={28} />} title="Cash flow not available" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            {[
              ['Operating CF', cf.operatingCf, cf.operatingCf >= 0 ? 'var(--growth)' : 'var(--overdue)'],
              ['Investing CF', cf.investingCf, cf.investingCf >= 0 ? 'var(--growth)' : 'var(--overdue)'],
              ['Financing CF', cf.financingCf, cf.financingCf >= 0 ? 'var(--growth)' : 'var(--overdue)'],
              ['Net cash change', cf.netCashFlow, cf.netCashFlow >= 0 ? 'var(--growth)' : 'var(--overdue)'],
            ].map(([label, value, color]) => (
              <div key={label as string}>
                <div className="esp-label">{label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: color as string }}>{fmtUsd(value as number)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tax summary */}
      <div className="esp-card">
        <div className="esp-section-title">Tax Summary</div>
        {p.propertyTaxAnnual == null ? (
          <EmptyState icon={<AlertTriangle size={28} />} title="Tax data not available" note="Add tax details under the Property Profile." />
        ) : (
          <table className="esp-table">
            <thead><tr><th>Property</th><th style={{ textAlign: 'right' }}>Annual Tax</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>
              <tr>
                <td>{p.name || company.name}</td>
                <td style={{ textAlign: 'right', color: 'var(--pending-dark)' }}>{fmtUsd2(p.propertyTaxAnnual)}</td>
                <td>{fmtDate(p.taxDueDate)}</td>
                <td>
                  {(() => {
                    const due = p.taxDueDate ? new Date(p.taxDueDate) : null;
                    const overdue = due != null && due.getTime() < Date.now();
                    const st: EspStatus = overdue ? 'Overdue' : 'Pending';
                    return <span className="esp-pill" style={statusPillStyle(st)}>{overdue ? 'Overdue' : 'Due'}</span>;
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
