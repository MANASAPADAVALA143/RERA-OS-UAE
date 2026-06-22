import { useState } from 'react';
import { Camera } from 'lucide-react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import ConstructionDailyPhotos from './ConstructionDailyPhotos';

// Sub-navigation items — add new sub-items here as the feature grows.
type SubTab = 'daily_photos';
// | 'submittals'  ← slot for next sub-item

const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'daily_photos', label: 'Daily Progress Photos', icon: <Camera className="h-4 w-4" /> },
  // { id: 'submittals', label: 'Submittals', icon: <FileText className="h-4 w-4" /> },
];

interface ConstructionDocumentsProps {
  projectId: string;
}

export default function ConstructionDocuments({ projectId }: ConstructionDocumentsProps) {
  const [subTab, setSubTab] = useState<SubTab>('daily_photos');

  return (
    <div className="space-y-5">
      {/* Internal sub-navigation */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {SUB_TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              subTab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-charcoal'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {subTab === 'daily_photos' && (
        <ErrorBoundary>
          <ConstructionDailyPhotos projectId={projectId} />
        </ErrorBoundary>
      )}
    </div>
  );
}
