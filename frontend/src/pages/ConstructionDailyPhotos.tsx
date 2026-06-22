import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown, Trash2, Upload, X } from 'lucide-react';
import api from '../services/api';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DPPhoto {
  id: string;
  file_reference: string;
  image_url: string;
  caption: string | null;
  uploaded_at: string;
}

interface DPEntry {
  id: string;
  project_id: string;
  entry_date: string;
  uploaded_by: string | null;
  photo_count: number;
  photos: DPPhoto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const IMG_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
function imgUrl(ref: string) { return `${IMG_BASE}/uploads/${ref}`; }

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function today() { return new Date().toISOString().slice(0, 10); }

// ─────────────────────────────────────────────────────────────────────────────
// Lightbox — same pattern as ConstructionWorkLog
// ─────────────────────────────────────────────────────────────────────────────

function Lightbox({ photos, startIndex, onClose }: { photos: DPPhoto[]; startIndex: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIndex);
  const img = photos[idx];
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white hover:text-gray-300 z-10">
        <X className="h-7 w-7" />
      </button>
      <button className="absolute left-4 text-white text-4xl hover:text-gray-300 disabled:opacity-30 px-2"
        disabled={idx === 0} onClick={(e) => { e.stopPropagation(); setIdx(i => i - 1); }}>‹</button>
      <div className="max-w-5xl max-h-[88vh] flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
        <img src={imgUrl(img.file_reference)} alt={img.caption || 'Progress photo'}
          className="max-h-[78vh] max-w-full object-contain rounded-xl shadow-2xl" />
        {img.caption && <p className="text-white text-sm max-w-xl text-center">{img.caption}</p>}
        <p className="text-gray-400 text-xs">{idx + 1} / {photos.length}</p>
      </div>
      <button className="absolute right-4 text-white text-4xl hover:text-gray-300 disabled:opacity-30 px-2"
        disabled={idx === photos.length - 1} onClick={(e) => { e.stopPropagation(); setIdx(i => i + 1); }}>›</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Date group
// ─────────────────────────────────────────────────────────────────────────────

function DateGroup({ entry, canWrite, onDelete }: { entry: DPEntry; canWrite: boolean; onDelete: (photoId: string) => void }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-charcoal">{fmtDate(entry.entry_date)}</h3>
          {entry.uploaded_by && <p className="text-xs text-gray-500 mt-0.5">Uploaded by {entry.uploaded_by}</p>}
        </div>
        <span className="flex items-center gap-1.5 text-sm text-gray-500">
          <Camera className="h-4 w-4" /> {entry.photo_count}
        </span>
      </div>
      <div className="p-4">
        {entry.photos.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No photos yet for this date.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {entry.photos.map((photo, i) => (
              <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                <img
                  src={imgUrl(photo.file_reference)}
                  alt={photo.caption || `Photo ${i + 1}`}
                  className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setLightboxIdx(i)}
                />
                {canWrite && (
                  <button
                    onClick={() => onDelete(photo.id)}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                {photo.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-1.5 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {photo.caption}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {lightboxIdx !== null && (
        <Lightbox photos={entry.photos} startIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload panel
// ─────────────────────────────────────────────────────────────────────────────

interface UploadPanelProps {
  projectId: string;
  onUploaded: () => void;
}

function UploadPanel({ projectId, onUploaded }: UploadPanelProps) {
  const [uploadDate, setUploadDate] = useState(today());
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [queue, setQueue] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setQueue(prev => [...prev, ...Array.from(files)]);
  };

  const removeQueued = (idx: number) => setQueue(q => q.filter((_, i) => i !== idx));

  const handleUpload = async () => {
    if (!queue.length) return;
    setUploading(true);
    try {
      for (const file of queue) {
        const form = new FormData();
        form.append('project_id', projectId);
        form.append('entry_date', uploadDate);
        form.append('file', file);
        if (caption) form.append('caption', caption);
        await api.post('/api/real-estate/daily-progress-photos/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      setQueue([]);
      setCaption('');
      onUploaded();
    } catch {
      alert('Upload failed — check that the backend is running.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Date</label>
          <input type="date" value={uploadDate} onChange={e => setUploadDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">Caption (optional — applies to all photos in this batch)</label>
          <input placeholder="e.g. North elevation framing" value={caption}
            onChange={e => setCaption(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="self-end">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-white">
            <Upload className="h-4 w-4" /> Select Photos
          </button>
        </div>
      </div>

      {/* Queued previews */}
      {queue.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">{queue.length} photo{queue.length !== 1 ? 's' : ''} queued</p>
          <div className="flex flex-wrap gap-2">
            {queue.map((f, i) => (
              <div key={i} className="relative">
                <img src={URL.createObjectURL(f)} alt={f.name}
                  className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
                <button onClick={() => removeQueued(i)}
                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs leading-none">
                  ×
                </button>
              </div>
            ))}
          </div>
          <button onClick={handleUpload} disabled={uploading}
            className="mt-3 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50">
            {uploading ? `Uploading ${queue.length} photo${queue.length !== 1 ? 's' : ''}…` : `Upload ${queue.length} photo${queue.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export default function ConstructionDailyPhotos({ projectId }: { projectId: string }) {
  const { canWrite } = useAuth();
  const [entries, setEntries] = useState<DPEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const LIMIT = 20;

  const load = async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/real-estate/daily-progress-photos', {
        params: { project_id: projectId, limit: LIMIT, offset: currentOffset },
      });
      const newEntries: DPEntry[] = res.data.entries ?? [];
      setEntries(reset ? newEntries : prev => [...prev, ...newEntries]);
      setHasMore(res.data.has_more ?? false);
      setOffset(currentOffset + newEntries.length);
    } catch {
      setError('Failed to load daily progress photos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEntries([]);
    setOffset(0);
    setHasMore(false);
    load(true);
  }, [projectId]);

  const handleDelete = async (photoId: string) => {
    if (!confirm('Delete this photo?')) return;
    try {
      await api.delete(`/api/real-estate/daily-progress-photos/${photoId}`);
      load(true);
    } catch {
      alert('Failed to delete photo.');
    }
  };

  return (
    <ErrorBoundary>
      <div className="space-y-5">
        {/* Upload panel */}
        {canWrite && (
          <div>
            {!showUpload ? (
              <button onClick={() => setShowUpload(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-light">
                <Upload className="h-4 w-4" /> Upload Progress Photos
              </button>
            ) : (
              <div className="space-y-2">
                <UploadPanel projectId={projectId} onUploaded={() => { setShowUpload(false); load(true); }} />
                <button onClick={() => setShowUpload(false)} className="text-sm text-gray-500 hover:text-charcoal">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Gallery */}
        {entries.length === 0 && !loading && !error && (
          <div className="text-center py-20 text-gray-400">
            <Camera className="h-12 w-12 mx-auto mb-3 opacity-25" />
            <p className="text-sm font-medium">No progress photos yet</p>
            {canWrite && <p className="text-xs mt-1">Upload photos above to start the visual record of this project.</p>}
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        {entries.map(entry => (
          <DateGroup key={entry.id} entry={entry} canWrite={canWrite} onDelete={handleDelete} />
        ))}

        {/* Load more */}
        {hasMore && !loading && (
          <button onClick={() => load()}
            className="w-full py-3 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2">
            <ChevronDown className="h-4 w-4" /> Load older dates
          </button>
        )}

        {loading && (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
