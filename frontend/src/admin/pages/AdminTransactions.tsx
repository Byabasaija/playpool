import { useState, useEffect, useCallback } from 'react';
import { useAdminApi } from '../hooks/useAdminApi';
import { DataTable, Column } from '../components/DataTable';

interface TxnRow {
  id: number;
  player_id: number;
  player_name?: string;
  player_phone?: string;
  transaction_type: string;
  amount: number;
  status: string;
  created_at: string;
  completed_at?: string;
}

const TYPE_FILTERS = ['all', 'STAKE', 'WITHDRAW', 'PAYOUT'] as const;
const STATUS_FILTERS = ['all', 'PENDING', 'COMPLETED', 'FAILED'] as const;

export function AdminTransactions() {
  const { get } = useAdminApi();

  const [transactions, setTransactions] = useState<TxnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [txnType, setTxnType] = useState<string>('all');
  const [txnStatus, setTxnStatus] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 50;

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/transactions', {
        type: txnType,
        status: txnStatus,
        date_from: dateFrom,
        date_to: dateTo,
        limit: pageSize,
        offset: page * pageSize,
      });
      setTransactions(data.transactions || []);
      setTotal(data.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [get, txnType, txnStatus, dateFrom, dateTo, page]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const columns: Column<TxnRow & Record<string, unknown>>[] = [
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
      key: 'transaction_type',
      label: 'Type',
      render: (_, row) => (
        <span className="capitalize text-sm">{row.transaction_type.replace(/_/g, ' ').toLowerCase()}</span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (_, row) => `${row.amount.toLocaleString()} UGX`,
    },
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
      label: 'Date',
      render: (_, row) => new Date(row.created_at).toLocaleString(),
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Transactions</h2>

      {/* Filters */}
      <div className="space-y-3 mb-4">
        {/* Type filter */}
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs text-gray-500 self-center w-12">Type:</span>
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => { setPage(0); setTxnType(t); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                txnType === t
                  ? 'bg-[#373536] text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {t === 'all' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs text-gray-500 self-center w-12">Status:</span>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => { setPage(0); setTxnStatus(s); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                txnStatus === s
                  ? 'bg-[#373536] text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs text-gray-500 w-12">Date:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setPage(0); setDateFrom(e.target.value); }}
            className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setPage(0); setDateTo(e.target.value); }}
            className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setPage(0); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      <DataTable
        columns={columns}
        data={transactions as (TxnRow & Record<string, unknown>)[]}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        loading={loading}
        emptyMessage="No transactions found"
      />
    </div>
  );
}
