import { useState, useEffect, useCallback } from 'react';
import { useAdminApi } from '../hooks/useAdminApi';
import { DataTable, Column } from '../components/DataTable';
import { ConfirmModal } from '../components/ConfirmModal';

interface WithdrawRow {
  id: number;
  player_id: number;
  player_name?: string;
  player_phone?: string;
  amount: number;
  fee: number;
  net_amount: number;
  method: string;
  destination: string;
  status: string;
  created_at: string;
  processed_at?: string;
  note?: string;
}

const STATUS_FILTERS = ['all', 'pending', 'completed', 'failed'] as const;

export function AdminWithdrawals() {
  const { get, post } = useAdminApi();

  const [withdrawals, setWithdrawals] = useState<WithdrawRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedWithdraw, setSelectedWithdraw] = useState<WithdrawRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const [pageSize, setPageSize] = useState(25);

  const loadWithdrawals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/withdrawals', {
        status,
        limit: pageSize,
        offset: page * pageSize,
      });
      setWithdrawals(data.withdrawals || []);
      setTotal(data.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load withdrawals');
    } finally {
      setLoading(false);
    }
  }, [get, status, page]);

  useEffect(() => { loadWithdrawals(); }, [loadWithdrawals]);

  const handleApprove = async () => {
    if (!selectedWithdraw) return;
    setActionLoading(true);
    try {
      await post(`/withdrawals/${selectedWithdraw.id}/approve`);
      setApproveModalOpen(false);
      setSelectedWithdraw(null);
      loadWithdrawals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve withdrawal');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedWithdraw || !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await post(`/withdrawals/${selectedWithdraw.id}/reject`, { reason: rejectReason });
      setRejectModalOpen(false);
      setSelectedWithdraw(null);
      setRejectReason('');
      loadWithdrawals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject withdrawal');
    } finally {
      setActionLoading(false);
    }
  };

  const columns: Column<WithdrawRow & Record<string, unknown>>[] = [
    { key: 'id', label: 'ID' },
    {
      key: 'player_name',
      label: 'Player',
      render: (_, row) => (
        <div>
          <div className="font-medium text-sm">{row.player_name || '—'}</div>
          {row.player_phone && <div className="text-xs text-gray-400">{row.player_phone}</div>}
        </div>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (_, row) => `${row.amount.toLocaleString()} UGX`,
    },
    { key: 'method', label: 'Method' },
    { key: 'destination', label: 'Destination' },
    {
      key: 'status',
      label: 'Status',
      render: (_, row) => (
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
            row.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
            row.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
            row.status === 'FAILED' ? 'bg-red-100 text-red-700' :
            'bg-gray-100 text-gray-700'
          }`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Requested',
      render: (_, row) => new Date(row.created_at).toLocaleString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => {
        if (row.status !== 'PENDING') return row.note || '—';
        return (
          <div className="flex gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedWithdraw(row); setApproveModalOpen(true); }}
              className="px-2 py-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100"
            >
              Approve
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedWithdraw(row); setRejectModalOpen(true); }}
              className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
            >
              Reject
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Withdrawals</h2>

      {/* Status Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setPage(0); setStatus(s); }}
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

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      <DataTable
        columns={columns}
        data={withdrawals as (WithdrawRow & Record<string, unknown>)[]}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        loading={loading}
        emptyMessage="No withdrawals found"
      />

      {/* Approve Modal */}
      <ConfirmModal
        open={approveModalOpen}
        title="Approve Withdrawal"
        message={selectedWithdraw ? `Approve withdrawal of ${selectedWithdraw.amount.toLocaleString()} UGX to ${selectedWithdraw.destination}?` : ''}
        confirmLabel="Approve"
        onConfirm={handleApprove}
        onCancel={() => { setApproveModalOpen(false); setSelectedWithdraw(null); }}
        loading={actionLoading}
      />

      {/* Reject Modal */}
      <ConfirmModal
        open={rejectModalOpen}
        title="Reject Withdrawal"
        message={selectedWithdraw ? `Reject withdrawal of ${selectedWithdraw.amount.toLocaleString()} UGX? The amount will be refunded to the player's balance.` : ''}
        confirmLabel="Reject & Refund"
        variant="danger"
        onConfirm={handleReject}
        onCancel={() => { setRejectModalOpen(false); setSelectedWithdraw(null); setRejectReason(''); }}
        loading={actionLoading}
      >
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this withdrawal being rejected?"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>
      </ConfirmModal>
    </div>
  );
}
