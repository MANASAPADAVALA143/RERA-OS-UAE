type Status = 'healthy' | 'watch' | 'danger' | 'neutral' | string;

const STATUS_MAP: Record<string, { bg: string; text: string; label?: string }> = {
  on_track: { bg: 'bg-green-100', text: 'text-green-800', label: 'On Track' },
  healthy: { bg: 'bg-green-100', text: 'text-green-800', label: 'Healthy' },
  watch: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Watch' },
  over_budget: { bg: 'bg-red-100', text: 'text-red-800', label: 'Over Budget' },
  late: { bg: 'bg-red-100', text: 'text-red-800', label: 'Late' },
  pending_approval: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pending Approval' },
  submitted: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Submitted' },
  compliant: { bg: 'bg-green-100', text: 'text-green-800', label: 'Compliant' },
  missing: { bg: 'bg-red-100', text: 'text-red-800', label: 'Missing' },
  expired: { bg: 'bg-red-100', text: 'text-red-800', label: 'Expired' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'In Progress' },
  breach: { bg: 'bg-red-100', text: 'text-red-800', label: 'Breach' },
  danger: { bg: 'bg-red-100', text: 'text-red-800', label: 'At Risk' },
  approved: { bg: 'bg-green-100', text: 'text-green-800' },
  closed: { bg: 'bg-green-100', text: 'text-green-800' },
  available: { bg: 'bg-blue-100', text: 'text-blue-800' },
  reserved: { bg: 'bg-amber-100', text: 'text-amber-800' },
  under_contract: { bg: 'bg-purple-100', text: 'text-purple-800' },
  none: { bg: 'bg-gray-100', text: 'text-gray-700' },
  neutral: { bg: 'bg-gray-100', text: 'text-gray-700' },
};

export function StatusPill({ status }: { status: Status }) {
  const key = (status || 'neutral').toLowerCase().replace(/ /g, '_');
  const style = STATUS_MAP[key] || STATUS_MAP.neutral;
  const label = style.label || status.replace(/_/g, ' ');
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${style.bg} ${style.text}`}>
      {label}
    </span>
  );
}
