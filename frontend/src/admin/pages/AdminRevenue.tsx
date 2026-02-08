import { useState, useEffect, useCallback } from 'react';
import { useAdminApi } from '../hooks/useAdminApi';

interface RevenueSummary {
  total_stakes: number;
  total_commissions: number;
  total_payouts: number;
  total_tax: number;
  total_withdrawals: number;
  games_completed: number;
}

interface BalanceRow {
  account_type: string;
  balance: number;
}

export function AdminRevenue() {
  const { get } = useAdminApi();

  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRevenue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/revenue', {
        date_from: dateFrom,
        date_to: dateTo,
      });
      setSummary(data.summary);
      setBalances(data.balances || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load revenue data');
    } finally {
      setLoading(false);
    }
  }, [get, dateFrom, dateTo]);

  useEffect(() => { loadRevenue(); }, [loadRevenue]);

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Revenue</h2>

      {/* Date Range Filter */}
      <div className="flex gap-2 items-center mb-6 flex-wrap">
        <span className="text-sm text-gray-500">Period:</span>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
        <span className="text-sm text-gray-400">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear (all time)
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
      )}

      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#373536] mx-auto"></div>
        </div>
      )}

      {!loading && summary && (
        <div className="space-y-6">
          {/* Revenue Summary */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              Revenue Summary
              {dateFrom || dateTo ? (
                <span className="text-sm font-normal text-gray-500 ml-2">
                  ({dateFrom || '...'} to {dateTo || 'now'})
                </span>
              ) : (
                <span className="text-sm font-normal text-gray-500 ml-2">(all time)</span>
              )}
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Total Stakes', value: summary.total_stakes, color: 'text-gray-900' },
                { label: 'Commissions Earned', value: summary.total_commissions, color: 'text-green-700' },
                { label: 'Tax Collected', value: summary.total_tax, color: 'text-blue-700' },
                { label: 'Winner Payouts', value: summary.total_payouts, color: 'text-gray-900' },
                { label: 'Withdrawals Processed', value: summary.total_withdrawals, color: 'text-gray-900' },
              ].map((item) => (
                <div key={item.label} className="p-4 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-500">{item.label}</div>
                  <div className={`text-xl font-bold ${item.color} mt-1`}>
                    {item.value.toLocaleString()} UGX
                  </div>
                </div>
              ))}
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500">Games Completed</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{summary.games_completed.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Net Revenue */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Net Revenue</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                <div className="text-xs text-gray-500">Platform Commission</div>
                <div className="text-xl font-bold text-green-700 mt-1">
                  {summary.total_commissions.toLocaleString()} UGX
                </div>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                <div className="text-xs text-gray-500">Tax Revenue</div>
                <div className="text-xl font-bold text-blue-700 mt-1">
                  {summary.total_tax.toLocaleString()} UGX
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-xs text-gray-500">Total Revenue</div>
                <div className="text-xl font-bold text-gray-900 mt-1">
                  {(summary.total_commissions + summary.total_tax).toLocaleString()} UGX
                </div>
              </div>
            </div>
          </div>

          {/* Current Account Balances */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              Current Account Balances
              <span className="text-sm font-normal text-gray-500 ml-2">(real-time)</span>
            </h3>
            {balances.length === 0 ? (
              <p className="text-sm text-gray-500">No accounts found</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {balances.map((bal) => (
                  <div key={bal.account_type} className="p-4 bg-gray-50 rounded-lg">
                    <div className="text-xs text-gray-500 uppercase">{bal.account_type.replace(/_/g, ' ')}</div>
                    <div className="text-xl font-bold text-gray-900 mt-1">
                      {bal.balance.toLocaleString()} UGX
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
