/**
 * Consultancy & Outsourcing — Clients.
 * Shell page: no backend data model exists yet for a client roster (unlike Billing &
 * Collections, which now has one). Every card/chart/table below shows an honest empty
 * state rather than fake numbers — this page establishes the intended layout so the
 * data-model + upload-flow pass that follows has a clear target to build against.
 */
import { Users } from 'lucide-react';
import { useConsultancy } from '../../contexts/ConsultancyContext';
import { ParchmentKpiTile } from '../../components/ui/ParchmentKpiTile';
import { PT, PT_FONT, PT_CARD } from '../../utils/parchmentTypography';
import { Table, type Column } from '../../components/ui/Table';

interface ClientRow extends Record<string, unknown> {
  id: string;
  name: string;
  engagementStart: string;
  contractValue: number;
  monthlyBilling: number;
  status: string;
  primaryContact: string;
}

const columns: Column<ClientRow>[] = [
  { key: 'name', label: 'Client Name' },
  { key: 'engagementStart', label: 'Engagement Start' },
  { key: 'contractValue', label: 'Contract Value' },
  { key: 'monthlyBilling', label: 'Monthly Billing' },
  { key: 'status', label: 'Status' },
  { key: 'primaryContact', label: 'Primary Contact' },
];

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center text-center px-4" style={{ height: 200, color: PT.mutedLight }}>
      {message}
    </div>
  );
}

export default function ConsultancyClients() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useConsultancy();
  const companyId = selectedCompanyId !== 'all' && companies.some(c => c.id === selectedCompanyId)
    ? selectedCompanyId
    : (companies[0]?.id ?? '');

  return (
    <div style={{ background: PT.pageBg, minHeight: '100vh', fontSize: 13, color: PT.text }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 style={PT_FONT.pageTitle}>Clients</h1>
          <p style={PT_FONT.pageSubtitle}>Client roster, contract value, and concentration risk.</p>
        </div>
        {companies.length > 0 && (
          <select
            value={companyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5"
            style={{ borderColor: PT.border, background: PT.cardBg }}
          >
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {!companies.length ? (
        <div className="border rounded-2xl shadow-sm p-6" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Users size={32} className="text-gray-400 mb-3" />
            <p className="text-lg font-semibold text-gray-700 mb-2">No companies yet</p>
            <p className="text-sm text-gray-400">Add a consulting/staffing company to get started.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl px-4 py-3 text-xs" style={{ background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E' }}>
            No data uploaded — this page needs a client roster upload capability that hasn&apos;t been built yet.
            The layout below shows what this tab will display once that data source exists.
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <ParchmentKpiTile label="Total Active Clients" value="—" sub="No data uploaded" />
            <ParchmentKpiTile label="Total Contract Value" value="—" sub="No data uploaded" />
            <ParchmentKpiTile label="New Clients (this period)" value="—" sub="No data uploaded" />
            <ParchmentKpiTile label="Client Churn Rate" value="—" sub="No data uploaded" />
            <ParchmentKpiTile label="Avg Contract Value" value="—" sub="No data uploaded" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div style={PT_CARD}>
              <p style={PT_FONT.chartTitle}>Client Concentration</p>
              <p style={PT_FONT.chartSubtitle}>Top 5 clients as % of total revenue — flags concentration risk above 20%</p>
              <EmptyChart message="No data uploaded — upload a client roster to populate this chart." />
            </div>
            <div style={PT_CARD}>
              <p style={PT_FONT.chartTitle}>Revenue by Client Type / Industry</p>
              <EmptyChart message="No data uploaded — upload a client roster to populate this chart." />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div style={PT_CARD}>
              <p style={PT_FONT.chartTitle}>Client Revenue Trend</p>
              <p style={PT_FONT.chartSubtitle}>Multi-year trend per top client</p>
              <EmptyChart message="No data uploaded — upload a client roster to populate this chart." />
            </div>
            <div style={PT_CARD}>
              <p style={PT_FONT.chartTitle}>New vs Churned Clients by Month</p>
              <EmptyChart message="No data uploaded — upload a client roster to populate this chart." />
            </div>
          </div>

          <div style={PT_CARD}>
            <p style={PT_FONT.chartTitle}>Client Roster</p>
            <Table<ClientRow>
              columns={columns}
              data={[]}
              emptyMessage="No data uploaded — upload a client roster to populate this section."
            />
          </div>
        </div>
      )}
    </div>
  );
}
