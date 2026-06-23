import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LayoutDashboard, TrendingUp, Grid3X3, Warehouse,
  Users, Phone, Landmark, Home, BarChart2,
  Receipt, Waves, FolderOpen, Upload,
} from 'lucide-react';

export type PropDevTab =
  | 'upload'
  | 'dashboard' | 'deal-pl' | 'pricing' | 'inventory'
  | 'partners' | 'capital-calls' | 'loans' | 'sales'
  | 'performance' | 'receivables' | 'cash-flow' | 'documents';

type LIcon = React.FC<{ size?: number; className?: string }>;

export interface PropDevNavItem {
  id: PropDevTab;
  label: string;
  Icon: LIcon;
  groupLabel?: string;
}

export const PROPDEV_TABS: PropDevNavItem[] = [
  { id: 'upload',        label: 'Upload Data',        Icon: Upload,         groupLabel: 'Data Import' },
  { id: 'dashboard',     label: 'Command Center',     Icon: LayoutDashboard, groupLabel: 'Analytics'  },
  { id: 'deal-pl',       label: 'Deal P&L',           Icon: TrendingUp      },
  { id: 'pricing',       label: 'Lot Pricing',        Icon: Grid3X3         },
  { id: 'inventory',     label: 'Lot Inventory',      Icon: Warehouse       },
  { id: 'partners',      label: 'Partners / JV',      Icon: Users           },
  { id: 'capital-calls', label: 'Capital Calls',      Icon: Phone           },
  { id: 'loans',         label: 'Loan Tracker',       Icon: Landmark        },
  { id: 'sales',         label: 'Sale of Property',   Icon: Home            },
  { id: 'performance',   label: 'Performance',        Icon: BarChart2       },
  { id: 'receivables',   label: 'Receivables',        Icon: Receipt         },
  { id: 'cash-flow',     label: 'Cash Flow',          Icon: Waves           },
  { id: 'documents',     label: 'Documents',          Icon: FolderOpen      },
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
