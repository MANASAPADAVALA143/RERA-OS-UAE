import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  Users, Phone, Landmark,
  BarChart2,
  Waves, Upload, Building2, Percent, ClipboardList, MapPin,
} from 'lucide-react';

export type PropDevTab =
  | 'upload' | 'companies'
  | 'dashboard'
  | 'entity-executive-summary'
  | 'properties'
  | 'executive-summary'
  | 'partners' | 'capital-calls' | 'loans'
  | 'cash-flow'
  | 'financials' | 'financial-ratios';

type LIcon = React.FC<{ size?: number; className?: string }>;

export interface PropDevNavItem {
  id: PropDevTab;
  label: string;
  Icon: LIcon;
  groupLabel?: string;
}

export const PROPDEV_TABS: PropDevNavItem[] = [
  { id: 'upload',        label: 'Upload Data',        Icon: Upload,         groupLabel: 'Data Import' },
  { id: 'companies',     label: 'Companies',          Icon: Building2,      groupLabel: 'Portfolio'   },
  { id: 'dashboard',     label: 'Command Center',     Icon: LayoutDashboard, groupLabel: 'Analytics'  },
  { id: 'executive-summary', label: 'Executive Summary', Icon: ClipboardList },
  { id: 'entity-executive-summary', label: 'Entity Executive Summary', Icon: ClipboardList },
  { id: 'properties',    label: 'Properties',         Icon: MapPin          },
  { id: 'partners',      label: 'Ownership',          Icon: Users           },
  { id: 'capital-calls', label: 'Capital Calls',      Icon: Phone           },
  { id: 'loans',         label: 'Loan Tracker',       Icon: Landmark        },
  { id: 'cash-flow',     label: 'Cash Flow',          Icon: Waves           },
  { id: 'financials',        label: 'Financials',         Icon: BarChart2,      groupLabel: 'Financials' },
  { id: 'financial-ratios',  label: 'Financial Ratios',   Icon: Percent        },
];

interface PropDevNavState {
  tab: PropDevTab;
  setTab: (t: PropDevTab) => void;
}

const Ctx = createContext<PropDevNavState | null>(null);

export function PropDevNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<PropDevTab>('dashboard');
  return <Ctx.Provider value={{ tab, setTab }}>{children}</Ctx.Provider>;
}

export function usePropDevNav() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePropDevNav must be used within PropDevNavProvider');
  return ctx;
}
