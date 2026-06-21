import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Card({ children, className = '', title }: CardProps) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>
      {title && <div className="px-5 py-3 border-b border-gray-100 font-semibold text-primary">{title}</div>}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function KpiCard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-5 ${accent ? 'bg-primary text-white' : 'bg-white border border-gray-200'}`}>
      <p className={`text-sm ${accent ? 'text-accent-light' : 'text-gray-500'}`}>{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className={`text-xs mt-1 ${accent ? 'text-gray-200' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}
