import { useEffect, useRef, useState } from 'react';
import {
  Camera, ChevronDown, ChevronUp, Cloud, CloudRain, CloudSnow, Plus, Sun, Thermometer, Trash2, X,
} from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WLImage {
  id: string;
  file_reference: string;
  image_url: string;
  caption: string | null;
  uploaded_at: string;
}

interface WLNote {
  id: string;
  sequence_number: number;
  trade_or_crew: string | null;
  narrative: string;
  created_at: string;
}

interface WLEntry {
  id: string;
  project_id: string;
  report_date: string;
  status: string;
  site_condition: string;
  created_by: string | null;
  image_count: number;
  images: WLImage[];
  notes: WLNote[];
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const IMG_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

function imgUrl(ref: string) {
  return `${IMG_BASE}/uploads/${ref}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function WeatherIcon({ condition, className = 'h-4 w-4' }: { condition: string; className?: string }) {
  switch (condition) {
    case 'sunny': return <Sun className={className + ' text-yellow-500'} />;
    case 'rain': return <CloudRain className={className + ' text-blue-500'} />;
    case 'cloudy': return <Cloud className={className + ' text-gray-400'} />;
    case 'snow': return <CloudSnow className={className + ' text-blue-200'} />;
    case 'extreme_heat': return <Thermometer className={className + ' text-red-500'} />;
    default: return <Cloud className={className + ' text-gray-400'} />;
  }
}

function conditionLabel(c: string) {
  return { sunny: 'Sunny', rain: 'Rain', cloudy: 'Cloudy', snow: 'Snow', extreme_heat: 'Extreme Heat', other: 'Other' }[c] ?? c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightbox
// ─────────────────────────────────────────────────────────────────────────────

function Lightbox({ images, startIndex, onClose }: { images: WLImage[]; startIndex: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIndex);
  const img = images[idx];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
      >
        <X className="h-7 w-7" />
      </button>
      <button
        className="absolute left-4 text-white text-3xl hover:text-gray-300 disabled:opacity-30"
        disabled={idx === 0}
        onClick={(e) => { e.stopPropagation(); setIdx(i => i - 1); }}
      >‹</button>
      <div className="max-w-4xl max-h-[85vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img
          src={imgUrl(img.file_reference)}
          alt={img.caption || 'Site photo'}
          className="max-h-[75vh] max-w-full object-contain rounded-lg"
        />
        {img.caption && <p className="text-white text-sm">{img.caption}</p>}
        <p className="text-gray-400 text-xs">{idx + 1} / {images.length}</p>
      </div>
      <button
        className="absolute right-4 text-white text-3xl hover:text-gray-300 disabled:opacity-30"
        disabled={idx === images.length - 1}
        onClick={(e) => { e.stopPropagation(); setIdx(i => i + 1); }}
      >›</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Card
// ─────────────────────────────────────────────────────────────────────────────

interface EntryCardProps {
  entry: WLEntry;
  canWrite: boolean;
  onRefresh: () => void;
}

function EntryCard({ entry, canWrite, onRefresh }: EntryCardProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [noteForm, setNoteForm] = useState({ trade_or_crew: '', narrative: '' });
  const [addingNote, setAddingNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [deletingNote, setDeletingNote] = useState<string | null>(null);
  const [deletingImg, setDeletingImg] = useState<string | null>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [imgCaption, setImgCaption] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUploadImage = async (file: File) => {
    setUploadingImg(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (imgCaption) form.append('caption', imgCaption);
      await api.post(`/api/real-estate/work-log/${entry.id}/images`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImgCaption('');
      onRefresh();
    } catch {
      alert('Image upload failed.');
    } finally {
      setUploadingImg(false);
    }
  };

  const handleDeleteImg = async (imageId: string) => {
    if (!confirm('Delete this image?')) return;
    setDeletingImg(imageId);
    try {
      await api.delete(`/api/real-estate/work-log/${entry.id}/images/${imageId}`);
      onRefresh();
    } catch {
      alert('Failed to delete image.');
    } finally {
      setDeletingImg(null);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNote(true);
    try {
      await api.post(`/api/real-estate/work-log/${entry.id}/notes`, {
        trade_or_crew: noteForm.trade_or_crew || null,
        narrative: noteForm.narrative,
      });
      setNoteForm({ trade_or_crew: '', narrative: '' });
      setAddingNote(false);
      onRefresh();
    } catch {
      alert('Failed to add note.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Delete this note?')) return;
    setDeletingNote(noteId);
    try {
      await api.delete(`/api/real-estate/work-log/${entry.id}/notes/${noteId}`);
      onRefresh();
    } catch {
      alert('Failed to delete note.');
    } finally {
      setDeletingNote(null);
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Entry header */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-100 bg-gray-50">
        <div className="flex-1">
          <h3 className="font-semibold text-charcoal">{fmtDate(entry.report_date)}</h3>
          {entry.created_by && (
            <p className="text-xs text-gray-500 mt-0.5">Created by {entry.created_by}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <WeatherIcon condition={entry.site_condition} className="h-5 w-5" />
          <span className="text-sm text-gray-600">{conditionLabel(entry.site_condition)}</span>
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          entry.status === 'closed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
        }`}>
          {entry.status === 'closed' ? 'Closed' : 'Open'}
        </span>
        <span className="flex items-center gap-1 text-sm text-gray-500">
          <Camera className="h-4 w-4" /> {entry.image_count}
        </span>
      </div>

      {/* Image grid */}
      {entry.images.length > 0 && (
        <div className="p-4 border-b border-gray-100">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {entry.images.map((img, i) => (
              <div key={img.id} className="group relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                <img
                  src={imgUrl(img.file_reference)}
                  alt={img.caption || `Site photo ${i + 1}`}
                  className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setLightboxIdx(i)}
                />
                {canWrite && (
                  <button
                    onClick={() => handleDeleteImg(img.id)}
                    disabled={deletingImg === img.id}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload row */}
      {canWrite && (
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <input
            type="text"
            placeholder="Caption (optional)"
            value={imgCaption}
            onChange={(e) => setImgCaption(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { handleUploadImage(f); e.target.value = ''; }
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadingImg}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <Camera className="h-4 w-4" />
            {uploadingImg ? 'Uploading…' : 'Add Photo'}
          </button>
        </div>
      )}

      {/* Notes list */}
      {entry.notes.length > 0 && (
        <div className="px-5 py-4 space-y-4">
          {entry.notes.map((note) => (
            <div key={note.id} className="flex gap-3 group">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {note.sequence_number}
              </span>
              <div className="flex-1">
                {note.trade_or_crew && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-xs font-medium text-gray-700 mb-1">
                    {note.trade_or_crew}
                  </span>
                )}
                <p className="text-sm text-charcoal leading-relaxed">{note.narrative}</p>
              </div>
              {canWrite && (
                <button
                  onClick={() => handleDeleteNote(note.id)}
                  disabled={deletingNote === note.id}
                  className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity self-start mt-0.5 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add note form */}
      {canWrite && (
        <div className="px-5 pb-4">
          {!addingNote ? (
            <button
              onClick={() => setAddingNote(true)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary transition-colors"
            >
              <Plus className="h-4 w-4" /> Add note
            </button>
          ) : (
            <form onSubmit={handleAddNote} className="space-y-2 pt-2">
              <input
                placeholder="Trade / crew (e.g. Structural Steel)"
                value={noteForm.trade_or_crew}
                onChange={(e) => setNoteForm({ ...noteForm, trade_or_crew: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <textarea
                required
                placeholder="Narrative…"
                value={noteForm.narrative}
                onChange={(e) => setNoteForm({ ...noteForm, narrative: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
              />
              <div className="flex gap-2">
                <button type="submit" disabled={savingNote}
                  className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50">
                  {savingNote ? 'Adding…' : 'Add'}
                </button>
                <button type="button" onClick={() => { setAddingNote(false); setNoteForm({ trade_or_crew: '', narrative: '' }); }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {lightboxIdx !== null && (
        <Lightbox images={entry.images} startIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

const BLANK_ENTRY = { report_date: today(), status: 'open', site_condition: 'sunny' };

export default function ConstructionWorkLog({ projectId }: { projectId: string }) {
  const { canWrite } = useAuth();
  const [entries, setEntries] = useState<WLEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_ENTRY });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { project_id: projectId };
      if (dateFilter) params.date = dateFilter;
      const res = await api.get('/api/real-estate/work-log', { params });
      setEntries(res.data.entries ?? []);
    } catch {
      setError('Failed to load work log.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId, dateFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/api/real-estate/work-log', { project_id: projectId, ...form });
      setShowForm(false);
      setForm({ ...BLANK_ENTRY });
      load();
    } catch {
      alert('Failed to create work log entry.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="space-y-5">
        {/* Toolbar */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Date:</label>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            />
            {dateFilter && (
              <button onClick={() => setDateFilter('')} className="text-xs text-gray-500 hover:text-charcoal">
                Clear
              </button>
            )}
          </div>
          {canWrite && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-light"
            >
              <Plus className="h-4 w-4" /> New Daily Report
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && canWrite && (
          <form onSubmit={handleCreate} className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
            <p className="text-sm font-medium text-charcoal">New Daily Report</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Report date</label>
                <input required type="date" value={form.report_date}
                  onChange={(e) => setForm({ ...form, report_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Site condition</label>
                <select value={form.site_condition} onChange={(e) => setForm({ ...form, site_condition: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="sunny">Sunny</option>
                  <option value="cloudy">Cloudy</option>
                  <option value="rain">Rain</option>
                  <option value="snow">Snow</option>
                  <option value="extreme_heat">Extreme Heat</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={creating}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50">
                {creating ? 'Creating…' : 'Create Report'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setForm({ ...BLANK_ENTRY }); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* KPI strip — only shown when showing all dates */}
        {!dateFilter && entries.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard label="Total Reports" value={String(entries.length)} />
            <KpiCard label="Open" value={String(entries.filter(e => e.status === 'open').length)} />
            <KpiCard label="Total Photos" value={String(entries.reduce((s, e) => s + e.image_count, 0))} />
            <KpiCard label="Total Notes" value={String(entries.reduce((s, e) => s + e.notes.length, 0))} />
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        )}
        {error && <p className="text-red-500 text-sm py-4">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Camera className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{dateFilter ? 'No report for this date.' : 'No daily reports yet.'}</p>
          </div>
        )}
        {!loading && !error && entries.map((entry) => (
          <EntryCard key={entry.id} entry={entry} canWrite={canWrite} onRefresh={load} />
        ))}
      </div>
    </ErrorBoundary>
  );
}
