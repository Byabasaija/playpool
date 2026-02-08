import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminApi } from '../hooks/useAdminApi';
import { DataTable, Column } from '../components/DataTable';
import type { AdminPlayer } from '../types/admin.types';

const STATUS_FILTERS = ['all', 'active', 'blocked'] as const;

export function AdminPlayers() {
  const { get } = useAdminApi();
  const navigate = useNavigate();

  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 50;

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/players', {
        q: search,
        status,
        limit: pageSize,
        offset: page * pageSize,
      });
      setPlayers(data.players || []);
      setTotal(data.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load players');
    } finally {
      setLoading(false);
    }
  }, [get, search, status, page]);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  };

  const handleStatusChange = (s: string) => {
    setPage(0);
    setStatus(s);
  };

  const columns: Column<AdminPlayer & Record<string, unknown>>[] = [
    { key: 'id', label: 'ID' },
    { key: 'phone_number', label: 'Phone' },
    {
      key: 'display_name',
      label: 'Name',
      render: (_, row) => (
        <span className="font-medium">{row.display_name || '—'}</span>
      ),
    },
    {
      key: 'total_games_played',
      label: 'Games',
      align: 'right',
    },
    {
      key: 'total_games_won',
      label: 'Won',
      align: 'right',
    },
    {
      key: 'total_winnings',
      label: 'Winnings',
      align: 'right',
      render: (_, row) => `${row.total_winnings.toLocaleString()} UGX`,
    },
    {
      key: 'is_blocked',
      label: 'Status',
      render: (_, row) => (
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
            row.is_blocked
              ? 'bg-red-100 text-red-700'
              : 'bg-green-100 text-green-700'
          }`}
        >
          {row.is_blocked ? 'Blocked' : 'Active'}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Joined',
      render: (_, row) =>
        new Date(row.created_at).toLocaleDateString(),
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Players</h2>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <input
            type="text"
            placeholder="Search by phone or name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#373536] focus:border-transparent"
          />
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-[#373536] rounded-lg hover:bg-[#2c2b2a]"
          >
            Search
          </button>
        </form>

        <div className="flex gap-2">
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
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      <DataTable
        columns={columns}
        data={players as (AdminPlayer & Record<string, unknown>)[]}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onRowClick={(row) => navigate(`/pm-admin/players/${row.id}`)}
        loading={loading}
        emptyMessage="No players found"
      />
    </div>
  );
}
