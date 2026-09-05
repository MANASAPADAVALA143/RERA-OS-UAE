import { Clock } from 'lucide-react';
import { PT, PT_FONT } from '../../utils/parchmentTypography';

/** Phase-2 placeholder for tabs needing employee/deployment data not yet uploaded. */
export default function ConsultancyComingSoon({ label }: { label: string }) {
  return (
    <div style={{ background: PT.pageBg, minHeight: '60vh', fontSize: 13, color: PT.text }}>
      <h1 style={PT_FONT.pageTitle}>{label}</h1>
      <div className="flex flex-col items-center justify-center h-64 text-center mt-6">
        <Clock size={32} className="text-gray-400 mb-3" />
        <p className="text-lg font-semibold text-gray-700 mb-2">Coming soon</p>
        <p className="text-sm text-gray-400 max-w-md">
          {label} needs employee/deployment data that hasn't been uploaded yet. This tab will
          light up once real Workforce and Deployment data is available for this segment.
        </p>
      </div>
    </div>
  );
}
