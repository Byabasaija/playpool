import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getConfig } from '../utils/apiClient';
import { GetWithdrawsResponse } from '../types/api.types';

export const ProfilePage: React.FC = () => {
  const [phoneRest, setPhoneRest] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('auth_token'));
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [playerExists, setPlayerExists] = useState<boolean | null>(null);
  const [allowCreate, setAllowCreate] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [withdrawAmount, setWithdrawAmount] = useState<number | ''>('');
  const [withdraws, setWithdraws] = useState<any[]>([]);
  const [loadingWithdraws, setLoadingWithdraws] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [showAllWithdraws, setShowAllWithdraws] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const withdrawInputRef = useRef<HTMLInputElement | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      fetchProfile(token);
    }
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setConfig(cfg);
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (token) {
      (async () => {
        setLoadingWithdraws(true);
        try {
          const resp = await fetch('/api/v1/me/withdraws', { headers: { Authorization: `Bearer ${token}` } });
          if (resp.ok) {
            const d = await resp.json() as GetWithdrawsResponse;
            setWithdraws(d.withdraws || []);
          }
        } catch (e) {}
        setLoadingWithdraws(false);
      })();
    }
  }, [token]);

  const fetchProfile = async (t: string) => {
    try {
      const resp = await fetch('/api/v1/me', { headers: { 'Authorization': `Bearer ${t}` } });
      if (!resp.ok) throw new Error('Failed to fetch profile');
      const data = await resp.json();
      setProfile(data);

      // fetch stats by phone if available
      if (data && data.phone) {
        const sresp = await fetch(`/api/v1/player/${encodeURIComponent(data.phone)}/stats`);
        if (sresp.ok) {
          const sdata = await sresp.json();
          setStats(sdata);
        }
      }
    } catch (e) {
      console.error(e);
      setMessage('Failed to load profile');
    }
  };

  const requestOtp = async () => {
    setMessage(null);
    setLoading(true);
    try {
      const resp = await fetch('/api/v1/auth/request-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '256' + phoneRest.replace(/\D/g, '') })
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMessage(data.error || 'Failed to request OTP');
      } else {
        setOtpRequested(true);
        setMessage('OTP sent via SMS');
      }
    } catch (e) {
      setMessage('Network error');
    }
    setLoading(false);
  };

  const verifyOtp = async () => {
    setMessage(null);
    setLoading(true);
    try {
      const resp = await fetch('/api/v1/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '256' + phoneRest.replace(/\D/g, ''), code })
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMessage(data.error || 'Invalid code');
      } else {
        // store token
        if (data.token) {
          sessionStorage.setItem('auth_token', data.token);
          setToken(data.token);
          setMessage('Verified');
        }
      }
    } catch (e) {
      setMessage('Network error');
    }
    setLoading(false);
  };

  const signOut = () => {
    sessionStorage.removeItem('auth_token');
    setToken(null);
    setProfile(null);
    setStats(null);
    navigate('/');
  };

  const simulateWithdraw = () => {
    // placeholder only - do not perform any backend action
    setMessage('Withdraw placeholder: no real withdrawal performed');
  };

  const checkPlayerExists = async (phoneToCheckRest: string) => {
    setPlayerExists(null);
    const fullPhone = '256' + phoneToCheckRest.replace(/\D/g, '')
    try {
      const resp = await fetch(`/api/v1/player/${encodeURIComponent(fullPhone)}`);
      if (resp.ok) {
        const p = await resp.json();
        setPlayerExists(true);
        // optionally prefill display name preview
        if (p.display_name) setMessage(`Existing user: ${p.display_name}`);
      } else if (resp.status === 404) {
        setPlayerExists(false);
      } else {
        setPlayerExists(false);
      }
    } catch (e) {
      setPlayerExists(false);
    }
  };

  const feePct = config?.withdraw_provider_fee_percent ?? 0;
  const minWithdraw = config?.min_withdraw_amount ?? 0;
  const availableWinnings = profile?.player_winnings ?? profile?.total_winnings ?? 0;

  const computeFee = (amount: number) => {
    return Math.round(amount * feePct) / 100;
  };

  const computeNet = (amount: number) => {
    return amount - computeFee(amount);
  };

  const prefillWithdraw = () => {
    // Prefill withdraw input with full winnings and focus it; reveal embedded form
    setWithdrawAmount(availableWinnings);
    setAmountError(null);
    setShowWithdrawForm(true);
    setTimeout(() => {
      withdrawInputRef.current?.focus();
      withdrawInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  };

  const openConfirm = () => {
    setAmountError(null);
    if (!withdrawAmount || Number(withdrawAmount) <= 0) {
      setAmountError('Enter a positive amount');
      return;
    }
    if (Number(withdrawAmount) < minWithdraw) {
      setAmountError(`Minimum withdraw is ${minWithdraw} UGX`);
      return;
    }
    if (Number(withdrawAmount) > availableWinnings) {
      setAmountError('Amount exceeds available withdrawable balance');
      return;
    }
    setShowConfirmModal(true);
    // focus confirm button after a tick
    setTimeout(() => confirmBtnRef.current?.focus(), 0);
  };

  const confirmWithdraw = async () => {
    if (!token || !withdrawAmount) return;
    setConfirmLoading(true);
    try {
      const resp = await fetch('/api/v1/me/withdraw', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: Number(withdrawAmount), method: 'MOMO', destination: '' })
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMessage(data.error || 'Failed to request withdraw');
      } else {
        setMessage('Withdraw requested');
        setShowConfirmModal(false);
        setWithdrawAmount('');
        // refresh withdraws list
        const wresp = await fetch('/api/v1/me/withdraws', { headers: { Authorization: `Bearer ${token}` } });
        if (wresp.ok) {
          const d = await wresp.json() as GetWithdrawsResponse;
          setWithdraws(d.withdraws || []);
        }
      }
    } catch (e) {
      setMessage('Network error');
    }
    setConfirmLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md mx-auto rounded-2xl p-8">
        <div className="text-center mb-6">
          <img src="/logo.png" alt="PlayMatatu Logo" width={160} className="mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Profile</h2>
        </div>

        {!token ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-700 mb-2">Phone Number</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700">256</span>
                <input
                  className="w-full px-3 py-2 border rounded-r-md"
                  value={phoneRest}
                  onChange={(e) => { setPhoneRest(e.target.value); setPlayerExists(null); setAllowCreate(false); }}
                  onBlur={() => { if (phoneRest) checkPlayerExists(phoneRest); }}
                  placeholder="7XXXXXXXX"
                />
              </div>
            </div>

            {playerExists === false && (
              <div className="text-sm text-yellow-600">
                No account found for this number. <button className="underline" onClick={() => setAllowCreate(true)}>Create account</button> to continue.
              </div>
            )}

            {!otpRequested ? (
              <button className="w-full bg-[#373536] text-white py-2 rounded flex items-center justify-center disabled:opacity-50" onClick={requestOtp} disabled={loading || (playerExists === false && !allowCreate)}>
                {loading ? (<div className="animate-spin h-4 w-4 border-b-2 border-white rounded-full mr-2" />) : null}
                Request OTP
              </button>
            ) : (
              <div className="space-y-2">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Enter 4-digit code</label>
                  <input maxLength={4} className="w-full px-3 py-2 border rounded" value={code} onChange={(e) => setCode(e.target.value)} placeholder="1234" />
                </div>
                <button className="w-full bg-[#373536] text-white py-2 rounded flex items-center justify-center disabled:opacity-50" onClick={verifyOtp} disabled={loading}>
                  {loading ? (<div className="animate-spin h-4 w-4 border-b-2 border-white rounded-full mr-2" />) : null}
                  Verify
                </button>
              </div>
            )}

            {message && <div className="text-sm text-red-600">{message}</div>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 border rounded">
              <div className="text-sm text-gray-500">Signed in as</div>
              <div className="font-semibold text-lg">{profile?.display_name || 'Player'}</div>
              <div className="text-xs text-gray-400">{profile?.phone}</div>

              <div className="mt-3 flex items-center gap-6 text-sm text-gray-600">
                <div className="flex items-center gap-2"><span aria-hidden>🎮</span><span className="font-semibold">{stats?.games_played ?? profile?.total_games_played ?? 0}</span></div>
                <div className="flex items-center gap-2"><span aria-hidden>🏆</span><span className="font-semibold">{stats?.games_won ?? profile?.total_games_won ?? 0}</span></div>
                <div className="flex items-center gap-2"><span aria-hidden>📈</span><span className="font-semibold">{(stats?.win_rate ?? 0).toFixed(1)}%</span></div>
                <div className="flex items-center gap-2"><span aria-hidden>🔥</span><span className="font-semibold">{stats?.current_streak ?? 0}</span></div>
              </div>
            </div>

            <div className="p-4 border rounded space-y-2">
              <div className="font-semibold">Balance</div>
              <div className="flex items-center justify-between">
                <div>Winnings: <span className="font-bold">{profile?.player_winnings ?? profile?.total_winnings ?? 0} UGX</span></div>
                <div>
                  <button
                    className="ml-2 bg-white border text-sm px-2 py-1 rounded"
                    onClick={prefillWithdraw}
                    disabled={availableWinnings <= 0}
                  >
                    Withdraw
                  </button>
                </div>
              </div>
              {config?.withdraw_provider_fee_percent != null && (
                <div className="text-xs text-gray-500">Withdrawals subject to provider fees (≈{config.withdraw_provider_fee_percent}%)</div>
              )}

              {showWithdrawForm && (
                <div className="mt-3">
                  <div className="text-sm">Available to withdraw: <span className="font-bold">{availableWinnings} UGX</span></div>
                  <div className="text-sm mt-2">Amount (UGX)</div>
                  <label htmlFor="withdraw-amount" className="sr-only">Amount in UGX</label>
                  <input ref={withdrawInputRef} id="withdraw-amount" type="number" className="w-full px-3 py-2 border rounded" value={withdrawAmount as any} onChange={(e) => setWithdrawAmount(e.target.value === '' ? '' : Number(e.target.value))} aria-describedby="withdraw-help" />

                  <div id="withdraw-help" className="text-xs text-gray-500 mt-2">
                    {feePct ? `Provider fee: ≈${feePct}%` : null}
                    {minWithdraw ? ` — min ${minWithdraw} UGX` : null}
                  </div>

                  {withdrawAmount && Number(withdrawAmount) > 0 && (
                    <div className="mt-2 p-2 bg-gray-50 rounded text-sm">
                      <div>Fee: <span className="font-semibold">{computeFee(Number(withdrawAmount))} UGX</span></div>
                      <div>Net you receive: <span className="font-semibold">{computeNet(Number(withdrawAmount))} UGX</span></div>
                    </div>
                  )}

                  {amountError && <div className="text-sm text-red-600">{amountError}</div>}

                  <div className="flex gap-3 mt-2">
                    <button className="flex-1 bg-[#373536] text-white py-2 rounded" onClick={openConfirm} disabled={!withdrawAmount || loading}>
                      {loading ? 'Processing...' : 'Withdraw'}
                    </button>
                    <button className="flex-1 bg-white border py-2 rounded" onClick={() => { setShowWithdrawForm(false); setWithdrawAmount(''); setAmountError(null); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>



            <div className="p-4 border rounded space-y-2">
              <div className="font-semibold">My withdraws { !loadingWithdraws && (<span className="text-sm text-gray-500">({withdraws.length})</span>) }</div>
              {loadingWithdraws ? <div className="text-sm">Loading...</div> : (
                <div className="space-y-2 text-sm">
                  {withdraws.length === 0 ? <div>No withdraws</div> : (
                    (showAllWithdraws ? withdraws : withdraws.slice(0, 5)).map(w => (
                      <div key={w.id} className="p-2 bg-gray-50 rounded">
                        <div className="flex justify-between">
                          <div>
                            <div className="font-medium">{new Date(w.created_at).toLocaleString()}</div>
                            <div className="text-xs text-gray-600">Method: {w.method} {w.destination ? `— ${w.destination}` : ''}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">{w.amount} UGX</div>
                            <div className="text-xs">Fee: {w.fee} — Net: {w.net_amount}</div>
                            <div className="text-xs">{w.status}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}

                  {withdraws.length > 5 && !showAllWithdraws && (
                    <div className="text-center text-sm">
                      <button className="text-sm text-blue-600 underline" onClick={() => setShowAllWithdraws(true)}>View all ({withdraws.length})</button>
                    </div>
                  )}

                  {withdraws.length > 5 && showAllWithdraws && (
                    <div className="text-center text-sm">
                      <button className="text-sm text-gray-600 underline" onClick={() => setShowAllWithdraws(false)}>Show less</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button className="flex-1 bg-[#373536] text-white py-2 rounded" onClick={() => navigate('/')}>New game</button>
            </div>

            <div className="pt-4 text-center">
              <button className="text-sm text-gray-600 underline" onClick={signOut}>Sign out</button>
            </div>

            {message && <div className="text-sm text-gray-600 text-center">{message}</div>}
          </div>
        )}

        {/* Confirmation modal */}
        {showConfirmModal && (
          <div className="fixed inset-0 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="withdraw-confirm-title">
            <div className="absolute inset-0 bg-black opacity-40" onClick={() => setShowConfirmModal(false)} aria-hidden="true"></div>
            <div className="bg-white rounded p-6 z-10 max-w-md w-full mx-4">
              <h2 id="withdraw-confirm-title" className="text-lg font-semibold">Confirm Withdraw</h2>
              <div className="mt-4 text-sm">
                <div>Amount: <span className="font-semibold">{withdrawAmount} UGX</span></div>
                <div>Fee: <span className="font-semibold">{computeFee(Number(withdrawAmount))} UGX</span></div>
                <div>Net you will receive: <span className="font-semibold">{computeNet(Number(withdrawAmount))} UGX</span></div>
              </div>
              <div className="mt-6 flex gap-3">
                <button ref={confirmBtnRef} className="flex-1 bg-[#373536] text-white py-2 rounded" onClick={confirmWithdraw} disabled={confirmLoading}>{confirmLoading ? 'Processing...' : 'Confirm'}</button>
                <button className="flex-1 bg-white border py-2 rounded" onClick={() => setShowConfirmModal(false)} disabled={confirmLoading}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};