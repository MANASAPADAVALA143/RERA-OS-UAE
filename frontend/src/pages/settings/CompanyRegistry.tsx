import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, X, Check, Search,
  Building2, Home, Landmark, HardHat, ChevronDown, ChevronRight, Upload,
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// ── types ─────────────────────────────────────────────────────────────────────

type ModuleId = 'rental' | 'propdev' | 'reit' | 'construction';

interface Company extends Record<string, unknown> {
  id: string;
  company_name: string;
  status?: string;
}

interface Suite {
  id: string;
  company_id: string;
  property_name: string;
  address: string | null;
  property_type: string | null;
  unit_count: number;
}

interface UnitRow {
  id: string;
  unit_number: string;
  status: string;
  monthly_rent: number;
  rent_history?: Record<string, number>;
  vacancy_loss?: number;
}

interface UnitPreview {
  label: string;
  unit_name: string;
  suite_name?: string;
  action: 'create' | 'skip' | 'update_rent';
  monthly_rent: number;
  status: 'occupied' | 'vacant';
  history: Record<string, number>;
  match_unit_id: string | null;
  match_unit_rent: number | null;
}

interface CompanyPreview {
  excel_name: string;
  display_name: string;
  action: 'create' | 'match';
  match_id: string | null;
  units: UnitPreview[];
  total_units: number;
  occupied: number;
  vacant: number;
  target_month: string;
}

interface PortfolioPreview {
  companies: CompanyPreview[];
  skipped: string[];
  summary: {
    companies_to_create: number;
    companies_to_match: number;
    units_to_create: number;
    units_to_skip: number;
  };
}

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  required?: boolean;
  options?: string[];
}

interface ModuleDef {
  id: ModuleId;
  label: string;
  icon: typeof Building2;
  endpoint: string;
  fields: FieldDef[];
  tableCols: string[];
  rowCells: (c: Company, viewMonth?: string) => (ReactNode | null)[];
  normalise: (raw: unknown) => Company[];
  toPayload: (form: Record<string, string>) => Record<string, unknown>;
}

// ── toast ─────────────────────────────────────────────────────────────────────

interface Toast { id: number; msg: string; ok: boolean }
let _tid = 0;

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, ok = true) => {
    const id = ++_tid;
    setToasts(p => [...p, { id, msg, ok }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  return { toasts, push };
}

// ── modal ─────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ── module definitions ────────────────────────────────────────────────────────

const MODULES: ModuleDef[] = [
  {
    id: 'rental',
    label: 'Rental & Lease',
    icon: Home,
    endpoint: '/api/rentals/companies',
    fields: [
      { name: 'company_name',  label: 'Company Name',  type: 'text',   required: true },
      { name: 'property_type', label: 'Property Type', type: 'select',
        options: ['Apartment Complex', 'Multifamily Townhome', 'Garden Apartment', 'Single Family Rental', 'Loft Apartment', 'Commercial'] },
      { name: 'total_units',   label: 'Total Units',   type: 'number' },
    ],
    tableCols: ['Company Name', 'Property Type', 'Occupancy', 'Month', 'Collected', 'Status'],
    rowCells: (c, viewMonth = 'Jun-2026') => {
      const mrd = (c.monthly_rent_data ?? {}) as Record<string, number>;
      const syncGross   = grossPotential(c);
      const syncVac     = c.sync_vacancy_loss as number | null;
      const displayColl = collectedForMonth(c, viewMonth);
      const hasMonthData = Boolean(viewMonth && Object.keys(mrd).length > 0 && viewMonth in mrd);
      const { occ, total: occTotal } = occupancyCounts(c);
      const occPct      = occTotal ? Math.round(occ / occTotal * 100) : null;
      const collPct     = syncGross > 0 ? Math.round(displayColl / syncGross * 100) : null;

      const occCell: ReactNode = occTotal > 0 ? (
        <div className="min-w-[110px]">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-sm font-mono font-medium" style={{ color: '#1C1917' }}>
              {occ} / {occTotal}
            </span>
            <span className="text-xs font-medium ml-2"
              style={{ color: occPct != null && occPct >= 85 ? '#059669' : occPct != null && occPct >= 70 ? '#D97706' : '#DC2626' }}>
              {occPct != null ? `${occPct}%` : ''}
            </span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: '#E8E4DC' }}>
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${occPct ?? 0}%`,
                background: occPct != null && occPct >= 85 ? '#059669' : occPct != null && occPct >= 70 ? '#F59E0B' : '#EF4444',
              }} />
          </div>
        </div>
      ) : (c.total_units as number) != null ? (
        <span className="text-gray-400 text-sm">— / {c.total_units}</span>
      ) : '—';

      const syncCell: ReactNode = (
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(99,102,241,0.15)', color: '#92400E' }}>
            {viewMonth}
          </span>
          {c.last_sync_month && c.last_sync_month !== viewMonth && (
            <span className="text-[10px] text-gray-400 block mt-0.5">synced {c.last_sync_month as string}</span>
          )}
        </div>
      );

      const collCell: ReactNode = displayColl != null || hasMonthData ? (
        <div>
          <div className="text-sm font-mono font-medium" style={{ color: '#1C1917' }}>
            ${Math.round(displayColl ?? 0).toLocaleString()}
          </div>
          <div className="text-xs mt-0.5" style={{ color: '#A8A29E' }}>
            {collPct != null ? `${collPct}% collected` : ''}
            {syncVac != null && syncVac > 0 ? ` · $${Math.round(syncVac).toLocaleString()} vac loss` : ''}
          </div>
        </div>
      ) : <span className="text-gray-400 text-sm">—</span>;

      return [c.company_name, (c.property_type as string) || '—', occCell, syncCell, collCell, null];
    },
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string, company_name: (r.company_name as string) ?? '',
        property_type: r.property_type as string, total_units: r.total_units,
        occupied_units: r.occupied_units ?? null,
        sync_occupied_units: r.sync_occupied_units ?? null,
        sync_total_units: r.sync_total_units ?? null,
        sync_collected: r.sync_collected ?? null,
        sync_gross_potential: r.sync_gross_potential ?? null,
        sync_vacancy_loss: r.sync_vacancy_loss ?? null,
        last_sync_month: r.last_sync_month ?? null,
        monthly_rent_data: r.monthly_rent_data ?? null,
        status: (r.status as string) ?? 'active',
      }));
    },
    toPayload: (f) => ({ company_name: f.company_name, property_type: f.property_type || undefined, total_units: f.total_units ? Number(f.total_units) : undefined, status: f.status || 'active' }),
  },
  {
    id: 'propdev',
    label: 'Property Dev',
    icon: Building2,
    endpoint: '/api/propdev/companies',
    fields: [
      { name: 'name',          label: 'Company Name',       type: 'text', required: true },
      { name: 'property_name', label: 'Project / Property', type: 'text' },
      { name: 'project_type',  label: 'Project Type',       type: 'select', options: ['Land Development', 'Residential', 'Commercial', 'Mixed Use'] },
      { name: 'total_lots',    label: 'Total Lots',         type: 'number' },
    ],
    tableCols: ['Company Name', 'Project / Property', 'Type', 'Lots', 'Status'],
    rowCells: (c) => [c.company_name, (c.property_name as string) || '—', (c.project_type as string) || '—', (c.total_lots as number) ?? '—', null],
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string, company_name: (r.name as string) ?? '',
        property_name: r.property_name as string, project_type: r.project_type as string,
        total_lots: r.total_lots, status: (r.status as string) ?? 'active', _raw_name: r.name,
      }));
    },
    toPayload: (f) => ({ name: f.name, property_name: f.property_name || '', project_type: f.project_type || undefined, total_lots: f.total_lots ? Number(f.total_lots) : undefined, status: f.status || 'active' }),
  },
  {
    id: 'reit',
    label: 'REIT',
    icon: Landmark,
    endpoint: '/api/reit/companies',
    fields: [
      { name: 'company_name', label: 'Company Name', type: 'text', required: true },
      { name: 'fund_name',    label: 'Fund Name',    type: 'text' },
      { name: 'asset_class',  label: 'Asset Class',  type: 'select', options: ['Multifamily', 'Office', 'Retail', 'Industrial', 'Mixed'] },
      { name: 'aum',          label: 'AUM ($)',      type: 'number' },
    ],
    tableCols: ['Company Name', 'Fund', 'Asset Class', 'AUM', 'Status'],
    rowCells: (c) => [c.company_name, (c.fund_name as string) || '—', (c.asset_class as string) || '—', (c.aum as number) ? `$${Number(c.aum).toLocaleString()}` : '—', null],
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string, company_name: (r.company_name as string) ?? '',
        fund_name: r.fund_name as string, asset_class: r.asset_class as string,
        aum: r.aum, status: (r.status as string) ?? 'active',
      }));
    },
    toPayload: (f) => ({ company_name: f.company_name, fund_name: f.fund_name || undefined, asset_class: f.asset_class || undefined, aum: f.aum ? Number(f.aum) : undefined, status: f.status || 'active' }),
  },
  {
    id: 'construction',
    label: 'Construction',
    icon: HardHat,
    endpoint: '/api/real-estate/construction/companies',
    fields: [
      { name: 'company_name',   label: 'Company Name',      type: 'text', required: true },
      { name: 'project_name',   label: 'Project Name',      type: 'text' },
      { name: 'project_type',   label: 'Project Type',      type: 'select', options: ['Residential', 'Commercial', 'Infrastructure', 'Industrial'] },
      { name: 'contract_value', label: 'Contract Value ($)', type: 'number' },
      { name: 'start_date',     label: 'Start Date',        type: 'date' },
      { name: 'end_date',       label: 'End Date',          type: 'date' },
    ],
    tableCols: ['Company Name', 'Project', 'Type', 'Contract Value', 'End Date', 'Status'],
    rowCells: (c) => [c.company_name, (c.project_name as string) || '—', (c.project_type as string) || '—', (c.contract_value as number) ? `$${Number(c.contract_value).toLocaleString()}` : '—', (c.end_date as string) || '—', null],
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string, company_name: (r.company_name as string) ?? '',
        project_name: r.project_name as string, project_type: r.project_type as string,
        contract_value: r.contract_value, start_date: r.start_date as string,
        end_date: r.end_date as string, status: (r.status as string) ?? 'active',
      }));
    },
    toPayload: (f) => ({ company_name: f.company_name, project_name: f.project_name || undefined, project_type: f.project_type || undefined, contract_value: f.contract_value ? Number(f.contract_value) : undefined, start_date: f.start_date || undefined, end_date: f.end_date || undefined, status: f.status || 'active' }),
  },
];

const SUITE_PROP_TYPES = ['Apartment', 'Townhome', 'SFR', 'Loft', 'Commercial'];

/** Collected for a month — monthly_rent_data (registry rollup) trumps stale sync_collected. */
function collectedForMonth(c: Record<string, unknown>, viewMonth: string): number {
  const mrd = (c.monthly_rent_data ?? {}) as Record<string, number>;
  if (viewMonth && Object.keys(mrd).length > 0 && viewMonth in mrd) {
    return mrd[viewMonth];
  }
  return (c.sync_collected as number) ?? 0;
}

function grossPotential(c: Record<string, unknown>): number {
  const mrd = (c.monthly_rent_data ?? {}) as Record<string, number>;
  const syncGross = c.sync_gross_potential as number | null;
  if (syncGross != null) return syncGross;
  if (Object.keys(mrd).length) return Math.max(...Object.values(mrd));
  return 0;
}

/** Registry unit rows trump Excel physical-unit inflation (combined labels like "Unit A,B,C"). */
function occupancyCounts(c: Record<string, unknown>): { occ: number; total: number } {
  const registryTotal = (c.total_units as number) ?? 0;
  const registryOcc = (c.occupied_units as number) ?? 0;
  if (registryTotal > 0) return { occ: registryOcc, total: registryTotal };
  return {
    occ: (c.sync_occupied_units as number) ?? 0,
    total: (c.sync_total_units as number) ?? 0,
  };
}

function StatusBadge({ status, onClick }: { status: string; onClick: () => void }) {
  const active = !status || status === 'active';
  return (
    <button onClick={onClick}
      className={`text-sm px-3 py-1 rounded-full font-medium transition-colors cursor-pointer
        ${active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
      {active ? 'Active' : 'Inactive'}
    </button>
  );
}

// ── inline suites table (no modals — modals handled by parent) ────────────────

const ALL_MONTHS = [
  'Jan-2026','Feb-2026','Mar-2026','Apr-2026','May-2026','Jun-2026',
  'Jul-2026','Aug-2026','Sep-2026','Oct-2026','Nov-2026','Dec-2026',
];

function unitRentForMonth(u: UnitRow, month: string): { rent: number; vacancyLoss: number; hasMonth: boolean } {
  const h = u.rent_history;
  if (!h || !month) {
    return { rent: u.monthly_rent ?? 0, vacancyLoss: u.vacancy_loss ?? 0, hasMonth: false };
  }
  if (!(month in h)) {
    return { rent: 0, vacancyLoss: 0, hasMonth: false };
  }
  const rent = h[month] ?? 0;

  let vacancyLoss = 0;
  if (rent <= 0) {
    if (u.vacancy_loss != null && u.vacancy_loss > 0) {
      vacancyLoss = u.vacancy_loss;
    } else {
      const idx = ALL_MONTHS.indexOf(month);
      const prevMonths = idx >= 0 ? ALL_MONTHS.slice(0, idx) : ALL_MONTHS;
      const lookback = prevMonths.slice().reverse()
        .map(m => h[m] ?? 0).filter(v => v > 0).slice(0, 3);
      if (lookback.length) {
        vacancyLoss = Math.round(lookback.reduce((a, b) => a + b, 0) / lookback.length);
      }
    }
  }

  return { rent, vacancyLoss, hasMonth: true };
}

/** Status + rent for a specific month — does not bleed across months. */
function unitDisplayForMonth(u: UnitRow, month: string): { status: string; rent: number; vacancyLoss: number } {
  const { rent, vacancyLoss, hasMonth } = unitRentForMonth(u, month);
  if (hasMonth) {
    return { status: rent > 0 ? 'occupied' : 'vacant', rent, vacancyLoss };
  }
  return { status: u.status, rent: u.monthly_rent ?? 0, vacancyLoss: u.vacancy_loss ?? 0 };
}
function InlineSuites({
  companyId, companyName, canWrite, push, totalCols,
  onAdd, onEdit, onDelete, reloadKey, viewMonth,
}: {
  companyId: string;
  companyName: string;
  canWrite: boolean;
  push: (msg: string, ok?: boolean) => void;
  totalCols: number;
  onAdd: (companyId: string, companyName: string) => void;
  onEdit: (suite: Suite) => void;
  onDelete: (suite: Suite) => void;
  reloadKey: number;
  viewMonth: string;
}) {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // unit expand + rename state
  const [expandedUnitsId, setExpandedUnitsId] = useState<string | null>(null);
  const [unitsMap, setUnitsMap] = useState<Record<string, UnitRow[]>>({});
  const [unitEditId, setUnitEditId] = useState<string | null>(null);
  const [unitEditVal, setUnitEditVal] = useState('');
  const [unitEditStatus, setUnitEditStatus] = useState('');
  const [unitEditRent, setUnitEditRent] = useState('');
  const [unitEditVacLoss, setUnitEditVacLoss] = useState('');
  const [unitSaving, setUnitSaving] = useState(false);

  // add unit inline form state
  const [addingUnitSuiteId, setAddingUnitSuiteId] = useState<string | null>(null);
  const [newUnitNum, setNewUnitNum] = useState('');
  const [newUnitStatus, setNewUnitStatus] = useState('vacant');
  const [newUnitRent, setNewUnitRent] = useState('');
  const [unitAdding, setUnitAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Suite[]>(`/api/rentals/suites?company_id=${companyId}`);
      setSuites(Array.isArray(res.data) ? res.data : []);
    } catch {
      push('Failed to load suites', false);
    } finally {
      setLoading(false);
    }
  }, [companyId, push]);

  useEffect(() => { load(); }, [load, reloadKey]);

  async function handleRename(id: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    try {
      await api.put(`/api/rentals/suites/${id}`, { property_name: editName.trim() });
      setEditingId(null);
      push('Property Name updated');
      load();
    } catch {
      push('Failed to update Property Name', false);
    }
  }

  async function loadSuiteUnits(suiteId: string) {
    try {
      const res = await api.get<UnitRow[]>(`/api/rentals/units?property_id=${suiteId}`);
      setUnitsMap(prev => ({ ...prev, [suiteId]: Array.isArray(res.data) ? res.data : [] }));
    } catch {
      push('Failed to load units', false);
    }
  }

  function toggleUnits(suiteId: string) {
    if (expandedUnitsId === suiteId) {
      setExpandedUnitsId(null);
    } else {
      setExpandedUnitsId(suiteId);
      loadSuiteUnits(suiteId);
    }
  }

  async function saveUnit(unitId: string, suiteId: string) {
    if (!unitEditVal.trim()) { setUnitEditId(null); return; }
    setUnitSaving(true);
    try {
      await api.put(`/api/rentals/units/${unitId}`, {
        unit_number: unitEditVal.trim(),
        status: unitEditStatus,
        monthly_rent: parseFloat(unitEditRent) || 0,
        vacancy_loss: parseFloat(unitEditVacLoss) || 0,
      });
      setUnitEditId(null);
      push('Unit updated');
      await loadSuiteUnits(suiteId);
    } catch {
      push('Failed to update unit', false);
    } finally {
      setUnitSaving(false);
    }
  }

  async function deleteUnit(unitId: string, suiteId: string) {
    if (!window.confirm('Delete this unit? This cannot be undone.')) return;
    try {
      await api.delete(`/api/rentals/units/${unitId}`);
      push('Unit deleted');
      await loadSuiteUnits(suiteId);
      await load();
    } catch {
      push('Failed to delete unit', false);
    }
  }

  async function addUnit(suite: Suite) {
    if (!newUnitNum.trim()) return;
    setUnitAdding(true);
    try {
      await api.post('/api/rentals/units', {
        property_id: suite.id,
        company_id: suite.company_id,
        unit_number: newUnitNum.trim(),
        status: newUnitStatus,
        monthly_rent: parseFloat(newUnitRent) || 0,
      });
      setNewUnitNum(''); setNewUnitRent(''); setNewUnitStatus('vacant');
      setAddingUnitSuiteId(null);
      push('Unit added');
      await loadSuiteUnits(suite.id);
      await load();
    } catch {
      push('Failed to add unit', false);
    } finally {
      setUnitAdding(false);
    }
  }

  const suiteCols = canWrite ? 6 : 5;

  return (
    <tr>
      <td colSpan={totalCols} className="px-0 py-0 border-b border-blue-100">
        <div className="bg-blue-50/50 px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full" style={{ background: '#6366F1' }} />
              <span className="text-sm font-semibold text-gray-700">
                Property Name — <span className="font-normal text-gray-500">{companyName}</span>
              </span>
              {!loading && (
                <span className="text-xs text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                  {suites.length} Property Name{suites.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {canWrite && (
              <button onClick={() => onAdd(companyId, companyName)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                style={{ background: '#1E1B4B', color: '#6366F1' }}>
                <Plus size={12} /> Add Property Name
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : suites.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-400">
              No properties yet.{canWrite && <> Click <span className="font-medium text-gray-600">Add Property Name</span> to create one.</>}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-blue-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Property Name</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Address</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Property Type</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Units</th>
                    {canWrite && <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {suites.map((s, i) => (
                    <Fragment key={s.id}>
                      <tr className={`hover:bg-blue-50/30 transition-colors${expandedUnitsId === s.id ? ' bg-blue-50/40' : ''}`}>
                        <td className="px-4 py-2.5 text-xs text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">
                          {editingId === s.id ? (
                            <div className="flex items-center gap-1">
                              <input autoFocus value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleRename(s.id); if (e.key === 'Escape') setEditingId(null); }}
                                className="text-sm border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[140px]" />
                              <button onClick={() => handleRename(s.id)} className="text-blue-600 hover:text-blue-800"><Check size={12} /></button>
                              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>
                            </div>
                          ) : (
                            <span className="cursor-pointer hover:text-blue-600 transition-colors" title="Double-click to rename"
                              onDoubleClick={() => { setEditingId(s.id); setEditName(s.property_name); }}>
                              {s.property_name}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">{s.address || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-500">{s.property_type || '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => toggleUnits(s.id)}
                            className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded transition-colors"
                            style={{ color: '#6366F1' }}
                            title="Click to show/hide units"
                          >
                            {s.unit_count}
                            {expandedUnitsId === s.id
                              ? <ChevronDown size={11} />
                              : <ChevronRight size={11} />}
                          </button>
                        </td>
                        {canWrite && (
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => onEdit(s)}
                                className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Edit">
                                <Pencil size={12} />
                              </button>
                              <button onClick={() => onDelete(s)}
                                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>

                      {expandedUnitsId === s.id && (
                        <tr>
                          <td colSpan={suiteCols} className="px-0 py-0 border-t border-indigo-100">
                            <div className="bg-indigo-50/30 px-6 py-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <div className="w-0.5 h-4 rounded-full" style={{ background: '#4F46E5' }} />
                                  <span className="text-xs font-semibold text-gray-600">
                                    Units — {s.property_name}
                                  </span>
                                  {viewMonth && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                                      {viewMonth}
                                    </span>
                                  )}
                                  {unitsMap[s.id] && (() => {
                                    const occ = unitsMap[s.id].filter(u => unitDisplayForMonth(u, viewMonth).status === 'occupied').length;
                                    const vac = unitsMap[s.id].filter(u => unitDisplayForMonth(u, viewMonth).status === 'vacant').length;
                                    const tot = unitsMap[s.id].length;
                                    return (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(5,150,105,0.12)', color: '#059669' }}>
                                          {occ} occ
                                        </span>
                                        {vac > 0 && (
                                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(239,68,68,0.10)', color: '#DC2626' }}>
                                            {vac} vacant
                                          </span>
                                        )}
                                        {tot - occ - vac > 0 && (
                                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(99,102,241,0.12)', color: '#92400E' }}>
                                            {tot - occ - vac} other
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                                {canWrite && (
                                  <button
                                    onClick={() => { setAddingUnitSuiteId(s.id); setNewUnitNum(''); setNewUnitRent(''); setNewUnitStatus('vacant'); }}
                                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors"
                                    style={{ background: '#6366F1', color: '#1E1B4B' }}>
                                    <Plus size={10} /> Add Unit
                                  </button>
                                )}
                              </div>
                              {!unitsMap[s.id] ? (
                                <div className="flex items-center gap-2 py-3">
                                  <div className="w-4 h-4 border-2 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: '#6366F1' }} />
                                  <span className="text-xs text-gray-400">Loading units…</span>
                                </div>
                              ) : unitsMap[s.id].length === 0 && addingUnitSuiteId !== s.id ? (
                                <p className="text-xs text-gray-400 py-2">No units found for this property. Click <span className="font-medium" style={{ color: '#6366F1' }}>+ Add Unit</span> to create one.</p>
                              ) : (
                                <div className="bg-white rounded-lg border border-indigo-100 overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-gray-50/80 border-b border-gray-100">
                                        <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide w-6">#</th>
                                        <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Unit Name</th>
                                        <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                                        <th className="text-right px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Rent / mo</th>
                                        <th className="text-right px-3 py-1.5 text-xs font-semibold text-orange-400 uppercase tracking-wide">Vacancy Loss</th>
                                        {canWrite && <th className="text-center px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</th>}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {unitsMap[s.id].map((u, j) => {
                                        const { status: dispStatus, rent: dispRent, vacancyLoss } = unitDisplayForMonth(u, viewMonth);
                                        return (
                                        <tr key={u.id}
                                          className="hover:bg-indigo-50/20"
                                          style={dispStatus === 'vacant' ? { background: 'rgba(239,68,68,0.04)' } : {}}>
                                          <td className="px-3 py-1.5 text-gray-400">{j + 1}</td>
                                          <td className="px-3 py-1.5 font-medium text-gray-800">
                                            {unitEditId === u.id ? (
                                              <input
                                                autoFocus
                                                value={unitEditVal}
                                                onChange={e => setUnitEditVal(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Escape') setUnitEditId(null); }}
                                                disabled={unitSaving}
                                                className="text-xs border border-indigo-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full min-w-[90px]"
                                              />
                                            ) : (
                                              u.unit_number
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5">
                                            {unitEditId === u.id ? (
                                              <select
                                                value={unitEditStatus}
                                                onChange={e => setUnitEditStatus(e.target.value)}
                                                disabled={unitSaving}
                                                className="text-xs border border-indigo-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                              >
                                                <option value="occupied">occupied</option>
                                                <option value="vacant">vacant</option>
                                                <option value="notice">notice</option>
                                                <option value="reserved">reserved</option>
                                                <option value="maintenance_hold">maintenance_hold</option>
                                              </select>
                                            ) : (
                                              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                                dispStatus === 'occupied'
                                                  ? 'bg-green-100 text-green-700'
                                                  : dispStatus === 'notice'
                                                  ? 'bg-yellow-100 text-yellow-700'
                                                  : dispStatus === 'reserved'
                                                  ? 'bg-blue-100 text-blue-700'
                                                  : dispStatus === 'maintenance_hold'
                                                  ? 'bg-orange-100 text-orange-700'
                                                  : 'bg-gray-100 text-gray-500'
                                              }`}>
                                                {dispStatus}
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5 text-right font-mono text-gray-700">
                                            {unitEditId === u.id ? (
                                              <input
                                                type="number"
                                                value={unitEditRent}
                                                onChange={e => setUnitEditRent(e.target.value)}
                                                disabled={unitSaving}
                                                className="text-xs border border-indigo-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-24 text-right"
                                              />
                                            ) : (
                                              dispRent > 0
                                                ? `$${dispRent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                                : '—'
                                            )}
                                          </td>
                                          <td className="px-3 py-1.5 text-right font-mono">
                                            {unitEditId === u.id ? (
                                              <input
                                                type="number"
                                                value={unitEditVacLoss}
                                                onChange={e => setUnitEditVacLoss(e.target.value)}
                                                disabled={unitSaving}
                                                placeholder="0"
                                                className="text-xs border border-orange-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400 w-24 text-right"
                                              />
                                            ) : (
                                              vacancyLoss > 0
                                                ? <span className="text-orange-500">${vacancyLoss.toLocaleString()}</span>
                                                : <span className="text-gray-300">—</span>
                                            )}
                                          </td>
                                          {canWrite && (
                                            <td className="px-3 py-1.5 text-center">
                                              {unitEditId === u.id ? (
                                                <div className="flex items-center justify-center gap-1">
                                                  <button onClick={() => saveUnit(u.id, s.id)} disabled={unitSaving}
                                                    className="text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
                                                    <Check size={11} />
                                                  </button>
                                                  <button onClick={() => setUnitEditId(null)} disabled={unitSaving}
                                                    className="text-gray-400 hover:text-gray-600">
                                                    <X size={11} />
                                                  </button>
                                                </div>
                                              ) : (
                                                <div className="flex items-center justify-center gap-1">
                                                  <button
                                                    onClick={() => {
                                                      const d = unitDisplayForMonth(u, viewMonth);
                                                      setUnitEditId(u.id);
                                                      setUnitEditVal(u.unit_number);
                                                      setUnitEditStatus(d.status);
                                                      setUnitEditRent(String(d.rent > 0 ? d.rent : ''));
                                                      setUnitEditVacLoss(String(d.vacancyLoss || 0));
                                                    }}
                                                    className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                                    title="Edit unit"
                                                  >
                                                    <Pencil size={11} />
                                                  </button>
                                                  <button
                                                    onClick={() => deleteUnit(u.id, s.id)}
                                                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                                    title="Delete unit"
                                                  >
                                                    <Trash2 size={11} />
                                                  </button>
                                                </div>
                                              )}
                                            </td>
                                          )}
                                        </tr>
                                        );
                                      })}
                                      {addingUnitSuiteId === s.id && (
                                        <tr className="bg-indigo-50/40 border-t border-indigo-200">
                                          <td className="px-3 py-2 text-gray-400 text-xs">—</td>
                                          <td className="px-3 py-2">
                                            <input
                                              autoFocus
                                              value={newUnitNum}
                                              onChange={e => setNewUnitNum(e.target.value)}
                                              onKeyDown={e => { if (e.key === 'Enter') addUnit(s); if (e.key === 'Escape') setAddingUnitSuiteId(null); }}
                                              placeholder="Unit 101"
                                              className="text-xs border border-indigo-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full min-w-[80px]"
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <select value={newUnitStatus} onChange={e => setNewUnitStatus(e.target.value)}
                                              className="text-xs border border-indigo-300 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                                              <option value="vacant">vacant</option>
                                              <option value="occupied">occupied</option>
                                              <option value="notice">notice</option>
                                              <option value="reserved">reserved</option>
                                              <option value="maintenance_hold">maintenance_hold</option>
                                            </select>
                                          </td>
                                          <td className="px-3 py-2 text-right">
                                            <input
                                              type="number"
                                              value={newUnitRent}
                                              onChange={e => setNewUnitRent(e.target.value)}
                                              placeholder="1200"
                                              className="text-xs border border-indigo-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-24 text-right"
                                            />
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                              <button onClick={() => addUnit(s)} disabled={unitAdding || !newUnitNum.trim()}
                                                className="text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
                                                <Check size={12} />
                                              </button>
                                              <button onClick={() => setAddingUnitSuiteId(null)}
                                                className="text-gray-400 hover:text-gray-600">
                                                <X size={12} />
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

interface Props { embedded?: boolean }

export default function CompanyRegistry({ embedded = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { canWrite } = useAuth();
  const { toasts, push } = useToast();
  const _ref = useRef<null>(null); void _ref;
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<'idle' | 'parsing' | 'review' | 'confirming'>('idle');
  const [importPreview, setImportPreview] = useState<PortfolioPreview | null>(null);
  const [expandedPreviewCo, setExpandedPreviewCo] = useState<string | null>(null);
  const [forceReplace, setForceReplace] = useState(false);
  const [importMonth, setImportMonth] = useState('Jun-2026');
  const IMPORT_MONTHS = [
    'Jan-2026','Feb-2026','Mar-2026','Apr-2026','May-2026','Jun-2026',
    'Jul-2026','Aug-2026','Sep-2026','Oct-2026','Nov-2026','Dec-2026',
  ];

  const initTab = (searchParams.get('tab') as ModuleId | null) ?? 'rental';
  const [activeId, setActiveId] = useState<ModuleId>(
    MODULES.some(m => m.id === initTab) ? initTab : 'rental'
  );

  // Company list state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedSuiteId, setExpandedSuiteId] = useState<string | null>(null);

  // Company modal state
  const [modal, setModal] = useState<'add' | 'edit' | 'delete' | null>(null);
  const [target, setTarget] = useState<Company | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Suite modal state — lifted here so modals render at page level (proper focus, clipboard)
  const [suiteModal, setSuiteModal] = useState<'add' | 'edit' | 'delete' | null>(null);
  const [suiteTarget, setSuiteTarget] = useState<Suite | null>(null);
  const [suiteCompany, setSuiteCompany] = useState<{ id: string; name: string } | null>(null);
  const [suiteName, setSuiteName] = useState('');
  const [suiteAddress, setSuiteAddress] = useState('');
  const [suitePropType, setSuitePropType] = useState('');
  const [suiteSaving, setSuiteSaving] = useState(false);
  const [suiteDeleting, setSuiteDeleting] = useState(false);
  const [suiteReloadKey, setSuiteReloadKey] = useState(0);

  const mod = MODULES.find(m => m.id === activeId)!;

  const load = useCallback(async () => {
    setLoading(true);
    setCompanies([]);
    setExpandedSuiteId(null);
    try {
      const res = await api.get(mod.endpoint);
      setCompanies(mod.normalise(res.data));
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { detail?: string } }; message?: string };
      const detail = ax.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : ax.message || 'Unknown error';
      push(`Failed to load ${mod.label} companies: ${msg}`, false);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, [mod, push]);

  useEffect(() => { load(); }, [load]);

  function triggerFileInput() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting same file
    setImportState('parsing');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('target_month', importMonth);
      const res = await api.post<PortfolioPreview>('/api/rentals/import-portfolio/preview', formData);
      setImportPreview(res.data);
      setExpandedPreviewCo(res.data.companies[0]?.excel_name ?? null);
      setImportState('review');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push(msg ?? 'Failed to parse file — check format', false);
      setImportState('idle');
    }
  }

  async function handleConfirmImport() {
    if (!importPreview) return;
    setImportState('confirming');
    try {
      const res = await api.post<{ message: string }>('/api/rentals/import-portfolio/confirm', {
        companies: importPreview.companies,
        force_replace: forceReplace,
        target_month: importMonth,
      });
      push(res.data.message ?? 'Portfolio imported!', true);
      setImportState('idle');
      setImportPreview(null);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push(msg ?? 'Import failed', false);
      setImportState('idle');
    }
  }

  function switchTab(id: ModuleId) {
    setActiveId(id);
    setSearch('');
    setExpandedSuiteId(null);
    setSearchParams({ tab: id }, { replace: true });
  }

  // ── company form ────────────────────────────────────────────────────────────

  function initForm(co?: Company) {
    if (!co) {
      const blank: Record<string, string> = { status: 'active' };
      mod.fields.forEach(f => { blank[f.name] = ''; });
      setForm(blank);
    } else {
      const filled: Record<string, string> = {};
      mod.fields.forEach(f => { const v = co[f.name]; filled[f.name] = v != null ? String(v) : ''; });
      filled.status = (co.status as string) ?? 'active';
      if (activeId === 'propdev') filled.name = (co.company_name as string) ?? '';
      setForm(filled);
    }
    setErrors({});
  }

  function openAdd() { initForm(); setTarget(null); setModal('add'); }
  function openEdit(c: Company) { initForm(c); setTarget(c); setModal('edit'); }
  function openDelete(c: Company) { setTarget(c); setModal('delete'); }
  function close() { setModal(null); setTarget(null); setSaving(false); }

  function validate() {
    const errs: Record<string, string> = {};
    mod.fields.filter(f => f.required).forEach(f => { if (!form[f.name]?.trim()) errs[f.name] = `${f.label} is required`; });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const isEdit = modal === 'edit' && !!target;
    const url = isEdit ? `${mod.endpoint}/${target!.id}` : mod.endpoint;
    const method = isEdit ? 'put' : 'post';
    try {
      await api[method](url, mod.toPayload(form));
      push(isEdit ? 'Company updated' : 'Company added');
      close(); load();
    } catch {
      push('Failed to save company', false);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!target) return;
    try {
      await api.delete(`${mod.endpoint}/${target.id}`);
      push('Company deleted');
      close(); load();
    } catch {
      push('Failed to delete company', false);
      close();
    }
  }

  async function toggleStatus(c: Company) {
    const newStatus = c.status === 'inactive' ? 'active' : 'inactive';
    try {
      await api.patch(`${mod.endpoint}/${c.id}/status`, { status: newStatus });
      setCompanies(prev => prev.map(x => x.id === c.id ? { ...x, status: newStatus } : x));
    } catch {
      push('Failed to update status', false);
    }
  }

  // ── suite handlers (run at page level, not inside tbody) ────────────────────

  function openSuiteAdd(companyId: string, companyName: string) {
    setSuiteCompany({ id: companyId, name: companyName });
    setSuiteTarget(null);
    setSuiteName('');
    setSuiteAddress('');
    setSuitePropType('');
    setSuiteModal('add');
  }

  function openSuiteEdit(suite: Suite) {
    const co = companies.find(c => c.id === suite.company_id);
    setSuiteCompany({ id: suite.company_id, name: co?.company_name ?? '' });
    setSuiteTarget(suite);
    setSuiteName(suite.property_name);
    setSuiteAddress(suite.address ?? '');
    setSuitePropType(suite.property_type ?? '');
    setSuiteModal('edit');
  }

  function openSuiteDelete(suite: Suite) {
    setSuiteTarget(suite);
    setSuiteModal('delete');
  }

  function closeSuiteModal() {
    setSuiteModal(null);
    setSuiteTarget(null);
    setSuiteCompany(null);
    setSuiteSaving(false);
    setSuiteDeleting(false);
  }

  async function handleSuiteSave() {
    if (!suiteName.trim()) return;
    setSuiteSaving(true);
    const payload: Record<string, unknown> = {
      property_name: suiteName.trim(),
      address: suiteAddress.trim() || null,
      property_type: suitePropType || null,
    };
    try {
      if (suiteTarget) {
        await api.put(`/api/rentals/suites/${suiteTarget.id}`, payload);
        push('Property Name updated');
      } else {
        payload.company_id = suiteCompany!.id;
        await api.post('/api/rentals/suites', payload);
        push('Property Name added');
      }
      closeSuiteModal();
      setSuiteReloadKey(k => k + 1);
    } catch {
      push('Failed to save Property Name', false);
      setSuiteSaving(false);
    }
  }

  async function handleSuiteDelete() {
    if (!suiteTarget) return;
    setSuiteDeleting(true);
    try {
      await api.delete(`/api/rentals/suites/${suiteTarget.id}`);
      push('Property Name deleted');
      closeSuiteModal();
      setSuiteReloadKey(k => k + 1);
    } catch {
      push('Failed to delete Property Name', false);
      setSuiteDeleting(false);
    }
  }

  // ── filtered list ───────────────────────────────────────────────────────────

  const filtered = companies.filter(c => {
    const q = search.toLowerCase();
    return (c.company_name ?? '').toLowerCase().includes(q)
      || Object.values(c).some(v => typeof v === 'string' && v.toLowerCase().includes(q));
  });

  const totalCols = 1 + mod.tableCols.length + (activeId === 'rental' ? 1 : 0) + (canWrite ? 1 : 0);

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-3xl font-bold text-charcoal">Company Registry</h1>
          <p className="text-base text-gray-500 mt-1">Add, edit, and manage companies across all modules.</p>
        </div>
      )}

      {/* Module tabs */}
      <div className="flex gap-1 bg-white border border-gray-100 shadow-sm rounded-xl p-1 w-fit">
        {MODULES.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => switchTab(id)}
            className={`flex items-center gap-1.5 text-base px-4 py-2.5 rounded-lg font-medium transition-all
              ${activeId === id ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Rental sync banner */}
      {activeId === 'rental' && companies.length > 0 && (() => {
        const totalOcc  = companies.reduce((a, c) => a + occupancyCounts(c).occ, 0);
        const totalUnits = companies.reduce((a, c) => a + occupancyCounts(c).total, 0);
        const totalColl  = companies.reduce((a, c) => a + collectedForMonth(c, importMonth), 0);
        const totalGross = companies.reduce((a, c) => a + grossPotential(c), 0);
        const collPct = totalGross > 0 ? Math.round(totalColl / totalGross * 100) : 0;
        const syncedCount = companies.filter(c => c.last_sync_month || c.monthly_rent_data).length;
        return (
          <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
            style={{ background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.30)' }}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#92400E' }}>Live Sync</span>
              <span className="text-sm font-semibold" style={{ color: '#1C1917' }}>{importMonth}</span>
              <span className="text-sm" style={{ color: '#78716C' }}>·</span>
              <span className="text-sm" style={{ color: '#1C1917' }}>{totalOcc}/{totalUnits} occupied</span>
              <span className="text-sm" style={{ color: '#78716C' }}>·</span>
              <span className="text-sm font-medium" style={{ color: '#059669' }}>${Math.round(totalColl).toLocaleString()} collected</span>
              <span className="text-sm" style={{ color: '#78716C' }}>·</span>
              <span className="text-sm font-medium" style={{ color: collPct >= 95 ? '#059669' : '#D97706' }}>{collPct}% collection rate</span>
            </div>
            <span className="text-[10px]" style={{ color: '#A8A29E' }}>{syncedCount} companies</span>
          </div>
        );
      })()}

      {/* Search + Add */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${mod.label}…`}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{filtered.length} companies</span>
          {canWrite && activeId === 'rental' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileSelected}
              />
              <select
                value={importMonth}
                onChange={e => setImportMonth(e.target.value)}
                disabled={importState !== 'idle'}
                title="View month for unit rent/status and Excel import target"
                className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60">
                {IMPORT_MONTHS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button
                onClick={async () => {
                  if (!window.confirm('Delete ALL companies and their units? This cannot be undone.')) return;
                  try {
                    await api.delete('/api/rentals/companies');
                    push('All companies cleared — now upload your Excel to reimport.', true);
                    load();
                  } catch {
                    push('Failed to clear companies', false);
                  }
                }}
                disabled={importState !== 'idle'}
                title="Delete all companies and units, then reimport from Excel"
                className="flex items-center gap-2 border border-rose-300 text-rose-600 text-sm px-4 py-2 rounded-xl hover:bg-rose-50 font-medium transition-colors disabled:opacity-60">
                Clear Registry
              </button>
              <button
                onClick={triggerFileInput}
                disabled={importState !== 'idle'}
                title="Upload Rent Receivable Excel to auto-create companies and units"
                className="flex items-center gap-2 bg-emerald-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-emerald-700 font-medium transition-colors disabled:opacity-60">
                <Upload size={14} />
                {importState === 'parsing' ? 'Parsing…' : importState === 'confirming' ? 'Importing…' : 'Load Portfolio'}
              </button>
            </>
          )}
          {canWrite && (
            <button onClick={openAdd}
              className="flex items-center gap-2 bg-gray-900 text-white text-sm px-4 py-2 rounded-xl hover:bg-gray-800 font-medium transition-colors">
              <Plus size={14} /> Add Company
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Building2 size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">
              {search ? 'No companies match your search' : `No ${mod.label} companies yet`}
            </p>
            {!search && canWrite && (
              <button onClick={openAdd}
                className="mt-4 text-sm bg-gray-900 text-white px-4 py-2 rounded-xl hover:bg-gray-800">+ Add Company</button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
                  {mod.tableCols.map(col => (
                    <th key={col} className="text-left px-4 py-3 text-sm font-semibold text-gray-400 uppercase tracking-wide">{col}</th>
                  ))}
                  {activeId === 'rental' && (
                    <th className="text-left px-4 py-3 text-sm font-semibold text-gray-400 uppercase tracking-wide">Property Name</th>
                  )}
                  {canWrite && (
                    <th className="text-right px-4 py-3 text-sm font-semibold text-gray-400 uppercase tracking-wide">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => {
                  const cells = mod.rowCells(c, activeId === 'rental' ? importMonth : undefined);
                  const isExpanded = expandedSuiteId === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr className={`border-b border-gray-50 transition-colors ${isExpanded ? 'bg-blue-50/30' : 'hover:bg-gray-50/60'}`} style={isExpanded ? { background: 'rgba(99,102,241,0.05)' } : {}}>
                        <td className="px-4 py-3 text-sm text-gray-400">{idx + 1}</td>
                        {cells.map((cell, ci) => (
                          <td key={ci} className={`px-4 py-3 ${ci === 0 ? 'text-base font-semibold text-gray-900' : 'text-sm text-gray-600'}`}>
                            {cell === null
                              ? <StatusBadge status={c.status ?? 'active'} onClick={() => canWrite && toggleStatus(c)} />
                              : cell}
                          </td>
                        ))}
                        {activeId === 'rental' && (
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setExpandedSuiteId(isExpanded ? null : c.id)}
                              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors"
                              style={isExpanded
                                ? { background: '#6366F1', color: '#1E1B4B', borderColor: '#6366F1' }
                                : { color: '#6366F1', borderColor: 'rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.08)' }}>
                              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Property Name
                            </button>
                          </td>
                        )}
                        {canWrite && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit(c)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors" title="Edit">
                                <Pencil size={13} />
                              </button>
                              <button onClick={() => openDelete(c)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {activeId === 'rental' && isExpanded && (
                        <InlineSuites
                          key={`${c.id}-${importMonth}`}
                          companyId={c.id}
                          companyName={c.company_name}
                          canWrite={canWrite}
                          push={push}
                          totalCols={totalCols}
                          onAdd={openSuiteAdd}
                          onEdit={openSuiteEdit}
                          onDelete={openSuiteDelete}
                          reloadKey={suiteReloadKey}
                          viewMonth={importMonth}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── COMPANY ADD / EDIT MODAL ── */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'add' ? `Add ${mod.label} Company` : 'Edit Company'} onClose={close}>
          <div className="space-y-3">
            {mod.fields.map(f => (
              <div key={f.name}>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {f.type === 'select' ? (
                  <select value={form[f.name] ?? ''} onChange={e => { setForm(p => ({ ...p, [f.name]: e.target.value })); setErrors(p => ({ ...p, [f.name]: '' })); }}
                    className={`w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white ${errors[f.name] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                    <option value="">Select…</option>
                    {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type} value={form[f.name] ?? ''} onChange={e => { setForm(p => ({ ...p, [f.name]: e.target.value })); setErrors(p => ({ ...p, [f.name]: '' })); }}
                    placeholder={`Enter ${f.label.toLowerCase()}`}
                    className={`w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 ${errors[f.name] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                )}
                {errors[f.name] && <p className="text-xs text-red-500 mt-0.5">{errors[f.name]}</p>}
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <div className="flex gap-2">
                {['active', 'inactive'].map(s => (
                  <button key={s} type="button" onClick={() => setForm(p => ({ ...p, status: s }))}
                    className={`flex-1 text-xs py-2 rounded-xl border font-medium capitalize transition-colors
                      ${(form.status ?? 'active') === s
                        ? s === 'active' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-700 text-white border-gray-700'
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={close} className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 text-sm bg-gray-900 text-white py-2.5 rounded-xl hover:bg-gray-800 font-medium disabled:opacity-50">
              {saving ? 'Saving…' : <><Check size={14} />{modal === 'add' ? 'Add Company' : 'Save Changes'}</>}
            </button>
          </div>
        </Modal>
      )}

      {/* ── COMPANY DELETE CONFIRM ── */}
      {modal === 'delete' && target && (
        <Modal title="Delete Company" onClose={close}>
          <div className="text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 size={20} className="text-red-500" />
            </div>
            <p className="text-sm text-gray-600 mb-1">Delete <span className="font-semibold text-gray-800">"{target.company_name}"</span>?</p>
            <p className="text-xs text-red-500 mb-5 leading-relaxed">This will permanently delete this company and all its data.</p>
            <div className="flex gap-3">
              <button onClick={close} className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete} className="flex-1 text-sm bg-red-600 text-white py-2.5 rounded-xl hover:bg-red-700 font-medium">Yes, Delete</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── SUITE ADD / EDIT MODAL ── rendered at page level for proper focus & clipboard */}
      {(suiteModal === 'add' || suiteModal === 'edit') && (
        <Modal title={suiteTarget ? `Edit Property Name` : `Add Property Name — ${suiteCompany?.name}`} onClose={closeSuiteModal}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Property Name <span className="text-red-500">*</span></label>
              <input
                autoFocus
                type="text"
                value={suiteName}
                onChange={e => setSuiteName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && suiteName.trim()) handleSuiteSave(); }}
                placeholder="e.g. Property Name"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                value={suiteAddress}
                onChange={e => setSuiteAddress(e.target.value)}
                placeholder="e.g. 123 Main St"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Property Type</label>
              <select value={suitePropType} onChange={e => setSuitePropType(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">Select…</option>
                {SUITE_PROP_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={closeSuiteModal} className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
            <button onClick={handleSuiteSave} disabled={suiteSaving || !suiteName.trim()}
              className="flex-1 flex items-center justify-center gap-2 text-sm bg-gray-900 text-white py-2.5 rounded-xl hover:bg-gray-800 font-medium disabled:opacity-50">
              {suiteSaving ? 'Saving…' : <><Check size={14} />{suiteTarget ? 'Save Changes' : 'Add Property Name'}</>}
            </button>
          </div>
        </Modal>
      )}

      {/* ── SUITE DELETE CONFIRM ── */}
      {suiteModal === 'delete' && suiteTarget && (
        <Modal title="Delete Property Name" onClose={closeSuiteModal}>
          <div className="text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 size={20} className="text-red-500" />
            </div>
            <p className="text-sm text-gray-700 font-medium mb-1">Delete "{suiteTarget.property_name}"?</p>
            {suiteTarget.unit_count > 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-left">
                This property has <strong>{suiteTarget.unit_count} unit{suiteTarget.unit_count !== 1 ? 's' : ''}</strong> with
                all their leases, invoices, and payment records — all will be permanently deleted.
              </p>
            ) : (
              <p className="text-xs text-red-500 mb-4">This cannot be undone.</p>
            )}
            <div className="flex gap-3">
              <button onClick={closeSuiteModal} disabled={suiteDeleting}
                className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button onClick={handleSuiteDelete} disabled={suiteDeleting}
                className="flex-1 flex items-center justify-center gap-2 text-sm bg-red-600 text-white py-2.5 rounded-xl hover:bg-red-700 font-medium disabled:opacity-50">
                {suiteDeleting ? 'Deleting…' : suiteTarget.unit_count > 0 ? `Delete + ${suiteTarget.unit_count} Units` : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── PORTFOLIO IMPORT REVIEW MODAL ─────────────────────────────── */}
      {importState === 'review' && importPreview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Portfolio Import Preview</h2>
                <p className="text-sm text-gray-500 mt-0.5">Review before anything is written to the database</p>
              </div>
              <button onClick={() => { setImportState('idle'); setImportPreview(null); }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            {/* Summary bar */}
            <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100 flex-shrink-0">
              {[
                { label: 'Companies to create', value: importPreview.summary.companies_to_create, color: '#059669' },
                { label: 'Matched to existing', value: importPreview.summary.companies_to_match, color: '#6366F1' },
                { label: 'Units to create',     value: importPreview.summary.units_to_create,    color: '#3B82F6' },
                { label: 'Units already exist', value: importPreview.summary.units_to_skip,      color: '#9CA3AF' },
              ].map(s => (
                <div key={s.label} className="px-5 py-3 text-center">
                  <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Company list */}
            <div className="overflow-y-auto flex-1" style={{ maxHeight: '55vh' }}>
              {importPreview.companies.map(co => {
                const isOpen = expandedPreviewCo === co.excel_name;
                const unitCounts = {
                  create: co.units.filter(u => u.action === 'create').length,
                  skip: co.units.filter(u => u.action === 'skip').length,
                  update: co.units.filter(u => u.action === 'update_rent').length,
                };
                return (
                  <div key={co.excel_name} className="border-b border-gray-50 last:border-0">
                    {/* Company row */}
                    <button
                      onClick={() => setExpandedPreviewCo(isOpen ? null : co.excel_name)}
                      className="w-full flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors text-left">
                      <ChevronDown size={14} className={`text-gray-400 transition-transform flex-shrink-0 ${isOpen ? '' : '-rotate-90'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 text-sm">{co.display_name}</span>
                          {co.action === 'create' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(5,150,105,0.12)', color: '#059669' }}>CREATE</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(99,102,241,0.15)', color: '#92400E' }}>MATCH</span>
                          )}
                          {co.target_month && (
                            <span className="text-xs text-gray-400">· {co.target_month}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                          <span>{co.total_units} units</span>
                          <span>{co.occupied} occupied · {co.vacant} vacant</span>
                          {unitCounts.create > 0 && <span className="text-blue-600 font-medium">+{unitCounts.create} to create</span>}
                          {unitCounts.skip > 0 && <span className="text-gray-400">{unitCounts.skip} skip</span>}
                          {unitCounts.update > 0 && <span className="text-amber-600 font-medium">{unitCounts.update} rent update</span>}
                        </div>
                      </div>
                    </button>

                    {/* Unit rows (expanded) */}
                    {isOpen && (
                      <div className="bg-gray-50/60 border-t border-gray-100 px-6 pb-2">
                        <table className="w-full text-xs mt-2">
                          <thead>
                            <tr className="text-gray-400 uppercase tracking-wide">
                              <th className="text-left py-1.5 font-semibold">Suite</th>
                              <th className="text-left py-1.5 font-semibold">Unit</th>
                              <th className="text-left py-1.5 font-semibold">Action</th>
                              <th className="text-left py-1.5 font-semibold">Status</th>
                              <th className="text-right py-1.5 font-semibold">Monthly Rent</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {co.units.map((u, i) => (
                              <tr key={i} className="hover:bg-white/60">
                                <td className="py-1.5 text-gray-400">{u.suite_name || '—'}</td>
                                <td className="py-1.5 font-medium text-gray-800">{u.unit_name}</td>
                                <td className="py-1.5">
                                  {u.action === 'create' && (
                                    <span className="px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(59,130,246,0.1)', color: '#2563EB' }}>+ Create</span>
                                  )}
                                  {u.action === 'skip' && (
                                    <span className="px-1.5 py-0.5 rounded text-gray-400">Skip</span>
                                  )}
                                  {u.action === 'update_rent' && (
                                    <span className="px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(99,102,241,0.15)', color: '#92400E' }}>Fill rent</span>
                                  )}
                                </td>
                                <td className="py-1.5">
                                  <span className={u.status === 'occupied' ? 'text-green-600 font-medium' : 'text-gray-400'}>
                                    {u.status}
                                  </span>
                                </td>
                                <td className="py-1.5 text-right font-mono text-gray-700">
                                  {u.monthly_rent > 0 ? `$${u.monthly_rent.toLocaleString()}` : '—'}
                                  {u.action === 'update_rent' && u.match_unit_rent !== null && (
                                    <span className="text-gray-400 ml-1">(was $0)</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Skipped / flagged */}
              {importPreview.skipped.length > 0 && (
                <div className="px-6 py-4 border-t border-amber-100" style={{ background: 'rgba(251,191,36,0.06)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#92400E' }}>
                      {importPreview.skipped.length} sheet{importPreview.skipped.length !== 1 ? 's' : ''} could not be parsed
                    </span>
                  </div>
                  {importPreview.skipped.map((s, i) => (
                    <div key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 mb-1">{s}</div>
                  ))}
                  <p className="text-xs text-gray-400 mt-2">These sheets will be skipped — add them manually if needed.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0 bg-gray-50/50">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forceReplace}
                  onChange={e => setForceReplace(e.target.checked)}
                  className="w-4 h-4 rounded accent-rose-600"
                />
                <span className="text-xs text-gray-600">
                  {forceReplace
                    ? 'Replace mode — existing units & suites will be wiped and recreated'
                    : 'Replace existing data (wipe & recreate units from Excel)'}
                </span>
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => { setImportState('idle'); setImportPreview(null); setForceReplace(false); }}
                  className="text-sm border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl hover:bg-gray-100">
                  Cancel
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={importState === 'confirming'}
                  className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl disabled:opacity-50 transition-colors"
                  style={{ background: forceReplace ? '#DC2626' : '#059669', color: '#fff' }}>
                  <Check size={14} />
                  {importState === 'confirming'
                    ? 'Importing…'
                    : forceReplace
                      ? `Replace & Import (${importPreview.summary.companies_to_match} companies)`
                      : `Confirm Import (${importPreview.summary.companies_to_create + importPreview.summary.units_to_create} new records)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST STACK */}
      <div className="fixed bottom-6 right-6 space-y-2 z-50 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm text-white font-medium pointer-events-auto
              ${t.ok ? 'bg-green-600' : 'bg-red-600'}`}>
            {t.ok ? <Check size={14} /> : <X size={14} />} {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
