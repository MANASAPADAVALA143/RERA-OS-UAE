import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, HardHat, Building2, Landmark, Home,
  ShieldAlert, Map, Settings, LogOut,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Badge } from '../ui/Badge';

const NAV = [
  { to: '/executive-summary', label: 'Executive Summary', icon: LayoutDashboard },
  { to: '/construction', label: 'Construction', icon: HardHat },
  { to: '/development', label: 'Development', icon: Building2 },
  { to: '/reit', label: 'REIT', icon: Landmark },
  { to: '/rental', label: 'Rental & Lease', icon: Home },
  { to: '/capital-risk', label: 'Capital & Risk', icon: ShieldAlert },
  { to: '/pipeline-market', label: 'Pipeline & Market', icon: Map },
];

export default function AppShell() {
  const { profile, signOut } = useAuth();

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="w-64 bg-primary text-white flex flex-col shrink-0">
        <div className="p-5 border-b border-white/10">
          <h1 className="text-xl font-bold tracking-tight">EstateCFO</h1>
          <p className="text-xs text-accent-light mt-1 truncate">{profile?.company_name}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-accent text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

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
