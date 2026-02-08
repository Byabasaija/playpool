import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminCheckSession } from '../hooks/useAdminApi';
import { AdminLayout } from './AdminLayout';

export function AdminProtectedRoute() {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    adminCheckSession()
      .then((data) => {
        if (data?.username) {
          setUsername(data.username);
        } else {
          navigate('/pm-admin');
        }
      })
      .catch(() => {
        navigate('/pm-admin');
      })
      .finally(() => setChecking(false));
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#373536]"></div>
      </div>
    );
  }

  if (!username) return null;

  return <AdminLayout username={username} />;
}
