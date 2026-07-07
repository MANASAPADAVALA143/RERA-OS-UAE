import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import {
  LayoutDashboard, Building2, Home, FileText,
  CreditCard, TrendingDown, DollarSign, Users, BarChart2,
  Wrench, AlertTriangle, Receipt,
  TrendingUp, ArrowDownUp, Table2, CalendarCheck, Activity,
  Landmark, Store, BookOpen,
  CircleDollarSign, CalendarRange, Tag, Percent, ClipboardList, Calculator,
} from "lucide-react";

export type RentalTab =
  | "executive-summary"
  | "overview" | "companies" | "units" | "leases"
  | "maintenance" | "vendor-risk"
  | "collections" | "vacancy" | "expenses" | "ar-dashboard"
  | "ap-dashboard" | "vendor-management"
  | "ownership" | "reports" | "financials"
  | "portfolio-upload" | "cfo-dashboard" | "income-bridge" | "entity-rollup" | "compliance"
  | "building-expenses" | "loan-tracker" | "cfo-portfolio" | "13-week-cf"
  | "discounts" | "financial-ratios"
  | "calculations-review";

type LucideIcon = React.FC<{ size?: number; className?: string }>;
export interface RentalNavItem {
  id: RentalTab;
  label: string;
  Icon: LucideIcon;
  groupLabel?: string;
  hidden?: boolean;
  /** Visible only to CA firm internal_reviewer / platform_admin */
  reviewerOnly?: boolean;
}

export const RENTAL_TABS: RentalNavItem[] = [
  // ── RENTAL & LEASE ────────────────────────────────────────────────────────
  { id: "executive-summary", label: "Executive Summary", Icon: ClipboardList,   groupLabel: "RENTAL & LEASE" },
  { id: "overview",          label: "Overview",          Icon: LayoutDashboard  },
  { id: "companies",         label: "Companies",         Icon: Building2       },
  { id: "units",             label: "Units",             Icon: Home            },
  { id: "discounts",         label: "Discounts",         Icon: Tag             },
  { id: "leases",            label: "Leases",            Icon: FileText        },
  { id: "maintenance",       label: "Maintenance",       Icon: Wrench          },
  // ── FINANCIALS & RISK ─────────────────────────────────────────────────────
  { id: "ar-dashboard",      label: "AR Dashboard",      Icon: Activity,        groupLabel: "FINANCIALS & RISK" },
  { id: "ap-dashboard",      label: "AP Dashboard",      Icon: Landmark,        hidden: true },
  { id: "expenses",          label: "Expenses",          Icon: DollarSign      },
  { id: "vendor-risk",       label: "Vendor Risk",       Icon: AlertTriangle   },
  { id: "collections",       label: "Collections",       Icon: CreditCard,      hidden: true },
  { id: "vacancy",           label: "Vacancy & Loss",    Icon: TrendingDown    },
  { id: "financials",        label: "Financials",        Icon: BookOpen        },
  { id: "financial-ratios",  label: "Financial Ratios",  Icon: Percent         },
  { id: "calculations-review", label: "Calculations Review", Icon: Calculator, reviewerOnly: true, groupLabel: "CA FIRM QA" },
  // ── OPERATIONS ────────────────────────────────────────────────────────────
  { id: "building-expenses", label: "Building Expenses", Icon: Receipt,         groupLabel: "OPERATIONS" },
  { id: "loan-tracker",      label: "Loan Tracker",      Icon: CircleDollarSign },
  { id: "vendor-management", label: "Vendor Mgmt",       Icon: Store            },
  { id: "ownership",         label: "Ownership",         Icon: Users            },
  { id: "reports",           label: "Reports",           Icon: BarChart2        },
  // ── CFO VIEW ──────────────────────────────────────────────────────────────
  { id: "cfo-dashboard",     label: "CFO Dashboard",     Icon: TrendingUp,      groupLabel: "CFO VIEW" },
  // { id: "income-bridge",     label: "Income Bridge",     Icon: ArrowDownUp      },  // hidden
  // { id: "entity-rollup",     label: "Entity Roll-up",    Icon: Table2           },  // hidden
  // { id: "compliance",        label: "Compliance",        Icon: CalendarCheck    },  // hidden
  { id: "13-week-cf",        label: "13-Week Cash Flow", Icon: CalendarRange    },
];

const TAB_PATHS: Partial<Record<RentalTab, string>> = {
  "building-expenses": "/rental/building-expenses",
  "loan-tracker":      "/rental/loan-tracker",
  "cfo-portfolio":     "/rental/cfo-portfolio",
  "13-week-cf":        "/rental/13-week-cf",
  "financial-ratios":  "/rental/financial-ratios",
  "calculations-review": "/rental/calculations-review",
};

const PATH_TO_TAB: Record<string, RentalTab> = {
  "/rental/building-expenses": "building-expenses",
  "/rental/loan-tracker":      "loan-tracker",
  "/rental/cfo-portfolio":     "cfo-portfolio",
  "/rental/13-week-cf":        "13-week-cf",
  "/rental/financial-ratios":  "financial-ratios",
  "/rental/calculations-review": "calculations-review",
};

export function rentalPathForTab(tab: RentalTab): string {
  return TAB_PATHS[tab] ?? "/rental";
}

export function tabFromRentalPath(path: string): RentalTab | null {
  return PATH_TO_TAB[path] ?? null;
}

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
