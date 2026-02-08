import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAdminApi } from '../hooks/useAdminApi';
import { ConfirmModal } from '../components/ConfirmModal';
import type { AdminGameMove } from '../types/admin.types';

interface GameDetail {
  id: number;
  game_token: string;
  player1_id?: number;
  player2_id?: number;
  player1_name?: string;
  player2_name?: string;
  player1_phone?: string;
  player2_phone?: string;
  stake_amount: number;
  status: string;
  winner_id?: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  expiry_time: string;
}

interface MoveRow extends AdminGameMove {
  player_name?: string;
}

const statusStyles: Record<string, string> = {
  WAITING: 'bg-yellow-100 text-yellow-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export function AdminGameDetail() {
  const { id } = useParams<{ id: string }>();
  const { get, post } = useAdminApi();
  const navigate = useNavigate();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get(`/games/${id}`);
      setGame(data.game);
      setMoves(data.moves || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
    } finally {
      setLoading(false);
    }
  }, [get, id]);

  useEffect(() => { loadGame(); }, [loadGame]);

  const handleCancel = async () => {
    if (!cancelReason.trim()) return;
    setActionLoading(true);
    try {
      await post(`/games/${id}/cancel`, { reason: cancelReason });
      setCancelModalOpen(false);
      setCancelReason('');
      loadGame();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel game');
    } finally {
      setActionLoading(false);
    }
  };

  const canCancel = game && (game.status === 'WAITING' || game.status === 'IN_PROGRESS');

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#373536] mx-auto"></div>
      </div>
    );
  }

  if (error && !game) {
    return (
      <div>
        <button onClick={() => navigate('/pm-admin/games')} className="text-sm text-[#373536] hover:underline mb-4">&larr; Back to Games</button>
        <div className="p-4 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      </div>
    );
  }

  if (!game) return null;

  const winnerName = game.winner_id
    ? game.winner_id === game.player1_id
      ? game.player1_name
      : game.player2_name
    : null;

  return (
    <div>
      <button
        onClick={() => navigate('/pm-admin/games')}
        className="text-sm text-[#373536] hover:underline mb-4 inline-block"
      >
        &larr; Back to Games
      </button>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      {/* Game Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Game #{game.id}
            </h2>
            <p className="text-sm text-gray-500 mt-1 font-mono">{game.game_token}</p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                  statusStyles[game.status] || 'bg-gray-100 text-gray-700'
                }`}
              >
                {game.status}
              </span>
              {winnerName && (
                <span className="text-xs text-gray-500">
                  Winner: {winnerName}
                </span>
              )}
            </div>
          </div>

          {canCancel && (
            <button
              onClick={() => setCancelModalOpen(true)}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
            >
              Cancel Game
            </button>
          )}
        </div>
      </div>

      {/* Game Info Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Stake</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{game.stake_amount.toLocaleString()} UGX</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Created</div>
          <div className="text-sm font-bold text-gray-900 mt-1">{new Date(game.created_at).toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Started</div>
          <div className="text-sm font-bold text-gray-900 mt-1">
            {game.started_at ? new Date(game.started_at).toLocaleString() : '—'}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Completed</div>
          <div className="text-sm font-bold text-gray-900 mt-1">
            {game.completed_at ? new Date(game.completed_at).toLocaleString() : '—'}
          </div>
        </div>
      </div>

      {/* Players */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-2">Player 1</div>
          {game.player1_id ? (
            <div>
              <div className="font-medium text-gray-900">{game.player1_name || 'No name'}</div>
              <div className="text-sm text-gray-500">{game.player1_phone}</div>
              <button
                onClick={() => navigate(`/pm-admin/players/${game.player1_id}`)}
                className="text-xs text-[#373536] hover:underline mt-1"
              >
                View profile
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-400">No player</div>
          )}
          {game.winner_id === game.player1_id && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 mt-2">
              Winner
            </span>
          )}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-2">Player 2</div>
          {game.player2_id ? (
            <div>
              <div className="font-medium text-gray-900">{game.player2_name || 'No name'}</div>
              <div className="text-sm text-gray-500">{game.player2_phone}</div>
              <button
                onClick={() => navigate(`/pm-admin/players/${game.player2_id}`)}
                className="text-xs text-[#373536] hover:underline mt-1"
              >
                View profile
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-400">Waiting for opponent</div>
          )}
          {game.winner_id === game.player2_id && game.player2_id && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 mt-2">
              Winner
            </span>
          )}
        </div>
      </div>

      {/* Moves Timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">
          Moves ({moves.length})
        </h3>
        {moves.length === 0 ? (
          <p className="text-sm text-gray-500">No moves recorded</p>
        ) : (
          <div className="space-y-2">
            {moves.map((move) => (
              <div
                key={move.id}
                className="flex items-center gap-3 py-2 px-3 rounded bg-gray-50 text-sm"
              >
                <span className="font-mono text-xs text-gray-400 w-8">#{move.move_number}</span>
                <span className="font-medium text-gray-900 min-w-[80px]">
                  {move.player_name || `Player #${move.player_id}`}
                </span>
                <span className="text-gray-600 capitalize">
                  {move.move_type.replace(/_/g, ' ')}
                </span>
                {move.card_played && (
                  <span className="font-mono text-xs bg-white border border-gray-200 px-2 py-0.5 rounded">
                    {move.card_played}
                  </span>
                )}
                {move.suit_declared && (
                  <span className="text-xs text-gray-500">
                    declared {move.suit_declared}
                  </span>
                )}
                <span className="ml-auto text-xs text-gray-400">
                  {new Date(move.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cancel Modal */}
      <ConfirmModal
        open={cancelModalOpen}
        title="Cancel Game"
        message="Cancel this game and refund stakes to both players? This action cannot be undone."
        confirmLabel="Cancel Game"
        variant="danger"
        onConfirm={handleCancel}
        onCancel={() => { setCancelModalOpen(false); setCancelReason(''); }}
        loading={actionLoading}
      >
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
          <input
            type="text"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Why is this game being cancelled?"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>
      </ConfirmModal>
    </div>
  );
}
