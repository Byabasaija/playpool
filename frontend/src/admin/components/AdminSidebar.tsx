import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/pm-admin/dashboard', label: 'Dashboard' },
  { to: '/pm-admin/players', label: 'Players' },
  { to: '/pm-admin/games', label: 'Games' },
  { to: '/pm-admin/transactions', label: 'Transactions' },
  { to: '/pm-admin/withdrawals', label: 'Withdrawals' },
  { to: '/pm-admin/revenue', label: 'Revenue' },
  { to: '/pm-admin/audit-log', label: 'Audit Log' },
  { to: '/pm-admin/config', label: 'Config' },
];

interface AdminSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AdminSidebar({ collapsed, onToggle }: AdminSidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          w-56 bg-[#373536] text-white flex flex-col
          transform transition-transform duration-200
          ${collapsed ? '-translate-x-full lg:translate-x-0 lg:w-16' : 'translate-x-0'}
        `}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          {!collapsed && (
            <span className="text-sm font-bold tracking-wide">PlayPool</span>
          )}
          <button
            onClick={onToggle}
            className="text-white/60 hover:text-white p-1"
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {!collapsed && item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
