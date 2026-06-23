import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LayoutDashboard, DollarSign, FileCheck, Edit, TrendingUp,
  Shield, Calendar, CalendarClock, ClipboardList, CheckSquare, Search, FolderOpen,
  Receipt, CreditCard, Landmark,
} from 'lucide-react';

export type Tab =
  | 'overview' | 'costs' | 'change_orders' | 'change_requests'
  | 'financials' | 'loan_tracker' | 'compliance' | 'schedule' | 'task_schedule' | 'work_log'
  | 'quality_check' | 'inspections' | 'documents'
  | 'pay_applications' | 'expenses' | 'receivables';

type LucideIcon = React.FC<{ size?: number; className?: string }>;
export interface NavItem { id: Tab; label: string; Icon: LucideIcon }

export const ALL_TABS: NavItem[] = [
  { id: 'overview',          label: 'Overview',          Icon: LayoutDashboard },
  { id: 'costs',             label: 'Costs & SOV',       Icon: DollarSign      },
  { id: 'pay_applications',  label: 'Pay Applications',  Icon: Receipt         },
  { id: 'expenses',          label: 'Expenses',          Icon: CreditCard      },
  { id: 'receivables',       label: 'Receivables',       Icon: Receipt         },
  { id: 'change_orders',     label: 'Change Orders',     Icon: FileCheck       },
  { id: 'change_requests',   label: 'Change Requests',   Icon: Edit            },
  { id: 'financials',        label: 'Financials & ROI',  Icon: TrendingUp      },
  { id: 'loan_tracker',      label: 'Loan Tracker',      Icon: Landmark        },
  { id: 'compliance',        label: 'Compliance',        Icon: Shield          },
  { id: 'schedule',          label: 'Schedule',          Icon: Calendar        },
  { id: 'task_schedule',     label: 'Task Schedule',     Icon: CalendarClock   },
  { id: 'work_log',          label: 'Work Log',          Icon: ClipboardList   },
  { id: 'quality_check',     label: 'Quality Check',     Icon: CheckSquare     },
  { id: 'inspections',       label: 'Inspections',       Icon: Search          },
  { id: 'documents',         label: 'Documents',         Icon: FolderOpen      },
];

export interface ProjectSummary {
  id: string;
  project_name: string;
  project_code?: string | null;
}

interface ConstructionNavState {
  tab: Tab;
  setTab: (t: Tab) => void;
  projectId: string;
  setProjectId: (id: string) => void;
  projects: ProjectSummary[];
  setProjects: (p: ProjectSummary[]) => void;
}

const Ctx = createContext<ConstructionNavState | null>(null);

export function ConstructionNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  return (
    <Ctx.Provider value={{ tab, setTab, projectId, setProjectId, projects, setProjects }}>
      {children}
    </Ctx.Provider>
  );
}

export function useConstructionNav() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConstructionNav must be used within ConstructionNavProvider');
  return ctx;
}
