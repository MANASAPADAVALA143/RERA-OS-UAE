import { useState } from 'react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { Download, FileSpreadsheet } from 'lucide-react';

interface ReportDef {
  id: string;
  title: string;
  description: string;
  endpoint: string;
  params?: Record<string, string>;
  filename: string;
}

const REPORTS: ReportDef[] = [
  {
    id: 'rent_roll',
    title: 'Rent Roll',
    description: 'All units with tenant, lease, rent, and current status.',
    endpoint: '/api/rentals/units',
    params: { format: 'csv' },
    filename: 'rent_roll.csv',
  },
  {
    id: 'occupancy',
    title: 'Occupancy Report',
    description: 'Occupancy percentage by company with unit counts.',
    endpoint: '/api/rentals/companies',
    params: { format: 'csv' },
    filename: 'occupancy_report.csv',
  },
  {
    id: 'vacancy_loss',
    title: 'Vacancy Loss Report',
    description: 'Vacant units with monthly rent loss calculation.',
    endpoint: '/api/rentals/units',
    params: { status: 'vacant', format: 'csv' },
    filename: 'vacancy_loss.csv',
  },
  {
    id: 'lease_expiry',
    title: 'Lease Expiry 30/60/90',
    description: 'Leases expiring within the next 90 days sorted by days remaining.',
    endpoint: '/api/rentals/leases',
    params: { format: 'csv' },
    filename: 'lease_expiry.csv',
  },
  {
    id: 'arrears_aging',
    title: 'Arrears Aging',
    description: 'All units with outstanding balances bucketed by aging period.',
    endpoint: '/api/rentals/collections',
    params: { format: 'csv' },
    filename: 'collections.csv',
  },
  {
    id: 'partner_distribution',
    title: 'Partner Distribution',
    description: 'NOI share per partner per company for the current month.',
    endpoint: '/api/rentals/ownership',
    params: { format: 'csv' },
    filename: 'partner_distribution.csv',
  },
];

export default function RentalReports() {
  const [generating, setGenerating] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const downloadCfoDashboard = async () => {
    setExporting(true);
    setExportError('');
    try {
      const response = await api.get('/api/rentals/export/cfo-dashboard', { responseType: 'blob' });
      const today = new Date().toISOString().split('T')[0];
      const filename = `EstateCFO_Dashboard_${today}.xlsx`;
      const url = window.URL.createObjectURL(new Blob([response.data as BlobPart]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setExportError('Failed to generate Excel export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const generateCSV = async (report: ReportDef) => {
    setGenerating(report.id);
    setErrors((prev) => ({ ...prev, [report.id]: '' }));
    try {
      const response = await api.get(report.endpoint, {
        params: report.params,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data as BlobPart]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', report.filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setErrors((prev) => ({ ...prev, [report.id]: 'Failed to generate report.' }));
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Reports</h1>
      <p className="text-sm text-gray-500">Generate CSV reports for download. All reports are scoped to your portfolio.</p>

      {/* CFO Dashboard Excel Export */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="p-3 bg-green-50 rounded-xl">
            <FileSpreadsheet size={28} className="text-green-800" />
          </div>
          <div className="flex-1 space-y-2">
            <h3 className="font-bold text-lg text-gray-800">CFO Dashboard Export</h3>
            <p className="text-sm text-gray-500">
              Complete portfolio workbook — Dashboard KPIs, Lender Risk (DSCR/LTV), AR &amp; AP aging,
              OpEx composition, and US/Texas compliance calendar. Values-only (no formula drift).
            </p>
            <p className="text-xs text-gray-400">
              Sheets: DASHBOARD · AR &amp; AP · OpEx Composition · COMPLIANCE
            </p>
            {exportError && <p className="text-xs text-red-700">{exportError}</p>}
            <button
              onClick={downloadCfoDashboard}
              disabled={exporting}
              className="flex items-center gap-2 px-5 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 transition-colors disabled:opacity-60"
            >
              <Download size={15} />
              {exporting ? 'Generating…' : 'Download Excel (.xlsx)'}
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {REPORTS.map((report) => (
          <Card key={report.id}>
            <div className="space-y-3">
              <h3 className="font-bold text-primary">{report.title}</h3>
              <p className="text-sm text-gray-500">{report.description}</p>
              {errors[report.id] && <p className="text-xs text-red-700">{errors[report.id]}</p>}
              <button
                onClick={() => generateCSV(report)}
                disabled={generating === report.id}
                className="flex items-center gap-2 w-full justify-center py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Download size={15} />
                {generating === report.id ? 'Generating…' : 'Generate CSV'}
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
