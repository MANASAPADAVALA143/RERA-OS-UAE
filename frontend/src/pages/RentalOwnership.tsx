import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

interface OwnershipItem {
  id: string;
  company_id: string;
  company_name: string | null;
  partner_name: string;
  ownership_pct: number;
  role: string;
  noi_share: number;
}

interface PartnerGroup {
  partner_name: string;
  company_count: number;
  total_noi_share: number;
  stakes: OwnershipItem[];
}

interface OwnershipResponse {
  items: OwnershipItem[];
  by_partner: PartnerGroup[];
}

export default function RentalOwnership() {
  const [data, setData] = useState<OwnershipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<OwnershipResponse>('/api/rentals/ownership');
      setData(res.data);
    } catch {
      setError('Failed to load ownership data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) return <LoadingSkeleton rows={6} />;
  if (error || !data) return <div className="text-red-600 p-4">{error || 'No data'}</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Ownership</h1>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {data.by_partner.map((p) => (
          <div key={p.partner_name} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="font-bold text-primary text-sm">{p.partner_name}</p>
            <p className="text-2xl font-bold mt-1">{p.company_count}</p>
            <p className="text-xs text-gray-500">companies</p>
            <p className={`text-sm font-medium mt-2 ${p.total_noi_share >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {fmtUSD(p.total_noi_share)} NOI share
            </p>
          </div>
        ))}
      </div>

      {/* Per-partner sections */}
      {data.by_partner.map((p) => (
        <Card key={p.partner_name} title={p.partner_name}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 px-2 font-medium">Company</th>
                  <th className="py-2 px-2 font-medium">Role</th>
                  <th className="py-2 px-2 font-medium">Ownership %</th>
                  <th className="py-2 px-2 font-medium">NOI Share (This Month)</th>
                  <th className="py-2 px-2 font-medium">Ownership Bar</th>
                </tr>
              </thead>
              <tbody>
                {p.stakes.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2 px-2 font-medium">{s.company_name}</td>
                    <td className="py-2 px-2 text-gray-500">{s.role.replace(/_/g, ' ')}</td>
                    <td className="py-2 px-2">{fmtPct(s.ownership_pct)}</td>
                    <td className="py-2 px-2">
                      <span className={s.noi_share >= 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                        {fmtUSD(s.noi_share)}
                      </span>
                    </td>
                    <td className="py-2 px-2 w-40">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(s.ownership_pct * 100).toFixed(1)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td className="py-2 px-2 font-bold" colSpan={3}>Total NOI Share</td>
                  <td className={`py-2 px-2 font-bold ${p.total_noi_share >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {fmtUSD(p.total_noi_share)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
