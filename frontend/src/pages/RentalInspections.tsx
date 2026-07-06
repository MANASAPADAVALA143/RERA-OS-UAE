import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Image } from 'lucide-react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';

interface ChecklistItem {
  id: string;
  item_name: string;
  condition: string;
  notes: string | null;
}

interface Photo {
  id: string;
  file_reference: string;
  image_url: string;
  caption: string | null;
  room_area: string | null;
}

interface Inspection {
  id: string;
  unit_id: string;
  unit_number: string;
  company_name: string;
  property_name: string;
  lease_id: string | null;
  inspection_type: string;
  inspection_date: string | null;
  performed_by: string | null;
  condition_score: string;
  notes: string | null;
  photo_count: number;
  checklist_count: number;
  photos?: Photo[];
  checklist?: ChecklistItem[];
}

const TYPE_PILL: Record<string, string> = {
  move_in:  'bg-blue-100 text-blue-800',
  move_out: 'bg-purple-100 text-purple-800',
  periodic: 'bg-gray-100 text-gray-700',
};

const SCORE_PILL: Record<string, string> = {
  excellent:    'bg-green-100 text-green-800',
  good:         'bg-teal-100 text-teal-800',
  fair:         'bg-amber-100 text-amber-800',
  poor:         'bg-red-100 text-red-800',
  needs_repair: 'bg-red-200 text-red-900',
};

const COND_PILL: Record<string, string> = {
  ok:             'bg-green-100 text-green-800',
  damaged:        'bg-red-100 text-red-700',
  missing:        'bg-gray-100 text-gray-700',
  needs_cleaning: 'bg-amber-100 text-amber-700',
};

const TYPES  = ['move_in', 'move_out', 'periodic'];
const SCORES = ['excellent', 'good', 'fair', 'poor', 'needs_repair'];

const CHECKLIST_DEFAULTS = [
  'Walls & Paint','Flooring','Ceiling','Windows & Blinds',
  'Kitchen Appliances','Plumbing Fixtures','Bathroom',
  'Electrical Outlets','HVAC / AC Unit','Doors & Locks',
];

const BLANK_FORM = {
  unit_id: '', lease_id: '', inspection_type: 'periodic',
  inspection_date: '', performed_by: '', condition_score: 'good', notes: '',
};

export default function RentalInspections() {
  const { canWrite } = useAuth();
  const [items, setItems] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterScore, setFilterScore] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<Inspection | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [checklist, setChecklist] = useState<Array<{ item_name: string; condition: string; notes: string }>>(
    CHECKLIST_DEFAULTS.map(n => ({ item_name: n, condition: 'ok', notes: '' }))
  );
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (filterType)  params.inspection_type = filterType;
      if (filterScore) params.condition_score = filterScore;
      const res = await api.get<Inspection[]>('/api/rentals/inspections', { params });
      setItems(res.data);
    } catch {
      setError('Failed to load inspections');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterScore]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    try {
      const res = await api.get<Inspection>(`/api/rentals/inspections/${id}`);
      setExpandedDetail(res.data);
    } catch {
      setExpandedDetail(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/rentals/inspections', {
        ...form,
        lease_id: form.lease_id || null,
        inspection_date: form.inspection_date || new Date().toISOString().slice(0, 10),
        checklist: checklist.filter(c => c.condition !== 'ok' || c.notes),
      });
      setForm({ ...BLANK_FORM });
      setChecklist(CHECKLIST_DEFAULTS.map(n => ({ item_name: n, condition: 'ok', notes: '' })));
      setShowForm(false);
      fetchData();
    } catch {
      alert('Failed to create inspection');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error)   return <p className="text-red-700 p-4">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Unit Inspections</h1>
          <p className="text-sm text-gray-500 mt-0.5">Move-in, move-out, and periodic unit condition records</p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90"
          >
            + New Inspection
          </button>
        )}
      </div>

      {/* New Inspection Form */}
      {showForm && canWrite && (
        <Card title="New Unit Inspection">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Unit ID</label>
                <input required value={form.unit_id} onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}
                  placeholder="Paste unit UUID"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Lease ID (optional)</label>
                <input value={form.lease_id} onChange={e => setForm(f => ({ ...f, lease_id: e.target.value }))}
                  placeholder="Paste lease UUID (move-in/out)"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <select value={form.inspection_type} onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                  {TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={form.inspection_date} onChange={e => setForm(f => ({ ...f, inspection_date: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Performed By</label>
                <input value={form.performed_by} onChange={e => setForm(f => ({ ...f, performed_by: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Overall Condition</label>
                <select value={form.condition_score} onChange={e => setForm(f => ({ ...f, condition_score: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                  {SCORES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
            </div>

            {/* Checklist */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Checklist</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4 text-xs text-gray-500 font-medium">Item</th>
                      <th className="py-2 pr-4 text-xs text-gray-500 font-medium">Condition</th>
                      <th className="py-2 text-xs text-gray-500 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {checklist.map((c, i) => (
                      <tr key={c.item_name}>
                        <td className="py-1.5 pr-4 text-gray-700 whitespace-nowrap">{c.item_name}</td>
                        <td className="py-1.5 pr-4">
                          <select value={c.condition}
                            onChange={e => setChecklist(cl => cl.map((ci, j) => j === i ? { ...ci, condition: e.target.value } : ci))}
                            className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent">
                            <option value="ok">OK</option>
                            <option value="damaged">Damaged</option>
                            <option value="missing">Missing</option>
                            <option value="needs_cleaning">Needs Cleaning</option>
                          </select>
                        </td>
                        <td className="py-1.5">
                          <input value={c.notes}
                            onChange={e => setChecklist(cl => cl.map((ci, j) => j === i ? { ...ci, notes: e.target.value } : ci))}
                            placeholder="Optional note"
                            className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Inspection'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
        </select>
        <select value={filterScore} onChange={e => setFilterScore(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
          <option value="">All Conditions</option>
          {SCORES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
      </div>

      {/* Inspections table */}
      <Card title={`Inspections (${items.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200">
                {['Unit','Company','Type','Date','Performed By','Condition','Checklist','Photos',''].map(h => (
                  <th key={h} className="py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-gray-400">No inspections found</td></tr>
              )}
              {items.map(insp => (
                <>
                  <tr key={insp.id} className="hover:bg-gray-50">
                    <td className="py-3 px-3 font-mono font-medium">{insp.unit_number}</td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{insp.company_name}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_PILL[insp.inspection_type] || 'bg-gray-100'}`}>
                        {insp.inspection_type.replace('_',' ')}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-600 whitespace-nowrap text-xs">{insp.inspection_date}</td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{insp.performed_by || '—'}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SCORE_PILL[insp.condition_score] || 'bg-gray-100'}`}>
                        {insp.condition_score.replace('_',' ')}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-500 text-xs text-center">{insp.checklist_count}</td>
                    <td className="py-3 px-3 text-gray-500 text-xs text-center">
                      <span className="flex items-center gap-1"><Image size={12} />{insp.photo_count}</span>
                    </td>
                    <td className="py-3 px-3">
                      <button onClick={() => toggleExpand(insp.id)} className="text-accent hover:text-accent/70">
                        {expandedId === insp.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === insp.id && (
                    <tr key={`${insp.id}-detail`}>
                      <td colSpan={9} className="bg-gray-50 px-6 py-4">
                        {!expandedDetail ? (
                          <p className="text-sm text-gray-400">Loading…</p>
                        ) : (
                          <div className="space-y-4">
                            {expandedDetail.notes && (
                              <p className="text-sm text-gray-700 italic">"{expandedDetail.notes}"</p>
                            )}

                            {/* Checklist grid */}
                            {expandedDetail.checklist && expandedDetail.checklist.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Checklist</p>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                                  {expandedDetail.checklist.map(ci => (
                                    <div key={ci.id} className="bg-white rounded-lg border p-2">
                                      <p className="text-xs font-medium text-gray-700 truncate">{ci.item_name}</p>
                                      <span className={`mt-1 inline-block px-1.5 py-0.5 rounded text-xs font-medium ${COND_PILL[ci.condition] || 'bg-gray-100'}`}>
                                        {ci.condition.replace('_',' ')}
                                      </span>
                                      {ci.notes && <p className="mt-1 text-xs text-gray-500">{ci.notes}</p>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Photos */}
                            {expandedDetail.photos && expandedDetail.photos.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Photos</p>
                                <div className="flex flex-wrap gap-3">
                                  {expandedDetail.photos.map(ph => (
                                    <div key={ph.id} className="w-32 rounded-lg border overflow-hidden bg-white">
                                      <img
                                        src={ph.image_url}
                                        alt={ph.caption || 'Inspection photo'}
                                        className="w-full h-24 object-cover"
                                      />
                                      {(ph.caption || ph.room_area) && (
                                        <div className="p-1.5">
                                          {ph.room_area && <p className="text-xs font-medium text-gray-600">{ph.room_area}</p>}
                                          {ph.caption  && <p className="text-xs text-gray-500">{ph.caption}</p>}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {expandedDetail.checklist_count === 0 && expandedDetail.photo_count === 0 && (
                              <p className="text-sm text-gray-400">No checklist items or photos recorded.</p>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Move-in vs Move-out comparison note */}
      <div className="text-xs text-gray-400 px-1">
        To compare move-in vs move-out condition for a specific unit, use the unit detail view from the Units register.
        Expand any row above to see the full checklist and photos for that inspection.
      </div>
    </div>
  );
}
