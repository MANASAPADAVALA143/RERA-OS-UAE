/**
 * Consultancy & Outsourcing Executive Summary — equivalent of PropDevExecutiveSummary.tsx.
 * Per-company header (company selector + Month/YTD/YoY toggle) wrapping
 * ConsultancyExecutiveSummaryBands, fed by the same payload builder used by the
 * Export PDF button — numbers on this page and in the PDF always match.
 */
import { useEffect, useMemo, useState } from 'react';
import { useConsultancy } from '../../contexts/ConsultancyContext';
import api from '../../services/api';
import PeriodToggle from '../../components/shared/PeriodToggle';
import { type Period, periodChipText } from '../../utils/periodWindow';
import { buildConsultancyBoardExportPayload } from '../../utils/gatherConsultancyBoardExportData';
import ConsultancyExecutiveSummaryBands from '../../components/consultancy/ConsultancyExecutiveSummaryBands';
import { PT, PT_FONT } from '../../utils/parchmentTypography';
import type { ConsultFinancials, ConsultFinItem } from './ConsultancyFinancials';

export default function ConsultancyExecutiveSummary() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useConsultancy();
  const [period, setPeriod] = useState<Period | null>(null);
  const [pMonth, setPMonth] = useState(new Date().getMonth() + 1);
  const [pYear, setPYear] = useState(new Date().getFullYear());
  const [fin, setFin] = useState<ConsultFinancials | null>(null);
  const [loading, setLoading] = useState(false);

  const financialCompanyId = selectedCompanyId !== 'all' && companies.some(c => c.id === selectedCompanyId)
    ? selectedCompanyId
    : (companies[0]?.id ?? '');
  const company = useMemo(() => companies.find(c => c.id === financialCompanyId), [companies, financialCompanyId]);

  useEffect(() => {
    if (!financialCompanyId) { setFin(null); return; }
    let cancelled = false;
    setLoading(true);
    api.get<{ company_name: string; years: number[]; pl: ConsultFinItem[]; bs: ConsultFinItem[]; cf?: ConsultFinItem[] }>(
      `/api/consultancy/financials/${financialCompanyId}`,
    )
      .then(res => {
        if (cancelled) return;
        if (!res.data?.pl?.length && !res.data?.bs?.length) { setFin(null); return; }
        setFin({
          companyName: res.data.company_name, years: res.data.years,
          plFile: '', bsFile: '', cfFile: undefined, uploadedAt: '',
          pl: res.data.pl, bs: res.data.bs, cf: res.data.cf ?? [],
        });
        const years = res.data.years ?? [];
        if (years.length) setPYear(years[years.length - 1]);
      })
      .catch(() => { if (!cancelled) setFin(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [financialCompanyId]);

  const periodLabel = period ? periodChipText(period, pMonth, pYear) : `FY ${pYear}`;
  const payload = useMemo(() => {
    if (!fin) return null;
    return buildConsultancyBoardExportPayload(fin, company?.name ?? 'Consultancy Entity', periodLabel);
  }, [fin, company, periodLabel]);

  return (
    <div style={{ background: PT.pageBg, minHeight: '100vh', width: '100%', maxWidth: '100%', fontSize: 13, color: PT.text }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ ...PT_FONT.pageTitle, fontFamily: "'Fraunces', Georgia, 'Times New Roman', serif", fontWeight: 600 }}>Executive Summary</h1>
          <p style={{ ...PT_FONT.pageSubtitle, margin: '6px 0 0' }}>
            {company?.name ?? 'Select a company'} · {periodLabel}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <select
            value={financialCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            style={{ ...PT_FONT.control, padding: '8px 12px', borderRadius: 8, border: `1px solid ${PT.border}`, background: PT.cardBg, minWidth: 220 }}
          >
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <PeriodToggle
            period={period}
            month={pMonth}
            year={pYear}
            onChange={(p, m, y) => { setPeriod(p); setPMonth(m); setPYear(y); }}
            availableKeys={[]}
          />
        </div>
      </div>

      {loading ? (
        <p style={PT_FONT.bodyMuted}>Loading company financials…</p>
      ) : !companies.length ? (
        <p style={PT_FONT.bodyMuted}>No companies yet — add one under Overview to see the Executive Summary.</p>
      ) : !payload ? (
        <p style={PT_FONT.bodyMuted}>No P&amp;L or Balance Sheet uploaded for {company?.name ?? 'this company'} yet — upload under Financials &amp; Risk to populate the Executive Summary.</p>
      ) : (
        <ConsultancyExecutiveSummaryBands data={payload} />
      )}
    </div>
  );
}
