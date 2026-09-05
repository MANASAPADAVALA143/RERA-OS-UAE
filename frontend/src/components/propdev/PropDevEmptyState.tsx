import { Upload } from 'lucide-react';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import { parchmentStyles } from '../../theme/parchmentTheme';

export default function PropDevEmptyState() {
  const { setTab } = usePropDevNav();

  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Upload size={28} className="text-gray-400" />
      </div>
      <p className="text-gray-600 text-base max-w-md">
        No data found. Upload your Excel file to get started.
      </p>
      <button
        type="button"
        onClick={() => setTab('upload')}
        className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors"
        style={{ ...parchmentStyles.tabActive, padding: '10px 20px' }}
      >
        Upload Data →
      </button>
    </div>
  );
}
