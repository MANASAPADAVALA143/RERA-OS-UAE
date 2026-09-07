import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import api, { formatApiError, postUploadWithWake } from '../../services/api';
import { fmtUSD } from '../../components/ProtectedRoute';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, ReferenceLine,
} from 'recharts';
import {
  ChevronDown, ChevronRight, Plus, Download, Zap,
  Building2, X,
} from 'lucide-react';
import {
  effectiveCapRate,
  partnerReturnMetrics,
  portfolioEquityMultiple,
  portfolioIrr,
  type PartnerReturnMetrics,
} from '../../utils/ownershipMetrics';
import { ParchmentKpiTile } from '../../components/ui/ParchmentKpiTile';
import { PT, PT_FONT, PT_CARD } from '../../utils/parchmentTypography';
import { usePropDev, type CompanyData } from '../../contexts/PropertyDevContext';
import { notifyPropDevCompaniesRefresh } from '../../utils/propDevSync';
import { exportPropDevOwnershipPdf } from '../../utils/propDevSectionPdfExport';
import { PROPDEV_EXPORT_PDF_EVENT } from '../../utils/propDevExportEvents';

const CHART_TICK = PT_FONT.chartTick;
const CHART_TOOLTIP = PT_FONT.tooltip;
const CHART_LEGEND = { wrapperStyle: PT_FONT.legend };

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
/** Optional fields (Book / FV) — show dash when not imported. */
const fmtKOrDash = (n: number, present = n > 0) => (present ? fmtK(n) : '—');

// ── Types ──────────────────────────────────────────────────────────────────────
interface Holding {
  ownership_id: string;
  company_id:   string;
  company_name: string;
  property_id?: string | null;
  property_name?: string;
  property_address?: string | null;
  entity_structure?: string | null;
  entity_line?: string | null;
  ownership_pct: number;
  role:          string;
  cost_basis?: number | null;
  book_value?: number | null;
  fair_market_value?: number | null;
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

/**
 * Sale consideration (or cost stack) as property MV, encoded as a monthly "GPR"
 * so companyMarketValue(pseudoGpr) === propertyValue — same calc path as Rentals.
 */
function companyValueAsPseudoGpr(co: CompanyData): number {
  const prop = co.property;
  const exitValue = prop.saleConsideration ?? 0;
  const costStack = (prop.landCost ?? 0) + (prop.hardCost ?? 0) + (prop.softCost ?? 0)
    + (prop.interestCapitalised ?? 0) + (prop.improvements ?? 0);
  const propertyValue = exitValue > 0 ? exitValue : costStack;
  return propertyValue > 0 ? (propertyValue * CAP_RATE) / 12 : 0;
}

function mapPropDevToPartnerGroups(companies: CompanyData[]): PartnerGroup[] {
  const byName = new Map<string, PartnerGroup>();
  for (const co of companies) {
    for (const p of co.partners) {
      const pct = p.sharePercent > 1 ? p.sharePercent / 100 : p.sharePercent;
      const holding: Holding = {
        ownership_id: p.id,
        company_id: co.id,
        company_name: co.name,
        property_id: co.property.id,
        property_name: p.propertyName || co.property.name,
        property_address: p.propertyAddress || co.property.address || null,
        entity_structure: p.type,
        entity_line: p.entityLine || 'Prop Dev',
        ownership_pct: pct,
        role: p.type === 'Class A' ? 'general_partner' : 'limited_partner',
        cost_basis: p.costBasis ?? null,
        book_value: p.bookValue ?? null,
        fair_market_value: p.fairMarketValue ?? null,
        existing_debt: p.existingDebt ?? null,
        capital_contributed: p.capitalContributed > 0 ? p.capitalContributed : null,
        noi_this_month: 0,
        noi_share: p.shareOfProfit || 0,
      };
      const existing = byName.get(p.name);
      if (existing) {
        existing.holdings.push(holding);
        existing.company_count = existing.holdings.length;
        existing.total_noi_share += holding.noi_share;
      } else {
        byName.set(p.name, {
          partner_name: p.name,
          company_count: 1,
          total_noi_share: holding.noi_share,
          holdings: [holding],
        });
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.partner_name.localeCompare(b.partner_name));
}

interface PFinancials {
  marketValue: number;
  capitalContributed: number;
  costBasis: number;
  bookValue: number;
  unrealizedGain: number;
  returnToDate: number;
  roi: number;
  /** True when at least one holding has FV / sale-proxy MV (unrealized is meaningful). */
  hasFairValue: boolean;
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
  companyFmv = 0,
): { marketValue: number; capitalContributed: number; costBasis: number; bookValue: number; unrealizedGain: number; existingDebt: number; hasFairValue: boolean } {
  // Ownership sheet Cost Basis / Book / FMV / Debt are property-level (100%).
  // Partner share = property figure × ownership %.
  // Book Value is optional — Prop Dev imports often omit it; never invent it.
  const pct = holding.ownership_pct > 0 ? holding.ownership_pct : 0;

  const propertyFv = companyFmv > 0
    ? companyFmv
    : (holding.fair_market_value != null && holding.fair_market_value > 0
      ? holding.fair_market_value
      : 0);
  // Sale-consideration proxy only when FV column is absent
  const propertyMV = propertyFv > 0 ? propertyFv : companyMarketValue(companyGpr);
  const hasFairValue = propertyFv > 0 || propertyMV > 0;

  // Market Value = FV (or sale proxy) × ownership % — never fall back to Book/Cost
  const marketValue = propertyMV > 0 ? propertyMV * pct : 0;

  // Explicit Capital Contributed is already the partner's cash in — do not × ownership %.
  let capitalContributed = holding.capital_contributed ?? null;
  if (capitalContributed == null && holding.cost_basis != null && holding.cost_basis > 0) {
    const partnerCost = holding.cost_basis * pct;
    const partnerDebt = (holding.existing_debt ?? 0) * pct;
    capitalContributed = Math.max(0, partnerCost - partnerDebt);
  }
  if (capitalContributed == null && marketValue > 0) {
    capitalContributed = marketValue / 1.25;
  }
  capitalContributed = capitalContributed ?? 0;

  const costBasis = holding.cost_basis != null && holding.cost_basis > 0
    ? holding.cost_basis * pct
    : (capitalContributed > 0 ? capitalContributed * (1 + ACQ_COST) : 0);

  const bookValue = holding.book_value != null && holding.book_value > 0
    ? holding.book_value * pct
    : 0;

  const existingDebt = holding.existing_debt != null && holding.existing_debt > 0
    ? holding.existing_debt * pct
    : 0;

  // Unrealized only when we have a mark-to-market value (FV). No FV → 0 (UI shows "—").
  const unrealizedGain = hasFairValue && marketValue > 0 ? marketValue - costBasis : 0;
  return { marketValue, capitalContributed, costBasis, bookValue, unrealizedGain, existingDebt, hasFairValue };
}

function holdingMetricWeight(holding: Holding, companyGpr: number, companyFmv = 0): number {
  const hf = holdingFinancials(holding, companyGpr, companyFmv);
  return hf.marketValue || hf.bookValue || hf.costBasis || hf.capitalContributed || 1;
}

/** Value-weighted average ownership % across holdings — never sums raw % across properties. */
function weightedOwnershipPct(
  holdings: Holding[],
  companyGpr: Record<string, number>,
  companyFmv: Record<string, number> = {},
): number {
  if (holdings.length === 0) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const h of holdings) {
    const w = holdingMetricWeight(h, companyGpr[h.company_id] ?? 0, companyFmv[h.company_id] ?? 0);
    weighted += h.ownership_pct * 100 * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) {
    const avg = holdings.reduce((s, h) => s + h.ownership_pct * 100, 0) / holdings.length;
    return Math.min(100, avg);
  }
  return Math.min(100, weighted / totalWeight);
}

/** Unique property names / addresses across a partner's holdings (for registry rows). */
function partnerPropertySummary(holdings: Holding[]): { names: string; addresses: string } {
  const byName = new Map<string, string>();
  for (const h of holdings) {
    const name = (h.property_name || h.company_name || '').trim();
    if (!name) continue;
    const addr = (h.property_address || '').trim();
    if (!byName.has(name)) byName.set(name, addr);
    else if (!byName.get(name) && addr) byName.set(name, addr);
  }
  if (byName.size === 0) return { names: '—', addresses: '—' };
  const names = [...byName.keys()].join(' · ');
  const addresses = [...new Set([...byName.values()].filter(Boolean))].join(' · ') || '—';
  return { names, addresses };
}

type CompanySlice = {
  partner: string;
  propertyName: string;
  propertyAddress: string;
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

function companyFmvFromHoldings(holdings: Holding[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const h of holdings) {
    const v = h.fair_market_value;
    if (v != null && v > 0) {
      m[h.company_id] = Math.max(m[h.company_id] ?? 0, v);
    }
  }
  return m;
}

function deriveFinancials(
  p: PartnerGroup,
  companyGpr: Record<string, number>,
  companyFmv: Record<string, number> = {},
): PFinancials {
  let marketValue = 0;
  let capitalContributed = 0;
  let costBasis = 0;
  let bookValue = 0;
  let hasFairValue = false;

  p.holdings.forEach(h => {
    const gpr = companyGpr[h.company_id] ?? 0;
    const hf = holdingFinancials(h, gpr, companyFmv[h.company_id] ?? 0);
    marketValue += hf.marketValue;
    capitalContributed += hf.capitalContributed;
    costBasis += hf.costBasis;
    bookValue += hf.bookValue; // imported Book only — never invent from cost
    if (hf.hasFairValue) hasFairValue = true;
  });

  const unrealizedGain = hasFairValue && marketValue > 0 ? marketValue - costBasis : 0;
  const returnToDate = capitalContributed > 0 ? capitalContributed * DIST_RATE * HOLD_YEARS : 0;
  const roi = costBasis > 0 ? (returnToDate / costBasis) * 100 : 0;
  return { marketValue, capitalContributed, costBasis, bookValue, unrealizedGain, returnToDate, roi, hasFairValue };
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
  return <span className={`px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${NATURE_BADGE[nature] ?? 'bg-gray-100 text-gray-600'}`} style={PT_FONT.caption}>{nature}</span>;
}

function GainCell({ value, present = true }: { value: number; present?: boolean }) {
  if (!present) {
    return <span className="text-gray-400" style={PT_FONT.tableCell}>—</span>;
  }
  const pos = value >= 0;
  return (
    <span className={`font-mono font-semibold ${pos ? 'text-green-800' : 'text-red-700'}`}>
      {pos ? '+' : '-'}{fmt(value)}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export interface PD05PartnersProps {
  /** Lock to one entity (e.g. Financials tab company selector). */
  scopeCompanyId?: string;
  /** Render inside Financials without standalone page chrome. */
  embedded?: boolean;
}

export default function PD05Partners({ scopeCompanyId, embedded = false }: PD05PartnersProps = {}) {
  const { companies: propDevCompanies, refetchCompanies, selectedCompanyId } = usePropDev();

  // Company scope: embedded Financials tab locks to one entity; otherwise use global command strip.
  const companyFilter = scopeCompanyId || selectedCompanyId || 'all';

  // Filters
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [breakdownTab, setBreakdownTab] = useState<'company' | 'partner' | 'property'>('company');

  // Scope to command-strip / embedded company so Partner dropdown only lists related partners.
  const scopedCompanies = useMemo(() => {
    if (scopeCompanyId && scopeCompanyId !== 'all') {
      return propDevCompanies.filter(c => c.id === scopeCompanyId);
    }
    if (!scopeCompanyId && selectedCompanyId && selectedCompanyId !== 'all') {
      return propDevCompanies.filter(c => c.id === selectedCompanyId);
    }
    return propDevCompanies;
  }, [propDevCompanies, scopeCompanyId, selectedCompanyId]);

  // Reset partner filter when company scope changes
  useEffect(() => {
    setPartnerFilter('all');
    setSelectedPartner(null);
  }, [companyFilter]);

  const apiPartners = useMemo(
    () => mapPropDevToPartnerGroups(scopedCompanies),
    [scopedCompanies],
  );

  const companies: CompanyMeta[] = useMemo(
    () => scopedCompanies.map(c => ({
      id: c.id,
      company_name: c.name,
      total_units: Math.max(1, c.lots.length || c.property.totalLots || 1),
      // Encode sale/exit value as pseudo-GPR so Ownership cap-rate math yields that value
      gross_potential_rent: companyValueAsPseudoGpr(c),
    })),
    [scopedCompanies],
  );

  const companyNetIncome = useMemo(() => {
    const m: Record<string, number> = {};
    scopedCompanies.forEach(c => {
      const pl = c.property.yearlyPL;
      if (!pl) { m[c.id] = 0; return; }
      const years = Object.keys(pl).sort();
      const last = years[years.length - 1];
      m[c.id] = last ? (pl[last]?.net_income ?? 0) : 0;
    });
    return m;
  }, [scopedCompanies]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const companyGpr = useMemo(() => {
    const m: Record<string, number> = {};
    companies.forEach(c => { m[c.id] = c.gross_potential_rent; });
    return m;
  }, [companies]);

  const companyFmv = useMemo(() => {
    const holdings = apiPartners.flatMap(p => p.holdings);
    return companyFmvFromHoldings(holdings);
  }, [apiPartners]);

  const companyLtv = useMemo(() => {
    const m: Record<string, number | null> = {};
    scopedCompanies.forEach(c => {
      const debt = c.loans.filter(l => l.status === 'Active').reduce((s, l) => s + l.balance, 0)
        || (c.property.yearlyBS
          ? Object.values(c.property.yearlyBS).slice(-1)[0]?.loan_balance ?? 0
          : 0);
      const mv = (companyFmv[c.id] ?? 0) > 0
        ? companyFmv[c.id]
        : companyMarketValue(companyValueAsPseudoGpr(c));
      m[c.id] = mv > 0 ? (debt / mv) * 100 : null;
    });
    return m;
  }, [scopedCompanies, companyFmv]);

  const companyUnits = useMemo(() => {
    const m: Record<string, number> = {};
    companies.forEach(c => { m[c.id] = c.total_units; });
    return m;
  }, [companies]);

  const allCompanies = useMemo(() => {
    const map: Record<string, string> = {};
    apiPartners.forEach(p => p.holdings.forEach(h => { map[h.company_id] = h.company_name; }));
    return Object.entries(map).map(([id, name]) => ({ id, name }));
  }, [apiPartners]);

  const filtered = useMemo(() => {
    let ps = apiPartners;
    if (partnerFilter !== 'all') ps = ps.filter(p => p.partner_name === partnerFilter);
    if (companyFilter !== 'all') {
      ps = ps
        .map(p => ({
          ...p,
          holdings: p.holdings.filter(h => h.company_id === companyFilter),
        }))
        .filter(p => p.holdings.length > 0)
        .map(p => ({
          ...p,
          company_count: p.holdings.length,
          total_noi_share: p.holdings.reduce((s, h) => s + h.noi_share, 0),
        }));
    }
    return ps;
  }, [apiPartners, partnerFilter, companyFilter]);

  const financials = useMemo(() => {
    const m: Record<string, PFinancials> = {};
    filtered.forEach(p => { m[p.partner_name] = deriveFinancials(p, companyGpr, companyFmv); });
    return m;
  }, [filtered, companyGpr, companyFmv]);

  const scopedCompanyIds = useMemo(() => {
    const ids = new Set<string>();
    filtered.forEach(p => p.holdings.forEach(h => ids.add(h.company_id)));
    return ids;
  }, [filtered]);

  const portfolioSolvency = useMemo(() => {
    const ltvs = [...scopedCompanyIds].map(id => companyLtv[id]).filter((v): v is number => v != null);
    if (!ltvs.length) {
      return { ltvPct: null as number | null, dscr: null as number | null, hasFinancials: false };
    }
    const avgLtv = ltvs.reduce((s, v) => s + v, 0) / ltvs.length;
    return { ltvPct: avgLtv, dscr: null as number | null, hasFinancials: true };
  }, [scopedCompanyIds, companyLtv]);

  const propertiesPerCompany = useMemo(() => {
    const uniq: Record<string, Set<string>> = {};
    filtered.forEach(p => {
      p.holdings.forEach(h => {
        if (!uniq[h.company_id]) uniq[h.company_id] = new Set();
        uniq[h.company_id].add(h.property_name || h.company_name);
      });
    });
    const out: Record<string, number> = {};
    Object.entries(uniq).forEach(([id, set]) => { out[id] = set.size; });
    return out;
  }, [filtered]);

  const hasImportedFinancials = useMemo(
    () => filtered.some(p => p.holdings.some(h =>
      h.cost_basis != null || h.book_value != null || h.capital_contributed != null || h.fair_market_value != null,
    )),
    [filtered],
  );

  const hasImportedFmv = useMemo(
    () => Object.values(companyFmv).some(v => v > 0),
    [companyFmv],
  );

  const kpis = useMemo(() => {
    const fs = filtered.map(p => financials[p.partner_name]).filter(Boolean);

    // Portfolio Fair Value (FV): ownership-sheet Fair Market Value is property-level (100%).
    // Partner / portfolio FV = Σ (property FV × ownership %), same rule as Cost Basis.
    let fvAllocated = 0;
    let fvHoldings = 0;
    filtered.forEach(p => {
      p.holdings.forEach(h => {
        const propFv = (h.fair_market_value != null && h.fair_market_value > 0)
          ? h.fair_market_value
          : (companyFmv[h.company_id] ?? 0);
        if (propFv > 0 && h.ownership_pct > 0) {
          fvAllocated += propFv * h.ownership_pct;
          fvHoldings += 1;
        }
      });
    });

    const partnerShareMv = fs.reduce((s, f) => s + f.marketValue, 0);
    const totalMV = fvHoldings > 0 ? fvAllocated : partnerShareMv;

    const importedDebt = filtered.reduce((s, p) => s + p.holdings.reduce((hs, h) => {
      const gpr = companyGpr[h.company_id] ?? 0;
      return hs + holdingFinancials(h, gpr, companyFmv[h.company_id] ?? 0).existingDebt;
    }, 0), 0);
    const totalDebt = importedDebt > 0 ? importedDebt : (totalMV > 0 ? totalMV * 0.6 : 0);
    const totalEq = totalMV - totalDebt;
    // Total Cost Basis = Σ (property cost basis × ownership %)
    const totalCost = fs.reduce((s, f) => s + f.costBasis, 0);
    const weightedROI = totalCost > 0
      ? fs.reduce((s, f) => s + f.roi * f.costBasis, 0) / totalCost
      : 0;
    return {
      totalPartners: filtered.length,
      totalCapital: totalCost,
      totalMV,
      totalEquity: totalEq,
      totalDebt,
      avgROI: weightedROI,
      marketValueFromFmv: fvHoldings > 0,
    };
  }, [financials, filtered, companyGpr, companyFmv]);

  const byCompany = useMemo(() => {
    const map: Record<string, {
      id: string; name: string; propertyName: string; address: string; units: number; noi: number;
      marketValue: number; bookValue: number; costBasis: number; capitalIn: number; debt: number;
      slices: CompanySlice[];
    }> = {};
    filtered.forEach((p, pi) => {
      p.holdings.forEach(h => {
        const gpr = companyGpr[h.company_id] ?? 0;
        const hf = holdingFinancials(h, gpr, companyFmv[h.company_id] ?? 0);
        if (!map[h.company_id]) {
          map[h.company_id] = {
            id: h.company_id,
            name: h.company_name,
            propertyName: h.property_name || h.company_name,
            address: h.property_address?.trim() || '—',
            units: companyUnits[h.company_id] ?? 0,
            noi: h.noi_this_month,
            marketValue: (companyFmv[h.company_id] ?? 0) > 0
              ? companyFmv[h.company_id]
              : companyMarketValue(gpr),
            bookValue: 0,
            costBasis: 0,
            capitalIn: 0,
            debt: 0,
            slices: [],
          };
        }
        map[h.company_id].costBasis += hf.costBasis;
        map[h.company_id].capitalIn += hf.capitalContributed;
        map[h.company_id].debt += hf.existingDebt;
        map[h.company_id].slices.push({
          partner: p.partner_name,
          propertyName: h.property_name || h.company_name,
          propertyAddress: h.property_address?.trim() || '—',
          pct: h.ownership_pct * 100,
          color: COLORS[pi % COLORS.length],
          costBasis: hf.costBasis,
          bookValue: h.book_value ?? 0,
          marketValue: hf.marketValue,
          capitalIn: hf.capitalContributed,
        });
      });
    });
    for (const co of Object.values(map)) {
      // Imported Book only — never invent from cost when Book column is blank.
      const hs = filtered.flatMap(p => p.holdings.filter(h => h.company_id === co.id));
      co.bookValue = hs.reduce((s, h) => {
        const pct = h.ownership_pct > 0 ? h.ownership_pct : 0;
        return s + ((h.book_value != null && h.book_value > 0) ? h.book_value * pct : 0);
      }, 0);
    }
    return Object.values(map);
  }, [filtered, companyGpr, companyFmv, companyUnits]);

  const byPartner = useMemo(() => {
    return filtered.map((p, pi) => {
      const f = financials[p.partner_name];
      return {
        name: p.partner_name,
        color: COLORS[pi % COLORS.length],
        ownershipPct: weightedOwnershipPct(p.holdings, companyGpr, companyFmv),
        capitalIn: f?.capitalContributed ?? 0,
        costBasis: f?.costBasis ?? 0,
        bookValue: f?.bookValue ?? 0,
        marketValue: f?.marketValue ?? 0,
        roi: f?.roi ?? 0,
        holdings: p.holdings.length,
      };
    });
  }, [filtered, financials, companyGpr, companyFmv]);

  const byProperty = useMemo(() => {
    const map: Record<string, {
      key: string; propertyName: string; companyName: string; companyId: string; address: string;
      costBasis: number; bookValue: number; marketValue: number; capitalIn: number; debt: number;
      effectiveCapRate: number | null; valuationAssumed: boolean;
      slices: { partner: string; pct: number; color: string }[];
    }> = {};
    filtered.forEach((p, pi) => {
      p.holdings.forEach(h => {
        const gpr = companyGpr[h.company_id] ?? 0;
        const hf = holdingFinancials(h, gpr, companyFmv[h.company_id] ?? 0);
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
        map[key].bookValue = Math.max(map[key].bookValue, h.book_value ?? 0);
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
      const companyNoi = companyNetIncome[r.companyId] ?? 0;
      const propCount = propertiesPerCompany[r.companyId] ?? 1;
      const allocatedNoi = propCount > 0 ? companyNoi / propCount : companyNoi;
      r.effectiveCapRate = effectiveCapRate(allocatedNoi, r.marketValue);
      r.valuationAssumed = (companyGpr[r.companyId] ?? 0) > 0;
    });
    return rows.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [filtered, companyGpr, companyFmv, companyNetIncome, propertiesPerCompany]);

  const totalRow = useMemo(() => {
    const fs = filtered.map(p => financials[p.partner_name]).filter(Boolean);
    const hasFairValue = fs.some(f => f.hasFairValue);
    return {
      capitalContributed: fs.reduce((s, f) => s + f.capitalContributed, 0),
      costBasis:          fs.reduce((s, f) => s + f.costBasis, 0),
      bookValue:          fs.reduce((s, f) => s + f.bookValue, 0),
      marketValue:        fs.reduce((s, f) => s + f.marketValue, 0),
      unrealizedGain:     fs.reduce((s, f) => s + (f.hasFairValue ? f.unrealizedGain : 0), 0),
      returnToDate:       fs.reduce((s, f) => s + f.returnToDate, 0),
      hasFairValue,
    };
  }, [filtered, financials]);

  const selPartnerData = selectedPartner ? filtered.find(p => p.partner_name === selectedPartner) : null;
  const selF = selPartnerData ? financials[selPartnerData.partner_name] : null;
  const selNature = selectedPartner
    ? (natures[selectedPartner]
      ?? ROLE_MAP[selPartnerData?.holdings[0]?.role ?? '']
      ?? (selPartnerData?.holdings[0]?.entity_structure === 'Class A' ? 'Class A — Preferred'
        : selPartnerData?.holdings[0]?.entity_structure === 'Class B' ? 'Class B — Common'
          : 'Joint Venture Partner'))
    : '';

  // All synthetic contributions merged with local — include imported capital + distributions
  const allContribs = useMemo(() => {
    const imported: Contribution[] = [];
    const partnerDist = new Map<string, number>();
    scopedCompanies.forEach(co => {
      co.partners.forEach(p => {
        partnerDist.set(p.name, (partnerDist.get(p.name) ?? 0) + (p.distributionsReceived || 0));
      });
    });
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
      const dist = partnerDist.get(p.partner_name) ?? 0;
      if (dist > 0) {
        imported.push({
          id: `dist-${p.partner_name}`,
          partner: p.partner_name,
          company: p.holdings[0]?.company_name ?? '',
          date: '—',
          amount: -dist,
          type: 'Distribution',
          reference: 'Import',
          notes: 'Distributions received (import)',
          cumulative: (financials[p.partner_name]?.capitalContributed ?? 0) - dist,
        });
      }
    });
    if (imported.length > 0) return [...imported, ...localContribs];
    const synth = apiPartners.flatMap(p => {
      const f = financials[p.partner_name];
      if (!f || f.capitalContributed <= 0) return [];
      return genContributions(p.partner_name, p.holdings.map(h => h.company_name), f.capitalContributed);
    });
    return [...synth, ...localContribs];
  }, [apiPartners, financials, localContribs, scopedCompanies]);

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

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const entityLabel = companyFilter === 'all'
        ? 'All Companies'
        : (propDevCompanies.find(c => c.id === companyFilter)?.name ?? 'Property Dev Entity');
      await exportPropDevOwnershipPdf({
        entityLabel,
        periodLabel: 'Current',
        partnerFilterLabel: partnerFilter === 'all' ? 'All Partners' : partnerFilter,
        kpis: {
          totalPartners: kpis.totalPartners,
          totalCapital: kpis.totalCapital,
          totalMV: kpis.totalMV,
          totalEquity: kpis.totalEquity,
          totalDebt: kpis.totalDebt,
          avgROI: kpis.avgROI,
          ltvPct: portfolioSolvency.ltvPct,
        },
        partners: filtered.map(p => {
          const f = financials[p.partner_name];
          const propSummary = partnerPropertySummary(p.holdings);
          const pMetrics = partnerMetricsByName[p.partner_name];
          return {
            name: p.partner_name,
            propertyNames: propSummary.names,
            ownPct: weightedOwnershipPct(p.holdings, companyGpr, companyFmv),
            capitalIn: f?.capitalContributed ?? 0,
            costBasis: f?.costBasis ?? 0,
            bookValue: f?.bookValue ?? 0,
            marketValue: f?.marketValue ?? 0,
            hasFairValue: f?.hasFairValue ?? false,
            unrealizedGain: f?.unrealizedGain ?? 0,
            returnToDate: f?.returnToDate ?? 0,
            roi: f?.roi ?? 0,
            irrLabel: pMetrics?.irrLabel ?? '—',
            equityMultipleLabel: pMetrics?.equityMultipleLabel ?? '—',
          };
        }),
        totals: {
          capitalIn: totalRow.capitalContributed,
          costBasis: totalRow.costBasis,
          bookValue: totalRow.bookValue,
          marketValue: totalRow.marketValue,
          unrealizedGain: totalRow.unrealizedGain,
          returnToDate: totalRow.returnToDate,
          hasFairValue: totalRow.hasFairValue,
        },
        portfolioIrrLabel: portfolioReturnMetrics.irrLabel,
        portfolioEqMultLabel: portfolioReturnMetrics.equityMultipleLabel,
      });
    } catch (e: unknown) {
      window.alert(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportingPdf(false);
    }
  }, [
    companyFilter, propDevCompanies, partnerFilter, kpis, portfolioSolvency.ltvPct,
    filtered, financials, partnerMetricsByName, companyGpr, companyFmv, totalRow,
    portfolioReturnMetrics,
  ]);

  useEffect(() => {
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent<{ scope?: string }>).detail ?? {};
      // When embedded under Financials → Ownership, ignore Financials-scope exports.
      if (embedded && detail.scope !== 'ownership') return;
      if (!embedded && detail.scope && detail.scope !== 'ownership') return;
      void handleExportPdf();
    };
    window.addEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
    return () => window.removeEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
  }, [handleExportPdf, embedded]);

  const propertyCapStats = useMemo(() => {
    let assumed = 0;
    let realMv = 0;
    byProperty.forEach(prop => {
      if (prop.valuationAssumed) assumed += 1;
      else realMv += 1;
    });
    return { assumed, realMv, total: byProperty.length };
  }, [byProperty]);

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
      const response = await api.get('/api/propdev/import-partner-ownership-template', { responseType: 'blob' });
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
      const response = await postUploadWithWake<{
        imported_count?: number;
        partners_imported?: number;
        skipped_non_propdev?: number;
        sheets_parsed?: string[];
        errors?: string[];
        message?: string;
      }>('/api/propdev/import-partner-ownership', formData);
      const data = response.data;
      const count = data.imported_count ?? data.partners_imported ?? 0;
      const skipped = data.skipped_non_propdev ?? 0;
      const sheets = data.sheets_parsed?.length
        ? ` Sheets: ${data.sheets_parsed.join(', ')}.`
        : '';
      const warnings = (data.errors ?? []).filter(Boolean);
      if (count === 0) {
        setImportMessage({
          type: 'error',
          text: warnings.join('; ') || data.message ||
            'No partner rows imported. Use Entity = Construction, Development, Holding, Prop Dev, or Partner and match Entity Name to Company Registry.',
        });
      } else {
        const skipText = skipped > 0
          ? ` Skipped ${skipped} row(s) where Entity is not Construction / Development / Holding / Prop Dev / Partner.`
          : '';
        const warnText = warnings.length
          ? ` (${warnings.length} row warning(s): ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''})`
          : '';
        setImportMessage({
          type: 'success',
          text: data.message || `Imported ${count} Property Dev partner position(s).${sheets}${skipText}${warnText}`,
        });
        notifyPropDevCompaniesRefresh();
        await refetchCompanies();
      }
    } catch (err: unknown) {
      setImportMessage({
        type: 'error',
        text: formatApiError(err, 'Import failed. Use the template and ensure Entity Name matches Company Registry.'),
      });
    } finally {
      setImporting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const avgROI = kpis.avgROI;
  const portfolioMarketValue = kpis.totalMV;

  const pagePad = 'space-y-6';

  return (
    <div className={pagePad} style={{ background: PT.pageBg, fontSize: 13, color: PT.text }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        {!embedded && (
          <div>
            <h1 style={PT_FONT.pageTitle}>Ownership</h1>
            <p style={PT_FONT.pageSubtitle}>Partner registry · Capital tracking · Equity analytics · Construction / Development / Holding / Prop Dev / Partner entities</p>
          </div>
        )}
        <div className={`flex flex-wrap items-center gap-2 ${embedded ? 'w-full justify-end' : ''}`}>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900" style={PT_FONT.control}>
            <span style={{ ...PT_FONT.caption, color: PT.muted }}>Company:</span>
            <span style={{ ...PT_FONT.button, fontSize: 13 }}>
              {companyFilter === 'all'
                ? 'All Companies'
                : (propDevCompanies.find(c => c.id === companyFilter)?.name ?? 'Selected')}
            </span>
          </div>
          {/* Partner filter — options scoped to selected company */}
          <div className="flex items-center gap-1.5" style={PT_FONT.control}>
            <span style={{ ...PT_FONT.caption, color: PT.muted }}>Partner:</span>
            <select value={partnerFilter} onChange={e => { setPartnerFilter(e.target.value); setSelectedPartner(e.target.value === 'all' ? null : e.target.value); }}
              className="border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-600"
              style={{ ...PT_FONT.control, borderColor: PT.border, background: PT.cardBg }}>
              <option value="all">All Partners{companyFilter !== 'all' ? ' (this company)' : ''}</option>
              {apiPartners.map(p => <option key={p.partner_name} value={p.partner_name}>{p.partner_name}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf}
            title="Export Ownership PDF"
            className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-60"
            style={{ ...PT_FONT.button, borderColor: PT.border, color: PT.text }}>
            <Download size={13} /> {exportingPdf ? 'Exporting…' : 'Export PDF'}
          </button>
          <button onClick={downloadImportTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg hover:bg-gray-50"
            style={{ ...PT_FONT.button, borderColor: PT.border, color: PT.muted }}>
            <Download size={13} /> Download Template
          </button>
          <button onClick={() => importFileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            style={{ ...PT_FONT.button, borderColor: PT.border, color: PT.muted }}
            disabled={importing}>
            <Download size={13} /> {importing ? 'Importing…' : 'Import Partners'}
          </button>
          <input ref={importFileRef} type="file" accept=".xlsx" onChange={handleImportPartners} style={{ display: 'none' }} />
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            style={PT_FONT.button}>
            <Zap size={13} /> AI Insights
          </button>
          <button onClick={() => setShowAddPartner(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-800 text-white rounded-lg hover:bg-amber-900"
            style={PT_FONT.button}>
            <Plus size={13} /> Add Partner
          </button>
        </div>
      </div>

      {importMessage && (
        <div className={`rounded-lg px-4 py-3 ${importMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}
          style={PT_FONT.body}>
          {importMessage.text}
        </div>
      )}

      {apiPartners.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-gray-800 mb-1">No partner ownership data</p>
          <p className="text-xs text-gray-500 mb-4 max-w-md mx-auto">
            Import the ownership workbook used in Rentals → Ownership. Reads Personal Entities, Partnership Entities (Family), and Partnership Entities. Property Dev keeps Construction / Development / Holding / Prop Dev / Partner rows.
          </p>
          <button type="button" onClick={() => importFileRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-800 text-white text-sm rounded-lg hover:bg-amber-900">
            <Download size={14} /> Import Partners
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1 — PORTFOLIO OWNERSHIP KPIs
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <ParchmentKpiTile label="Total Partners" value={kpis.totalPartners.toString()} sub="active partners" />
        <ParchmentKpiTile label="Total Cost Basis" value={fmtK(kpis.totalCapital)} sub="property cost × ownership % (land + improvements)" accent />
        <ParchmentKpiTile label="Portfolio Fair Value (FV)" value={fmtK(kpis.totalMV)}
          sub={kpis.marketValueFromFmv || hasImportedFmv
            ? 'property FV × ownership %'
            : hasImportedFinancials
              ? 'no FV column — re-import ownership with Fair Market Value'
              : 'import ownership Fair Market Value (FV)'} />
        <ParchmentKpiTile label="Total Equity" value={fmtK(kpis.totalEquity)}
          sub={kpis.totalDebt > 0 && kpis.totalDebt !== kpis.totalMV * 0.6 ? 'FV − imported debt' : 'FV − debt (60% LTV)'} />
        <ParchmentKpiTile label="Avg Partner ROI" value={`${avgROI.toFixed(1)}%`}
          sub="weighted by cost basis · 4.5%/yr × 5 yrs"
          warn={avgROI < 20} />
      </div>

      {/* Secondary solvency KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
        <ParchmentKpiTile
          label="Portfolio LTV"
          value={portfolioSolvency.hasFinancials && portfolioSolvency.ltvPct != null
            ? `${portfolioSolvency.ltvPct.toFixed(1)}%`
            : 'No debt / value'}
          sub={portfolioSolvency.hasFinancials ? 'Loan balance ÷ property market value' : 'Import debt or sale consideration for LTV'}
        />
        <ParchmentKpiTile
          label="Portfolio DSCR (Est.)"
          value="—"
          sub="Upload P&L under Financials for DSCR (same as Rentals when financials exist)"
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2 — PARTNER REGISTRY TABLE
      ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{ ...PT_CARD, overflow: 'hidden' }}>
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: PT.border }}>
          <div>
            <h3 style={PT_FONT.sectionTitle}>Partner Registry</h3>
            <p style={PT_FONT.sectionSubtitle}>{filtered.length} partner{filtered.length !== 1 ? 's' : ''} · {hasImportedFinancials ? 'financials from import where provided' : 'values derived from sale consideration / cost basis · same formulas as Rentals Ownership'}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={PT_FONT.table}>
            <thead style={{ background: PT.pageBg }}>
              <tr>
                {['Partner','Property Name','Address','Entity','Nature','Wtd Own %','Capital In','Cost Basis','Book Value','Market Value','Unrealized G/L','Return to Date','ROI','IRR','Eq. Mult.','Status',''].map(h => (
                  <th
                    key={h}
                    className={`px-3 py-3 whitespace-nowrap ${
                      ['Partner', 'Property Name', 'Address', 'Entity', 'Nature', 'Status', ''].includes(h) ? 'text-left' : 'text-right'
                    }`}
                    style={PT_FONT.tableHeader}
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p, pi) => {
                const f = financials[p.partner_name];
                if (!f) return null;
                const nature = natures[p.partner_name]
                  ?? ROLE_MAP[p.holdings[0]?.role ?? '']
                  ?? (p.holdings[0]?.entity_structure === 'Class A' ? 'Class A — Preferred'
                    : p.holdings[0]?.entity_structure === 'Class B' ? 'Class B — Common'
                      : 'Joint Venture Partner');
                const totalPct = weightedOwnershipPct(p.holdings, companyGpr, companyFmv);
                const pMetrics = partnerMetricsByName[p.partner_name];
                const isSelected = selectedPartner === p.partner_name;
                const entityLines = [...new Set(p.holdings.map(h => h.entity_line || 'Prop Dev'))];
                const propSummary = partnerPropertySummary(p.holdings);
                return (
                  <tr key={p.partner_name}
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-green-50 ring-1 ring-inset ring-green-200' : ''}`}
                    onClick={() => setSelectedPartner(prev => prev === p.partner_name ? null : p.partner_name)}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-white shrink-0" style={{ ...PT_FONT.caption, background: COLORS[pi % COLORS.length] }}>
                          {p.partner_name[0]}
                        </span>
                        <span className="font-medium text-gray-900 whitespace-nowrap">{p.partner_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 max-w-[180px]">
                      <span className="text-gray-900" style={PT_FONT.tableCell}>{propSummary.names}</span>
                    </td>
                    <td className="px-3 py-3 max-w-[220px]">
                      <span className="text-gray-500" style={PT_FONT.tableCell}>{propSummary.addresses}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {entityLines.map(line => (
                          <span key={line} className={`px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                            line === 'Land' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                          }`} style={PT_FONT.caption}>{line}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={nature}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setNatures(prev => ({ ...prev, [p.partner_name]: e.target.value }))}
                        className="border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-green-600 rounded"
                        style={PT_FONT.tableCell}
                      >
                        {NATURE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className="font-mono font-semibold" style={PT_FONT.tableCell}>{totalPct.toFixed(1)}%</span>
                        <div className="w-16 bg-gray-200 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-green-700" style={{ width: `${totalPct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono" style={PT_FONT.tableCell}>{fmtK(f.capitalContributed)}</td>
                    <td className="px-3 py-3 text-right font-mono" style={PT_FONT.tableCell}>{fmtK(f.costBasis)}</td>
                    <td className="px-3 py-3 text-right font-mono" style={PT_FONT.tableCell}>{fmtKOrDash(f.bookValue)}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-green-800" style={PT_FONT.tableCell}>{fmtKOrDash(f.marketValue, f.hasFairValue)}</td>
                    <td className="px-3 py-3 text-right"><GainCell value={f.unrealizedGain} present={f.hasFairValue} /></td>
                    <td className="px-3 py-3 text-right font-mono text-blue-700" style={PT_FONT.tableCell}>{fmtK(f.returnToDate)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={`font-semibold ${f.roi >= 20 ? 'text-green-800' : f.roi >= 10 ? 'text-amber-600' : 'text-red-700'}`} style={PT_FONT.tableCell}>
                        {f.roi.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-gray-700" style={PT_FONT.tableCell} title={pMetrics?.irrLabel}>
                      {pMetrics?.irrLabel ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-gray-800" style={PT_FONT.tableCell}>
                      {pMetrics?.equityMultipleLabel ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-left">
                      <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800" style={PT_FONT.caption}>Active</span>
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={e => { e.stopPropagation(); setSelectedPartner(p.partner_name); }}
                        className="text-blue-600 hover:underline" style={PT_FONT.tableCell}>Detail</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white font-semibold" style={PT_FONT.tableCell}>
                <td className="px-3 py-3" colSpan={6}>Portfolio Total</td>
                <td className="px-3 py-3 text-right font-mono">{fmtK(totalRow.capitalContributed)}</td>
                <td className="px-3 py-3 text-right font-mono">{fmtK(totalRow.costBasis)}</td>
                <td className="px-3 py-3 text-right font-mono">{fmtKOrDash(totalRow.bookValue)}</td>
                <td className="px-3 py-3 text-right font-mono text-green-300">{fmtKOrDash(totalRow.marketValue, totalRow.hasFairValue)}</td>
                <td className="px-3 py-3 text-right font-mono">
                  {totalRow.hasFairValue ? (
                    <span className={totalRow.unrealizedGain >= 0 ? 'text-green-300' : 'text-red-300'}>
                      {totalRow.unrealizedGain >= 0 ? '+' : '-'}{fmtK(Math.abs(totalRow.unrealizedGain))}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-mono text-blue-300">{fmtK(totalRow.returnToDate)}</td>
                <td className="px-3 py-3 text-right font-mono">{avgROI.toFixed(1)}%</td>
                <td className="px-3 py-3 text-right font-mono" style={PT_FONT.tableCell}>{portfolioReturnMetrics.irrLabel}</td>
                <td className="px-3 py-3 text-right font-mono">{portfolioReturnMetrics.equityMultipleLabel}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3 — OWNERSHIP ANALYTICS
      ═══════════════════════════════════════════════════════════════════════ */}
      <div style={PT_CARD}>
        <div className="p-4 border-b" style={{ borderColor: PT.border }}>
          <h3 style={PT_FONT.sectionTitle}>Ownership Analytics</h3>
          <p style={PT_FONT.sectionSubtitle}>
            Property Dev entities · equity, return and gain/loss comparison (same calc as Rentals Ownership)
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px" style={{ background: PT.border }}>
          {/* Chart 1: Ownership Distribution Donut */}
          <div className="p-4" style={{ background: PT.cardBg }}>
            <p style={{ ...PT_FONT.tableHeader, marginBottom: 12 }}>Ownership Distribution</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={filtered.map((p, i) => ({
                    name: p.partner_name,
                    value: portfolioMarketValue > 0
                      ? parseFloat((((financials[p.partner_name]?.marketValue ?? 0) / portfolioMarketValue) * 100).toFixed(1))
                      : 0,
                  }))}
                  dataKey="value" cx="45%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}
                >
                  {filtered.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Portfolio Equity']} />
                <Legend wrapperStyle={CHART_LEGEND.wrapperStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 2: Capital vs Market Value */}
          <div className="p-4" style={{ background: PT.cardBg }}>
            <p style={{ ...PT_FONT.tableHeader, marginBottom: 12 }}>Capital vs Market Value per Partner</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={filtered.map(p => {
                const f = financials[p.partner_name];
                return { name: p.partner_name.split(' ')[0], costBasis: Math.round((f?.costBasis ?? 0) / 1000), marketValue: Math.round((f?.marketValue ?? 0) / 1000) };
              })} barCategoryGap="30%" barGap={2}>
                <XAxis dataKey="name" tick={CHART_TICK} />
                <YAxis tick={CHART_TICK} tickFormatter={v => `$${v}K`} />
                <Tooltip formatter={(v: number) => [`$${v}K`, '']} />
                <Legend wrapperStyle={CHART_LEGEND.wrapperStyle} />
                <Bar dataKey="costBasis"    name="Cost Basis"    fill="#2563EB" radius={[3,3,0,0]} maxBarSize={22} />
                <Bar dataKey="marketValue"  name="Market Value"  fill="#16A34A" radius={[3,3,0,0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 3: ROI Comparison (horizontal bar) */}
          <div className="p-4" style={{ background: PT.cardBg }}>
            <p style={{ ...PT_FONT.tableHeader, marginBottom: 12 }}>ROI Comparison — Sorted Highest First</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                layout="vertical"
                data={[...filtered].sort((a, b) => (financials[b.partner_name]?.roi ?? 0) - (financials[a.partner_name]?.roi ?? 0)).map(p => ({
                  name: p.partner_name.split(' ')[0],
                  roi: parseFloat((financials[p.partner_name]?.roi ?? 0).toFixed(1)),
                }))}
                barSize={16} margin={{ left: 4, right: 40 }}
              >
                <XAxis type="number" tick={CHART_TICK} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={CHART_TICK} width={80} />
                <Tooltip formatter={(v: number) => [`${v}%`, 'ROI']} />
                <ReferenceLine x={avgROI} stroke="#D97706" strokeDasharray="4 2" label={{ value: `Avg ${avgROI.toFixed(1)}%`, fontSize: 9, fill: '#D97706', position: 'insideTopRight' }} />
                <Bar dataKey="roi" fill="#1E3A8A" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 4: Unrealized Gain/Loss */}
          <div className="p-4" style={{ background: PT.cardBg }}>
            <p style={{ ...PT_FONT.tableHeader, marginBottom: 12 }}>Unrealized Gain / Loss per Partner</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={filtered
                .filter(p => financials[p.partner_name]?.hasFairValue)
                .map((p) => {
                  const f = financials[p.partner_name];
                  return {
                    name: p.partner_name.split(' ')[0],
                    gain: Math.round((f?.unrealizedGain ?? 0) / 1000),
                    color: (f?.unrealizedGain ?? 0) >= 0 ? '#16A34A' : '#DC2626',
                  };
                })} barSize={28}>
                <XAxis dataKey="name" tick={CHART_TICK} />
                <YAxis tick={CHART_TICK} tickFormatter={v => `$${v}K`} />
                <Tooltip formatter={(v: number) => [`$${v}K`, 'Unrealized G/L']} />
                <ReferenceLine y={0} stroke="#9CA3AF" />
                <Bar dataKey="gain" name="Unrealized G/L" radius={[3,3,0,0]}>
                  {filtered.filter(p => financials[p.partner_name]?.hasFairValue).map((p, i) => (
                    <Cell key={i} fill={(financials[p.partner_name]?.unrealizedGain ?? 0) >= 0 ? '#16A34A' : '#DC2626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
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
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Holdings by Property</p>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      {['Property Name','Address','Company','% Own','Units','Cost Basis','Book Value','Market Value','Unrealized Gain','Income Share','Status'].map(h => (
                        <th
                          key={h}
                          className={`px-2 py-2 ${
                            ['Property Name', 'Address', 'Company', 'Status'].includes(h) ? 'text-left' : 'text-right'
                          }`}
                        >{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selPartnerData.holdings.map(h => {
                      const gpr = companyGpr[h.company_id] ?? 0;
                      const hf = holdingFinancials(h, gpr, companyFmv[h.company_id] ?? 0);
                      const units = companyUnits[h.company_id] ?? 0;
                      const partnerUnits = Math.round(units * h.ownership_pct);
                      const propName = h.property_name || h.company_name;
                      const propAddr = h.property_address?.trim() || '—';
                      return (
                        <tr key={`${h.company_id}-${propName}`} className="hover:bg-gray-50">
                          <td className="px-2 py-2 font-medium truncate max-w-[140px]" title={propName}>{propName}</td>
                          <td className="px-2 py-2 text-gray-500 truncate max-w-[160px]" title={propAddr}>{propAddr}</td>
                          <td className="px-2 py-2 font-medium truncate max-w-[120px]">{h.company_name}</td>
                          <td className="px-2 py-2 text-right">{(h.ownership_pct * 100).toFixed(1)}%</td>
                          <td className="px-2 py-2 text-right">{partnerUnits}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtK(hf.costBasis)}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtK(hf.bookValue)}</td>
                          <td className="px-2 py-2 text-right font-mono text-green-800">{fmtK(hf.marketValue)}</td>
                          <td className="px-2 py-2 text-right"><GainCell value={hf.unrealizedGain} /></td>
                          <td className="px-2 py-2 text-right font-mono text-blue-700">{fmtK(h.noi_share)}</td>
                          <td className="px-2 py-2 text-left">
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
                    <Legend wrapperStyle={CHART_LEGEND.wrapperStyle} />
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
                      <th
                        key={h}
                        className={`px-2 py-2 ${
                          ['Date', 'Transaction', 'Notes'].includes(h) ? 'text-left' : 'text-right'
                        }`}
                      >{h}</th>
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
          SECTION 5 — OWNERSHIP BREAKDOWN (Company / Partner / Property)
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
                    <div className="flex items-center gap-3 min-w-0">
                      {isExp ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                      <Building2 size={14} className="text-gray-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium text-gray-900">{co.name}</span>
                          {co.propertyName && co.propertyName !== co.name && (
                            <span className="text-xs text-gray-500">· {co.propertyName}</span>
                          )}
                          <span className="text-xs text-gray-400">
                            · {co.units} unit{co.units !== 1 ? 's' : ''} · {co.slices.length} partner{co.slices.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {co.address !== '—' && (
                          <p className="text-xs text-gray-400 truncate mt-0.5" title={co.address}>{co.address}</p>
                        )}
                      </div>
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
                            <th className="pb-1.5 text-left">Address</th>
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
                              <td className="py-1.5 pr-2 text-gray-500 max-w-[140px] truncate" title={s.propertyAddress}>{s.propertyAddress}</td>
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
                            <Legend wrapperStyle={CHART_LEGEND.wrapperStyle} />
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
          SECTION 6 — CAPITAL CONTRIBUTIONS TRACKER
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
                  <th
                    key={h}
                    className={`px-3 py-2.5 whitespace-nowrap ${
                      ['Partner', 'Company', 'Type', 'Reference', 'Notes'].includes(h) ? 'text-left' : 'text-right'
                    }`}
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredContribs.map(c => (
                <tr key={c.id} className={`hover:bg-gray-50 ${c.amount < 0 ? 'bg-red-50/30' : ''}`}>
                  <td className="px-3 py-2.5 text-left font-medium text-gray-900 whitespace-nowrap">{c.partner}</td>
                  <td className="px-3 py-2.5 text-left text-gray-600 text-xs whitespace-nowrap">{c.company}</td>
                  <td className="px-3 py-2.5 text-right text-gray-600 text-xs">{c.date}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    <span className={c.amount >= 0 ? 'text-green-800 font-semibold' : 'text-red-700 font-semibold'}>
                      {c.amount >= 0 ? '+' : ''}{fmtUSD(c.amount)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-left">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${c.amount < 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-800'}`}>
                      {c.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-left text-xs text-gray-400 font-mono">{c.reference}</td>
                  <td className="px-3 py-2.5 text-left text-xs text-gray-500">{c.notes || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-700">{fmtUSD(c.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredContribs.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No transactions</p>}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 7 — COST BASIS BY PROPERTY NAME
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Cost Basis by Property Name</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Property rollup · Effective yield uses annual net income ÷ market value
            {propertyCapStats.total > 0 && (
              <> · {propertyCapStats.assumed} from sale/cost value, {propertyCapStats.realMv} with book/cost-only value</>
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {['Property Name','Company','Address','Cost Basis','Book Value','Market Value','Eff. Cap Rate','Valuation','Debt','Partners'].map(h => (
                  <th
                    key={h}
                    className={`px-3 py-3 whitespace-nowrap ${
                      ['Property Name', 'Company', 'Address', 'Valuation', 'Partners'].includes(h) ? 'text-left' : 'text-right'
                    }`}
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byProperty.map(prop => (
                <tr key={prop.key} className="hover:bg-gray-50">
                  <td className="px-3 py-3 text-left font-medium text-gray-900">{prop.propertyName}</td>
                  <td className="px-3 py-3 text-left text-gray-600 text-xs">{prop.companyName}</td>
                  <td className="px-3 py-3 text-left text-gray-500 text-xs max-w-[200px] truncate">{prop.address}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{fmtK(prop.costBasis)}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtK(prop.bookValue)}</td>
                  <td className="px-3 py-3 text-right font-mono text-green-800">{fmtK(prop.marketValue)}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">
                    {prop.effectiveCapRate != null ? `${prop.effectiveCapRate.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-3 text-left text-xs">
                    {prop.valuationAssumed ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title="Market value from sale consideration (or cost stack) × ownership %">
                        Sale / cost value
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-800">Imported / book</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{fmtK(prop.debt)}</td>
                  <td className="px-3 py-3 text-left text-xs text-gray-500">{prop.slices.map(s => s.partner).join(', ')}</td>
                </tr>
              ))}
            </tbody>
            {byProperty.length > 0 && (
              <tfoot>
                <tr className="bg-gray-900 text-white font-semibold" style={PT_FONT.tableCell}>
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
