import { useState, useEffect, useCallback } from 'react';
import { useAdminApi } from '../hooks/useAdminApi';
import { DataTable, Column } from '../components/DataTable';
import type { AdminStats, AdminAccountBalance } from '../types/admin.types';

interface AcctTxnRow {
  id: number;
  debit_account?: string;
  credit_account?: string;
  amount: number;
  reference_type?: string;
  reference_id?: number;
  description?: string;
  created_at: string;
}

export function AdminDashboard() {
  const { get } = useAdminApi();
  const [activeTab, setActiveTab] = useState<'stats' | 'accounts' | 'transactions'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [accounts, setAccounts] = useState<AdminAccountBalance[]>([]);
  const [transactions, setTransactions] = useState<AcctTxnRow[]>([]);
  const [txnTotal, setTxnTotal] = useState(0);
  const [txnPage, setTxnPage] = useState(0);
  const [txnPageSize, setTxnPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/stats');
      setStats(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/accounts');
      setAccounts(data.accounts || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/account_transactions', {
        limit: txnPageSize,
        offset: txnPage * txnPageSize,
      });
      setTransactions(data.transactions || []);
      setTxnTotal(data.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [get, txnPage, txnPageSize]);

  useEffect(() => { loadStats(); }, []);

  useEffect(() => {
    if (activeTab === 'transactions') {
      loadTransactions();
    }
  }, [activeTab, loadTransactions]);

  const handleTabChange = (tab: 'stats' | 'accounts' | 'transactions') => {
    setActiveTab(tab);
    if (tab === 'stats') loadStats();
    else if (tab === 'accounts') loadAccounts();
  };

  const txnColumns: Column<AcctTxnRow & Record<string, unknown>>[] = [
    { key: 'id', label: 'ID' },
    {
      key: 'debit_account',
      label: 'Debit (From)',
      render: (_, row) => (
        <span className="text-sm">{row.debit_account || '—'}</span>
      ),
    },
    {
      key: 'credit_account',
      label: 'Credit (To)',
      render: (_, row) => (
        <span className="text-sm">{row.credit_account || '—'}</span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (_, row) => `${row.amount.toLocaleString()} UGX`,
    },
    {
      key: 'description',
      label: 'Description',
      render: (_, row) => (
        <span className="text-sm text-gray-500">{row.description || '—'}</span>
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
      <h2 className="text-xl font-bold text-gray-900 mb-4">Dashboard</h2>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['stats', 'accounts', 'transactions'] as const).map((tab) => (
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

      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>}

      {loading && activeTab !== 'transactions' && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#373536] mx-auto"></div>
        </div>
      )}

      {/* Stats */}
      {!loading && activeTab === 'stats' && stats && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Account Balances</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stats.account_balances && Object.entries(stats.account_balances).map(([type, balance]) => (
                <div key={type} className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-500 uppercase">{type.replace(/_/g, ' ')}</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{balance.toLocaleString()} UGX</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Platform Stats</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Players', value: stats.total_players || 0 },
                { label: 'Total Games', value: stats.total_games || 0 },
                { label: 'Active Games', value: stats.active_games || 0 },
                { label: 'Completed Games', value: stats.completed_games || 0 },
              ].map((item) => (
                <div key={item.label} className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-500">{item.label}</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{item.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Pending Actions</h3>
            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-100">
              <div className="text-xs text-gray-500">Pending Withdrawals</div>
              <div className="text-xl font-bold text-gray-900 mt-1">
                {(stats.pending_withdrawals || 0).toLocaleString()} UGX
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Accounts */}
      {!loading && activeTab === 'accounts' && (
        <div className="bg-white rounded-lg overflow-hidden border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {accounts.filter(a => !a.owner_player_id).map((acc) => (
                <tr key={acc.id}>
                  <td className="px-4 py-3 text-sm text-gray-900">{acc.id}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{acc.account_type}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                    {acc.balance.toLocaleString()} UGX
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(acc.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transactions */}
      {activeTab === 'transactions' && (
        <DataTable
          columns={txnColumns}
          data={transactions as (AcctTxnRow & Record<string, unknown>)[]}
          total={txnTotal}
          page={txnPage}
          pageSize={txnPageSize}
          onPageChange={setTxnPage}
          onPageSizeChange={(size) => { setTxnPageSize(size); setTxnPage(0); }}
          loading={loading}
          emptyMessage="No account transactions found"
        />
      )}
    </div>
  );
}
