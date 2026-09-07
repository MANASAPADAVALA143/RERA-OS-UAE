/** Consultancy & Outsourcing — Overview: company list + add/remove. Phase 1 keeps this
 * simple (name only) since Clients/Workforce/Deployments are Phase 2. */
import { useState } from 'react';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { useConsultancy } from '../../contexts/ConsultancyContext';
import { PT, PT_FONT } from '../../utils/parchmentTypography';

export default function ConsultancyOverview() {
  const { companies, loading, createCompany, deleteCompany, setSelectedCompanyId } = useConsultancy();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setError('');
    try {
      await createCompany(name.trim());
      setName('');
      setAdding(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create company');
    }
  };

  return (
    <div style={{ background: PT.pageBg, minHeight: '100vh', fontSize: 13, color: PT.text }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={PT_FONT.pageTitle}>Overview</h1>
          <p style={{ ...PT_FONT.pageSubtitle, margin: '6px 0 0' }}>Consulting &amp; staffing companies tracked in this segment</p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(a => !a)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white"
          style={{ background: '#4F46E5' }}
        >
          <Plus size={14} /> Add Company
        </button>
      </div>

      {adding && (
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 10, padding: 16, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Company name"
            className="text-sm border rounded px-3 py-1.5 flex-1"
            style={{ borderColor: PT.border }}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button type="button" onClick={handleCreate} className="text-xs px-3 py-1.5 rounded text-white bg-green-700">Create</button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}

      {loading ? (
        <p style={PT_FONT.bodyMuted}>Loading companies…</p>
      ) : !companies.length ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Building2 size={32} className="text-gray-400 mb-3" />
          <p className="text-lg font-semibold text-gray-700 mb-2">No companies yet</p>
          <p className="text-sm text-gray-400">Add a consulting/staffing company to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {companies.map(c => (
            <div key={c.id} style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 10, padding: 16 }}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm">{c.name}</p>
                <button type="button" onClick={() => deleteCompany(c.id)} className="text-gray-400 hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Cash available: {c.cashAvailable ? `$${c.cashAvailable.toLocaleString()}` : '—'}</p>
              <button
                type="button"
                onClick={() => setSelectedCompanyId(c.id)}
                className="text-xs text-amber-700 mt-2 font-medium"
              >
                Select →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
