import { useEffect, useMemo, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import api from '../../../services/api';
import type { CompanyData, Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { buildPropDevActionPlan, type ActionItem, type ActionPriority } from '../../../utils/propDevActionPlanData';
import { Toast } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

const PRIORITY_STYLE: Record<ActionPriority, { border: string; bg: string; pillBg: string; pillColor: string }> = {
  Critical: { border: 'var(--overdue)', bg: '#FDFBFF', pillBg: 'var(--overdue-bg)', pillColor: '#6D28D9' },
  Warning: { border: 'var(--pending)', bg: '#FFFEF5', pillBg: 'var(--pending-bg)', pillColor: 'var(--pending-dark)' },
  Info: { border: 'var(--active)', bg: '#F0F4F9', pillBg: 'var(--active-bg)', pillColor: 'var(--active)' },
};

interface Props {
  companies: CompanyData[];
  allLoans: Loan[];
  kpisById: Record<string, PropDevCompanyOverviewKpis>;
  loading: boolean;
}

export default function PDActionPlanTab({ companies, kpisById, loading }: Props) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.get<string[]>('/api/propdev/actions/done').then(res => {
      setDismissedIds(new Set(res.data ?? []));
    }).catch(() => {});
  }, []);

  const actions = useMemo(
    () => buildPropDevActionPlan(companies, kpisById).filter(a => !dismissedIds.has(a.id)),
    [companies, kpisById, dismissedIds],
  );

  async function markDone(a: ActionItem) {
    setDismissedIds(prev => new Set(prev).add(a.id));
    setToast('Action marked complete ✓');
    try {
      await api.post(`/api/propdev/actions/${encodeURIComponent(a.id)}/done`, {
        action_type: a.priority, entity_id: a.entityId,
      });
    } catch {
      // Non-blocking — action logging failure shouldn't undo the UI dismissal.
    }
  }

  const critical = actions.filter(a => a.priority === 'Critical');
  const warning = actions.filter(a => a.priority === 'Warning');
  const info = actions.filter(a => a.priority === 'Info');

  if (loading) return <p style={{ fontSize: 13, color: '#78716C' }}>Loading action plan…</p>;

  function Section({ title, items }: { title: string; items: ActionItem[] }) {
    if (!items.length) return null;
    return (
      <div>
        <div className="esp-section-title">{title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(a => {
            const style = PRIORITY_STYLE[a.priority];
            return (
              <div key={a.id} style={{ borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border)', borderLeft: `4px solid ${style.border}`, background: style.bg }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="esp-pill" style={{ background: style.pillBg, color: style.pillColor }}>{a.priority}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-text)' }}>{a.title}</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--slate)', marginBottom: 4 }}>{a.detail}</div>
                <div style={{ fontSize: 11, color: 'var(--navy-text)', marginBottom: 8 }}>{a.nextStep}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--slate)' }}>{a.dueDate ? `Due ${a.dueDate}` : ''}</span>
                  <button type="button" className="esp-btn-ghost" onClick={() => markDone(a)}>Mark done</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {actions.length === 0 ? (
        <div style={{ background: 'var(--active-bg)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <CheckCircle size={32} color="var(--active)" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--active)' }}>No actions required</div>
          <div style={{ fontSize: 11, color: 'var(--slate)', marginTop: 4 }}>Portfolio is performing within all thresholds</div>
        </div>
      ) : (
        <>
          <Section title="Critical — Immediate Action Required" items={critical} />
          <Section title="Warning — Review Recommended" items={warning} />
          <Section title="Info" items={info} />
        </>
      )}
    </div>
  );
}
