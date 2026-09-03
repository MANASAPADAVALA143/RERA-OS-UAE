import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LayoutDashboard, Users, TrendingUp, Wallet, ReceiptText, BarChart2,
} from 'lucide-react';

export type ConsultancyTab =
  | 'dashboard' | 'revenue' | 'pnl' | 'payroll' | 'receivables' | 'financials';

type LIcon = React.FC<{ size?: number; className?: string }>;

export interface ConsultancyNavItem {
  id: ConsultancyTab;
  label: string;
  Icon: LIcon;
  groupLabel?: string;
}

export const CONSULTANCY_TABS: ConsultancyNavItem[] = [
  { id: 'dashboard',   label: 'Command Center',       Icon: LayoutDashboard, groupLabel: 'Analytics' },
  { id: 'revenue',     label: 'Revenue & Clients',    Icon: TrendingUp   },
  { id: 'pnl',         label: 'Profit & Loss',        Icon: BarChart2    },
  { id: 'payroll',     label: 'Payroll & Team',       Icon: Wallet       },
  { id: 'receivables', label: 'AR Aging',             Icon: ReceiptText  },
  { id: 'financials',  label: 'Financial Statements', Icon: Users,        groupLabel: 'Financials' },
];

interface ConsultancyNavState {
  tab: ConsultancyTab;
  setTab: (t: ConsultancyTab) => void;
}

const Ctx = createContext<ConsultancyNavState | null>(null);

export function ConsultancyNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<ConsultancyTab>('dashboard');
  return <Ctx.Provider value={{ tab, setTab }}>{children}</Ctx.Provider>;
}

export function useConsultancyNav() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConsultancyNav must be used within ConsultancyNavProvider');
  return ctx;
}
