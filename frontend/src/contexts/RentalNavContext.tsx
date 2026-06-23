import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import {
  LayoutDashboard, Building2, Home, FileText,
  CreditCard, TrendingDown, DollarSign, Users, BarChart2,
  Wrench, ClipboardCheck, AlertTriangle, Receipt,
  Upload, TrendingUp, ArrowDownUp, Table2, CalendarCheck, Activity,
  Landmark, Store, BookOpen,
} from "lucide-react";

export type RentalTab =
  | "overview" | "companies" | "units" | "leases"
  | "maintenance" | "inspections" | "vendor-risk"
  | "collections" | "vacancy" | "expenses" | "ar-dashboard"
  | "ap-dashboard" | "vendor-management"
  | "ownership" | "reports" | "financials"
  | "portfolio-upload" | "cfo-dashboard" | "income-bridge" | "entity-rollup" | "compliance";

type LucideIcon = React.FC<{ size?: number; className?: string }>;
export interface RentalNavItem {
  id: RentalTab;
  label: string;
  Icon: LucideIcon;
  groupLabel?: string;
}

export const RENTAL_TABS: RentalNavItem[] = [
  { id: "overview",          label: "Overview",          Icon: LayoutDashboard },
  { id: "companies",         label: "Companies",         Icon: Building2       },
  { id: "units",             label: "Units",             Icon: Home            },
  { id: "leases",            label: "Leases",            Icon: FileText        },
  { id: "maintenance",       label: "Maintenance",       Icon: Wrench          },
  { id: "inspections",       label: "Inspections",       Icon: ClipboardCheck  },
  { id: "vendor-risk",       label: "Vendor Risk",       Icon: AlertTriangle   },
  { id: "collections",       label: "Collections",       Icon: CreditCard      },
  { id: "vacancy",           label: "Vacancy & Loss",    Icon: TrendingDown    },
  { id: "expenses",          label: "Expenses",          Icon: DollarSign      },
  { id: "ar-dashboard",      label: "AR Dashboard",      Icon: Activity        },
  { id: "ap-dashboard",      label: "AP Dashboard",      Icon: Landmark        },
  { id: "vendor-management", label: "Vendor Mgmt",       Icon: Store           },
  { id: "financials",        label: "Financials",        Icon: BookOpen        },
  { id: "ownership",         label: "Ownership",         Icon: Users           },
  { id: "reports",           label: "Reports",           Icon: BarChart2       },
  // ── CFO Portfolio View ────────────────────────────────────────────────────
  { id: "portfolio-upload",  label: "Portfolio Upload",  Icon: Upload,         groupLabel: "CFO Portfolio View" },
  { id: "cfo-dashboard",     label: "CFO Dashboard",     Icon: TrendingUp      },
  { id: "income-bridge",     label: "Income Bridge",     Icon: ArrowDownUp     },
  { id: "entity-rollup",     label: "Entity Roll-up",    Icon: Table2          },
  { id: "compliance",        label: "Compliance",        Icon: CalendarCheck   },
];

interface RentalNavState {
  tab: RentalTab;
  setTab: (t: RentalTab) => void;
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string | null) => void;
}

const Ctx = createContext<RentalNavState | null>(null);

export function RentalNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<RentalTab>("overview");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{ tab, setTab, selectedCompanyId, setSelectedCompanyId }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRentalNav() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRentalNav must be used within RentalNavProvider");
  return ctx;
}
