import { useCallback, useEffect, useState } from 'react';
import { Plus, X, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';

interface RiskItem {
  vendor_name: string;
  vendor_category: string | null;
  ap_amount: number;
  ap_pct: number;
  concentration_flag: boolean;
  open_maintenance: number;
  repeat_issues_flag: boolean;
  last_payment_date: string | null;
}

interface VendorRiskResponse {
  total_ap: number;
  vendor_count: number;
  concentration_risk_count: number;
  repeat_issue_count: number;
  items: RiskItem[];
}

interface VendorOption { id: string; vendor_name: string; vendor_category: string | null }

const BLANK_VENDOR = { vendor_name: '', vendor_category: 'other', contact_name: '', contact_email: '', contact_phone: '', last_payment_date: '' };

const CAT_LABELS: Record<string, string> = {
  maintenance: 'Maintenance', utilities: 'Utilities', property_mgmt: 'Property Mgmt',
  insurance: 'Insurance', landscaping: 'Landscaping', cleaning: 'Cleaning',
  security: 'Security', accounting: 'Accounting', legal: 'Legal', other: 'Other',
};

function pct(n: number) {
  if (!isFinite(n) || isNaN(n) || n === 0) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function concentrationBadge(flag: boolean) {
  return flag
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 font-medium"><AlertTriangle size={11} />High</span>
    : <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">OK</span>;
}

function repeatBadge(flag: boolean) {
  return flag
    ? <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 font-medium">Yes</span>
    : <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">No</span>;
}

export default function RentalVendorRisk() {
  const [data, setData] = useState<VendorRiskResponse | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_VENDOR });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [riskRes, vendRes] = await Promise.all([
        api.get<VendorRiskResponse>('/api/rentals/vendor-risk'),
        api.get<VendorOption[]>('/api/rentals/vendors'),
      ]);
      setData(riskRes.data);
      setVendors(vendRes.data);
    } catch {
      setError('Failed to load vendor risk data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitVendor(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/rentals/vendors', {
        vendor_name: form.vendor_name.trim(),
        vendor_category: form.vendor_category,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        last_payment_date: form.last_payment_date || null,
      });
      setShowForm(false);
      setForm({ ...BLANK_VENDOR });
      await load();
    } catch {
      alert('Failed to save vendor.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteVendor(id: string) {
    if (!confirm('Delete this vendor?')) return;
    try {
      await api.delete(`/api/rentals/vendors/${id}`);
      await load();
    } catch {
      alert('Failed to delete vendor.');
    }
  }

  if (loading) return <LoadingSkeleton rows={6} />;
  if (error) return <p className="text-red-600 p-4">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total AP Exposure" value={fmtUSD(data.total_ap)} />
        <KpiCard label="Vendors Tracked" value={String(data.vendor_count)} />
        <KpiCard label="Concentration Risk" value={String(data.concentration_risk_count)}
          accent={data.concentration_risk_count > 0} />
        <KpiCard label="Repeat Issues" value={String(data.repeat_issue_count)}
          accent={data.repeat_issue_count > 0} />
      </div>

      {/* Add vendor */}
      <div>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-[#0E3B36] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#1A5249]">
          <Plus size={16} /> Add Vendor
        </button>
      </div>

      {showForm && (
        <Card>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-800">New Vendor</h3>
            <button onClick={() => setShowForm(false)}><X size={16} /></button>
          </div>
          <form onSubmit={submitVendor} className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Vendor Name *</label>
              <input required value={form.vendor_name}
                onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <select value={form.vendor_category}
                onChange={e => setForm(f => ({ ...f, vendor_category: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm">
                {Object.entries(CAT_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Contact Name</label>
              <input value={form.contact_name}
                onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Contact Email</label>
              <input type="email" value={form.contact_email}
                onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Contact Phone</label>
              <input value={form.contact_phone}
                onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Last Payment Date</label>
              <input type="date" value={form.last_payment_date}
                onChange={e => setForm(f => ({ ...f, last_payment_date: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div className="col-span-2 md:col-span-3 flex gap-2 mt-1">
              <button type="submit" disabled={saving}
                className="bg-[#0E3B36] text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Vendor'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="border px-4 py-1.5 rounded text-sm">Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {/* Risk table */}
      <Card>
        <h3 className="font-semibold text-gray-800 mb-3">Vendor Risk Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-700">
            <thead>
              <tr className="bg-[#0E3B36] text-white text-xs">
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Total AP Owed</th>
                <th className="px-3 py-2 text-right">% of Total AP</th>
                <th className="px-3 py-2 text-center">Concentration</th>
                <th className="px-3 py-2 text-right">Open Maint.</th>
                <th className="px-3 py-2 text-center">Repeat Issues</th>
                <th className="px-3 py-2 text-right">Last Payment</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={item.vendor_name} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 font-medium">{item.vendor_name}</td>
                  <td className="px-3 py-2 text-gray-500">{item.vendor_category ? CAT_LABELS[item.vendor_category] ?? item.vendor_category : '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtUSD(item.ap_amount)}</td>
                  <td className="px-3 py-2 text-right">{pct(item.ap_pct)}</td>
                  <td className="px-3 py-2 text-center">{concentrationBadge(item.concentration_flag)}</td>
                  <td className="px-3 py-2 text-right">{item.open_maintenance}</td>
                  <td className="px-3 py-2 text-center">{repeatBadge(item.repeat_issues_flag)}</td>
                  <td className="px-3 py-2 text-right">{item.last_payment_date ?? '—'}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                    No vendors yet. Add the first one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Registered vendors list */}
      {vendors.length > 0 && (
        <Card>
          <h3 className="font-semibold text-gray-800 mb-3">Registered Vendors</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-700">
              <thead>
                <tr className="bg-gray-100 text-gray-600 text-xs">
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v, i) => (
                  <tr key={v.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2">{v.vendor_name}</td>
                    <td className="px-3 py-2 text-gray-500">{v.vendor_category ? CAT_LABELS[v.vendor_category] ?? v.vendor_category : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => deleteVendor(v.id)}
                        className="text-red-500 hover:text-red-700 text-xs">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
