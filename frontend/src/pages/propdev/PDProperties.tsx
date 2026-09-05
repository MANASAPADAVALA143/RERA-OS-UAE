import { useEffect, useMemo, useState } from 'react';
import { fmtUSD } from '../../components/ProtectedRoute';
import { usePropDev, type CompanyData } from '../../contexts/PropertyDevContext';
import { fetchPropDevFinancialsPool } from '../../utils/fetchPropDevFinancialsPool';
import type { PDFinancialsLike } from '../../utils/propDevCfoTrendData';
import { propDevCompanyOverviewKpis } from '../../utils/propDevCompanyOverview';
import { resolveAllPropDevLoans } from '../../utils/propDevLoanMetrics';
import PDPropertyDetail from './PDPropertyDetail';
import PDPropertiesCalculationsTab from './PDPropertiesCalculationsTab';
import {
  PD_FONT, PD_IVORY, PD_NAVY, PD_CARD_BG, PD_GOLD, PD_TEXT, PD_SLATE, PD_BORDER,
  PD_GREEN_BG, PD_GREEN_TEXT, PD_AMBER_BG, PD_AMBER_TEXT, PD_RED_BG, PD_RED_STRONG,
  PD_GRAY_BG, PD_GRAY_TEXT, PD_GOLD_LIGHT,
  pdLtlvTone, PdSectionTitle, PdSectionCard, PdBadge,
} from '../../theme/propDevEnterpriseTheme';

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return fmtUSD(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  'Under Development': { bg: PD_GRAY_BG, text: '#334155' },
  'Holding': { bg: PD_GRAY_BG, text: PD_GRAY_TEXT },
  'Active': { bg: PD_GREEN_BG, text: PD_GREEN_TEXT },
  'Sold': { bg: '#F1EDFB', text: '#3C3489' },
  'Entitlement': { bg: PD_AMBER_BG, text: PD_AMBER_TEXT },
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs" style={{ color: PD_GRAY_TEXT }}>—</span>;
  const tone = STATUS_TONE[status] ?? { bg: PD_GRAY_BG, text: PD_GRAY_TEXT };
  return <PdBadge text={status} tone={tone} />;
}

export default function PDProperties() {
  const { companies, loans, ensureCompanyYearly } = usePropDev();
  const [pageTab, setPageTab] = useState<'overview' | 'calculations'>('overview');
  const [view, setView] = useState<'all' | 'entity'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [uploadedFin, setUploadedFin] = useState<Record<string, PDFinancialsLike>>({});
  const [yearlyReady, setYearlyReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all(companies.map(c => ensureCompanyYearly(c.id)));
      if (!cancelled) setYearlyReady(n => n + 1);
    })();
    return () => { cancelled = true; };
  }, [companies, ensureCompanyYearly]);

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

  const rows = useMemo(() => {
    void yearlyReady;
    return companies.map(c => ({
      c,
      kpis: propDevCompanyOverviewKpis(c, uploadedFin[c.id] ?? null, loans),
    }));
  }, [companies, uploadedFin, yearlyReady, loans]);

  const grouped = useMemo(() => {
    const byEntity = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.c.name;
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key)!.push(r);
    }
    return [...byEntity.entries()];
  }, [rows]);

  const allLoans = useMemo(() => resolveAllPropDevLoans(companies, loans), [companies, loans]);

  if (!companies.length) return null;

  const detailCompany = detailId ? companies.find(c => c.id === detailId) : null;
  if (detailCompany) {
    return <PDPropertyDetail company={detailCompany} onBack={() => setDetailId(null)} />;
  }

  function drillIn(companyId: string) {
    setDetailId(companyId);
  }

  return (
    <div style={{ fontFamily: PD_FONT, color: PD_TEXT, background: PD_IVORY, padding: 20, borderRadius: 12 }}>
      <div className="flex gap-1 border-b mb-5" style={{ borderColor: PD_BORDER }}>
        {([
          { id: 'overview' as const, label: 'Overview' },
          { id: 'calculations' as const, label: 'Calculations' },
        ]).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPageTab(t.id)}
            className="px-3 py-2 text-xs font-medium border-b-2 -mb-px"
            style={{
              borderColor: pageTab === t.id ? PD_GOLD : 'transparent',
              color: pageTab === t.id ? PD_TEXT : PD_SLATE,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {pageTab === 'calculations' && (
        <PDPropertiesCalculationsTab companies={companies} allLoans={allLoans} />
      )}

      {pageTab === 'overview' && <>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold" style={{ color: PD_TEXT }}>Properties</h2>
          <p className="text-xs mt-0.5" style={{ color: PD_SLATE }}>{companies.length} properties across the portfolio</p>
        </div>
        <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${PD_BORDER}` }}>
          <button
            type="button"
            onClick={() => setView('all')}
            className="px-3 py-1.5 text-xs font-medium"
            style={view === 'all' ? { background: PD_NAVY, color: '#FFFFFF' } : { background: PD_CARD_BG, color: PD_SLATE }}
          >
            All Properties
          </button>
          <button
            type="button"
            onClick={() => setView('entity')}
            className="px-3 py-1.5 text-xs font-medium"
            style={{ borderLeft: `1px solid ${PD_BORDER}`, ...(view === 'entity' ? { background: PD_NAVY, color: '#FFFFFF' } : { background: PD_CARD_BG, color: PD_SLATE }) }}
          >
            Entity View
          </button>
        </div>
      </div>

      {view === 'all' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {[...rows].sort((a, b) => a.c.name.localeCompare(b.c.name)).map(({ c, kpis }) => (
            <PropertyCard key={c.id} c={c} ltlv={kpis.ltlv} onClick={() => drillIn(c.id)} />
          ))}
        </div>
      )}

      {view === 'entity' && (
        <div className="space-y-4 mb-6">
          {grouped.map(([entityName, entityRows]) => {
            const totalAcres = entityRows.reduce((s, r) => s + (r.c.property.totalAcres || 0), 0);
            const totalTax = entityRows.reduce((s, r) => s + (r.c.property.propertyTaxAnnual || 0), 0);
            const totalDebt = entityRows.reduce((s, r) => s + (r.kpis.loanBalance || 0), 0);
            return (
              <div key={entityName} className="rounded-xl overflow-hidden" style={{ background: PD_CARD_BG, border: `1px solid ${PD_BORDER}`, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div className="px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1" style={{ background: '#F8FAFC', borderBottom: `1px solid ${PD_BORDER}` }}>
                  <h3 className="font-bold text-sm" style={{ color: PD_TEXT }}>{entityName}</h3>
                  <span className="text-xs" style={{ color: PD_SLATE }}>{totalAcres.toFixed(1)} acres</span>
                  <span className="text-xs" style={{ color: PD_SLATE }}>Tax payable {fmtMoney(totalTax)}</span>
                  <span className="text-xs" style={{ color: PD_SLATE }}>Debt {fmtMoney(totalDebt)}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                  {entityRows.map(({ c, kpis }) => (
                    <PropertyCard key={c.id} c={c} ltlv={kpis.ltlv} onClick={() => drillIn(c.id)} compact />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-6">
        <PdSectionTitle>Property tax summary</PdSectionTitle>
        <PdSectionCard>
          <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${PD_BORDER}` }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: PD_NAVY }}>
                  {['Property', 'Entity', 'Parcel ID', 'Annual Tax', 'Due Date', 'Status'].map((h, i) => (
                    <th key={h} className={`px-3 py-2.5 text-[10px] font-semibold uppercase ${i === 3 ? 'text-right' : i === 5 ? 'text-center' : 'text-left'}`} style={{ color: '#FFFFFF', letterSpacing: '0.05em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => (b.c.property.propertyTaxAnnual || 0) - (a.c.property.propertyTaxAnnual || 0))
                  .map(({ c }, idx) => {
                    const tax = c.property.propertyTaxAnnual;
                    const tone = !tax ? { bg: PD_GRAY_BG, text: PD_GRAY_TEXT } : { bg: PD_AMBER_BG, text: PD_AMBER_TEXT };
                    return (
                      <tr
                        key={c.id}
                        className="cursor-pointer"
                        style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderTop: `1px solid ${PD_BORDER}` }}
                        onClick={() => drillIn(c.id)}
                      >
                        <td className="px-3 py-2 font-semibold" style={{ color: PD_TEXT }}>{c.property.name || c.name}</td>
                        <td className="px-3 py-2" style={{ color: PD_SLATE }}>{c.name}</td>
                        <td className="px-3 py-2" style={{ color: PD_SLATE }}>{c.property.taxParcelId || '—'}</td>
                        <td className="px-3 py-2 text-right font-medium" style={{ color: PD_TEXT }}>{fmtMoney(tax)}</td>
                        <td className="px-3 py-2" style={{ color: PD_SLATE }}>{fmtDate(c.property.taxDueDate)}</td>
                        <td className="px-3 py-2 text-center">
                          <PdBadge text={tax ? 'Outstanding' : 'No data'} tone={tone} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] mt-2" style={{ color: PD_GRAY_TEXT }}>
            Annual tax and due date come from the property profile. YTD-paid / payable-balance (from Balance Sheet uploads) is not wired into this table yet.
          </p>
        </PdSectionCard>
      </div>

      <div>
        <PdSectionTitle>Ownership history</PdSectionTitle>
        <PdSectionCard>
          <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${PD_BORDER}` }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: PD_NAVY }}>
                  {['Property', 'Previous Owner', 'Acquisition Date', 'Acquisition Price', 'Type', 'Title Company'].map((h, i) => (
                    <th key={h} className={`px-3 py-2.5 text-[10px] font-semibold uppercase ${i === 3 ? 'text-right' : 'text-left'}`} style={{ color: '#FFFFFF', letterSpacing: '0.05em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c }, idx) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer"
                    style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderTop: `1px solid ${PD_BORDER}` }}
                    onClick={() => drillIn(c.id)}
                  >
                    <td className="px-3 py-2 font-semibold" style={{ color: PD_TEXT }}>{c.property.name || c.name}</td>
                    <td className="px-3 py-2" style={{ color: PD_SLATE }}>{c.property.previousOwnerName || '—'}</td>
                    <td className="px-3 py-2" style={{ color: PD_SLATE }}>{fmtDate(c.property.acquisitionDate)}</td>
                    <td className="px-3 py-2 text-right font-medium" style={{ color: PD_TEXT }}>{fmtMoney(c.property.acquisitionPrice)}</td>
                    <td className="px-3 py-2" style={{ color: PD_SLATE }}>{c.property.acquisitionType || '—'}</td>
                    <td className="px-3 py-2" style={{ color: PD_SLATE }}>{c.property.titleCompany || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PdSectionCard>
      </div>
      </>}
    </div>
  );
}

function PropertyCard({
  c, ltlv, onClick, compact,
}: {
  c: CompanyData; ltlv: number | null; onClick: () => void; compact?: boolean;
}) {
  const p = c.property;
  const tone = pdLtlvTone(ltlv);
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl p-3.5 transition-colors"
      style={{ background: PD_CARD_BG, border: `1px solid ${PD_BORDER}`, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: PD_TEXT }}>{p.name || c.name}</p>
          <p className="text-xs truncate" style={{ color: PD_SLATE }}>{p.address || 'No address on file'}</p>
        </div>
        <StatusBadge status={p.currentStatus} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs" style={{ color: PD_SLATE }}>
        <span>{p.totalAcres ? `${p.totalAcres.toFixed(1)} acres` : '— acres'}</span>
        <span>{p.totalLots ?? 0} lot(s)</span>
        {p.landUseType && <span>{p.landUseType}</span>}
      </div>
      {!compact && (
        <div className="grid grid-cols-2 gap-2 mt-3 pt-2 text-xs" style={{ borderTop: `1px solid ${PD_BORDER}` }}>
          <div>
            <p className="text-[10px] uppercase" style={{ color: PD_GRAY_TEXT }}>Acquired</p>
            <p style={{ color: PD_TEXT }}>{fmtDate(p.acquisitionDate)}</p>
            <p style={{ color: PD_SLATE }}>{fmtMoney(p.acquisitionPrice)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase" style={{ color: PD_GRAY_TEXT }}>Annual tax</p>
            <p style={{ color: PD_TEXT }}>{fmtMoney(p.propertyTaxAnnual)}</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mt-2.5 pt-2" style={{ borderTop: `1px solid ${PD_BORDER}` }}>
        <span className="text-[11px] truncate" style={{ color: PD_SLATE }}>{c.name}</span>
        <PdBadge text={`LTLV ${ltlv != null ? `${ltlv.toFixed(1)}%` : '—'}`} tone={{ bg: tone.bg, text: tone.text }} />
      </div>
    </button>
  );
}
