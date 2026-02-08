import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAdminApi } from '../hooks/useAdminApi';
import { ConfirmModal } from '../components/ConfirmModal';
import { DataTable, Column } from '../components/DataTable';
import type { AdminPlayer, AdminGameSession, AdminTransaction } from '../types/admin.types';

type Tab = 'games' | 'transactions';

export function AdminPlayerDetail() {
  const { id } = useParams<{ id: string }>();
  const { get, post } = useAdminApi();
  const navigate = useNavigate();

  const [player, setPlayer] = useState<AdminPlayer | null>(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<Tab>('games');
  const [games, setGames] = useState<AdminGameSession[]>([]);
  const [gamesTotal, setGamesTotal] = useState(0);
  const [gamesPage, setGamesPage] = useState(0);
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [txnTotal, setTxnTotal] = useState(0);
  const [txnPage, setTxnPage] = useState(0);
  const [tabLoading, setTabLoading] = useState(false);

  // Modals
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [unblockModalOpen, setUnblockModalOpen] = useState(false);
  const [resetPinModalOpen, setResetPinModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [blockDuration, setBlockDuration] = useState('');

  const pageSize = 20;

  const loadPlayer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get(`/players/${id}`);
      setPlayer(data.player);
      setBalance(data.balance || 0);
      setGames(data.recent_games || []);
      setTransactions(data.recent_transactions || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load player');
    } finally {
      setLoading(false);
    }
  }, [get, id]);

  const loadGames = useCallback(async (p: number) => {
    setTabLoading(true);
    try {
      const data = await get(`/players/${id}/games`, {
        limit: pageSize,
        offset: p * pageSize,
      });
      setGames(data.games || []);
      setGamesTotal(data.total || 0);
    } catch {
      // silently fail, initial data still shown
    } finally {
      setTabLoading(false);
    }
  }, [get, id]);

  const loadTransactions = useCallback(async (p: number) => {
    setTabLoading(true);
    try {
      const data = await get(`/players/${id}/transactions`, {
        limit: pageSize,
        offset: p * pageSize,
      });
      setTransactions(data.transactions || []);
      setTxnTotal(data.total || 0);
    } catch {
      // silently fail
    } finally {
      setTabLoading(false);
    }
  }, [get, id]);

  useEffect(() => { loadPlayer(); }, [loadPlayer]);

  const handleGamesPage = (p: number) => {
    setGamesPage(p);
    loadGames(p);
  };

  const handleTxnPage = (p: number) => {
    setTxnPage(p);
    loadTransactions(p);
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'games' && gamesPage === 0 && gamesTotal === 0) {
      loadGames(0);
    } else if (tab === 'transactions' && txnPage === 0 && txnTotal === 0) {
      loadTransactions(0);
    }
  };

  const handleBlock = async () => {
    if (!blockReason.trim()) return;
    setActionLoading(true);
    try {
      await post(`/players/${id}/block`, {
        reason: blockReason,
        duration_hours: blockDuration ? parseInt(blockDuration) : undefined,
      });
      setBlockModalOpen(false);
      setBlockReason('');
      setBlockDuration('');
      loadPlayer();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to block player');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnblock = async () => {
    setActionLoading(true);
    try {
      await post(`/players/${id}/unblock`);
      setUnblockModalOpen(false);
      loadPlayer();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to unblock player');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPin = async () => {
    setActionLoading(true);
    try {
      await post(`/players/${id}/reset-pin`);
      setResetPinModalOpen(false);
      loadPlayer();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset PIN');
    } finally {
      setActionLoading(false);
    }
  };

  const gameColumns: Column<AdminGameSession & Record<string, unknown>>[] = [
    { key: 'id', label: 'ID' },
    { key: 'game_token', label: 'Token', render: (_, row) => (
      <span className="font-mono text-xs">{row.game_token.slice(0, 8)}...</span>
    )},
    { key: 'stake_amount', label: 'Stake', align: 'right', render: (_, row) => `${row.stake_amount.toLocaleString()} UGX` },
    { key: 'status', label: 'Status', render: (_, row) => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
        row.status === 'completed' ? 'bg-green-100 text-green-700' :
        row.status === 'active' ? 'bg-blue-100 text-blue-700' :
        row.status === 'cancelled' ? 'bg-red-100 text-red-700' :
        'bg-gray-100 text-gray-700'
      }`}>{row.status}</span>
    )},
    { key: 'winner_id', label: 'Won?', align: 'center', render: (_, row) => {
      if (!row.winner_id) return '—';
      return row.winner_id === Number(id) ? (
        <span className="text-green-600 font-medium">Yes</span>
      ) : (
        <span className="text-red-600 font-medium">No</span>
      );
    }},
    { key: 'created_at', label: 'Date', render: (_, row) => new Date(row.created_at).toLocaleString() },
  ];

  const txnColumns: Column<AdminTransaction & Record<string, unknown>>[] = [
    { key: 'id', label: 'ID' },
    { key: 'transaction_type', label: 'Type', render: (_, row) => (
      <span className="capitalize">{row.transaction_type.replace(/_/g, ' ')}</span>
    )},
    { key: 'amount', label: 'Amount', align: 'right', render: (_, row) => `${row.amount.toLocaleString()} UGX` },
    { key: 'status', label: 'Status', render: (_, row) => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
        row.status === 'completed' ? 'bg-green-100 text-green-700' :
        row.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
        row.status === 'failed' ? 'bg-red-100 text-red-700' :
        'bg-gray-100 text-gray-700'
      }`}>{row.status}</span>
    )},
    { key: 'created_at', label: 'Date', render: (_, row) => new Date(row.created_at).toLocaleString() },
  ];

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#373536] mx-auto"></div>
      </div>
    );
  }

  if (error && !player) {
    return (
      <div>
        <button onClick={() => navigate('/pm-admin/players')} className="text-sm text-[#373536] hover:underline mb-4">&larr; Back to Players</button>
        <div className="p-4 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      </div>
    );
  }

  if (!player) return null;

  return (
    <div>
      <button
        onClick={() => navigate('/pm-admin/players')}
        className="text-sm text-[#373536] hover:underline mb-4 inline-block"
      >
        &larr; Back to Players
      </button>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      {/* Player Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {player.display_name || 'No name'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{player.phone_number}</p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                  player.is_blocked
                    ? 'bg-red-100 text-red-700'
                    : 'bg-green-100 text-green-700'
                }`}
              >
                {player.is_blocked ? 'Blocked' : 'Active'}
              </span>
              {player.block_reason && (
                <span className="text-xs text-gray-500">
                  Reason: {player.block_reason}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {player.is_blocked ? (
              <button
                onClick={() => setUnblockModalOpen(true)}
                className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100"
              >
                Unblock
              </button>
            ) : (
              <button
                onClick={() => setBlockModalOpen(true)}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
              >
                Block
              </button>
            )}
            <button
              onClick={() => setResetPinModalOpen(true)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Reset PIN
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Balance', value: `${balance.toLocaleString()} UGX` },
          { label: 'Games Played', value: player.total_games_played },
          { label: 'Games Won', value: player.total_games_won },
          { label: 'Games Drawn', value: player.total_games_drawn },
          { label: 'Total Winnings', value: `${player.total_winnings.toLocaleString()} UGX` },
          { label: 'Disconnects', value: player.disconnect_count },
          { label: 'No Shows', value: player.no_show_count },
          { label: 'Last Active', value: player.last_active ? new Date(player.last_active).toLocaleString() : 'Never' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs text-gray-500">{stat.label}</div>
            <div className="text-lg font-bold text-gray-900 mt-1">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(['games', 'transactions'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === tab
                ? 'bg-[#373536] text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'games' && (
        <DataTable
          columns={gameColumns}
          data={games as (AdminGameSession & Record<string, unknown>)[]}
          total={gamesTotal}
          page={gamesPage}
          pageSize={pageSize}
          onPageChange={handleGamesPage}
          loading={tabLoading}
          emptyMessage="No games found"
        />
      )}

      {activeTab === 'transactions' && (
        <DataTable
          columns={txnColumns}
          data={transactions as (AdminTransaction & Record<string, unknown>)[]}
          total={txnTotal}
          page={txnPage}
          pageSize={pageSize}
          onPageChange={handleTxnPage}
          loading={tabLoading}
          emptyMessage="No transactions found"
        />
      )}

      {/* Block Modal */}
      <ConfirmModal
        open={blockModalOpen}
        title="Block Player"
        message={`Block ${player.display_name || player.phone_number}? They won't be able to play while blocked.`}
        confirmLabel="Block Player"
        variant="danger"
        onConfirm={handleBlock}
        onCancel={() => { setBlockModalOpen(false); setBlockReason(''); setBlockDuration(''); }}
        loading={actionLoading}
      >
        <div className="space-y-3 mt-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
            <input
              type="text"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="Why is this player being blocked?"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Duration (hours, leave empty for permanent)</label>
            <input
              type="number"
              value={blockDuration}
              onChange={(e) => setBlockDuration(e.target.value)}
              placeholder="e.g. 24"
              min="1"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>
        </div>
      </ConfirmModal>

      {/* Unblock Modal */}
      <ConfirmModal
        open={unblockModalOpen}
        title="Unblock Player"
        message={`Unblock ${player.display_name || player.phone_number}? They will be able to play again.`}
        confirmLabel="Unblock Player"
        onConfirm={handleUnblock}
        onCancel={() => setUnblockModalOpen(false)}
        loading={actionLoading}
      />

      {/* Reset PIN Modal */}
      <ConfirmModal
        open={resetPinModalOpen}
        title="Reset PIN"
        message={`Reset the PIN for ${player.display_name || player.phone_number}? They will need to set a new PIN on their next login.`}
        confirmLabel="Reset PIN"
        variant="danger"
        onConfirm={handleResetPin}
        onCancel={() => setResetPinModalOpen(false)}
        loading={actionLoading}
      />
    </div>
  );
}
