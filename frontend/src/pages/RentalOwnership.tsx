import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import {
  ChevronDown, ChevronRight, Plus, Download, Zap,
  Building2, Users, TrendingUp, DollarSign, X,
} from 'lucide-react';
import {
  aggregateKpiDataList,
  apiResponseToParsedFinancials,
  calcKpis,
  formatSolvencyDscr,
  formatSolvencyLtv,
  solvencyMetricsFromKpi,
  type KpiData,
} from '../utils/rentalKpiEngine';
import {
  effectiveCapRate,
  partnerReturnMetrics,
  portfolioEquityMultiple,
  portfolioIrr,
  type PartnerReturnMetrics,
} from '../utils/ownershipMetrics';

// ── Constants ──────────────────────────────────────────────────────────────────
const CAP_RATE    = 0.055;
const ACQ_COST    = 0.05;
const DEP_RATE    = 0.03636;
const HOLD_YEARS  = 5;
const DIST_RATE   = 0.045;

const NATURE_OPTIONS = [
  'General Partner (GP)',
  'Limited Partner (LP)',
  'Class A — Preferred',
  'Class B — Common',
  'Joint Venture Partner',
  'Silent Partner',
  'Managing Member',
  'Passive Investor',
] as const;
type Nature = typeof NATURE_OPTIONS[number];

const NATURE_BADGE: Record<string, string> = {
  'General Partner (GP)':  'bg-green-900 text-white',
  'Limited Partner (LP)':  'bg-blue-100 text-blue-800',
  'Class A — Preferred':   'bg-amber-100 text-amber-800',
  'Class B — Common':      'bg-purple-100 text-purple-800',
  'Joint Venture Partner': 'bg-teal-100 text-teal-800',
  'Silent Partner':        'bg-gray-200 text-gray-700',
  'Managing Member':       'bg-green-100 text-green-800',
  'Passive Investor':      'bg-gray-100 text-gray-500',
};

const ROLE_MAP: Record<string, Nature> = {
  general_partner:  'General Partner (GP)',
  limited_partner:  'Limited Partner (LP)',
  silent_partner:   'Silent Partner',
  managing_member:  'Managing Member',
  passive_investor: 'Passive Investor',
};

const COLORS = ['#1E3A8A','#2D6A4F','#40916C','#52B788','#74C69D','#95D5B2','#FBBF24','#F97316','#7C3AED','#DB2777'];

const CONTRIB_TYPES = [
  'Initial Contribution',
  'Additional Contribution',
  'Capital Call Payment',
  'Return of Capital',
  'Distribution',
];

const fmtK = (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${Math.round(n)}`;
const fmt  = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString()}`;

// ── Types ──────────────────────────────────────────────────────────────────────
interface Holding {
  ownership_id: string;
  company_id:   string;
  company_name: string;
  property_id?: string | null;
  property_name?: string;
  property_address?: string | null;
  entity_structure?: string | null;
  ownership_pct: number;
  role:          string;
  cost_basis?: number | null;
  book_value?: number | null;
  existing_debt?: number | null;
  capital_contributed?: number | null;
  noi_this_month: number;
  noi_share:     number;
}

interface CompanyMeta {
  id: string;
  company_name: string;
  total_units: number;
  gross_potential_rent: number;
}

interface PartnerGroup {
  partner_name:    string;
  company_count:   number;
  total_noi_share: number;
  holdings:        Holding[];
}

interface PFinancials {
  marketValue: number;
  capitalContributed: number;
  costBasis: number;
  bookValue: number;
  unrealizedGain: number;
  returnToDate: number;
  roi: number;
}

interface Contribution {
  id: string; partner: string; company: string;
  date: string; amount: number; type: string;
  reference: string; notes: string; cumulative: number;
}

interface AddPartnerForm {
  name: string; nature: Nature; companies: string[];
  ownershipPct: string; capital: string; costBasis: string;
  acquisitionDate: string; email: string; phone: string; notes: string;
}

const BLANK_PARTNER: AddPartnerForm = {
  name: '', nature: 'Limited Partner (LP)', companies: [],
  ownershipPct: '', capital: '', costBasis: '',
  acquisitionDate: '', email: '', phone: '', notes: '',
};

const BLANK_CONTRIB = {
  partner: '', company: '', date: '', amount: '',
  type: 'Initial Contribution', reference: '', notes: '',
};

// ── Derivations ────────────────────────────────────────────────────────────────
function companyMarketValue(gpr: number): number {
  return gpr > 0 ? (gpr * 12) / CAP_RATE : 0;
}

function holdingFinancials(
  holding: Holding,
  companyGpr: number,
  holdYears = HOLD_YEARS,
): { marketValue: number; capitalContributed: number; costBasis: number; bookValue: number; unrealizedGain: number; existingDebt: number } {
  const propertyMV = companyMarketValue(companyGpr);

  const marketValue = propertyMV > 0
    ? propertyMV * holding.ownership_pct
    : (holding.book_value ?? holding.cost_basis ?? 0);

  let capitalContributed = holding.capital_contributed ?? null;
  if (capitalContributed == null && holding.cost_basis != null) {
    capitalContributed = holding.cost_basis / (1 + ACQ_COST);
  }
  if (capitalContributed == null && marketValue > 0) {
    capitalContributed = marketValue / 1.25;
  }
  capitalContributed = capitalContributed ?? 0;

  const costBasis = holding.cost_basis
    ?? (capitalContributed > 0 ? capitalContributed * (1 + ACQ_COST) : 0);

  const bookValue = holding.book_value
    ?? (costBasis > 0 ? Math.max(0, costBasis * (1 - DEP_RATE * holdYears)) : 0);

  const existingDebt = holding.existing_debt ?? 0;
  const unrealizedGain = marketValue - costBasis;
  return { marketValue, capitalContributed, costBasis, bookValue, unrealizedGain, existingDebt };
}

function holdingMetricWeight(holding: Holding, companyGpr: number): number {
  const hf = holdingFinancials(holding, companyGpr);
  return hf.marketValue || hf.bookValue || hf.costBasis || hf.capitalContributed || 1;
}

/** Value-weighted average ownership % across holdings — never sums raw % across properties. */
function weightedOwnershipPct(
  holdings: Holding[],
  companyGpr: Record<string, number>,
): number {
  if (holdings.length === 0) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const h of holdings) {
    const w = holdingMetricWeight(h, companyGpr[h.company_id] ?? 0);
    weighted += h.ownership_pct * 100 * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) {
    const avg = holdings.reduce((s, h) => s + h.ownership_pct * 100, 0) / holdings.length;
    return Math.min(100, avg);
  }
  return Math.min(100, weighted / totalWeight);
}

type CompanySlice = {
  partner: string;
  propertyName: string;
  pct: number;
  color: string;
  costBasis: number;
  bookValue: number;
  marketValue: number;
  capitalIn: number;
};

/** Partner equity share within a company (for pie charts) — sums to 100%. */
function partnerEquityShareInCompany(slices: CompanySlice[]): { name: string; value: number; color: string }[] {
  const byPartner = new Map<string, { mv: number; color: string }>();
  let totalMv = 0;
  for (const s of slices) {
    totalMv += s.marketValue;
    const cur = byPartner.get(s.partner) ?? { mv: 0, color: s.color };
    cur.mv += s.marketValue;
    byPartner.set(s.partner, cur);
  }
  if (totalMv > 0) {
    return [...byPartner.entries()].map(([name, { mv, color }]) => ({
      name,
      value: (mv / totalMv) * 100,
      color,
    }));
  }
  const byPct = new Map<string, { sum: number; color: string }>();
  for (const s of slices) {
    const cur = byPct.get(s.partner) ?? { sum: 0, color: s.color };
    cur.sum += s.pct;
    byPct.set(s.partner, cur);
  }
  const total = [...byPct.values()].reduce((s, v) => s + v.sum, 0);
  return [...byPct.entries()].map(([name, { sum, color }]) => ({
    name,
    value: total > 0 ? (sum / total) * 100 : 0,
    color,
  }));
}

function deriveFinancials(p: PartnerGroup, companyGpr: Record<string, number>): PFinancials {
  let marketValue = 0;
  let capitalContributed = 0;
  let costBasis = 0;
  let bookValue = 0;

  p.holdings.forEach(h => {
    const gpr = companyGpr[h.company_id] ?? 0;
    const hf = holdingFinancials(h, gpr);
    marketValue += hf.marketValue;
    capitalContributed += hf.capitalContributed;
    costBasis += hf.costBasis;
    bookValue += hf.bookValue;
  });

  const unrealizedGain = marketValue - costBasis;
  const returnToDate = capitalContributed > 0 ? capitalContributed * DIST_RATE * HOLD_YEARS : 0;
  const roi = costBasis > 0 ? (returnToDate / costBasis) * 100 : 0;
  return { marketValue, capitalContributed, costBasis, bookValue, unrealizedGain, returnToDate, roi };
}

function genContributions(partner: string, companies: string[], capital: number): Contribution[] {
  const amounts = [capital * 0.5, capital * 0.3, capital * 0.2, -(capital * DIST_RATE), -(capital * DIST_RATE), -(capital * DIST_RATE)];
  const dates   = ['2020-03-15','2020-09-01','2021-06-15','2022-12-31','2023-12-31','2024-12-31'];
  const types   = ['Initial Contribution','Additional Contribution','Capital Call Payment','Distribution','Distribution','Distribution'];
  let cum = 0;
  return amounts.map((amt, i) => {
    cum += amt;
    return { id:`${partner}-${i}`, partner, company: companies[i % Math.max(1, companies.length)], date: dates[i], amount: Math.round(amt), type: types[i], reference:`REF-${2020+Math.floor(i/2)}-${String(i+1).padStart(3,'0')}`, notes:'', cumulative: Math.round(cum) };
  });
}

function genTrend(costBasis: number, marketValue: number) {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now); d.setMonth(d.getMonth() - (11 - i));
    const t = i / 11;
    return {
      month: d.toLocaleString('default', { month:'short', year:'2-digit' }),
      bookValue:   Math.round(costBasis * (1 - DEP_RATE * (4 + t))),
      marketValue: Math.round(costBasis * 1.1 + (marketValue - costBasis * 1.1) * t),
    };
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function NatureBadge({ nature }: { nature: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${NATURE_BADGE[nature] ?? 'bg-gray-100 text-gray-600'}`}>{nature}</span>;
}

function GainCell({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span className={`font-mono font-semibold ${pos ? 'text-green-800' : 'text-red-700'}`}>
      {pos ? '+' : '-'}{fmt(value)}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function RentalOwnership() {
  const [apiPartners, setApiPartners] = useState<PartnerGroup[]>([]);
  const [companies, setCompanies]     = useState<CompanyMeta[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

  // Filters
  const [companyFilter, setCompanyFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('all');

  // UI state
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [expandedCos, setExpandedCos]         = useState<Set<string>>(new Set());

  // Local overrides
  const [natures, setNatures]         = useState<Record<string, string>>({});
  const [localContribs, setLocalContribs] = useState<Contribution[]>([]);

  // Modals
  const [showAddPartner, setShowAddPartner] = useState(false);
  const [partnerForm, setPartnerForm]       = useState<AddPartnerForm>(BLANK_PARTNER);
  const [showAddContrib, setShowAddContrib] = useState(false);
  const [contribForm, setContribForm]       = useState({ ...BLANK_CONTRIB });
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [breakdownTab, setBreakdownTab] = useState<'company' | 'partner' | 'property'>('company');
  const [companyKpis, setCompanyKpis] = useState<Record<string, KpiData | null>>({});
  const [scatterMode, setScatterMode] = useState<'partner' | 'property'>('partner');

  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [ownRes, coRes] = await Promise.all([
        api.get<PartnerGroup[]>('/api/rentals/ownership'),
        api.get<CompanyMeta[]>('/api/rentals/companies'),
      ]);
      setApiPartners(Array.isArray(ownRes.data) ? ownRes.data : []);
      setCompanies(Array.isArray(coRes.data) ? coRes.data : []);
    } catch { setError('Failed to load ownership data.'); }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const ids = [...new Set(apiPartners.flatMap(p => p.holdings.map(h => h.company_id)))];
    if (!ids.length) {
      setCompanyKpis({});
      return;
    }
    let cancelled = false;
    Promise.all(ids.map(async id => {
      try {
        const res = await api.get(`/api/rentals/financials/${id}`);
        const fin = apiResponseToParsedFinancials(res.data);
        const year = fin.years.length ? fin.years[fin.years.length - 1] : null;
        return [id, year ? calcKpis(fin, year) : null] as const;
      } catch {
        return [id, null] as const;
      }
    })).then(rows => {
      if (cancelled) return;
      const m: Record<string, KpiData | null> = {};
      rows.forEach(([id, k]) => { m[id] = k; });
      setCompanyKpis(m);
    });
    return () => { cancelled = true; };
  }, [apiPartners]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const companyGpr = useMemo(() => {
    const m: Record<string, number> = {};
    companies.forEach(c => { m[c.id] = c.gross_potential_rent; });
    return m;
  }, [companies]);

  const companyUnits = useMemo(() => {
    const m: Record<string, number> = {};
    companies.forEach(c => { m[c.id] = c.total_units; });
    return m;
  }, [companies]);

  const financials = useMemo(() => {
    const m: Record<string, PFinancials> = {};
    apiPartners.forEach(p => { m[p.partner_name] = deriveFinancials(p, companyGpr); });
    return m;
  }, [apiPartners, companyGpr]);

  const allCompanies = useMemo(() => {
    const map: Record<string, string> = {};
    apiPartners.forEach(p => p.holdings.forEach(h => { map[h.company_id] = h.company_name; }));
    return Object.entries(map).map(([id, name]) => ({ id, name }));
  }, [apiPartners]);

  const filtered = useMemo(() => {
    let ps = apiPartners;
    if (partnerFilter !== 'all') ps = ps.filter(p => p.partner_name === partnerFilter);
    if (companyFilter !== 'all') ps = ps.filter(p => p.holdings.some(h => h.company_id === companyFilter));
    return ps;
  }, [apiPartners, partnerFilter, companyFilter]);

  const scopedCompanyIds = useMemo(() => {
    const ids = new Set<string>();
    filtered.forEach(p => p.holdings.forEach(h => ids.add(h.company_id)));
    return ids;
  }, [filtered]);

  const portfolioSolvency = useMemo(() => {
    const kpis = [...scopedCompanyIds]
      .map(id => companyKpis[id])
      .filter((k): k is KpiData => k != null);
    if (!kpis.length) {
      return { ltvPct: null as number | null, dscr: null as number | null, hasFinancials: false };
    }
    return { ...solvencyMetricsFromKpi(aggregateKpiDataList(kpis)), hasFinancials: true };
  }, [scopedCompanyIds, companyKpis]);

  const propertiesPerCompany = useMemo(() => {
    const uniq: Record<string, Set<string>> = {};
    apiPartners.forEach(p => {
      p.holdings.forEach(h => {
        if (!uniq[h.company_id]) uniq[h.company_id] = new Set();
        uniq[h.company_id].add(h.property_name || h.company_name);
      });
    });
    const out: Record<string, number> = {};
    Object.entries(uniq).forEach(([id, set]) => { out[id] = set.size; });
    return out;
  }, [apiPartners]);

  const hasImportedFinancials = useMemo(
    () => apiPartners.some(p => p.holdings.some(h =>
      h.cost_basis != null || h.book_value != null || h.capital_contributed != null,
    )),
    [apiPartners],
  );

  const kpis = useMemo(() => {
    const fs = filtered.map(p => financials[p.partner_name]).filter(Boolean);
    const totalMV  = fs.reduce((s, f) => s + f.marketValue, 0);
    const totalDebt = filtered.reduce((s, p) => s + p.holdings.reduce((hs, h) => {
      const gpr = companyGpr[h.company_id] ?? 0;
      return hs + holdingFinancials(h, gpr).existingDebt;
    }, 0), 0) || totalMV * 0.6;
    const totalEq  = totalMV - totalDebt;
    const totalCap = fs.reduce((s, f) => s + f.capitalContributed, 0);
    const totalCost = fs.reduce((s, f) => s + f.costBasis, 0);
    const weightedROI = totalCost > 0
      ? fs.reduce((s, f) => s + f.roi * f.costBasis, 0) / totalCost
      : 0;
    return {
      totalPartners: filtered.length,
      totalCapital: totalCap,
      totalMV,
      totalEquity: totalEq,
      totalDebt,
      avgROI: weightedROI,
    };
  }, [financials, filtered, companyGpr]);

  const byCompany = useMemo(() => {
    const map: Record<string, {
      id: string; name: string; units: number; noi: number;
      marketValue: number; bookValue: number; costBasis: number; capitalIn: number; debt: number;
      slices: CompanySlice[];
    }> = {};
    apiPartners.forEach((p, pi) => {
      p.holdings.forEach(h => {
        const gpr = companyGpr[h.company_id] ?? 0;
        const hf = holdingFinancials(h, gpr);
        if (!map[h.company_id]) {
          map[h.company_id] = {
            id: h.company_id,
            name: h.company_name,
            units: companyUnits[h.company_id] ?? 0,
            noi: h.noi_this_month,
            marketValue: companyMarketValue(gpr),
            bookValue: 0,
            costBasis: 0,
            capitalIn: 0,
            debt: 0,
            slices: [],
          };
        }
        map[h.company_id].bookValue += hf.bookValue;
        map[h.company_id].costBasis += hf.costBasis;
        map[h.company_id].capitalIn += hf.capitalContributed;
        map[h.company_id].debt += hf.existingDebt;
        map[h.company_id].slices.push({
          partner: p.partner_name,
          propertyName: h.property_name || h.company_name,
          pct: h.ownership_pct * 100,
          color: COLORS[pi % COLORS.length],
          costBasis: hf.costBasis,
          bookValue: hf.bookValue,
          marketValue: hf.marketValue,
          capitalIn: hf.capitalContributed,
        });
      });
    });
    return Object.values(map);
  }, [apiPartners, companyGpr, companyUnits]);

  const byPartner = useMemo(() => {
    return apiPartners.map((p, pi) => {
      const f = financials[p.partner_name];
      return {
        name: p.partner_name,
        color: COLORS[pi % COLORS.length],
        ownershipPct: weightedOwnershipPct(p.holdings, companyGpr),
        capitalIn: f?.capitalContributed ?? 0,
        costBasis: f?.costBasis ?? 0,
        bookValue: f?.bookValue ?? 0,
        marketValue: f?.marketValue ?? 0,
        roi: f?.roi ?? 0,
        holdings: p.holdings.length,
      };
    });
  }, [apiPartners, financials, companyGpr]);

  const byProperty = useMemo(() => {
    const map: Record<string, {
      key: string; propertyName: string; companyName: string; companyId: string; address: string;
      costBasis: number; bookValue: number; marketValue: number; capitalIn: number; debt: number;
      effectiveCapRate: number | null; valuationAssumed: boolean;
      slices: { partner: string; pct: number; color: string }[];
    }> = {};
    apiPartners.forEach((p, pi) => {
      p.holdings.forEach(h => {
        const gpr = companyGpr[h.company_id] ?? 0;
        const hf = holdingFinancials(h, gpr);
        const propName = h.property_name || h.company_name;
        const key = `${h.company_id}::${propName}`;
        if (!map[key]) {
          map[key] = {
            key,
            propertyName: propName,
            companyName: h.company_name,
            companyId: h.company_id,
            address: h.property_address || '—',
            costBasis: 0,
            bookValue: 0,
            marketValue: 0,
            capitalIn: 0,
            debt: 0,
            effectiveCapRate: null,
            valuationAssumed: gpr > 0,
            slices: [],
          };
        }
        map[key].costBasis += hf.costBasis;
        map[key].bookValue += hf.bookValue;
        map[key].marketValue += hf.marketValue;
        map[key].capitalIn += hf.capitalContributed;
        map[key].debt += hf.existingDebt;
        map[key].slices.push({ partner: p.partner_name, pct: h.ownership_pct * 100, color: COLORS[pi % COLORS.length] });
      });
    });
    const rows = Object.values(map);
    const companyMvTotals: Record<string, number> = {};
    rows.forEach(r => {
      companyMvTotals[r.companyId] = (companyMvTotals[r.companyId] ?? 0) + r.marketValue;
    });
    rows.forEach(r => {
      const kpi = companyKpis[r.companyId];
      const propCount = propertiesPerCompany[r.companyId] ?? 1;
      const companyNoi = kpi?.noi ?? 0;
      const allocatedNoi = propCount > 0 ? companyNoi / propCount : companyNoi;
      r.effectiveCapRate = effectiveCapRate(allocatedNoi, r.marketValue);
      r.valuationAssumed = (companyGpr[r.companyId] ?? 0) > 0;
    });
    return rows.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [apiPartners, companyGpr, companyKpis, propertiesPerCompany]);

  const totalRow = useMemo(() => {
    const fs = filtered.map(p => financials[p.partner_name]).filter(Boolean);
    return {
      capitalContributed: fs.reduce((s, f) => s + f.capitalContributed, 0),
      costBasis:          fs.reduce((s, f) => s + f.costBasis, 0),
      bookValue:          fs.reduce((s, f) => s + f.bookValue, 0),
      marketValue:        fs.reduce((s, f) => s + f.marketValue, 0),
      unrealizedGain:     fs.reduce((s, f) => s + f.unrealizedGain, 0),
      returnToDate:       fs.reduce((s, f) => s + f.returnToDate, 0),
    };
  }, [filtered, financials]);

  const selPartnerData = selectedPartner ? apiPartners.find(p => p.partner_name === selectedPartner) : null;
  const selF = selPartnerData ? financials[selPartnerData.partner_name] : null;
  const selNature = selectedPartner ? (natures[selectedPartner] ?? ROLE_MAP[selPartnerData?.holdings[0]?.role ?? ''] ?? 'Limited Partner (LP)') : '';

  // All synthetic contributions merged with local
  const allContribs = useMemo(() => {
    const imported: Contribution[] = [];
    apiPartners.forEach(p => {
      p.holdings.forEach(h => {
        if (h.capital_contributed && h.capital_contributed > 0) {
          imported.push({
            id: `import-${h.ownership_id}`,
            partner: p.partner_name,
            company: h.company_name,
            date: '—',
            amount: h.capital_contributed,
            type: 'Initial Contribution',
            reference: 'Import',
            notes: h.property_name ? `Property: ${h.property_name}` : '',
            cumulative: h.capital_contributed,
          });
        }
      });
    });
    if (imported.length > 0) return [...imported, ...localContribs];
    const synth = apiPartners.flatMap(p => {
      const f = financials[p.partner_name];
      if (!f || f.capitalContributed <= 0) return [];
      return genContributions(p.partner_name, p.holdings.map(h => h.company_name), f.capitalContributed);
    });
    return [...synth, ...localContribs];
  }, [apiPartners, financials, localContribs]);

  const filteredContribs = useMemo(() => {
    let cs = allContribs;
    if (partnerFilter !== 'all') cs = cs.filter(c => c.partner === partnerFilter);
    if (companyFilter !== 'all') {
      const coName = allCompanies.find(c => c.id === companyFilter)?.name ?? '';
      cs = cs.filter(c => c.company === coName);
    }
    return cs;
  }, [allContribs, partnerFilter, companyFilter, allCompanies]);

  const partnerMetricsByName = useMemo(() => {
    const m: Record<string, PartnerReturnMetrics> = {};
    apiPartners.forEach(p => {
      const f = financials[p.partner_name];
      const contribs = allContribs
        .filter(c => c.partner === p.partner_name)
        .map(c => ({ date: c.date, amount: c.amount, type: c.type }));
      m[p.partner_name] = partnerReturnMetrics(
        contribs,
        f?.capitalContributed ?? 0,
        f?.marketValue ?? 0,
      );
    });
    return m;
  }, [apiPartners, financials, allContribs]);

  const portfolioReturnMetrics = useMemo(() => {
    const rows = filtered.map(p => {
      const f = financials[p.partner_name];
      const contribs = allContribs.filter(c => c.partner === p.partner_name);
      const distributions = contribs
        .filter(c => c.amount < 0 || /distribution|return of capital/i.test(c.type))
        .reduce((s, c) => s + Math.abs(c.amount), 0);
      return {
        capital: f?.capitalContributed ?? 0,
        distributions,
        marketValue: f?.marketValue ?? 0,
        metrics: partnerMetricsByName[p.partner_name],
        weight: f?.capitalContributed ?? 0,
      };
    });
    const em = portfolioEquityMultiple(rows);
    const irr = portfolioIrr(rows.map(r => ({ metrics: r.metrics, weight: r.weight })));
    return {
      equityMultiple: em,
      equityMultipleLabel: em !== null ? `${em.toFixed(2)}x` : '—',
      irrLabel: irr.label,
    };
  }, [filtered, financials, allContribs, partnerMetricsByName]);

  const propertyCapStats = useMemo(() => {
    let assumed = 0;
    let realMv = 0;
    byProperty.forEach(prop => {
      if (prop.valuationAssumed) assumed += 1;
      else realMv += 1;
    });
    return { assumed, realMv, total: byProperty.length };
  }, [byProperty]);

  const scatterPoints = useMemo(() => {
    if (scatterMode === 'partner') {
      return filtered.map(p => {
        const f = financials[p.partner_name];
        const metrics = partnerMetricsByName[p.partner_name];
        const companyIds = [...new Set(p.holdings.map(h => h.company_id))];
        const kpis = companyIds.map(id => companyKpis[id]).filter((k): k is KpiData => k != null);
        const solvency = kpis.length ? solvencyMetricsFromKpi(aggregateKpiDataList(kpis)) : { ltvPct: null, dscr: null };
        const risk = solvency.ltvPct ?? (solvency.dscr != null ? solvency.dscr * 100 : null);
        return {
          name: p.partner_name,
          irr: metrics?.irr ?? null,
          risk,
          size: Math.max(f?.marketValue ?? 0, 1),
        };
      }).filter(pt => pt.irr != null && pt.risk != null);
    }
    return byProperty.map(prop => {
      const kpi = companyKpis[prop.companyId];
      const solvency = kpi ? solvencyMetricsFromKpi(kpi) : { ltvPct: null, dscr: null };
      const risk = solvency.ltvPct ?? (solvency.dscr != null ? solvency.dscr * 100 : null);
      return {
        name: prop.propertyName,
        irr: prop.effectiveCapRate,
        risk,
        size: Math.max(prop.marketValue, 1),
      };
    }).filter(pt => pt.irr != null && pt.risk != null);
  }, [scatterMode, filtered, financials, partnerMetricsByName, companyKpis, byProperty]);

  function savePartner() {
    if (!partnerForm.name.trim()) return;
    setShowAddPartner(false);
    setPartnerForm(BLANK_PARTNER);
  }

  function saveContrib() {
    if (!contribForm.partner || !contribForm.amount) return;
    const existing = allContribs.filter(c => c.partner === contribForm.partner);
    const cum = existing.reduce((s, c) => s + c.amount, 0) + parseFloat(contribForm.amount || '0');
    setLocalContribs(prev => [...prev, {
      id: `local-${Date.now()}`,
      partner: contribForm.partner,
      company: contribForm.company,
      date: contribForm.date,
      amount: parseFloat(contribForm.amount || '0'),
      type: contribForm.type,
      reference: contribForm.reference,
      notes: contribForm.notes,
      cumulative: Math.round(cum),
    }]);
    setShowAddContrib(false);
    setContribForm({ ...BLANK_CONTRIB });
  }

  async function downloadImportTemplate() {
    try {
      const response = await api.get('/api/rentals/ownership/import-template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data as BlobPart]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Ownership_Import_Template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setImportMessage({ type: 'error', text: 'Failed to download import template.' });
    }
  }

  async function handleImportPartners(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const formData = new FormData();
    formData.append('file', file);

    setImporting(true);
    setImportMessage(null);
    try {
      const response = await api.post('/api/rentals/ownership/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const data = response.data as {
        imported_count?: number;
        skipped_non_rental?: number;
        errors?: string[];
        message?: string;
      };
      const count = data.imported_count ?? 0;
      const skipped = data.skipped_non_rental ?? 0;
      const warnings = (data.errors ?? []).filter(Boolean);
      if (count === 0) {
        setImportMessage({
          type: 'error',
          text: warnings.join('; ') || 'No rental ownership rows imported. Use Entity = Rental and match Entity Name to Company Registry.',
        });
      } else {
        const skipText = skipped > 0 ? ` Skipped ${skipped} non-rental row(s).` : '';
        const warnText = warnings.length ? ` (${warnings.length} row warning(s): ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''})` : '';
        setImportMessage({ type: 'success', text: `Imported ${count} rental ownership position(s).${skipText}${warnText}` });
        loadData();
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setImportMessage({
        type: 'error',
        text: typeof detail === 'string' ? detail : 'Import failed. Use the template and ensure Entity Name matches Company Registry.',
      });
    } finally {
      setImporting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (loading) return <LoadingSkeleton rows={8} />;
  if (error)   return <div className="text-red-700 p-4">{error}<button className="ml-3 underline" onClick={loadData}>Retry</button></div>;

  const avgROI = kpis.avgROI;
  const portfolioMarketValue = kpis.totalMV;

  return (
    <div className="space-y-6 -m-6 p-6" style={{ background: 'transparent' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Ownership</h1>
          <p className="text-sm text-gray-500 mt-0.5">Partner registry · Capital tracking · Equity analytics · Rental entity rows only</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Company filter */}
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-gray-500 text-xs">Company:</span>
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-600">
              <option value="all">All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          {/* Partner filter */}
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-gray-500 text-xs">Partner:</span>
            <select value={partnerFilter} onChange={e => { setPartnerFilter(e.target.value); setSelectedPartner(e.target.value === 'all' ? null : e.target.value); }}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-600">
              <option value="all">All Partners</option>
              {apiPartners.map(p => <option key={p.partner_name} value={p.partner_name}>{p.partner_name}</option>)}
            </select>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50">
            <Download size={13} /> Export PDF
          </button>
          <button onClick={downloadImportTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50">
            <Download size={13} /> Download Template
          </button>
          <button onClick={() => importFileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            disabled={importing}>
            <Download size={13} /> {importing ? 'Importing…' : 'Import Partners'}
          </button>
          <input ref={importFileRef} type="file" accept=".xlsx" onChange={handleImportPartners} style={{ display: 'none' }} />
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700">
            <Zap size={13} /> AI Insights
          </button>
          <button onClick={() => setShowAddPartner(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-800 text-white rounded-lg text-xs hover:bg-green-900">
            <Plus size={13} /> Add Partner
          </button>
        </div>
      </div>

      {importMessage && (
        <div className={`rounded-lg px-4 py-3 text-sm ${importMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {importMessage.text}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1 — PORTFOLIO OWNERSHIP KPIs
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Partners',      value: kpis.totalPartners.toString(),  icon: <Users size={18} />,       color: 'text-gray-900',   sub: 'active partners' },
          { label: 'Total Capital Raised', value: fmtK(kpis.totalCapital),       icon: <DollarSign size={18} />,  color: 'text-blue-700',   sub: 'contributed' },
          { label: 'Portfolio Market Value', value: fmtK(kpis.totalMV),         icon: <Building2 size={18} />,   color: 'text-green-800',  sub: hasImportedFinancials ? 'imported + cap rate where available' : 'at 5.5% cap rate' },
          { label: 'Total Equity',          value: fmtK(kpis.totalEquity),       icon: <TrendingUp size={18} />,  color: 'text-amber-700',  sub: kpis.totalDebt > 0 && kpis.totalDebt !== kpis.totalMV * 0.6 ? 'market value − imported debt' : 'market value − debt (60% LTV)' },
          { label: 'Avg Partner ROI',       value: `${avgROI.toFixed(1)}%`,      icon: <TrendingUp size={18} />,  color: avgROI >= 20 ? 'text-green-800' : 'text-amber-700', sub: 'weighted by cost basis' },
        ].map(({ label, value, icon, color, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
              <span className="text-gray-300">{icon}</span>
            </div>
            <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Secondary solvency KPIs — same source as Financial Ratios */}
      <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
        {[
          {
            label: 'Portfolio LTV',
            value: portfolioSolvency.hasFinancials
              ? formatSolvencyLtv(portfolioSolvency.ltvPct)
              : 'No bldg value',
            sub: portfolioSolvency.hasFinancials
              ? 'Mortgage ÷ property value (P&L balance sheet)'
              : 'Upload company financials for LTV',
            color: 'text-blue-800',
          },
          {
            label: 'Portfolio DSCR (Est.)',
            value: portfolioSolvency.hasFinancials
              ? formatSolvencyDscr(portfolioSolvency.dscr)
              : '—',
            sub: portfolioSolvency.hasFinancials
              ? 'NOI ÷ (interest × 1.2) — matches Financial Ratios'
              : 'Upload company financials for DSCR',
            color: 'text-emerald-800',
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">{label}</p>
            <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2 — PARTNER REGISTRY TABLE
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Partner Registry</h3>
            <p className="text-xs text-gray-400 mt-0.5">{filtered.length} partner{filtered.length !== 1 ? 's' : ''} · {hasImportedFinancials ? 'financials from import where provided' : 'all financial values derived at 5.5% cap rate'}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {['Partner','Nature','Wtd Own %','Capital In','Cost Basis','Book Value','Market Value','Unrealized G/L','Return to Date','ROI','IRR','Eq. Mult.','Status',''].map(h => (
                  <th key={h} className="px-3 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p, pi) => {
                const f = financials[p.partner_name];
                if (!f) return null;
                const nature = natures[p.partner_name] ?? ROLE_MAP[p.holdings[0]?.role ?? ''] ?? 'Limited Partner (LP)';
                const totalPct = weightedOwnershipPct(p.holdings, companyGpr);
                const pMetrics = partnerMetricsByName[p.partner_name];
                const isSelected = selectedPartner === p.partner_name;
                return (
                  <tr key={p.partner_name}
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-green-50 ring-1 ring-inset ring-green-200' : ''}`}
                    onClick={() => setSelectedPartner(prev => prev === p.partner_name ? null : p.partner_name)}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: COLORS[pi % COLORS.length] }}>
                          {p.partner_name[0]}
                        </span>
                        <span className="font-medium text-gray-900 whitespace-nowrap">{p.partner_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={nature}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setNatures(prev => ({ ...prev, [p.partner_name]: e.target.value }))}
                        className="text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-green-600 rounded"
                      >
                        {NATURE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className="font-mono text-xs font-semibold">{totalPct.toFixed(1)}%</span>
                        <div className="w-16 bg-gray-200 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-green-700" style={{ width: `${totalPct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{fmtK(f.capitalContributed)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{fmtK(f.costBasis)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{fmtK(f.bookValue)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs font-semibold text-green-800">{fmtK(f.marketValue)}</td>
                    <td className="px-3 py-3 text-right"><GainCell value={f.unrealizedGain} /></td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-blue-700">{fmtK(f.returnToDate)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={`font-semibold text-xs ${f.roi >= 20 ? 'text-green-800' : f.roi >= 10 ? 'text-amber-600' : 'text-red-700'}`}>
                        {f.roi.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-xs font-mono text-gray-700" title={pMetrics?.irrLabel}>
                      {pMetrics?.irrLabel ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-right text-xs font-mono font-semibold text-gray-800">
                      {pMetrics?.equityMultipleLabel ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">Active</span>
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={e => { e.stopPropagation(); setSelectedPartner(p.partner_name); }}
                        className="text-xs text-blue-600 hover:underline">Detail</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white text-xs font-semibold">
                <td className="px-3 py-3" colSpan={3}>Portfolio Total</td>
                <td className="px-3 py-3 text-right font-mono">{fmtK(totalRow.capitalContributed)}</td>
                <td className="px-3 py-3 text-right font-mono">{fmtK(totalRow.costBasis)}</td>
                <td className="px-3 py-3 text-right font-mono">{fmtK(totalRow.bookValue)}</td>
                <td className="px-3 py-3 text-right font-mono text-green-300">{fmtK(totalRow.marketValue)}</td>
                <td className="px-3 py-3 text-right font-mono">
                  <span className={totalRow.unrealizedGain >= 0 ? 'text-green-300' : 'text-red-300'}>
                    {totalRow.unrealizedGain >= 0 ? '+' : '-'}{fmtK(Math.abs(totalRow.unrealizedGain))}
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-blue-300">{fmtK(totalRow.returnToDate)}</td>
                <td className="px-3 py-3 text-right font-mono">{avgROI.toFixed(1)}%</td>
                <td className="px-3 py-3 text-right font-mono text-xs">{portfolioReturnMetrics.irrLabel}</td>
                <td className="px-3 py-3 text-right font-mono">{portfolioReturnMetrics.equityMultipleLabel}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 4 — PARTNER DETAIL VIEW (when one selected)
      ═══════════════════════════════════════════════════════════════════════ */}
      {selectedPartner && selPartnerData && selF && (
        <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-100" style={{ background: '#1E3A8A' }}>
            <h3 className="font-semibold text-white">{selectedPartner} — Ownership Profile</h3>
            <button onClick={() => setSelectedPartner(null)} className="text-green-300 hover:text-white"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-5">
            {/* Profile card */}
            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
              <div className="flex flex-wrap items-start gap-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white" style={{ background: COLORS[apiPartners.findIndex(p => p.partner_name === selectedPartner) % COLORS.length] }}>
                    {selectedPartner[0]}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 text-lg">{selectedPartner}</p>
                    <NatureBadge nature={selNature} />
                    <span className="ml-2 text-xs text-green-800">● Active</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 flex-1 min-w-0">
                  {[['Capital In', fmtUSD(selF.capitalContributed)],['Book Value', fmtUSD(selF.bookValue)],['Market Value', fmtUSD(selF.marketValue)]].map(([l,v]) => (
                    <div key={l} className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-xs text-gray-500">{l}</p>
                      <p className="font-bold font-mono text-gray-900">{v}</p>
                    </div>
                  ))}
                </div>
                <div className="text-sm space-y-1 border-l border-gray-200 pl-6">
                  <p><span className="text-gray-500">Unrealized Gain: </span>
                    <span className={`font-semibold ${selF.unrealizedGain >= 0 ? 'text-green-800' : 'text-red-700'}`}>
                      {selF.unrealizedGain >= 0 ? '+' : '-'}{fmt(selF.unrealizedGain)} ({((selF.unrealizedGain / selF.costBasis) * 100).toFixed(1)}%)
                    </span>
                  </p>
                  <p><span className="text-gray-500">Return to Date: </span><span className="font-semibold text-blue-700">{fmtUSD(selF.returnToDate)}</span></p>
                  <p><span className="text-gray-500">Total ROI: </span><span className="font-semibold text-green-800">{selF.roi.toFixed(1)}%</span></p>
                </div>
              </div>
            </div>

            {/* Holdings + trend chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Holdings table */}
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Holdings by Company</p>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      {['Company','% Own','Units','Cost Basis','Book Value','Market Value','Unrealized Gain','Income Share','Status'].map(h => (
                        <th key={h} className="px-2 py-2 text-right first:text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selPartnerData.holdings.map(h => {
                      const gpr = companyGpr[h.company_id] ?? 0;
                      const hf = holdingFinancials(h, gpr);
                      const units = companyUnits[h.company_id] ?? 0;
                      const partnerUnits = Math.round(units * h.ownership_pct);
                      return (
                        <tr key={h.company_id} className="hover:bg-gray-50">
                          <td className="px-2 py-2 font-medium truncate max-w-[120px]">{h.company_name}</td>
                          <td className="px-2 py-2 text-right">{(h.ownership_pct * 100).toFixed(1)}%</td>
                          <td className="px-2 py-2 text-right">{partnerUnits}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtK(hf.costBasis)}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtK(hf.bookValue)}</td>
                          <td className="px-2 py-2 text-right font-mono text-green-800">{fmtK(hf.marketValue)}</td>
                          <td className="px-2 py-2 text-right"><GainCell value={hf.unrealizedGain} /></td>
                          <td className="px-2 py-2 text-right font-mono text-blue-700">{fmtK(h.noi_share)}</td>
                          <td className="px-2 py-2 text-right">
                            <span className="px-1.5 py-0.5 rounded-full text-xs bg-green-100 text-green-800">Active</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Book vs Market trend */}
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Book Value vs Market Value — 12 Months</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={genTrend(selF.costBasis, selF.marketValue)}>
                    <XAxis dataKey="month" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="bookValue"    stroke="#6B7280" strokeWidth={2} dot={false} name="Book Value" />
                    <Line type="monotone" dataKey="marketValue"  stroke="#16A34A" strokeWidth={2} dot={false} name="Market Value" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Capital history */}
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Capital History</p>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    {['Date','Transaction','Amount','Cumulative','Notes'].map(h => (
                      <th key={h} className="px-2 py-2 text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allContribs
                    .filter(c => c.partner === selectedPartner)
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map(c => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-2 py-2 text-gray-600">{c.date}</td>
                        <td className="px-2 py-2">{c.type}</td>
                        <td className={`px-2 py-2 text-right font-mono font-semibold ${c.amount >= 0 ? 'text-green-800' : 'text-red-700'}`}>
                          {c.amount >= 0 ? '+' : ''}{fmtUSD(c.amount)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{fmtUSD(c.cumulative)}</td>
                        <td className="px-2 py-2 text-gray-500">{c.notes || c.reference || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3 — OWNERSHIP BREAKDOWN (Company / Partner / Property)
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-800">Ownership Breakdown</h3>
            <p className="text-xs text-gray-400 mt-0.5">Group by company, partner, or property · Book value rolls up company-wise</p>
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {(['company', 'partner', 'property'] as const).map(tab => (
              <button key={tab}
                onClick={() => setBreakdownTab(tab)}
                className={`px-3 py-1.5 capitalize ${breakdownTab === tab ? 'bg-green-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                By {tab === 'company' ? 'Company' : tab === 'partner' ? 'Partner' : 'Property'}
              </button>
            ))}
          </div>
        </div>

        {breakdownTab === 'company' && (
          <div className="divide-y divide-gray-100">
            {byCompany.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No ownership data — import partners or add manually</p>}
            {byCompany.map(co => {
              const isExp = expandedCos.has(co.id);
              const companyPieData = partnerEquityShareInCompany(co.slices);
              return (
                <div key={co.id}>
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                    onClick={() => setExpandedCos(prev => { const next = new Set(prev); if (next.has(co.id)) next.delete(co.id); else next.add(co.id); return next; })}
                  >
                    <div className="flex items-center gap-3">
                      {isExp ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                      <Building2 size={14} className="text-gray-400" />
                      <span className="font-medium text-gray-900">{co.name}</span>
                      <span className="text-xs text-gray-400">
                        · {co.units} unit{co.units !== 1 ? 's' : ''} · {co.slices.length} partner{co.slices.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
                      <span>Book Value: <strong>{fmtK(co.bookValue)}</strong></span>
                      <span>Cost Basis: <strong>{fmtK(co.costBasis)}</strong></span>
                      <span>Market Value: <strong className="text-green-800">{fmtK(co.marketValue)}</strong></span>
                    </div>
                  </button>
                  {isExp && (
                    <div className="px-4 pb-4 bg-gray-50 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <table className="w-full text-xs mt-3">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="pb-1.5 text-left">Partner</th>
                            <th className="pb-1.5 text-left">Property</th>
                            <th className="pb-1.5 text-right">% Share</th>
                            <th className="pb-1.5 text-right">Capital In</th>
                            <th className="pb-1.5 text-right">Book Value</th>
                            <th className="pb-1.5 text-right">Market Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {co.slices.map((s, si) => (
                            <tr key={`${s.partner}-${s.propertyName}-${si}`} className="hover:bg-white cursor-pointer" onClick={() => setSelectedPartner(s.partner)}>
                              <td className="py-1.5 pr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-3 h-3 rounded-full inline-block" style={{ background: s.color }} />
                                  {s.partner}
                                </div>
                              </td>
                              <td className="py-1.5 pr-2 text-gray-600">{s.propertyName}</td>
                              <td className="py-1.5 text-right">{s.pct.toFixed(1)}%</td>
                              <td className="py-1.5 text-right font-mono">{fmtK(s.capitalIn)}</td>
                              <td className="py-1.5 text-right font-mono">{fmtK(s.bookValue)}</td>
                              <td className="py-1.5 text-right font-mono text-green-800">{fmtK(s.marketValue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex items-center justify-center">
                        <ResponsiveContainer width="100%" height={160}>
                          <PieChart>
                            <Pie
                              data={companyPieData}
                              dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={2}
                            >
                              {companyPieData.map((s, si) => (
                                <Cell key={si} fill={s.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Equity Share']} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {breakdownTab === 'partner' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  {['Partner','Wtd Own %','Capital In','Cost Basis','Book Value','Market Value','ROI','Holdings'].map(h => (
                    <th key={h} className="px-3 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byPartner.map(p => (
                  <tr key={p.name} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedPartner(p.name)}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                        <span className="font-medium">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{p.ownershipPct.toFixed(1)}%</td>
                    <td className="px-3 py-3 text-right font-mono">{fmtK(p.capitalIn)}</td>
                    <td className="px-3 py-3 text-right font-mono">{fmtK(p.costBasis)}</td>
                    <td className="px-3 py-3 text-right font-mono">{fmtK(p.bookValue)}</td>
                    <td className="px-3 py-3 text-right font-mono text-green-800">{fmtK(p.marketValue)}</td>
                    <td className="px-3 py-3 text-right font-semibold">{p.roi.toFixed(1)}%</td>
                    <td className="px-3 py-3 text-right text-gray-500">{p.holdings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byPartner.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No partners</p>}
          </div>
        )}

        {breakdownTab === 'property' && (
          <div className="divide-y divide-gray-100">
            {byProperty.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No property-level ownership</p>}
            {byProperty.map(prop => (
              <div key={prop.key} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div>
                    <p className="font-medium text-gray-900">{prop.propertyName}</p>
                    <p className="text-xs text-gray-400">{prop.companyName} · {prop.address}</p>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                    <span>Cost Basis: <strong>{fmtK(prop.costBasis)}</strong></span>
                    <span>Book Value: <strong>{fmtK(prop.bookValue)}</strong></span>
                    <span>Market Value: <strong className="text-green-800">{fmtK(prop.marketValue)}</strong></span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {prop.slices.map(s => (
                    <span key={s.partner} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-xs">
                      <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                      {s.partner}: {s.pct.toFixed(1)}%
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 5 — CAPITAL CONTRIBUTIONS TRACKER
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Capital Contributions</h3>
            <p className="text-xs text-gray-400 mt-0.5">All transactions · contributions, distributions and capital calls</p>
          </div>
          <button onClick={() => setShowAddContrib(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-800 text-white rounded-lg text-xs hover:bg-green-900">
            <Plus size={13} /> Add Transaction
          </button>
        </div>

        {/* Per-partner summary strip */}
        <div className="px-4 py-3 border-b border-gray-100 overflow-x-auto">
          <div className="flex gap-4 min-w-max">
            {apiPartners.map(p => {
              const cs = allContribs.filter(c => c.partner === p.partner_name);
              const totalIn  = cs.filter(c => c.amount > 0).reduce((s, c) => s + c.amount, 0);
              const totalOut = cs.filter(c => c.amount < 0).reduce((s, c) => s + Math.abs(c.amount), 0);
              return (
                <div key={p.partner_name} className="bg-gray-50 rounded-lg px-3 py-2 text-xs border border-gray-200 min-w-[160px]">
                  <p className="font-semibold text-gray-800 truncate">{p.partner_name}</p>
                  <div className="flex gap-3 mt-1">
                    <span className="text-green-800">In: {fmtK(totalIn)}</span>
                    <span className="text-red-700">Out: {fmtK(totalOut)}</span>
                  </div>
                  <p className="text-gray-500 mt-0.5">Net: <strong className="text-gray-800">{fmtK(totalIn - totalOut)}</strong></p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {['Partner','Company','Date','Amount','Type','Reference','Notes','Cumulative'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right first:text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredContribs.map(c => (
                <tr key={c.id} className={`hover:bg-gray-50 ${c.amount < 0 ? 'bg-red-50/30' : ''}`}>
                  <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{c.partner}</td>
                  <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{c.company}</td>
                  <td className="px-3 py-2.5 text-right text-gray-600 text-xs">{c.date}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    <span className={c.amount >= 0 ? 'text-green-800 font-semibold' : 'text-red-700 font-semibold'}>
                      {c.amount >= 0 ? '+' : ''}{fmtUSD(c.amount)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${c.amount < 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-800'}`}>
                      {c.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-gray-400 font-mono">{c.reference}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-gray-500">{c.notes || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-700">{fmtUSD(c.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredContribs.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No transactions</p>}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 6 — OWNERSHIP ANALYTICS
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Ownership Analytics</h3>
          <p className="text-xs text-gray-400 mt-0.5">Portfolio-wide equity, return and gain/loss comparison</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-gray-100">
          {/* Chart 1: Ownership Distribution Donut */}
          <div className="bg-white p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Ownership Distribution</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={apiPartners.map((p, i) => ({
                    name: p.partner_name,
                    value: portfolioMarketValue > 0
                      ? parseFloat((((financials[p.partner_name]?.marketValue ?? 0) / portfolioMarketValue) * 100).toFixed(1))
                      : 0,
                  }))}
                  dataKey="value" cx="45%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}
                >
                  {apiPartners.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Portfolio Equity']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 2: Capital vs Market Value */}
          <div className="bg-white p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Capital vs Market Value per Partner</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={apiPartners.map(p => {
                const f = financials[p.partner_name];
                return { name: p.partner_name.split(' ')[0], costBasis: Math.round((f?.costBasis ?? 0) / 1000), marketValue: Math.round((f?.marketValue ?? 0) / 1000) };
              })} barCategoryGap="30%" barGap={2}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}K`} />
                <Tooltip formatter={(v: number) => [`$${v}K`, '']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="costBasis"    name="Cost Basis"    fill="#2563EB" radius={[3,3,0,0]} maxBarSize={22} />
                <Bar dataKey="marketValue"  name="Market Value"  fill="#16A34A" radius={[3,3,0,0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 3: ROI Comparison (horizontal bar) */}
          <div className="bg-white p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">ROI Comparison — Sorted Highest First</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                layout="vertical"
                data={[...apiPartners].sort((a, b) => (financials[b.partner_name]?.roi ?? 0) - (financials[a.partner_name]?.roi ?? 0)).map(p => ({
                  name: p.partner_name.split(' ')[0],
                  roi: parseFloat((financials[p.partner_name]?.roi ?? 0).toFixed(1)),
                }))}
                barSize={16} margin={{ left: 4, right: 40 }}
              >
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v: number) => [`${v}%`, 'ROI']} />
                <ReferenceLine x={avgROI} stroke="#D97706" strokeDasharray="4 2" label={{ value: `Avg ${avgROI.toFixed(1)}%`, fontSize: 9, fill: '#D97706', position: 'insideTopRight' }} />
                <Bar dataKey="roi" fill="#1E3A8A" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 4: Unrealized Gain/Loss */}
          <div className="bg-white p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Unrealized Gain / Loss per Partner</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={apiPartners.map((p, i) => {
                const f = financials[p.partner_name];
                return { name: p.partner_name.split(' ')[0], gain: Math.round((f?.unrealizedGain ?? 0) / 1000), color: (f?.unrealizedGain ?? 0) >= 0 ? '#16A34A' : '#DC2626' };
              })} barSize={28}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}K`} />
                <Tooltip formatter={(v: number) => [`$${v}K`, 'Unrealized G/L']} />
                <ReferenceLine y={0} stroke="#9CA3AF" />
                <Bar dataKey="gain" name="Unrealized G/L" radius={[3,3,0,0]}>
                  {apiPartners.map((p, i) => (
                    <Cell key={i} fill={(financials[p.partner_name]?.unrealizedGain ?? 0) >= 0 ? '#16A34A' : '#DC2626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 5: IRR vs Risk scatter */}
          <div className="bg-white p-4 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {scatterMode === 'partner' ? 'IRR vs LTV — by Partner' : 'Effective Cap Rate vs LTV — by Property'}
              </p>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                {(['partner', 'property'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setScatterMode(mode)}
                    className={`px-2.5 py-1 capitalize ${scatterMode === mode ? 'bg-amber-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    By {mode}
                  </button>
                ))}
              </div>
            </div>
            {scatterPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <XAxis type="number" dataKey="risk" name="LTV %" tick={{ fontSize: 10 }} unit="%" />
                  <YAxis
                    type="number"
                    dataKey="irr"
                    name={scatterMode === 'partner' ? 'IRR %' : 'Cap Rate %'}
                    tick={{ fontSize: 10 }}
                    unit="%"
                  />
                  <ZAxis type="number" dataKey="size" range={[60, 400]} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    formatter={(v: number, name: string) => [
                      scatterMode === 'partner' && name === 'IRR %' ? `${v.toFixed(1)}%`
                        : scatterMode === 'property' && name === 'Cap Rate %' ? `${v.toFixed(2)}%`
                          : name === 'LTV %' ? `${v.toFixed(1)}%`
                            : fmtK(v),
                      name,
                    ]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.name ?? ''}
                  />
                  <Scatter data={scatterPoints} fill="#B8860B" fillOpacity={0.75} />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-400 text-center py-16">
                {scatterMode === 'partner'
                  ? 'IRR scatter requires dated contribution/distribution cash flows and uploaded financials for LTV.'
                  : 'Property scatter requires P&L NOI and balance-sheet LTV per company.'}
              </p>
            )}
            <p className="text-[10px] text-gray-400 mt-2">Bubble size = market value · Risk proxy = portfolio LTV % (Financial Ratios formula)</p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 7 — COST BASIS BY PROPERTY NAME
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Cost Basis by Property Name</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Property rollup · Effective cap rate uses P&L NOI ÷ market value
            {propertyCapStats.total > 0 && (
              <> · {propertyCapStats.assumed} assumed @ {(CAP_RATE * 100).toFixed(1)}% cap, {propertyCapStats.realMv} with book/cost-based value</>
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {['Property Name','Company','Address','Cost Basis','Book Value','Market Value','Eff. Cap Rate','Valuation','Debt','Partners'].map(h => (
                  <th key={h} className="px-3 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byProperty.map(prop => (
                <tr key={prop.key} className="hover:bg-gray-50">
                  <td className="px-3 py-3 font-medium text-gray-900">{prop.propertyName}</td>
                  <td className="px-3 py-3 text-gray-600 text-xs">{prop.companyName}</td>
                  <td className="px-3 py-3 text-gray-500 text-xs max-w-[200px] truncate">{prop.address}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{fmtK(prop.costBasis)}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtK(prop.bookValue)}</td>
                  <td className="px-3 py-3 text-right font-mono text-green-800">{fmtK(prop.marketValue)}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">
                    {prop.effectiveCapRate != null ? `${prop.effectiveCapRate.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-xs">
                    {prop.valuationAssumed ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title={`Market value derived at ${(CAP_RATE * 100).toFixed(1)}% cap from GPR`}>
                        Assumed {(CAP_RATE * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-800">Imported / book</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{fmtK(prop.debt)}</td>
                  <td className="px-3 py-3 text-right text-xs text-gray-500">{prop.slices.map(s => s.partner).join(', ')}</td>
                </tr>
              ))}
            </tbody>
            {byProperty.length > 0 && (
              <tfoot>
                <tr className="bg-gray-900 text-white text-xs font-semibold">
                  <td className="px-3 py-3" colSpan={3}>Portfolio Total</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtK(byProperty.reduce((s, p) => s + p.costBasis, 0))}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtK(byProperty.reduce((s, p) => s + p.bookValue, 0))}</td>
                  <td className="px-3 py-3 text-right font-mono text-green-300">{fmtK(byProperty.reduce((s, p) => s + p.marketValue, 0))}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">—</td>
                  <td />
                  <td className="px-3 py-3 text-right font-mono">{fmtK(byProperty.reduce((s, p) => s + p.debt, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          {byProperty.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No property data — import ownership Excel with Property Name column</p>}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          MODAL — Add Partner
      ══════════════════════════════════════════════════════════════════════════ */}
      {showAddPartner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddPartner(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ background: '#1E3A8A' }}>
              <h3 className="font-bold text-white">Add Partner</h3>
              <button onClick={() => setShowAddPartner(false)} className="text-green-300 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {([
                ['Partner Name', 'text', 'name'],
                ['Capital Contributed ($)', 'number', 'capital'],
                ['Cost Basis ($)', 'number', 'costBasis'],
                ['Ownership %', 'number', 'ownershipPct'],
                ['Acquisition Date', 'date', 'acquisitionDate'],
                ['Contact Email', 'email', 'email'],
                ['Contact Phone', 'tel', 'phone'],
              ] as [string, string, keyof AddPartnerForm][]).map(([label, type, key]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
                  <input type={type} value={partnerForm[key] as string}
                    onChange={e => setPartnerForm(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nature of Ownership</label>
                <select value={partnerForm.nature} onChange={e => setPartnerForm(prev => ({ ...prev, nature: e.target.value as Nature }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600">
                  {NATURE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={partnerForm.notes} rows={3}
                  onChange={e => setPartnerForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t bg-gray-50">
              <button onClick={() => setShowAddPartner(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100">Cancel</button>
              <button onClick={savePartner} className="px-4 py-2 text-sm bg-green-800 text-white rounded-lg hover:bg-green-900">Save Partner</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          MODAL — Add Contribution
      ══════════════════════════════════════════════════════════════════════════ */}
      {showAddContrib && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddContrib(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ background: '#1E3A8A' }}>
              <h3 className="font-bold text-white">Add Transaction</h3>
              <button onClick={() => setShowAddContrib(false)} className="text-green-300 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Partner</label>
                <select value={contribForm.partner} onChange={e => setContribForm(prev => ({ ...prev, partner: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600">
                  <option value="">— Select Partner —</option>
                  {apiPartners.map(p => <option key={p.partner_name} value={p.partner_name}>{p.partner_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Company</label>
                <select value={contribForm.company} onChange={e => setContribForm(prev => ({ ...prev, company: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600">
                  <option value="">— Select Company —</option>
                  {allCompanies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={contribForm.date} onChange={e => setContribForm(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Amount ($)</label>
                  <input type="number" value={contribForm.amount} onChange={e => setContribForm(prev => ({ ...prev, amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <select value={contribForm.type} onChange={e => setContribForm(prev => ({ ...prev, type: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600">
                  {CONTRIB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reference</label>
                <input type="text" value={contribForm.reference} onChange={e => setContribForm(prev => ({ ...prev, reference: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={contribForm.notes} rows={2}
                  onChange={e => setContribForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t bg-gray-50">
              <button onClick={() => setShowAddContrib(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100">Cancel</button>
              <button onClick={saveContrib} className="px-4 py-2 text-sm bg-green-800 text-white rounded-lg hover:bg-green-900">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
