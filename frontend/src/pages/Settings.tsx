import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import CompanyRegistry from './settings/CompanyRegistry';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';

type Tab = 'team' | 'ai' | 'company' | 'audit' | 'registry';

interface TeamMember extends Record<string, unknown> {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_at: string | null;
  joined_at: string | null;
}

interface TenantSettings {
  company_name: string;
  subscription_tier: string;
  ai_narrative_enabled: boolean;
}

interface AuditEntry extends Record<string, unknown> {
  date: string;
  feature: string;
  success: boolean;
  endpoint: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'team',     label: 'Team'             },
  { id: 'ai',       label: 'AI'               },
  { id: 'company',  label: 'Company'          },
  { id: 'audit',    label: 'AI Usage Log'     },
  { id: 'registry', label: 'Company Registry' },
];

const ROLES = ['owner', 'admin', 'cfo', 'controller', 'analyst', 'viewer'];

export default function Settings() {
  const { canWrite, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>('team');
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const fetchTeam = useCallback(async () => {
    const { data } = await api.get<TeamMember[]>('/api/auth/team');
    setTeam(data);
  }, []);

  const fetchSettings = useCallback(async () => {
    const { data } = await api.get<TenantSettings>('/api/tenant/settings');
    setSettings(data);
    setCompanyName(data.company_name || '');
  }, []);

  const fetchAudit = useCallback(async () => {
    const { data } = await api.get<AuditEntry[]>('/api/real-estate/ai/audit-log');
    setAuditLog(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchTeam(), fetchSettings(), fetchAudit()])
      .finally(() => setLoading(false));
  }, [fetchTeam, fetchSettings, fetchAudit]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteMsg('');
    try {
      const { data } = await api.post<{ message: string }>('/api/auth/invite-user', {
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteMsg(data.message);
      setInviteEmail('');
      fetchTeam();
    } catch (err: unknown) {
      setInviteMsg(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setInviting(false);
    }
  };

  const patchSettings = async (patch: Partial<TenantSettings>) => {
    setSaving(true);
    setSaveMsg('');
    try {
      const { data } = await api.patch<TenantSettings>('/api/tenant/settings', patch);
      setSettings(data);
      setSaveMsg('Settings saved.');
      refreshProfile();
    } catch {
      setSaveMsg('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleAiToggle = () => {
    if (!settings) return;
    patchSettings({ ai_narrative_enabled: !settings.ai_narrative_enabled });
  };

  const handleCompanySave = (e: React.FormEvent) => {
    e.preventDefault();
    patchSettings({ company_name: companyName });
  };

  const teamColumns: Column<TeamMember>[] = [
    { key: 'email', label: 'Email', sortValue: (r) => r.email },
    { key: 'role', label: 'Role', render: (r) => <Badge variant="accent">{r.role}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
    { key: 'joined_at', label: 'Joined', render: (r) => (r.joined_at ? new Date(r.joined_at).toLocaleDateString() : r.invited_at ? `Invited ${new Date(r.invited_at).toLocaleDateString()}` : '—') },
  ];

  const auditColumns: Column<AuditEntry>[] = [
    { key: 'date', label: 'Date', render: (r) => new Date(r.date).toLocaleString(), sortValue: (r) => r.date },
    { key: 'feature', label: 'Feature', render: (r) => r.feature.replace(/_/g, ' ') },
    { key: 'endpoint', label: 'Endpoint', render: (r) => <span className="text-xs text-gray-500 font-mono">{r.endpoint}</span> },
    { key: 'success', label: 'Status', render: (r) => (
      <span className={r.success ? 'text-green-700' : 'text-red-600'}>{r.success ? 'Success' : 'Failed'}</span>
    ) },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-charcoal">Settings</h1>
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Settings</h1>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === id ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-charcoal'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'team' && (
        <ErrorBoundary>
          <Card title="Team Members">
            <Table columns={teamColumns} data={team} emptyMessage="No team members" />
            {canWrite && (
              <form onSubmit={handleInvite} className="mt-6 pt-6 border-t border-gray-100 space-y-3">
                <p className="text-sm font-medium text-charcoal">Invite User</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="email"
                    required
                    placeholder="email@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-accent"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50"
                  >
                    {inviting ? 'Sending…' : 'Send Invite'}
                  </button>
                </div>
                {inviteMsg && <p className="text-sm text-gray-600">{inviteMsg}</p>}
              </form>
            )}
          </Card>
        </ErrorBoundary>
      )}

      {tab === 'ai' && (
        <ErrorBoundary>
          <Card title="AI Narrative">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-charcoal">AI Narrative Enabled</p>
                <p className="text-sm text-gray-500 mt-1">
                  When enabled, morning briefings, cost explanations, and parcel comparisons use AI. When disabled, rule-based fallbacks are used.
                </p>
              </div>
              <button
                onClick={handleAiToggle}
                disabled={!canWrite || saving}
                className={`relative w-12 h-7 rounded-full transition-colors ${settings?.ai_narrative_enabled ? 'bg-accent' : 'bg-gray-300'} disabled:opacity-50`}
                aria-pressed={settings?.ai_narrative_enabled}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                    settings?.ai_narrative_enabled ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
            {!canWrite && <p className="text-xs text-gray-400 mt-3">Only owners and admins can change this setting.</p>}
            {saveMsg && <p className="text-sm text-gray-600 mt-3">{saveMsg}</p>}
          </Card>
        </ErrorBoundary>
      )}

      {tab === 'company' && (
        <ErrorBoundary>
          <Card title="Company Profile">
            <form onSubmit={handleCompanySave} className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  disabled={!canWrite}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-accent disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subscription Tier</label>
                <p className="text-sm text-charcoal capitalize">{settings?.subscription_tier || '—'}</p>
              </div>
              {canWrite && (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
              {saveMsg && <p className="text-sm text-gray-600">{saveMsg}</p>}
            </form>
          </Card>
        </ErrorBoundary>
      )}

      {tab === 'audit' && (
        <ErrorBoundary>
          <Card title="AI Usage Log">
            <p className="text-sm text-gray-500 mb-4">Last 50 AI feature calls for your tenant.</p>
            <Table columns={auditColumns} data={auditLog} emptyMessage="No AI usage recorded yet" />
          </Card>
        </ErrorBoundary>
      )}

      {tab === 'registry' && (
        <ErrorBoundary>
          <CompanyRegistry embedded={true} />
        </ErrorBoundary>
      )}
    </div>
  );
}
