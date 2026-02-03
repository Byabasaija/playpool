import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = '/api/v1';

interface Account {
  id: number;
  account_type: string;
  owner_player_id?: number;
  balance: number;
  created_at: string;
  updated_at: string;
}

interface AccountTransaction {
  id: number;
  debit_account_id?: number;
  credit_account_id?: number;
  amount: number;
  reference_type?: string;
  reference_id?: number;
  description?: string;
  created_at: string;
}

interface Stats {
  account_balances?: Record<string, number>;
  total_games?: number;
  active_games?: number;
  completed_games?: number;
  total_players?: number;
  pending_withdrawals?: number;
}

export const AdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'stats' | 'accounts' | 'transactions'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adminSession = sessionStorage.getItem('admin_session');
  const adminPhone = sessionStorage.getItem('admin_phone');

  useEffect(() => {
    if (!adminSession) {
      navigate('/pm-admin');
      return;
    }

    // Load stats by default
    loadStats();
  }, []);

  const makeAuthRequest = async (endpoint: string) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'X-Admin-Session': adminSession!,
      },
    });

    if (res.status === 401) {
      sessionStorage.removeItem('admin_session');
      sessionStorage.removeItem('admin_phone');
      navigate('/pm-admin');
      throw new Error('Session expired');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  };

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await makeAuthRequest('/admin/stats');
      setStats(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await makeAuthRequest('/admin/accounts');
      setAccounts(data.accounts || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await makeAuthRequest('/admin/account_transactions?limit=100');
      setTransactions(data.transactions || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab: 'stats' | 'accounts' | 'transactions') => {
    setActiveTab(tab);
    if (tab === 'stats') loadStats();
    else if (tab === 'accounts') loadAccounts();
    else if (tab === 'transactions') loadTransactions();
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_session');
    sessionStorage.removeItem('admin_phone');
    navigate('/pm-admin');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <img src="/logo.webp" alt="PlayMatatu" width={120} height={85} />
            <h1 className="text-xl font-bold text-gray-900">Admin Dashboard</h1>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600">{adminPhone}</span>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex space-x-2 mb-6">
          <button
            onClick={() => handleTabChange('stats')}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === 'stats'
                ? 'bg-[#373536] text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Stats
          </button>
          <button
            onClick={() => handleTabChange('accounts')}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === 'accounts'
                ? 'bg-[#373536] text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Accounts
          </button>
          <button
            onClick={() => handleTabChange('transactions')}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === 'transactions'
                ? 'bg-[#373536] text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Transactions
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#373536] mx-auto"></div>
          </div>
        )}

        {/* Stats Tab */}
        {!loading && activeTab === 'stats' && stats && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Account Balances</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {stats.account_balances && Object.entries(stats.account_balances).map(([type, balance]) => (
                  <div key={type} className="p-4 bg-gray-50 rounded-lg">
                    <div className="text-sm text-gray-600">{type.replace(/_/g, ' ').toUpperCase()}</div>
                    <div className="text-2xl font-bold text-gray-900">{balance.toLocaleString()} UGX</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Platform Stats</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600">Total Players</div>
                  <div className="text-2xl font-bold text-gray-900">{stats.total_players || 0}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600">Total Games</div>
                  <div className="text-2xl font-bold text-gray-900">{stats.total_games || 0}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600">Active Games</div>
                  <div className="text-2xl font-bold text-gray-900">{stats.active_games || 0}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600">Completed Games</div>
                  <div className="text-2xl font-bold text-gray-900">{stats.completed_games || 0}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Pending Actions</h2>
              <div className="p-4 bg-yellow-50 rounded-lg">
                <div className="text-sm text-gray-600">Pending Withdrawals</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.pending_withdrawals || 0).toLocaleString()} UGX</div>
              </div>
            </div>
          </div>
        )}

        {/* Accounts Tab */}
        {!loading && activeTab === 'accounts' && (
          <div className="bg-white rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {accounts.filter(acc => acc.owner_player_id === null || acc.owner_player_id === undefined).map((acc) => (
                  <tr key={acc.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{acc.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{acc.account_type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                      {acc.balance.toLocaleString()} UGX
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(acc.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Transactions Tab */}
        {!loading && activeTab === 'transactions' && (
          <div className="bg-white rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Debit Acc</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Credit Acc</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((txn) => (
                  <tr key={txn.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{txn.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{txn.debit_account_id || '—'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{txn.credit_account_id || '—'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                      {txn.amount.toLocaleString()} UGX
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{txn.description || '—'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(txn.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
