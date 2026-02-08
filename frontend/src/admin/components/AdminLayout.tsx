import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { adminLogout } from '../hooks/useAdminApi';
import { useNavigate } from 'react-router-dom';

interface AdminLayoutProps {
  username: string;
}

export function AdminLayout({ username }: AdminLayoutProps) {
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleLogout = async () => {
    await adminLogout();
    navigate('/pm-admin');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="lg:hidden text-gray-600 hover:text-gray-900 p-1"
            >
              ☰
            </button>
            <h1 className="text-lg font-semibold text-gray-900">Admin</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{username}</span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-sm font-medium hover:bg-gray-300"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
