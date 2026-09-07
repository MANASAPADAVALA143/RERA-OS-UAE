import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Home, Hotel, Warehouse, House, Landmark, Store, School, Factory, Building,
  Plus, ArrowRight,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { fmtUSD } from '../../components/ProtectedRoute';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import { PT } from '../../theme/parchmentTheme';
import { fetchPropDevFinancialsPool } from '../../utils/fetchPropDevFinancialsPool';
import type { PDFinancialsLike } from '../../utils/propDevCfoTrendData';
import {
  propDevCompanyOverviewKpis,
  propDevPortfolioOverview,
} from '../../utils/propDevCompanyOverview';

const REGISTRY_HREF = '/settings/companies?tab=propdev';

type IconComp = React.FC<{ size?: number | string; className?: string }>;

const COMPANY_STYLES: { Icon: IconComp; bg: string; text: string }[] = [
  { Icon: Building2, bg: 'bg-amber-100', text: 'text-amber-800' },
  { Icon: Home,      bg: 'bg-blue-100',    text: 'text-blue-700'    },
  { Icon: Hotel,     bg: 'bg-orange-100',  text: 'text-orange-700'  },
  { Icon: Building,  bg: 'bg-indigo-100',  text: 'text-indigo-700'  },
  { Icon: House,     bg: 'bg-teal-100',    text: 'text-teal-900'    },
  { Icon: Warehouse, bg: 'bg-cyan-100',    text: 'text-cyan-700'    },
  { Icon: Landmark,  bg: 'bg-violet-100',  text: 'text-violet-700'  },
  { Icon: Store,     bg: 'bg-rose-100',    text: 'text-rose-700'    },
  { Icon: School,    bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { Icon: Factory,   bg: 'bg-slate-100',   text: 'text-slate-700'   },
];

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return fmtUSD(n);
}

function fmtPctOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] leading-tight mb-0.5" style={{ color: PT.muted }}>{label}</p>
      <p
        className="font-semibold text-xs leading-tight"
        style={{ color: warn ? '#B91C1C' : PT.text }}
      >
        {value}
      </p>
    </div>
  );
}

export default function PDCompanies() {
  const navigate = useNavigate();
  const { companies, loans, ensureCompanyYearly, setSelectedCompanyId } = usePropDev();
  const { setTab } = usePropDevNav();
  const [prefersReduced, setPrefersReduced] = useState(false);
  const [uploadedFin, setUploadedFin] = useState<Record<string, PDFinancialsLike>>({});
  const [yearlyReady, setYearlyReady] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Load yearly BS/PL for Command Center–aligned land / cost / cash / NI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all(companies.map(c => ensureCompanyYearly(c.id)));
      if (!cancelled) setYearlyReady(n => n + 1);
    })();
    return () => { cancelled = true; };
  }, [companies, ensureCompanyYearly]);

  // Load uploaded P&L / BS for richer Cash / Cost Basis when present.
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
      {
        onItem: (id, item) => {
          if (!cancelled) setUploadedFin(prev => ({ ...prev, [id]: item }));
        },
      },
    ).then(merged => {
      if (!cancelled) setUploadedFin(prev => ({ ...prev, ...merged }));
    });
    return () => { cancelled = true; };
  }, [companies]);

  const portfolio = useMemo(() => {
    void yearlyReady;
    return companies.map(c => ({
      c,
      kpis: propDevCompanyOverviewKpis(c, uploadedFin[c.id] ?? null, loans),
    }));
  }, [companies, uploadedFin, yearlyReady, loans]);

  const summary = useMemo(() => propDevPortfolioOverview(portfolio), [portfolio]);

  const propertyCount = useMemo(
    () => companies.filter(c => (c.property.name || '').trim()).length || companies.length,
    [companies],
  );

  function drillToCommandCenter(companyId: string) {
    setSelectedCompanyId(companyId);
    setTab('dashboard');
  }

  return (
    <>
      {!prefersReduced && (
        <style>{`
          @keyframes fadeInCard {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0);   }
          }
        `}</style>
      )}
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: PT.text }}>Companies</h1>
            <p className="text-sm mt-1" style={{ color: PT.muted }}>
              Property Dev portfolio — click a card for Command Center
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(REGISTRY_HREF)}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-medium transition-colors"
            style={{ background: PT.accent, color: '#fff' }}
          >
            <Plus size={15} /> Add Company
          </button>
        </div>

        {companies.length > 0 && (
          <div
            className="rounded-xl border px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
            style={{ background: PT.cardBg, borderColor: PT.border, color: PT.muted }}
          >
            <span style={{ fontWeight: 600, color: PT.text }}>
              Portfolio View:
            </span>
            <span>
              {companies.length} companies · {propertyCount} properties
            </span>
            <span style={{ color: PT.border }}>·</span>
            <span>Land Value <strong style={{ color: PT.text }}>{fmtMoney(summary.totalLand || null)}</strong></span>
            <span style={{ color: PT.border }}>·</span>
            <span>Cost Basis <strong style={{ color: PT.text }}>{fmtMoney(summary.totalCostBasis || null)}</strong></span>
            <span style={{ color: PT.border }}>·</span>
            <span>Outstanding Debt <strong style={{ color: PT.text }}>{fmtMoney(summary.totalDebt || null)}</strong></span>
            <span style={{ color: PT.border }}>·</span>
            <span>Avg LTLV <strong style={{ color: PT.text }}>{fmtPctOrDash(summary.avgLtlv)}</strong></span>
          </div>
        )}

        {companies.length === 0 ? (
          <div
            className="rounded-xl border p-8 text-center"
            style={{ background: PT.cardBg, borderColor: PT.border }}
          >
            <Building2 size={40} className="mx-auto mb-3" style={{ color: PT.muted }} />
            <p className="font-semibold mb-2" style={{ color: PT.text }}>No companies yet</p>
            <p className="text-sm mb-4" style={{ color: PT.muted }}>
              Add entities in Company Registry or upload your portfolio Excel.
            </p>
            <div className="flex justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => navigate(REGISTRY_HREF)}
                className="px-4 py-2 rounded-lg text-sm font-medium border"
                style={{ borderColor: PT.border, color: PT.text, background: PT.cardBg }}
              >
                Company Registry
              </button>
              <button
                type="button"
                onClick={() => setTab('upload')}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: PT.accent }}
              >
                Upload Data
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {portfolio.map(({ c, kpis }, index) => {
              const style = COMPANY_STYLES[index % COMPANY_STYLES.length];
              const { Icon } = style;
              return (
                <div
                  key={c.id}
                  className={prefersReduced ? '' : 'hover:scale-[1.02] transition-transform duration-150'}
                  style={prefersReduced ? {} : {
                    animation: `fadeInCard 0.25s ease ${index * 40}ms both`,
                  }}
                >
                  <Card>
                    <div
                      className="space-y-3 cursor-pointer"
                      onClick={() => drillToCommandCenter(c.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          drillToCommandCenter(c.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-xl ${style.bg} flex-shrink-0`}>
                          <Icon size={22} className={style.text} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold truncate" style={{ color: PT.text }} title={c.name}>
                            {c.name}
                          </h3>
                          <p className="text-xs truncate" style={{ color: PT.muted }}>
                            {c.property.name || '—'}
                          </p>
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                            kpis.hasFin ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {kpis.hasFin ? 'Fin uploaded' : 'No fin'}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <Metric label="Land Value" value={fmtMoney(kpis.landValue)} />
                        <Metric label="Cost Basis" value={fmtMoney(kpis.costBasis)} />
                        <Metric label="Fair Market Value" value={fmtMoney(kpis.fmv)} />
                        <Metric
                          label="Outstanding Loan"
                          value={kpis.loanBalance > 0 ? fmtMoney(kpis.loanBalance) : '—'}
                          warn={kpis.loanBalance > 0}
                        />
                        <Metric label="LTLV" value={fmtPctOrDash(kpis.ltlv)} />
                        <Metric label="Cash on Hand" value={fmtMoney(kpis.cash)} />
                        <Metric
                          label="Net Income"
                          value={fmtMoney(kpis.netIncome)}
                          warn={kpis.netIncome != null && kpis.netIncome < 0}
                        />
                      </div>

                      <div
                        className="rounded-lg px-2.5 py-2 text-xs"
                        style={{ background: 'rgba(0,0,0,0.03)', border: `1px solid ${PT.border}` }}
                      >
                        <p className="mb-1 font-medium" style={{ color: PT.muted }}>Partners</p>
                        {!kpis.hasOwnership ? (
                          <p style={{ color: PT.muted }}>Partners: not uploaded</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {kpis.partners.map(p => (
                              <li key={`${c.id}-${p.name}`} style={{ color: PT.text }}>
                                {p.name} — {p.sharePercent.toFixed(2)}%
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => drillToCommandCenter(c.id)}
                          className="w-full py-1.5 text-sm rounded-lg font-medium transition-colors"
                          style={{ background: PT.accent, color: '#fff' }}
                        >
                          Command Center <ArrowRight size={12} className="inline ml-0.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCompanyId(c.id);
                            setTab('financials');
                          }}
                          className="w-full py-1.5 text-sm rounded-lg font-medium border transition-colors"
                          style={{ borderColor: PT.border, color: PT.text, background: PT.cardBg }}
                        >
                          Financials
                        </button>
                      </div>
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
