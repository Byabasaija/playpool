import { useState, useEffect, useCallback } from 'react';
import { useAdminApi } from '../hooks/useAdminApi';
import { DataTable, Column } from '../components/DataTable';

interface AuditRow {
  id: number;
  admin_username?: string;
  ip?: string;
  route?: string;
  action?: string;
  details?: string;
  success?: boolean;
  created_at: string;
}

export function AdminAuditLog() {
  const { get } = useAdminApi();

  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [usernameFilter, setUsernameFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 50;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/audit-logs', {
        admin_username: usernameFilter,
        limit: pageSize,
        offset: page * pageSize,
      });
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [get, usernameFilter, page]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const columns: Column<AuditRow & Record<string, unknown>>[] = [
    { key: 'id', label: 'ID' },
    {
      key: 'admin_username',
      label: 'Admin',
      render: (_, row) => row.admin_username || '—',
    },
    {
      key: 'action',
      label: 'Action',
      render: (_, row) => (
        <span className="font-medium">{row.action?.replace(/_/g, ' ') || '—'}</span>
      ),
    },
    {
      key: 'route',
      label: 'Route',
      render: (_, row) => (
        <span className="font-mono text-xs text-gray-500">{row.route || '—'}</span>
      ),
    },
    {
      key: 'success',
      label: 'Status',
      render: (_, row) => {
        if (row.success === null || row.success === undefined) return '—';
        return (
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
              row.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {row.success ? 'OK' : 'Failed'}
          </span>
        );
      },
    },
    { key: 'ip', label: 'IP' },
    {
      key: 'created_at',
      label: 'Time',
      render: (_, row) => new Date(row.created_at).toLocaleString(),
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Audit Log</h2>

      {/* Filter */}
      <div className="flex gap-2 items-center mb-4">
        <input
          type="text"
          placeholder="Filter by admin username..."
          value={usernameFilter}
          onChange={(e) => { setPage(0); setUsernameFilter(e.target.value); }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#373536] focus:border-transparent max-w-xs"
        />
        {usernameFilter && (
          <button
            onClick={() => { setUsernameFilter(''); setPage(0); }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      <DataTable
        columns={columns}
        data={logs as (AuditRow & Record<string, unknown>)[]}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        loading={loading}
        emptyMessage="No audit log entries found"
      />
    </div>
  );
}
