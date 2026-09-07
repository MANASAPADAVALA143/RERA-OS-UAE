import { useState } from 'react';
import { ArrowLeft, Download, Loader2, Plus, Trash2 } from 'lucide-react';
import { fmtUSD } from '../../components/ProtectedRoute';
import api from '../../services/api';
import { usePropDev, type CompanyData } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import { exportPropDevPropertyProfilePdf } from '../../utils/propDevSectionPdfExport';
import { PD_FONT, PD_IVORY, PD_NAVY, PD_GOLD, PD_TEXT, PD_SLATE, PD_BORDER } from '../../theme/propDevEnterpriseTheme';

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return fmtUSD(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type Tab = 'overview' | 'tax' | 'ownership' | 'improvements' | 'loans';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tax', label: 'Tax' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'improvements', label: 'Improvements' },
  { id: 'loans', label: 'Loans' },
];

interface FieldDef { key: string; label: string; type: 'text' | 'number' | 'date'; }

function EditableSection({
  companyId, fields, values, onSaved,
}: {
  companyId: string;
  fields: FieldDef[];
  values: Record<string, string | number | null>;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    const init: Record<string, string> = {};
    fields.forEach(f => { init[f.key] = values[f.key] != null ? String(values[f.key]) : ''; });
    setDraft(init);
    setEditing(true);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      fields.forEach(f => {
        const raw = draft[f.key] ?? '';
        if (f.type === 'number') body[f.key] = raw === '' ? null : Number(raw);
        else body[f.key] = raw === '' ? null : raw;
      });
      await api.put(`/api/propdev/companies/${companyId}`, body);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400">{editing ? 'Editing' : 'Click Edit to update these fields'}</span>
        {!editing ? (
          <button type="button" onClick={startEdit} className="text-xs font-medium text-blue-600 hover:text-blue-700">
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="text-xs font-medium px-2.5 py-1 rounded bg-gray-900 text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(f => (
          <div key={f.key}>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">{f.label}</p>
            {editing ? (
              <input
                type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                value={draft[f.key] ?? ''}
                onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
              />
            ) : (
              <p className="text-sm text-gray-800">
                {f.type === 'number' ? fmtMoney(values[f.key] as number | null) : f.type === 'date' ? fmtDate(values[f.key] as string | null) : (values[f.key] || '—')}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImprovementsTab({ company, onSaved }: { company: CompanyData; onSaved: () => void }) {
  const [form, setForm] = useState({ improvement_type: '', improvement_cost: '', improvement_date: '', contractor_name: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addImprovement() {
    if (!form.improvement_type.trim()) { setError('Improvement type is required'); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/propdev/companies/${company.id}/improvements`, {
        improvement_type: form.improvement_type,
        improvement_cost: form.improvement_cost ? Number(form.improvement_cost) : 0,
        improvement_date: form.improvement_date || null,
        contractor_name: form.contractor_name || null,
        notes: form.notes || null,
      });
      setForm({ improvement_type: '', improvement_cost: '', improvement_date: '', contractor_name: '', notes: '' });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add improvement');
    } finally {
      setSaving(false);
    }
  }

  async function removeImprovement(id: string) {
    try {
      await api.delete(`/api/propdev/improvements/${id}`);
      onSaved();
    } catch (e) {
      console.error('Failed to delete improvement', e);
    }
  }

  const total = company.propertyImprovements.reduce((s, i) => s + (i.improvementCost || 0), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Improvement Log</h3>
          <span className="text-xs text-gray-500">Total {fmtMoney(total)}</span>
        </div>
        {company.propertyImprovements.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">No improvements recorded yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Contractor</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {company.propertyImprovements.map(imp => (
                <tr key={imp.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">{imp.improvementType}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(imp.improvementCost)}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtDate(imp.improvementDate)}</td>
                  <td className="px-3 py-2 text-gray-600">{imp.contractorName || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => void removeImprovement(imp.id)} className="text-gray-400 hover:text-red-600">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Add Improvement</h3>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Type (e.g. Roof replacement)" value={form.improvement_type}
            onChange={e => setForm(f => ({ ...f, improvement_type: e.target.value }))}
            className="text-sm border border-gray-300 rounded px-2 py-1.5" />
          <input placeholder="Cost" type="number" value={form.improvement_cost}
            onChange={e => setForm(f => ({ ...f, improvement_cost: e.target.value }))}
            className="text-sm border border-gray-300 rounded px-2 py-1.5" />
          <input type="date" value={form.improvement_date}
            onChange={e => setForm(f => ({ ...f, improvement_date: e.target.value }))}
            className="text-sm border border-gray-300 rounded px-2 py-1.5" />
          <input placeholder="Contractor" value={form.contractor_name}
            onChange={e => setForm(f => ({ ...f, contractor_name: e.target.value }))}
            className="text-sm border border-gray-300 rounded px-2 py-1.5" />
          <input placeholder="Notes" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="text-sm border border-gray-300 rounded px-2 py-1.5 col-span-2" />
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <button
          type="button"
          onClick={() => void addImprovement()}
          disabled={saving}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded bg-gray-900 text-white disabled:opacity-60"
        >
          <Plus size={13} /> {saving ? 'Adding…' : 'Add Improvement'}
        </button>
      </div>
    </div>
  );
}

export default function PDPropertyDetail({ company, onBack }: { company: CompanyData; onBack: () => void }) {
  const { refetchCompanies, setSelectedCompanyId } = usePropDev();
  const { setTab } = usePropDevNav();
  const [tab, setLocalTab] = useState<Tab>('overview');
  const [exporting, setExporting] = useState(false);
  const p = company.property;

  async function handleExportPdf() {
    setExporting(true);
    try {
      await exportPropDevPropertyProfilePdf(company);
    } catch (e) {
      window.alert(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ fontFamily: PD_FONT, color: PD_TEXT, background: PD_IVORY, padding: 20, borderRadius: 12 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm" style={{ color: PD_SLATE }}>
          <ArrowLeft size={15} /> Back to Properties
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setSelectedCompanyId(company.id); setTab('dashboard'); }}
            className="text-xs rounded px-2.5 py-1.5"
            style={{ color: PD_SLATE, border: `1px solid ${PD_BORDER}`, background: '#FFFFFF' }}
          >
            View in Command Center
          </button>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white disabled:opacity-60"
            style={{ background: PD_NAVY }}
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold" style={{ color: PD_TEXT }}>{p.name || company.name}</h2>
        <p className="text-xs mt-0.5" style={{ color: PD_SLATE }}>{p.address || 'No address on file'} · {company.name}</p>
      </div>

      <div className="flex gap-1" style={{ borderBottom: `1px solid ${PD_BORDER}` }}>
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setLocalTab(t.id)}
            className="px-3 py-2 text-xs font-medium border-b-2 -mb-px"
            style={tab === t.id ? { borderColor: PD_GOLD, color: PD_TEXT } : { borderColor: 'transparent', color: PD_SLATE }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white p-3.5 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Acres</p>
              <p className="text-lg font-bold text-gray-900">{p.totalAcres ? p.totalAcres.toFixed(1) : '—'}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3.5 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Lots</p>
              <p className="text-lg font-bold text-gray-900">{p.totalLots ?? 0}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3.5 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Status</p>
              <p className="text-sm font-semibold text-gray-800 mt-1">{p.currentStatus || '—'}</p>
            </div>
          </div>
          <EditableSection
            companyId={company.id}
            fields={[
              { key: 'property_name', label: 'Property Name', type: 'text' },
              { key: 'address', label: 'Address', type: 'text' },
              { key: 'city', label: 'City', type: 'text' },
              { key: 'state', label: 'State', type: 'text' },
              { key: 'zip_code', label: 'ZIP', type: 'text' },
              { key: 'county', label: 'County', type: 'text' },
              { key: 'land_use_type', label: 'Land Use Type', type: 'text' },
              { key: 'zoning', label: 'Zoning', type: 'text' },
              { key: 'current_status', label: 'Current Status', type: 'text' },
              { key: 'legal_description', label: 'Legal Description', type: 'text' },
            ]}
            values={{
              property_name: p.name, address: p.address, city: p.city ?? null, state: p.state ?? null,
              zip_code: p.zipCode ?? null, county: p.county ?? null, land_use_type: p.landUseType ?? null,
              zoning: p.zoning ?? null, current_status: p.currentStatus ?? null,
              legal_description: p.legalDescription ?? null,
            }}
            onSaved={refetchCompanies}
          />
        </div>
      )}

      {tab === 'tax' && (
        <EditableSection
          companyId={company.id}
          fields={[
            { key: 'tax_parcel_id', label: 'Tax Parcel ID', type: 'text' },
            { key: 'property_tax_annual', label: 'Annual Property Tax', type: 'number' },
            { key: 'tax_assessment_year', label: 'Assessment Year', type: 'number' },
            { key: 'tax_assessed_value', label: 'Assessed Value', type: 'number' },
            { key: 'tax_exemptions', label: 'Exemptions', type: 'text' },
            { key: 'tax_due_date', label: 'Tax Due Date', type: 'date' },
          ]}
          values={{
            tax_parcel_id: p.taxParcelId ?? null, property_tax_annual: p.propertyTaxAnnual ?? null,
            tax_assessment_year: p.taxAssessmentYear ?? null, tax_assessed_value: p.taxAssessedValue ?? null,
            tax_exemptions: p.taxExemptions ?? null, tax_due_date: p.taxDueDate ?? null,
          }}
          onSaved={refetchCompanies}
        />
      )}

      {tab === 'ownership' && (
        <EditableSection
          companyId={company.id}
          fields={[
            { key: 'previous_owner_name', label: 'Previous Owner', type: 'text' },
            { key: 'previous_owner_entity', label: 'Previous Owner Entity', type: 'text' },
            { key: 'acquisition_date', label: 'Acquisition Date', type: 'date' },
            { key: 'acquisition_price', label: 'Acquisition Price', type: 'number' },
            { key: 'acquisition_type', label: 'Acquisition Type', type: 'text' },
            { key: 'title_company', label: 'Title Company', type: 'text' },
            { key: 'deed_reference', label: 'Deed Reference', type: 'text' },
          ]}
          values={{
            previous_owner_name: p.previousOwnerName ?? null, previous_owner_entity: p.previousOwnerEntity ?? null,
            acquisition_date: p.acquisitionDate ?? null, acquisition_price: p.acquisitionPrice ?? null,
            acquisition_type: p.acquisitionType ?? null, title_company: p.titleCompany ?? null,
            deed_reference: p.deedReference ?? null,
          }}
          onSaved={refetchCompanies}
        />
      )}

      {tab === 'improvements' && <ImprovementsTab company={company} onSaved={refetchCompanies} />}

      {tab === 'loans' && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {company.loans.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No loans linked to this property.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 text-left">Lender</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">EMI</th>
                  <th className="px-3 py-2 text-left">Maturity</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {company.loans.map(l => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-900">{l.bank}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(l.balance)}</td>
                    <td className="px-3 py-2 text-right">{l.interestRate ? `${(l.interestRate * 100).toFixed(2)}%` : '—'}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(l.emi)}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtDate(l.maturityDate)}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
