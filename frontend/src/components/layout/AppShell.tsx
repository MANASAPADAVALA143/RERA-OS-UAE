import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, HardHat, Building2, Landmark, Home,
  ShieldAlert, Map, Settings, LogOut, HardDriveUpload,
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

const NAV = [
  { to: '/executive-summary', label: 'Executive Summary', icon: LayoutDashboard },
  { to: '/construction',      label: 'Construction',      icon: HardHat         },
  { to: '/development',       label: 'Development',       icon: Building2       },
  { to: '/reit',              label: 'REIT',              icon: Landmark        },
  { to: '/property-dev',      label: 'Property Dev',      icon: HardDriveUpload },
  { to: '/rental',            label: 'Rental & Lease',    icon: Home            },
  { to: '/capital-risk',      label: 'Capital & Risk',    icon: ShieldAlert     },
  { to: '/pipeline-market',   label: 'Pipeline & Market', icon: Map             },
];

function SidebarInner() {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const onConstruction = location.pathname.startsWith('/construction');
  const onRental = location.pathname.startsWith('/rental');
  const onPropDev = location.pathname.startsWith('/property-dev');
  const { tab, setTab, projectId, setProjectId, projects } = useConstructionNav();
  const { tab: rentalTab, setTab: setRentalTab } = useRentalNav();
  const navigate = useNavigate();
  const { tab: propDevTab, setTab: setPropDevTab } = usePropDevNav();

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="w-64 bg-primary text-white flex flex-col shrink-0">
        {/* Brand */}
        <div className="p-5 border-b border-white/10">
          <h1 className="text-xl font-bold tracking-tight">EstateCFO</h1>
          <p className="text-xs text-accent-light mt-1 truncate">{profile?.company_name}</p>
        </div>

        {/* Main nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <div key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-accent text-white'
                      : 'text-gray-300 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>

              {/* Rental sub-nav — only when route is active */}
              {to === '/rental' && onRental && (
                <div className="mt-1 mb-1">
                  {RENTAL_TABS.map(({ id, label: itemLabel, Icon: ItemIcon, groupLabel }) => (
                    <div key={id}>
                      {groupLabel && (
                        <p className="pl-7 pr-3 pt-3 pb-1 text-xs uppercase tracking-wider text-amber-400 font-medium">
                          ─── {groupLabel} ───
                        </p>
                      )}
                      <button
                        onClick={() => {
                          setRentalTab(id);
                          const path = rentalPathForTab(id);
                          if (path !== location.pathname) navigate(path);
                        }}
                        className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-lg text-xs transition-colors text-left ${
                          rentalTab === id
                            ? 'bg-accent text-white'
                            : 'text-gray-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <ItemIcon size={13} className="shrink-0" />
                        {itemLabel}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Property Dev sub-nav — only when route is active */}
              {to === '/property-dev' && onPropDev && (
                <div className="mt-1 mb-1">
                  {PROPDEV_TABS.map(({ id, label: itemLabel, Icon: ItemIcon, groupLabel }) => (
                    <div key={id}>
                      {groupLabel && (
                        <p className="pl-7 pr-3 pt-2 pb-0.5 text-xs uppercase tracking-wider text-amber-400 font-medium">
                          ─── {groupLabel} ───
                        </p>
                      )}
                      <button
                        onClick={() => setPropDevTab(id)}
                        className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-lg text-xs transition-colors text-left ${
                          propDevTab === id
                            ? 'bg-accent text-white'
                            : 'text-gray-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <ItemIcon size={13} className="shrink-0" />
                        {itemLabel}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Construction sub-nav — only when route is active */}
              {to === '/construction' && onConstruction && (
                <div className="mt-1 mb-1">
                  {/* Project selector */}
                  <div className="px-2 pb-1.5">
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-md text-xs bg-white/10 text-white border border-white/20 focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {projects.length === 0 && <option value="">No projects</option>}
                      {projects.map((p) => (
                        <option key={p.id} value={p.id} className="bg-primary text-white">
                          {p.project_code ? `${p.project_code} — ` : ''}{p.project_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Section items */}
                  {ALL_TABS.map(({ id, label: itemLabel, Icon: ItemIcon }) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-lg text-xs transition-colors text-left ${
                        tab === id
                          ? 'bg-accent text-white'
                          : 'text-gray-300 hover:bg-white/10 hover:text-white'
                      }`}
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
        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="text-sm">
            <p className="font-medium truncate">{profile?.email}</p>
            <Badge variant="accent">{profile?.role}</Badge>
          </div>
          <NavLink to="/settings" className="flex items-center gap-2 text-sm text-gray-300 hover:text-white">
            <Settings size={16} /> Settings
          </NavLink>
          <button onClick={signOut} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white w-full">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}

export default function AppShell() {
  return (
    <ConstructionNavProvider>
      <RentalNavProvider>
        <RentalPortfolioProvider>
          <PropDevNavProvider>
            <SidebarInner />
          </PropDevNavProvider>
        </RentalPortfolioProvider>
      </RentalNavProvider>
    </ConstructionNavProvider>
  );
}
