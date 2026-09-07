import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ClipboardList, LayoutDashboard, Building2, Users, Briefcase,
  Receipt, Wallet, Gauge, BookOpen, TrendingUp,
} from 'lucide-react';

export type ConsultancyTab =
  | 'executive-summary' | 'overview'
  | 'clients' | 'workforce' | 'deployments'
  | 'billing-collections' | 'payroll-compliance' | 'bench-utilization'
  | 'financials' | 'cfo-view';

type LIcon = React.FC<{ size?: number; className?: string }>;

export interface ConsultancyNavItem {
  id: ConsultancyTab;
  label: string;
  Icon: LIcon;
  groupLabel?: string;
  /** Phase 2 — needs Workforce/Deployments data not yet uploaded; shows a "coming soon" placeholder. */
  comingSoon?: boolean;
}

export const CONSULTANCY_TABS: ConsultancyNavItem[] = [
  { id: 'executive-summary', label: 'Executive Summary', Icon: ClipboardList, groupLabel: 'CONSULTANCY & OUTSOURCING' },
  { id: 'overview',          label: 'Overview',           Icon: LayoutDashboard },
  { id: 'clients',           label: 'Clients',            Icon: Building2 },
  { id: 'workforce',         label: 'Workforce',          Icon: Users,          comingSoon: true },
  { id: 'deployments',       label: 'Deployments',        Icon: Briefcase,      comingSoon: true },
  { id: 'billing-collections', label: 'Billing & Collections', Icon: Receipt,   groupLabel: 'OPERATIONS' },
  { id: 'payroll-compliance', label: 'Payroll & Compliance',  Icon: Wallet,     comingSoon: true },
  { id: 'bench-utilization',  label: 'Bench & Utilization',   Icon: Gauge,      comingSoon: true },
  { id: 'financials',        label: 'Financials & Risk',  Icon: BookOpen,       groupLabel: 'FINANCIALS' },
  { id: 'cfo-view',          label: 'CFO View',           Icon: TrendingUp,     groupLabel: 'CFO VIEW' },
];

interface ConsultancyNavState {
  tab: ConsultancyTab;
  setTab: (t: ConsultancyTab) => void;
}

const Ctx = createContext<ConsultancyNavState | null>(null);

export function ConsultancyNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<ConsultancyTab>('executive-summary');
  return <Ctx.Provider value={{ tab, setTab }}>{children}</Ctx.Provider>;
}

export function useConsultancyNav() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConsultancyNav must be used within ConsultancyNavProvider');
  return ctx;
}
