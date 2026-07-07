import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  titleClassName?: string;
  action?: ReactNode;
}

export function Card({ children, className = '', title, titleClassName, action }: CardProps) {
  return (
    <div className={`rounded-xl border shadow-sm ${className}`}
      style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
      {(title || action) && (
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3"
          style={{ borderColor: '#DDD8CC' }}>
          {title && (
            <span className={`font-semibold ${titleClassName ?? 'text-sm'}`}
              style={{ color: '#92400E' }}>{title}</span>
          )}
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function KpiCard({
  label, value, sub, accent = false, gradient,
}: {
  label: string; value: string; sub?: string; accent?: boolean; gradient?: string;
}) {
  // gradient prop kept for backward compat — maps to amber tones
  if (gradient) {
    const GRADIENT_MAP: Record<string, string> = {
      orange: 'linear-gradient(135deg, #F97316, #EA580C)',
      purple: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
      teal:   'linear-gradient(135deg, #14B8A6, #0D9488)',
      red:    'linear-gradient(135deg, #EF4444, #DC2626)',
      amber:  'linear-gradient(135deg, #D4AF37, #B8962E)',
      blue:   'linear-gradient(135deg, #D4AF37, #B8962E)', // remap blue→amber
      indigo: 'linear-gradient(135deg, #D4AF37, #B8962E)', // remap indigo→amber
    };
    const bg = GRADIENT_MAP[gradient] ?? GRADIENT_MAP.amber;
    return (
      <div className="rounded-xl p-5 shadow-sm" style={{ background: bg, color: 'white' }}>
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.75)' }}>{label}</p>
        <p className="text-2xl font-bold mt-1" style={{ fontWeight: 500, fontSize: '22px' }}>{value}</p>
        {sub && <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>{sub}</p>}
      </div>
    );
  }

  // Hero card (accent=true): dark bg, gold border
  if (accent) {
    return (
      <div className="rounded-xl p-5 shadow-sm"
        style={{ background: '#161310', border: '1px solid #D4AF37' }}>
        <p className="text-xs font-medium uppercase tracking-wider"
          style={{ color: '#D4AF37', letterSpacing: '0.05em' }}>{label}</p>
        <p className="mt-1 font-medium" style={{ color: 'white', fontSize: '22px', fontWeight: 500 }}>{value}</p>
        {sub && <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>{sub}</p>}
      </div>
    );
  }

  // Standard card: cream bg, amber-brown label, dark value
  return (
    <div className="rounded-xl p-5 shadow-sm"
      style={{ background: '#F7F5F0', border: '1px solid #DDD8CC' }}>
      <p className="text-sm" style={{ color: '#92400E' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: '#1C1917' }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: '#A8A29E' }}>{sub}</p>}
    </div>
  );
}
