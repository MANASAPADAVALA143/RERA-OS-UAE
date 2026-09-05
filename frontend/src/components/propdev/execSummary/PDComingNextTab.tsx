import { Clock } from 'lucide-react';
import { EmptyState } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

export default function PDComingNextTab({ title, note }: { title: string; note: string }) {
  return (
    <div className="esp-scope esp-fade-in">
      <div className="esp-card">
        <div className="esp-section-title">{title}</div>
        <EmptyState icon={<Clock size={32} />} title={`${title} isn't wired in yet`} note={note} />
      </div>
    </div>
  );
}
