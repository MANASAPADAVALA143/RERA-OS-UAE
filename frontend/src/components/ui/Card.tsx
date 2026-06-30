import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}

export function Card({ children, className = '', title, action }: CardProps) {
  return (
    <div className={`rounded-xl border shadow-sm ${className}`} style={{ background: '#151B3D', borderColor: '#2A3158' }}>
      {(title || action) && (
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: '#2A3158' }}>
          {title && <span className="font-semibold" style={{ color: '#60A5FA' }}>{title}</span>}
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

const GRADIENT_MAP: Record<string, string> = {
  orange: 'linear-gradient(135deg, #F97316, #EA580C)',
  purple: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
  blue:   'linear-gradient(135deg, #3B82F6, #1D4ED8)',
  teal:   'linear-gradient(135deg, #14B8A6, #0D9488)',
  red:    'linear-gradient(135deg, #EF4444, #DC2626)',
  indigo: 'linear-gradient(135deg, #6366F1, #4338CA)',
};

export function KpiCard({
  label, value, sub, accent = false, gradient,
}: {
  label: string; value: string; sub?: string; accent?: boolean; gradient?: keyof typeof GRADIENT_MAP;
}) {
  if (gradient) {
    const bg = GRADIENT_MAP[gradient] ?? GRADIENT_MAP.blue;
    return (
      <div className="rounded-xl p-5 shadow-sm" style={{ background: bg, color: 'white' }}>
        <p className="text-sm opacity-80">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
      </div>
    );
  }
  return (
    <div
      className="rounded-xl p-5 shadow-sm"
      style={
        accent
          ? { background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)', color: 'white' }
          : { background: '#151B3D', border: '1px solid #2A3158', color: '#F1F5F9' }
      }
    >
      <p className="text-sm" style={{ color: accent ? 'rgba(255,255,255,0.75)' : '#94A3B8' }}>{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: accent ? 'rgba(255,255,255,0.6)' : '#64748B' }}>{sub}</p>}
    </div>
  );
}
