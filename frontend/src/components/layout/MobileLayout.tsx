import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Home, Truck, Package, Menu, X, Wallet, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { DESKTOP_FLAG, MOBILE_OPT_IN } from '../../constants/mobile';

const tabs = [
  { to: '/m/', icon: Home, label: 'Dashboard' },
  { to: '/m/deliveries', icon: Truck, label: 'Deliveries' },
  { to: '/m/inventory', icon: Package, label: 'Inventory' },
] as const;

export function MobileLayout() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  // Clear both flags to ensure desktop view sticks: DESKTOP_FLAG prevents
  // MobileRedirect from re-redirecting, and removing mobile_opt_in resets
  // the user's explicit mobile preference.
  const handleSwitchDesktop = () => {
    localStorage.setItem(DESKTOP_FLAG, 'true');
    localStorage.removeItem(MOBILE_OPT_IN);
    navigate('/');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Top header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#1e3a5f] rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">COD</span>
          </div>
          <span className="font-semibold text-gray-900 text-sm">COD Agent</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <span className="text-blue-700 text-xs font-medium">
              {user?.name?.charAt(0)?.toUpperCase() || 'A'}
            </span>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav className="flex items-center justify-around bg-white border-t border-gray-200 shrink-0 pb-safe">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/m/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 px-3 text-xs transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`
            }
          >
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center gap-0.5 py-2 px-3 text-xs text-gray-500"
        >
          <Menu size={22} />
          <span>More</span>
        </button>
      </nav>

      {/* More slide-up menu */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setMoreOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-50 pb-safe animate-slide-up">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <span className="font-semibold text-gray-900">More</span>
              <button onClick={() => setMoreOpen(false)} className="p-1 text-gray-400">
                <X size={20} />
              </button>
            </div>
            <div className="py-2">
              <MoreItem
                icon={Wallet}
                label="Collections"
                onClick={() => { setMoreOpen(false); navigate('/m/collections'); }}
              />
              <MoreItem
                icon={Settings}
                label="Settings"
                onClick={() => { setMoreOpen(false); navigate('/m/settings'); }}
              />
              <MoreItem
                icon={Home}
                label="Switch to Desktop"
                onClick={() => { setMoreOpen(false); handleSwitchDesktop(); }}
              />
              <div className="border-t border-gray-100 my-1" />
              <MoreItem
                icon={LogOut}
                label="Logout"
                onClick={handleLogout}
                danger
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MoreItem({ icon: Icon, label, onClick, danger }: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-gray-50 ${
        danger ? 'text-red-600' : 'text-gray-700'
      }`}
    >
      <Icon size={20} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

