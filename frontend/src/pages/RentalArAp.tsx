import { useCallback, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';

interface ArRecord {
  id: string;
  company_id: string;
  company_name: string;
  as_of_date: string;
  current_amount: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
  ar_total: number;
}

interface ApRecord {
  id: string;
  company_id: string;
  company_name: string;
  vendor_id: string;
  vendor_name: string;
  as_of_date: string;
  current_amount: number;
  days_1_30: number;
  days_31_60: number;
  days_60_plus: number;
  ap_total: number;
}

interface PortfolioRow {
  company_id: string;
  company_name: string;
  ar: {
    current_amount: number; days_1_30: number; days_31_60: number;
    days_61_90: number; days_90_plus: number;
  } | null;
  ap: {
    current_amount: number; days_1_30: number; days_31_60: number; days_60_plus: number;
  } | null;
  ar_total: number;
  ap_total: number;
  net_working_capital: number;
}

interface PortfolioResponse {
  total_ar: number;
  total_ap: number;
  net_working_capital: number;
  rows: PortfolioRow[];
}

interface CompanyOption { id: string; company_name: string }
interface VendorOption { id: string; vendor_name: string }

const BLANK_AR = { company_id: '', as_of_date: '', current_amount: '', days_1_30: '', days_31_60: '', days_61_90: '', days_90_plus: '' };
const BLANK_AP = { company_id: '', vendor_id: '', as_of_date: '', current_amount: '', days_1_30: '', days_31_60: '', days_60_plus: '' };

function fmt(n: number) {
  return fmtUSD(n);
}

function nwcColor(n: number) {
  if (n > 0) return 'text-green-700';
  if (n < 0) return 'text-red-700';
  return 'text-gray-700';
}

export default function RentalArAp() {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showArForm, setShowArForm] = useState(false);
  const [showApForm, setShowApForm] = useState(false);
  const [arForm, setArForm] = useState({ ...BLANK_AR });
  const [apForm, setApForm] = useState({ ...BLANK_AP });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [portRes, coRes, vendRes] = await Promise.all([
        api.get<PortfolioResponse>('/api/rentals/ar-ap/portfolio'),
        api.get<CompanyOption[]>('/api/rentals/companies'),
        api.get<VendorOption[]>('/api/rentals/vendors'),
      ]);
      setData(portRes.data);
      setCompanies(coRes.data);
      setVendors(vendRes.data);
    } catch {
      setError('Failed to load AR/AP data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitAr(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/rentals/ar', {
        company_id: arForm.company_id,
        as_of_date: arForm.as_of_date,
        current_amount: Number(arForm.current_amount) || 0,
        days_1_30:      Number(arForm.days_1_30)      || 0,
        days_31_60:     Number(arForm.days_31_60)     || 0,
        days_61_90:     Number(arForm.days_61_90)     || 0,
        days_90_plus:   Number(arForm.days_90_plus)   || 0,
      });
      setShowArForm(false);
      setArForm({ ...BLANK_AR });
      await load();
    } catch {
      alert('Failed to save AR snapshot.');
    } finally {
      setSaving(false);
    }
  }

  async function submitAp(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/rentals/ap', {
        company_id: apForm.company_id,
        vendor_id:  apForm.vendor_id,
        as_of_date: apForm.as_of_date,
        current_amount: Number(apForm.current_amount) || 0,
        days_1_30:      Number(apForm.days_1_30)      || 0,
        days_31_60:     Number(apForm.days_31_60)     || 0,
        days_60_plus:   Number(apForm.days_60_plus)   || 0,
      });
      setShowApForm(false);
      setApForm({ ...BLANK_AP });
      await load();
    } catch {
      alert('Failed to save AP snapshot.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingSkeleton rows={6} cols={12} />;
  if (error) return <p className="text-red-600 p-4">{error}</p>;
  if (!data) return null;

  const rows = data.rows;
  const totAr = data.total_ar;
  const totAp = data.total_ap;
  const nwc   = data.net_working_capital;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total AR" value={fmt(totAr)} />
        <KpiCard label="Total AP" value={fmt(totAp)} />
        <KpiCard
          label="Net Working Capital"
          value={fmt(nwc)}
          accent={nwc < 0}
        />
        <KpiCard
          label="Entities Tracked"
          value={String(rows.length)}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => { setShowArForm(true); setShowApForm(false); }}
          className="flex items-center gap-2 bg-[#0E3B36] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#1A5249]"
        >
          <Plus size={16} /> Add AR Snapshot
        </button>
        <button
          onClick={() => { setShowApForm(true); setShowArForm(false); }}
          className="flex items-center gap-2 border border-[#0E3B36] text-[#0E3B36] px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
        >
          <Plus size={16} /> Add AP Snapshot
        </button>
      </div>

      {/* AR form */}
      {showArForm && (
        <Card>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-800">New AR Snapshot</h3>
            <button onClick={() => setShowArForm(false)}><X size={16} /></button>
          </div>
          <form onSubmit={submitAr} className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Entity</label>
              <select required value={arForm.company_id}
                onChange={e => setArForm(f => ({ ...f, company_id: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm">
                <option value="">— select —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">As of Date</label>
              <input required type="date" value={arForm.as_of_date}
                onChange={e => setArForm(f => ({ ...f, as_of_date: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            {(["current_amount","days_1_30","days_31_60","days_61_90","days_90_plus"] as const).map(field => (
              <div key={field}>
                <label className="block text-xs text-gray-500 mb-1">
                  {field === "current_amount" ? "Current" : field === "days_1_30" ? "1-30 Days" : field === "days_31_60" ? "31-60 Days" : field === "days_61_90" ? "61-90 Days" : "90+ Days"}
                </label>
                <input type="number" step="0.01" min="0" value={(arForm as Record<string, string>)[field]}
                  onChange={e => setArForm(f => ({ ...f, [field]: e.target.value }))}
                  className="w-full border rounded px-2 py-1.5 text-sm" placeholder="0.00" />
              </div>
            ))}
            <div className="col-span-2 md:col-span-4 flex gap-2 mt-2">
              <button type="submit" disabled={saving}
                className="bg-[#0E3B36] text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save AR Snapshot'}
              </button>
              <button type="button" onClick={() => setShowArForm(false)}
                className="border px-4 py-1.5 rounded text-sm">Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {/* AP form */}
      {showApForm && (
        <Card>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-800">New AP Snapshot</h3>
            <button onClick={() => setShowApForm(false)}><X size={16} /></button>
          </div>
          <form onSubmit={submitAp} className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Entity</label>
              <select required value={apForm.company_id}
                onChange={e => setApForm(f => ({ ...f, company_id: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm">
                <option value="">— select —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Vendor</label>
              <select required value={apForm.vendor_id}
                onChange={e => setApForm(f => ({ ...f, vendor_id: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm">
                <option value="">— select —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">As of Date</label>
              <input required type="date" value={apForm.as_of_date}
                onChange={e => setApForm(f => ({ ...f, as_of_date: e.target.value }))}
                className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            {(["current_amount","days_1_30","days_31_60","days_60_plus"] as const).map(field => (
              <div key={field}>
                <label className="block text-xs text-gray-500 mb-1">
                  {field === "current_amount" ? "Current" : field === "days_1_30" ? "1-30 Days" : field === "days_31_60" ? "31-60 Days" : "60+ Days"}
                </label>
                <input type="number" step="0.01" min="0" value={(apForm as Record<string, string>)[field]}
                  onChange={e => setApForm(f => ({ ...f, [field]: e.target.value }))}
                  className="w-full border rounded px-2 py-1.5 text-sm" placeholder="0.00" />
              </div>
            ))}
            <div className="col-span-2 md:col-span-4 flex gap-2 mt-2">
              <button type="submit" disabled={saving}
                className="bg-[#0E3B36] text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save AP Snapshot'}
              </button>
              <button type="button" onClick={() => setShowApForm(false)}
                className="border px-4 py-1.5 rounded text-sm">Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {/* Portfolio table */}
      <Card>
        <h3 className="font-semibold text-gray-800 mb-3">AR & AP by Entity</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-700">
            <thead>
              <tr className="bg-[#0E3B36] text-white text-xs">
                <th className="px-3 py-2 text-left whitespace-nowrap">Entity</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AR Current</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AR 1-30</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AR 31-60</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AR 61-90</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AR 90+</th>
                <th className="px-3 py-2 text-right whitespace-nowrap font-bold">AR Total</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AP Current</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AP 1-30</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AP 31-60</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">AP 60+</th>
                <th className="px-3 py-2 text-right whitespace-nowrap font-bold">AP Total</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">NWC</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.company_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{row.company_name}</td>
                  <td className="px-3 py-2 text-right">{row.ar ? fmt(row.ar.current_amount) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.ar ? fmt(row.ar.days_1_30) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.ar ? fmt(row.ar.days_31_60) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.ar ? fmt(row.ar.days_61_90) : '—'}</td>
                  <td className="px-3 py-2 text-right text-red-600">{row.ar ? fmt(row.ar.days_90_plus) : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmt(row.ar_total)}</td>
                  <td className="px-3 py-2 text-right">{row.ap ? fmt(row.ap.current_amount) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.ap ? fmt(row.ap.days_1_30) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.ap ? fmt(row.ap.days_31_60) : '—'}</td>
                  <td className="px-3 py-2 text-right text-amber-600">{row.ap ? fmt(row.ap.days_60_plus) : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmt(row.ap_total)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${nwcColor(row.net_working_capital)}`}>
                    {fmt(row.net_working_capital)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-gray-400">
                    No AR/AP snapshots yet. Add the first one above.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#0E3B36] text-white font-semibold">
                  <td className="px-3 py-2">Portfolio Total</td>
                  <td className="px-3 py-2 text-right" colSpan={5}></td>
                  <td className="px-3 py-2 text-right">{fmt(totAr)}</td>
                  <td className="px-3 py-2 text-right" colSpan={4}></td>
                  <td className="px-3 py-2 text-right">{fmt(totAp)}</td>
                  <td className={`px-3 py-2 text-right ${nwc >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(nwc)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
