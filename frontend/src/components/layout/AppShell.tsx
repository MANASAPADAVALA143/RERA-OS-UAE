import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, HardHat, Building2, Landmark, Home,
  ShieldAlert, Map, Settings, LogOut, HardDriveUpload, Database,
  Menu, X, Briefcase,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Badge } from '../ui/Badge';
import {
  ConstructionNavProvider,
  useConstructionNav,
  ALL_TABS,
} from '../../contexts/ConstructionNavContext';
import {
  RentalNavProvider,
  useRentalNav,
  RENTAL_TABS,
  rentalPathForTab,
} from '../../contexts/RentalNavContext';
import { RentalPortfolioProvider } from '../../contexts/RentalPortfolioContext';
import {
  PropDevNavProvider,
  usePropDevNav,
  PROPDEV_TABS,
} from '../../contexts/PropDevNavContext';
import {
  ConsultancyNavProvider,
  useConsultancyNav,
  CONSULTANCY_TABS,
} from '../../contexts/ConsultancyNavContext';

const NAV = [
  { to: '/executive-summary', label: 'Executive Summary', icon: LayoutDashboard },
  { to: '/construction',      label: 'Construction',      icon: HardHat         },
  { to: '/development',       label: 'Development',       icon: Building2       },
  { to: '/reit',              label: 'REIT',              icon: Landmark        },
  { to: '/property-dev',      label: 'Property Dev',      icon: HardDriveUpload },
  { to: '/consultancy',       label: 'Consultancy',       icon: Briefcase      },
  { to: '/rental',            label: 'Rental & Lease',    icon: Home            },
  { to: '/capital-risk',      label: 'Capital & Risk',    icon: ShieldAlert     },
  { to: '/pipeline-market',   label: 'Pipeline & Market', icon: Map             },
];

// ── Sub-nav shared styles ──────────────────────────────────────────────────
const subActive   = { background: 'rgba(91,95,239,0.15)', color: '#A5B4FC' } as const;
const subInactive = { color: '#9C9893' } as const;
const subBase     = 'w-full flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-lg text-base transition-colors text-left hover:bg-white/5';

function SidebarInner() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { profile, signOut, isKpiReviewer } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const onConstruction = location.pathname.startsWith('/construction');
  const onRental       = location.pathname.startsWith('/rental');
  const onPropDev      = location.pathname.startsWith('/property-dev');
  const onConsultancy  = location.pathname.startsWith('/consultancy');
  const { tab, setTab, projectId, setProjectId, projects } = useConstructionNav();
  const { tab: rentalTab, setTab: setRentalTab }           = useRentalNav();
  const { tab: propDevTab, setTab: setPropDevTab }         = usePropDevNav();
  const { tab: consultancyTab, setTab: setConsultancyTab } = useConsultancyNav();

  // Close sidebar on any navigation (mobile UX)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const closeSidebar = () => setSidebarOpen(false);

  // Current page label for mobile header
  const currentPage = NAV.find(n => location.pathname.startsWith(n.to))?.label ?? 'All in one MIS';

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#F7F8FA' }}>

      {/* ── Mobile backdrop ───────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={closeSidebar}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────
          Mobile:  fixed overlay drawer, hidden by default (-translate-x-full)
          Desktop: static column, always visible (md:relative md:translate-x-0) */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 flex flex-col h-full
          transition-transform duration-300 ease-in-out
          md:relative md:translate-x-0 md:shrink-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{ background: '#0B1437', borderRight: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Brand + mobile close button */}
        <div className="flex items-center justify-between p-5"
          style={{ borderBottom: '1px solid rgba(99,102,241,0.12)' }}>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight" style={{ color: '#F5F5F4' }}>RERA OS</h1>
            <p className="text-xs mt-1 truncate" style={{ color: '#A5B4FC' }}>{profile?.company_name ?? 'Demo Portfolio'}</p>
          </div>
          <button
            onClick={closeSidebar}
            className="md:hidden ml-2 shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: '#9C9893' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Main nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <div key={to}>
              <NavLink
                to={to}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-base transition-colors hover:bg-white/5"
                style={({ isActive }) =>
                  isActive
                    ? { background: '#5B5FEF', color: '#fff', fontWeight: 600 }
                    : { color: '#9C9893' }
                }
              >
                <Icon size={20} />
                {label}
              </NavLink>

              {/* Rental sub-nav */}
              {to === '/rental' && onRental && (
                <div className="mt-1 mb-1">
                  {RENTAL_TABS.filter((item) => !item.hidden && (!item.reviewerOnly || isKpiReviewer)).map(({ id, label: itemLabel, Icon: ItemIcon, groupLabel }) => (
                    <div key={id}>
                      {groupLabel && (
                        <p className="pl-7 pr-3 pt-3 pb-1 text-sm uppercase tracking-wider font-medium"
                          style={{ color: '#6366F1', opacity: 0.7 }}>
                          ─── {groupLabel} ───
                        </p>
                      )}
                      <button
                        onClick={() => {
                          setRentalTab(id);
                          const path = rentalPathForTab(id);
                          if (path !== location.pathname) navigate(path);
                        }}
                        className={subBase}
                        style={rentalTab === id ? subActive : subInactive}
                      >
                        <ItemIcon size={15} className="shrink-0" />
                        {itemLabel}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Property Dev sub-nav */}
              {to === '/property-dev' && onPropDev && (
                <div className="mt-1 mb-1">
                  {PROPDEV_TABS.map(({ id, label: itemLabel, Icon: ItemIcon, groupLabel }) => (
                    <div key={id}>
                      {groupLabel && (
                        <p className="pl-7 pr-3 pt-2 pb-0.5 text-sm uppercase tracking-wider font-medium"
                          style={{ color: '#6366F1', opacity: 0.7 }}>
                          ─── {groupLabel} ───
                        </p>
                      )}
                      <button
                        onClick={() => setPropDevTab(id)}
                        className={subBase}
                        style={propDevTab === id ? subActive : subInactive}
                      >
                        <ItemIcon size={15} className="shrink-0" />
                        {itemLabel}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Consultancy sub-nav */}
              {to === '/consultancy' && onConsultancy && (
                <div className="mt-1 mb-1">
                  {CONSULTANCY_TABS.map(({ id, label: itemLabel, Icon: ItemIcon, groupLabel }) => (
                    <div key={id}>
                      {groupLabel && (
                        <p className="pl-7 pr-3 pt-2 pb-0.5 text-sm uppercase tracking-wider font-medium"
                          style={{ color: '#6366F1', opacity: 0.7 }}>
                          ─── {groupLabel} ───
                        </p>
                      )}
                      <button
                        onClick={() => setConsultancyTab(id)}
                        className={subBase}
                        style={consultancyTab === id ? subActive : subInactive}
                      >
                        <ItemIcon size={15} className="shrink-0" />
                        {itemLabel}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Construction sub-nav */}
              {to === '/construction' && onConstruction && (
                <div className="mt-1 mb-1">
                  <div className="px-2 pb-1.5">
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-md text-xs focus:outline-none focus:ring-1"
                      style={{
                        background: 'rgba(99,102,241,0.08)',
                        border: '1px solid rgba(99,102,241,0.2)',
                        color: '#F5F5F4',
                      }}
                    >
                      {projects.length === 0 && <option value="">No projects</option>}
                      {projects.map((p) => (
                        <option key={p.id} value={p.id} style={{ background: '#1E1B4B', color: '#F5F5F4' }}>
                          {p.project_code ? `${p.project_code} — ` : ''}{p.project_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {ALL_TABS.map(({ id, label: itemLabel, Icon: ItemIcon }) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={subBase}
                      style={tab === id ? subActive : subInactive}
                    >
                      <ItemIcon size={13} className="shrink-0" />
                      {itemLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 space-y-3" style={{ borderTop: '1px solid rgba(99,102,241,0.12)' }}>
          <div className="text-base">
            <p className="font-medium truncate" style={{ color: '#F5F5F4' }}>{profile?.email}</p>
            <Badge variant="accent">{profile?.role}</Badge>
          </div>
          <NavLink to="/settings"
            className="flex items-center gap-2 text-base hover:opacity-80 transition-opacity"
            style={{ color: '#9C9893' }}>
            <Settings size={16} /> Settings
          </NavLink>
          <NavLink to="/settings/companies"
            className="flex items-center gap-2 text-base hover:opacity-80 transition-opacity"
            style={{ color: '#9C9893' }}>
            <Database size={16} /> Company Registry
          </NavLink>
          <button onClick={signOut}
            className="flex items-center gap-2 text-sm w-full hover:opacity-80 transition-opacity"
            style={{ color: '#9C9893' }}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Right side: mobile header + main content ─────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Mobile top bar (hidden on md+) */}
        <header
          className="md:hidden flex items-center gap-3 px-4 shrink-0"
          style={{ height: 48, background: '#0B1437', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: '#6366F1' }}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <span className="text-sm font-semibold truncate" style={{ color: '#F5F5F4' }}>
            {currentPage}
          </span>
        </header>

        {/* Main content — full width when sidebar is hidden on mobile */}
        <main className="dark-app flex-1 overflow-y-auto p-4 lg:p-6" style={{ background: '#F7F8FA' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function AppShell() {
  return (
    <ConstructionNavProvider>
      <RentalNavProvider>
        <RentalPortfolioProvider>
          <PropDevNavProvider>
            <ConsultancyNavProvider>
              <SidebarInner />
            </ConsultancyNavProvider>
          </PropDevNavProvider>
        </RentalPortfolioProvider>
      </RentalNavProvider>
    </ConstructionNavProvider>
  );
}
