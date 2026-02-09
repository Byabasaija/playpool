import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminApi } from '../hooks/useAdminApi';
import { DataTable, Column } from '../components/DataTable';
import type { AdminGameSession } from '../types/admin.types';

const STATUS_FILTERS = ['all', 'waiting', 'active', 'completed', 'cancelled'] as const;

const statusStyles: Record<string, string> = {
  WAITING: 'bg-yellow-100 text-yellow-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export function AdminGames() {
  const { get } = useAdminApi();
  const navigate = useNavigate();

  const [games, setGames] = useState<AdminGameSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pageSize, setPageSize] = useState(25);

  const loadGames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/games', {
        status,
        limit: pageSize,
        offset: page * pageSize,
      });
      setGames(data.games || []);
      setTotal(data.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load games');
    } finally {
      setLoading(false);
    }
  }, [get, status, page]);

  useEffect(() => { loadGames(); }, [loadGames]);

  const handleStatusChange = (s: string) => {
    setPage(0);
    setStatus(s);
  };

  const columns: Column<AdminGameSession & Record<string, unknown>>[] = [
    { key: 'id', label: 'ID' },
    {
      key: 'game_token',
      label: 'Token',
      render: (_, row) => (
        <span className="font-mono text-xs">{row.game_token.slice(0, 8)}...</span>
      ),
    },
    {
      key: 'player1_name',
      label: 'Player 1',
      render: (_, row) => (row as Record<string, unknown>).player1_name as string || '—',
    },
    {
      key: 'player2_name',
      label: 'Player 2',
      render: (_, row) => (row as Record<string, unknown>).player2_name as string || '—',
    },
    {
      key: 'stake_amount',
      label: 'Stake',
      align: 'right',
      render: (_, row) => `${row.stake_amount.toLocaleString()} UGX`,
    },
    {
      key: 'status',
      label: 'Status',
      render: (_, row) => (
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
            statusStyles[row.status] || 'bg-gray-100 text-gray-700'
          }`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: 'winner_id',
      label: 'Winner',
      render: (_, row) => {
        if (!row.winner_id) return '—';
        const r = row as Record<string, unknown>;
        if (row.winner_id === r.player1_id) return (r.player1_name as string) || `#${row.winner_id}`;
        if (row.winner_id === r.player2_id) return (r.player2_name as string) || `#${row.winner_id}`;
        return `#${row.winner_id}`;
      },
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (_, row) => new Date(row.created_at).toLocaleString(),
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Games</h2>

      {/* Status Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            className={`px-3 py-2 rounded-lg text-sm font-medium ${
              status === s
                ? 'bg-[#373536] text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {s === 'active' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      <DataTable
        columns={columns}
        data={games as (AdminGameSession & Record<string, unknown>)[]}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        onRowClick={(row) => navigate(`/pm-admin/games/${row.id}`)}
        loading={loading}
        emptyMessage="No games found"
      />
    </div>
  );
}
