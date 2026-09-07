import type { CSSProperties, ReactNode } from 'react';
import { PT } from '../../utils/parchmentTypography';

/**
 * Full-bleed page wrapper matching Rentals Ownership / Loan Tracker:
 * same cream background, 13px body text, stone ink.
 */
export default function PropDevPage({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`space-y-6 ${className}`}
      style={{
        background: PT.pageBg,
        fontSize: 13,
        color: PT.text,
        marginLeft: -16,
        marginRight: -16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 4,
        paddingBottom: 24,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
