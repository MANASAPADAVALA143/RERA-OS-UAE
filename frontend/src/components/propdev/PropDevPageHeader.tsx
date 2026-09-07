import type { ReactNode } from 'react';
import { PT_FONT } from '../../utils/parchmentTypography';

/** Same page title / subtitle scale as Rentals Ownership & Expenses. */
export default function PropDevPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 style={PT_FONT.pageTitle}>{title}</h1>
        {subtitle ? (
          typeof subtitle === 'string'
            ? <p style={PT_FONT.pageSubtitle}>{subtitle}</p>
            : <div style={PT_FONT.pageSubtitle}>{subtitle}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}
