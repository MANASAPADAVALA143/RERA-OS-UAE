import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
  rowCells: (c: Company) => (string | number | null)[];
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
    tableCols: ['Company Name', 'Property Type', 'Occ / Total', 'Last Sync', 'Collected', 'Status'],
    rowCells: (c) => {
      const syncTotal = c.sync_total_units as number | null;
      const syncOcc   = c.sync_occupied_units as number | null;
      const occTotal  = syncTotal != null
        ? `${syncOcc ?? '?'} / ${syncTotal}`
        : (c.total_units as number) != null ? `— / ${c.total_units}` : '—';
      const lastSync  = (c.last_sync_month as string) || '—';
      const collected = (c.sync_collected as number) != null
        ? `$${Math.round(c.sync_collected as number).toLocaleString()}`
        : '—';
      return [c.company_name, (c.property_type as string) || '—', occTotal, lastSync, collected, null];
    },
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string, company_name: (r.company_name as string) ?? '',
        property_type: r.property_type as string, total_units: r.total_units,
        sync_occupied_units: r.sync_occupied_units ?? null,
        sync_total_units: r.sync_total_units ?? null,
        sync_collected: r.sync_collected ?? null,
        last_sync_month: r.last_sync_month ?? null,
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

function StatusBadge({ status, onClick }: { status: string; onClick: () => void }) {
  const active = !status || status === 'active';
  return (
    <button onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors cursor-pointer
        ${active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
      {active ? 'Active' : 'Inactive'}
    </button>
  );
}

// ── inline suites table (no modals — modals handled by parent) ────────────────

function InlineSuites({
  companyId, companyName, canWrite, push, totalCols,
  onAdd, onEdit, onDelete, reloadKey,
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
      push('Suite renamed');
      load();
    } catch {
      push('Failed to rename suite', false);
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
              <div className="w-1 h-5 rounded-full" style={{ background: '#D4AF37' }} />
              <span className="text-sm font-semibold text-gray-700">
                Suites — <span className="font-normal text-gray-500">{companyName}</span>
              </span>
              {!loading && (
                <span className="text-xs text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                  {suites.length} suite{suites.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {canWrite && (
              <button onClick={() => onAdd(companyId, companyName)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                style={{ background: '#161310', color: '#D4AF37' }}>
                <Plus size={12} /> Add Suite
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : suites.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-400">
              No suites yet.{canWrite && <> Click <span className="font-medium text-gray-600">Add Suite</span> to create one.</>}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-blue-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Suite Name</th>
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
                            style={{ color: '#D4AF37' }}
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
                                <div className="flex items-center gap-2">
                                  <div className="w-0.5 h-4 rounded-full" style={{ background: '#B8962E' }} />
                                  <span className="text-xs font-semibold text-gray-600">
                                    Units — {s.property_name}
                                  </span>
                                  {unitsMap[s.id] && (
                                    <span className="text-xs text-gray-400">
                                      ({unitsMap[s.id].length} units)
                                    </span>
                                  )}
                                </div>
                                {canWrite && (
                                  <button
                                    onClick={() => { setAddingUnitSuiteId(s.id); setNewUnitNum(''); setNewUnitRent(''); setNewUnitStatus('vacant'); }}
                                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors"
                                    style={{ background: '#D4AF37', color: '#161310' }}>
                                    <Plus size={10} /> Add Unit
                                  </button>
                                )}
                              </div>
                              {!unitsMap[s.id] ? (
                                <div className="flex items-center gap-2 py-3">
                                  <div className="w-4 h-4 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
                                  <span className="text-xs text-gray-400">Loading units…</span>
                                </div>
                              ) : unitsMap[s.id].length === 0 && addingUnitSuiteId !== s.id ? (
                                <p className="text-xs text-gray-400 py-2">No units found for this suite. Click <span className="font-medium text-indigo-600">+ Add Unit</span> to create one.</p>
                              ) : (
                                <div className="bg-white rounded-lg border border-indigo-100 overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-gray-50/80 border-b border-gray-100">
                                        <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide w-6">#</th>
                                        <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Unit Name</th>
                                        <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                                        <th className="text-right px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Rent / mo</th>
                                        {canWrite && <th className="text-center px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</th>}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {unitsMap[s.id].map((u, j) => (
                                        <tr key={u.id} className="hover:bg-indigo-50/20">
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
                                                u.status === 'occupied'
                                                  ? 'bg-green-100 text-green-700'
                                                  : u.status === 'notice'
                                                  ? 'bg-yellow-100 text-yellow-700'
                                                  : u.status === 'reserved'
                                                  ? 'bg-blue-100 text-blue-700'
                                                  : u.status === 'maintenance_hold'
                                                  ? 'bg-orange-100 text-orange-700'
                                                  : 'bg-gray-100 text-gray-500'
                                              }`}>
                                                {u.status}
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
                                              u.monthly_rent > 0
                                                ? `$${u.monthly_rent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                                : '—'
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
                                                      setUnitEditId(u.id);
                                                      setUnitEditVal(u.unit_number);
                                                      setUnitEditStatus(u.status);
                                                      setUnitEditRent(String(u.monthly_rent));
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
                                      ))}
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
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (!status || status === 404) {
        // endpoint not yet built or not reachable — show empty state silently
        setCompanies([]);
      } else {
        push(`Failed to load ${mod.label} companies`, false);
      }
    } finally {
      setLoading(false);
    }
  }, [mod, push]);

  useEffect(() => { load(); }, [load]);

  async function handleImport() {
    setImporting(true);
    try {
      const res = await api.post('/api/rentals/seed-portfolio');
      push(res.data.message ?? 'Portfolio loaded!', true);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push(msg ?? 'Seed failed — check backend logs', false);
    } finally {
      setImporting(false);
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
        push('Suite updated');
      } else {
        payload.company_id = suiteCompany!.id;
        await api.post('/api/rentals/suites', payload);
        push('Suite added');
      }
      closeSuiteModal();
      setSuiteReloadKey(k => k + 1);
    } catch {
      push('Failed to save suite', false);
      setSuiteSaving(false);
    }
  }

  async function handleSuiteDelete() {
    if (!suiteTarget) return;
    setSuiteDeleting(true);
    try {
      await api.delete(`/api/rentals/suites/${suiteTarget.id}`);
      push('Suite deleted');
      closeSuiteModal();
      setSuiteReloadKey(k => k + 1);
    } catch {
      push('Failed to delete suite', false);
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
          <h1 className="text-2xl font-bold text-charcoal">Company Registry</h1>
          <p className="text-sm text-gray-500 mt-1">Add, edit, and manage companies across all modules.</p>
        </div>
      )}

      {/* Module tabs */}
      <div className="flex gap-1 bg-white border border-gray-100 shadow-sm rounded-xl p-1 w-fit">
        {MODULES.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => switchTab(id)}
            className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg font-medium transition-all
              ${activeId === id ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

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
            <button
              onClick={handleImport}
              disabled={importing}
              title="Load all 10 portfolio companies with suites and units"
              className="flex items-center gap-2 bg-emerald-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-emerald-700 font-medium transition-colors disabled:opacity-60">
              <Upload size={14} /> {importing ? 'Loading…' : 'Load Portfolio'}
            </button>
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
                  {mod.tableCols.map(col => (
                    <th key={col} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{col}</th>
                  ))}
                  {activeId === 'rental' && (
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Suites</th>
                  )}
                  {canWrite && (
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => {
                  const cells = mod.rowCells(c);
                  const isExpanded = expandedSuiteId === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr className={`border-b border-gray-50 transition-colors ${isExpanded ? 'bg-blue-50/30' : 'hover:bg-gray-50/60'}`} style={isExpanded ? { background: 'rgba(212,175,55,0.05)' } : {}}>
                        <td className="px-4 py-3 text-xs text-gray-400">{idx + 1}</td>
                        {cells.map((cell, ci) => (
                          <td key={ci} className={`px-4 py-3 ${ci === 0 ? 'font-medium text-gray-800' : 'text-gray-500'}`}>
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
                                ? { background: '#D4AF37', color: '#161310', borderColor: '#D4AF37' }
                                : { color: '#D4AF37', borderColor: 'rgba(212,175,55,0.35)', background: 'rgba(212,175,55,0.08)' }}>
                              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Suites
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
                          companyId={c.id}
                          companyName={c.company_name}
                          canWrite={canWrite}
                          push={push}
                          totalCols={totalCols}
                          onAdd={openSuiteAdd}
                          onEdit={openSuiteEdit}
                          onDelete={openSuiteDelete}
                          reloadKey={suiteReloadKey}
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
        <Modal title={suiteTarget ? `Edit Suite` : `Add Suite — ${suiteCompany?.name}`} onClose={closeSuiteModal}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Suite Name <span className="text-red-500">*</span></label>
              <input
                autoFocus
                type="text"
                value={suiteName}
                onChange={e => setSuiteName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && suiteName.trim()) handleSuiteSave(); }}
                placeholder="e.g. Suite 123"
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
              {suiteSaving ? 'Saving…' : <><Check size={14} />{suiteTarget ? 'Save Changes' : 'Add Suite'}</>}
            </button>
          </div>
        </Modal>
      )}

      {/* ── SUITE DELETE CONFIRM ── */}
      {suiteModal === 'delete' && suiteTarget && (
        <Modal title="Delete Suite" onClose={closeSuiteModal}>
          <div className="text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 size={20} className="text-red-500" />
            </div>
            <p className="text-sm text-gray-700 font-medium mb-1">Delete "{suiteTarget.property_name}"?</p>
            {suiteTarget.unit_count > 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-left">
                This suite has <strong>{suiteTarget.unit_count} unit{suiteTarget.unit_count !== 1 ? 's' : ''}</strong> with
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
