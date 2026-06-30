import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, Plus, X } from 'lucide-react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface LandParcel {
  id: string;
  parcel_name: string;
  city: string | null;
  state: string | null;
  acres: number | null;
  status: string;
  projected_acquisition_cost: number | null;
  projected_project_irr: number | null;
  target_close_date: string | null;
}

interface MarketComp extends Record<string, unknown> {
  id: string;
  market_area: string;
  comp_name: string;
  comp_price_per_sqft: number | null;
  comp_absorption_units_per_month: number | null;
  prevailing_mortgage_rate_pct: number | null;
  prevailing_cap_rate_pct: number | null;
  data_as_of_date: string | null;
  source_note: string | null;
}

const STATUS_ORDER = ['prospect', 'due_diligence', 'under_contract', 'closed', 'passed'];

export default function PipelineMarket() {
  const { canWrite } = useAuth();
  const [parcels, setParcels] = useState<LandParcel[]>([]);
  const [comps, setComps] = useState<MarketComp[]>([]);
  const [selectedParcels, setSelectedParcels] = useState<string[]>([]);
  const [comparison, setComparison] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    market_area: '',
    comp_name: '',
    comp_price_per_sqft: '',
    comp_absorption_units_per_month: '',
    prevailing_mortgage_rate_pct: '',
    prevailing_cap_rate_pct: '',
    source_note: '',
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [landRes, compsRes] = await Promise.all([
        api.get<LandParcel[]>('/api/real-estate/pipeline/land'),
        api.get<MarketComp[]>('/api/real-estate/pipeline/market-comps'),
      ]);
      setParcels(landRes.data);
      setComps(compsRes.data);
    } catch {
      setParcels([]);
      setComps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const groupedParcels = useMemo(() => {
    const groups: Record<string, LandParcel[]> = {};
    STATUS_ORDER.forEach((s) => { groups[s] = []; });
    parcels.forEach((p) => {
      const key = p.status || 'prospect';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return groups;
  }, [parcels]);

  const toggleParcel = (id: string) => {
    setSelectedParcels((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const handleCompare = async () => {
    if (selectedParcels.length < 2) return;
    setComparing(true);
    try {
      const { data } = await api.post<{ narrative: string }>('/api/real-estate/ai/compare-parcels', {
        parcel_ids: selectedParcels,
      });
      setComparison(data.narrative);
    } catch {
      setComparison('Unable to generate parcel comparison.');
    } finally {
      setComparing(false);
    }
  };

  const handleAddComp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/real-estate/pipeline/market-comps', {
        market_area: form.market_area,
        comp_name: form.comp_name,
        comp_price_per_sqft: form.comp_price_per_sqft ? parseFloat(form.comp_price_per_sqft) : null,
        comp_absorption_units_per_month: form.comp_absorption_units_per_month ? parseFloat(form.comp_absorption_units_per_month) : null,
        prevailing_mortgage_rate_pct: form.prevailing_mortgage_rate_pct ? parseFloat(form.prevailing_mortgage_rate_pct) : null,
        prevailing_cap_rate_pct: form.prevailing_cap_rate_pct ? parseFloat(form.prevailing_cap_rate_pct) : null,
        source_note: form.source_note || null,
      });
      setShowModal(false);
      setForm({ market_area: '', comp_name: '', comp_price_per_sqft: '', comp_absorption_units_per_month: '', prevailing_mortgage_rate_pct: '', prevailing_cap_rate_pct: '', source_note: '' });
      fetchData();
    } catch {
      /* keep modal open */
    } finally {
      setSaving(false);
    }
  };

  const compColumns: Column<MarketComp>[] = [
    { key: 'market_area', label: 'Market', sortValue: (r) => r.market_area },
    { key: 'comp_name', label: 'Comp', sortValue: (r) => r.comp_name },
    { key: 'comp_price_per_sqft', label: '$/Sq Ft', render: (r) => (r.comp_price_per_sqft ? `$${safe(r.comp_price_per_sqft).toFixed(0)}` : '—'), sortValue: (r) => safe(r.comp_price_per_sqft) },
    { key: 'comp_absorption_units_per_month', label: 'Absorption/mo', render: (r) => (r.comp_absorption_units_per_month ?? '—'), sortValue: (r) => safe(r.comp_absorption_units_per_month) },
    { key: 'prevailing_mortgage_rate_pct', label: 'Mortgage Rate', render: (r) => (r.prevailing_mortgage_rate_pct != null ? `${safe(r.prevailing_mortgage_rate_pct).toFixed(2)}%` : '—') },
    { key: 'prevailing_cap_rate_pct', label: 'Cap Rate', render: (r) => (r.prevailing_cap_rate_pct != null ? `${safe(r.prevailing_cap_rate_pct).toFixed(2)}%` : '—') },
    { key: 'data_as_of_date', label: 'As Of', render: (r) => r.data_as_of_date || '—' },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-charcoal">Pipeline & Market</h1>
        <LoadingSkeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Pipeline & Market</h1>

      <ErrorBoundary>
        <Card title="Land Pipeline">
          {parcels.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No land parcels in pipeline</p>
          ) : (
            <div className="space-y-6">
              {STATUS_ORDER.filter((s) => groupedParcels[s]?.length).map((status) => (
                <div key={status}>
                  <div className="flex items-center gap-2 mb-3">
                    <StatusPill status={status} />
                    <span className="text-sm text-gray-500">{groupedParcels[status].length} parcel(s)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {groupedParcels[status].map((p) => (
                      <label
                        key={p.id}
                        className={`block p-4 border rounded-xl cursor-pointer transition-colors ${
                          selectedParcels.includes(p.id) ? 'border-accent bg-accent/5' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedParcels.includes(p.id)}
                            onChange={() => toggleParcel(p.id)}
                            className="mt-1 accent-accent"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-charcoal truncate">{p.parcel_name}</p>
                            <p className="text-xs text-gray-500">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</p>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-600">
                              {p.acres != null && <span>{p.acres} ac</span>}
                              {p.projected_acquisition_cost != null && <span>{fmtUSD(p.projected_acquisition_cost)}</span>}
                              {p.projected_project_irr != null && <span>IRR {fmtPct(p.projected_project_irr)}</span>}
                            </div>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedParcels.length >= 2 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={handleCompare}
                disabled={comparing}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50"
              >
                <Sparkles size={16} />
                {comparing ? 'Comparing…' : `Compare ${selectedParcels.length} Parcels with AI`}
              </button>
            </div>
          )}

          {comparison && (
            <div className="mt-4 p-4 bg-transparent rounded-xl text-sm text-charcoal leading-relaxed">
              <p>{comparison}</p>
              <button onClick={() => setComparison(null)} className="text-xs text-gray-400 mt-2 hover:text-gray-600">Dismiss</button>
            </div>
          )}
        </Card>
      </ErrorBoundary>

      <ErrorBoundary>
        <Card title="Market Comps">
          <div className="flex justify-end mb-4">
            {canWrite && (
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-blue-700"
              >
                <Plus size={14} /> Add Comp
              </button>
            )}
          </div>
          <Table columns={compColumns} data={comps} emptyMessage="No market comps" />
        </Card>
      </ErrorBoundary>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-charcoal">Add Market Comp</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleAddComp} className="space-y-3">
              <input required placeholder="Market area" value={form.market_area} onChange={(e) => setForm({ ...form, market_area: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input required placeholder="Comp name" value={form.comp_name} onChange={(e) => setForm({ ...form, comp_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="0.01" placeholder="$/Sq Ft" value={form.comp_price_per_sqft} onChange={(e) => setForm({ ...form, comp_price_per_sqft: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <input type="number" step="0.1" placeholder="Absorption/mo" value={form.comp_absorption_units_per_month} onChange={(e) => setForm({ ...form, comp_absorption_units_per_month: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <input type="number" step="0.01" placeholder="Mortgage rate %" value={form.prevailing_mortgage_rate_pct} onChange={(e) => setForm({ ...form, prevailing_mortgage_rate_pct: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <input type="number" step="0.01" placeholder="Cap rate %" value={form.prevailing_cap_rate_pct} onChange={(e) => setForm({ ...form, prevailing_cap_rate_pct: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <input placeholder="Source note" value={form.source_note} onChange={(e) => setForm({ ...form, source_note: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <button type="submit" disabled={saving}
                className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary-light disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Comp'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
