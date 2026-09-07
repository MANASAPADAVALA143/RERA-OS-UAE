import { AlertTriangle } from 'lucide-react';
import type { CompanyData, Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { isActivePropDevLoan, sumActiveMonthlyEmi, normalizeInterestRatePercent } from '../../../utils/propDevLoanMetrics';
import { EmptyState, type EspStatus, BadgePill } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function ltlvColor(ltlv: number | null): string {
  if (ltlv == null) return 'var(--slate)';
  if (ltlv < 60) return 'var(--active)';
  if (ltlv <= 80) return 'var(--pending)';
  return 'var(--overdue)';
}
function loanStatus(days: number | null): EspStatus {
  if (days == null) return 'Active';
  if (days < 90) return 'Overdue';
  if (days < 365) return 'Pending';
  return 'Active';
}

interface Props {
  company: CompanyData;
  kpis: PropDevCompanyOverviewKpis | undefined;
  loans: Loan[];
}

export default function PDEntityLoansTab({ company, kpis, loans }: Props) {
  const activeLoans = loans.filter(isActivePropDevLoan);
  const monthlyEmi = sumActiveMonthlyEmi(activeLoans);
  const noiAnnual = kpis?.netIncome ?? null;
  const dscr = noiAnnual != null && monthlyEmi > 0 ? noiAnnual / (monthlyEmi * 12) : null;
  const dscrColor = dscr == null ? 'var(--slate)' : dscr >= 1.25 ? 'var(--active)' : dscr >= 1.0 ? 'var(--pending)' : 'var(--overdue)';

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div className="esp-card" style={{ borderLeft: `4px solid ${ltlvColor(kpis?.ltlv ?? null)}` }}>
          <div className="esp-label">LTLV</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: ltlvColor(kpis?.ltlv ?? null), marginTop: 4 }}>
            {kpis?.ltlv != null ? `${kpis.ltlv.toFixed(1)}%` : '—'}
          </div>
          <div className="esp-sub" style={{ marginTop: 4 }}>Outstanding ÷ land value</div>
        </div>
        <div className="esp-card" style={{ borderLeft: `4px solid ${dscrColor}` }}>
          <div className="esp-label">DSCR</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: dscrColor, marginTop: 4 }}>
            {dscr != null ? `${dscr.toFixed(2)}x` : 'N/A'}
          </div>
          <div className="esp-sub" style={{ marginTop: 4 }}>Annual NOI ÷ (EMI × 12)</div>
        </div>
      </div>

      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Loans — {company.name}</div>
        {activeLoans.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<AlertTriangle size={32} />} title="No active loans" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Lender</th><th style={{ textAlign: 'right' }}>Outstanding</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>EMI</th><th>Maturity</th><th>Status</th></tr></thead>
              <tbody>
                {activeLoans.map(l => {
                  const rate = normalizeInterestRatePercent(l.interestRate);
                  const days = l.maturityDate ? Math.round((new Date(l.maturityDate).getTime() - Date.now()) / 86400000) : null;
                  return (
                    <tr key={l.id} className="esp-row-hover">
                      <td style={{ fontWeight: 600 }}>{l.bank}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(l.balance)}</td>
                      <td style={{ textAlign: 'right', color: rate > 8 ? 'var(--overdue)' : rate >= 6 ? 'var(--pending-dark)' : 'var(--active)' }}>{rate.toFixed(2)}%</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(l.emi)}</td>
                      <td>{fmtDate(l.maturityDate)}{days != null ? ` · ${days}d` : ''}</td>
                      <td><BadgePill badge={loanStatus(days)} /></td>
                    </tr>
                  );
                })}
                <tr className="esp-total-row">
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(activeLoans.reduce((s, l) => s + l.balance, 0))}</td>
                  <td /><td style={{ textAlign: 'right' }}>{fmtUsd(monthlyEmi)}</td><td /><td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
