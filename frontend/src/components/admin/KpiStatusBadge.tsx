import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

export function KpiStatusBadge({ status }: { status: string }) {
  if (status === 'MATCH') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">
        <CheckCircle2 size={12} /> MATCH
      </span>
    );
  }
  if (status === 'MISMATCH') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800">
        <XCircle size={12} /> MISMATCH
      </span>
    );
  }
  if (status === 'CHECK_LOGIC') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-900">
        <AlertTriangle size={12} /> CHECK LOGIC
      </span>
    );
  }
  return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">NO DATA</span>;
}
