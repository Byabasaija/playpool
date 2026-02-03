import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getConfig, checkPlayerStatus, verifyPIN, requestOTP, verifyOTPAction, resetPIN, getProfile, getPlayerStats, getWithdraws, requestWithdraw } from '../utils/apiClient';
import PinInput from '../components/PinInput';

export const ProfilePage: React.FC = () => {
  const [phoneRest, setPhoneRest] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [playerExists, setPlayerExists] = useState<boolean | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [withdrawAmount, setWithdrawAmount] = useState<number | ''>('');
  const [withdraws, setWithdraws] = useState<any[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [showAllWithdraws, setShowAllWithdraws] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const withdrawInputRef = useRef<HTMLInputElement | null>(null);

  // PIN-related state
  const [hasPin, setHasPin] = useState<boolean>(false);
  const [showPinEntry, setShowPinEntry] = useState<boolean>(true);
  const [pinError, setPinError] = useState<string | undefined>(undefined);
  const [pinLoading, setPinLoading] = useState<boolean>(false);
  const [pinLockoutUntil, setPinLockoutUntil] = useState<string | null>(null);
  const [showForgotPin, setShowForgotPin] = useState<boolean>(false);
  const [forgotPinStep, setForgotPinStep] = useState<'otp' | 'new_pin' | 'confirm_pin'>('otp');
  const [newPin, setNewPin] = useState<string>('');
  
  // Session-only token (not persisted)
  const [token, setToken] = useState<string | null>(null);
  const [loadingWithdraws, setLoadingWithdraws] = useState(false);
  const [otpActionToken, setOtpActionToken] = useState<string | null>(null);
  // Forgot PIN OTP flow state
  const [otpRequested, setOtpRequested] = useState(false);
  const [code, setCode] = useState('');

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Initialize phone from URL params and auto-check if PIN is needed
  useEffect(() => {
    const phoneParam = searchParams.get('phone');
    if (phoneParam && !token && !phoneRest) {
      // Extract the part after 256 prefix
      const rest = phoneParam.startsWith('256') ? phoneParam.slice(3) : phoneParam;
      setPhoneRest(rest);
      // Auto-check player status
      checkPlayerAndPin(rest);
    }
  }, [searchParams]);

  useEffect(() => {
    if (token) {
      fetchProfile(token);
      // Auto-show withdraw form if URL param is set
      if (searchParams.get('withdraw') === '1') {
        setShowWithdrawForm(true);
      }
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

  const fetchProfile = async (t: string) => {
    try {
      const data = await getProfile(t);
      setProfile(data);

      // fetch stats by phone if available
      if (data && data.phone) {
        try {
          const sdata = await getPlayerStats(data.phone);
          setStats(sdata);
        } catch (e) {
          // Stats fetch is non-critical
        }
      }
    } catch (e: any) {
      console.error(e);
      setMessage(e.message || 'Failed to load profile');
    }
  };

  const signOut = () => {
    // Clear all local data and return to landing page
    setProfile(null);
    setStats(null);
    navigate('/');
  };

  const checkPlayerAndPin = async (phoneToCheckRest: string) => {
    setPlayerExists(null);
    setHasPin(false);
    setShowPinEntry(false);
    const fullPhone = '256' + phoneToCheckRest.replace(/\D/g, '');
    try {
      const status = await checkPlayerStatus(fullPhone);
      if (status.exists) {
        setPlayerExists(true);
        if (status.display_name) setMessage(`Welcome, ${status.display_name}`);
        if (status.has_pin) {
          setHasPin(true);
          setShowPinEntry(true);
        } else {
          setMessage('PIN not set for this account. Please play a game first to set up PIN.');
        }
      } else {
        setPlayerExists(false);
        setMessage('No account found for this number. Please play a game first to create an account.');
      }
    } catch (e) {
      setPlayerExists(false);
    }
  };

  // Fetch all profile data using token immediately, then discard token
  const fetchAllProfileData = async (token: string) => {
    try {
      // Fetch profile data
      const data = await getProfile(token);
      setProfile(data);
      
      // Fetch stats using public endpoint (no auth required)
      if (data && data.phone) {
        try {
          const sdata = await getPlayerStats(data.phone);
          setStats(sdata);
        } catch (e) {
          // Stats fetch is non-critical
        }
      }
      
      // Fetch withdraws with the same token
      try {
        setLoadingWithdraws(true);
        const wdata = await getWithdraws(token);
        setWithdraws(wdata.withdraws || []);
      } catch (e) {
        // Withdraws fetch failed, but profile succeeded
      } finally {
        setLoadingWithdraws(false);
      }
      
      // Token is now used and discarded - no storage
    } catch (error: any) {
      setPinError(error.message || 'Failed to load profile data');
    }
  };

  const handlePinSubmit = async (pin: string) => {
    setPinError(undefined);
    setPinLoading(true);
    const fullPhone = '256' + phoneRest.replace(/\D/g, '');
    try {
      const result = await verifyPIN(fullPhone, pin, 'view_profile');
      if (result.action_token) {
        // Use token immediately for all profile-related requests, then store for session only
        setToken(result.action_token);
        await fetchAllProfileData(result.action_token);
        // Save phone to localStorage for returning user convenience
        localStorage.setItem('playmatatu_phone', fullPhone);
        setShowPinEntry(false);
      }
    } catch (e: any) {
      if (e.lockout_until) {
        setPinLockoutUntil(e.lockout_until);
        setPinError(`Too many attempts. Try again after ${new Date(e.lockout_until).toLocaleTimeString()}`);
      } else {
        setPinError(e.message || 'Invalid PIN');
      }
    }
    setPinLoading(false);
  };

  const handleForgotPin = () => {
    setShowForgotPin(true);
    setForgotPinStep('otp');
    setOtpRequested(false);
    setCode('');
    setNewPin('');
    setOtpActionToken(null);
    setMessage(null);
  };

  const requestForgotPinOtp = async () => {
    setMessage(null);
    setLoading(true);
    const fullPhone = '256' + phoneRest.replace(/\D/g, '');
    try {
      await requestOTP(fullPhone);
      setOtpRequested(true);
      setMessage('OTP sent via SMS');
    } catch (e: any) {
      setMessage(e.message || 'Failed to request OTP');
    }
    setLoading(false);
  };

  const verifyForgotPinOtp = async () => {
    setMessage(null);
    setLoading(true);
    const fullPhone = '256' + phoneRest.replace(/\D/g, '');
    try {
      const result = await verifyOTPAction(fullPhone, code, 'reset_pin');
      if (result.action_token) {
        setOtpActionToken(result.action_token);
        setForgotPinStep('new_pin');
        setMessage(null);
      }
    } catch (e: any) {
      setMessage(e.message || 'Invalid OTP');
    }
    setLoading(false);
  };

  const handleNewPinSubmit = (pin: string) => {
    setNewPin(pin);
    setForgotPinStep('confirm_pin');
  };

  const handleConfirmPinSubmit = async (pin: string) => {
    if (pin !== newPin) {
      setPinError('PINs do not match');
      return;
    }
    setPinLoading(true);
    const fullPhone = '256' + phoneRest.replace(/\D/g, '');
    try {
      await resetPIN(fullPhone, pin, otpActionToken!);
      setShowForgotPin(false);
      setMessage('PIN reset successfully. Please enter your new PIN.');
      setPinError(undefined);
    } catch (e: any) {
      setPinError(e.message || 'Failed to reset PIN');
    }
    setPinLoading(false);
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
    if (!withdrawAmount) return;
    setConfirmLoading(true);
    try {
      // Require fresh PIN verification for withdrawal
      const pin = prompt('Enter your PIN to authorize withdrawal:');
      if (!pin) {
        setMessage('PIN required for withdrawal');
        setConfirmLoading(false);
        return;
      }
      
      const phone = localStorage.getItem('playmatatu_phone');
      if (!phone) {
        setMessage('Phone not available');
        setConfirmLoading(false);
        return;
      }
      
      // Get fresh token for withdrawal
      const result = await verifyPIN(phone, pin, 'view_profile');
      if (!result.action_token) {
        setMessage('PIN verification failed');
        setConfirmLoading(false);
        return;
      }
      
      // Use token immediately for withdrawal
      try {
        await requestWithdraw(result.action_token, Number(withdrawAmount), 'MOMO', '');
        setMessage('Withdraw requested');
        setShowConfirmModal(false);
        setWithdrawAmount('');
        // Refresh profile data requires new PIN entry
        setProfile(null);
        setShowPinEntry(true);
      } catch (err: any) {
        setMessage(err.message || 'Failed to request withdraw');
      }
    } catch (e: any) {
      setMessage(e.message || 'Network error');
    }
    setConfirmLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md mx-auto rounded-2xl p-8">
        <div className="text-center mb-6">
          <img src="/logo.webp" alt="PlayMatatu Logo" width={160} height={113} className="mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Profile</h2>
        </div>

        {showPinEntry ? (
          <div className="space-y-4">
            {/* Forgot PIN flow */}
            {showForgotPin ? (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Reset PIN</h3>
                {forgotPinStep === 'otp' && (
                  <>
                    <div className="text-sm text-gray-600">We'll send a code to verify your identity</div>
                    {!otpRequested ? (
                      <button className="w-full bg-[#373536] text-white py-2 rounded flex items-center justify-center disabled:opacity-50" onClick={requestForgotPinOtp} disabled={loading}>
                        {loading ? (<div className="animate-spin h-4 w-4 border-b-2 border-white rounded-full mr-2" />) : null}
                        Send OTP
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-sm text-gray-700 mb-2">Enter 4-digit code</label>
                          <input maxLength={4} className="w-full px-3 py-2 border rounded" value={code} onChange={(e) => setCode(e.target.value)} placeholder="1234" />
                        </div>
                        <button className="w-full bg-[#373536] text-white py-2 rounded flex items-center justify-center disabled:opacity-50" onClick={verifyForgotPinOtp} disabled={loading}>
                          {loading ? (<div className="animate-spin h-4 w-4 border-b-2 border-white rounded-full mr-2" />) : null}
                          Verify
                        </button>
                      </div>
                    )}
                  </>
                )}
                {forgotPinStep === 'new_pin' && (
                  <>
                    <div className="text-sm text-gray-600">Enter your new 4-digit PIN</div>
                    <PinInput
                      title="New PIN"
                      onSubmit={handleNewPinSubmit}
                      loading={pinLoading}
                      error={pinError}
                    />
                  </>
                )}
                {forgotPinStep === 'confirm_pin' && (
                  <>
                    <div className="text-sm text-gray-600">Confirm your new PIN</div>
                    <PinInput
                      title="Confirm PIN"
                      onSubmit={handleConfirmPinSubmit}
                      loading={pinLoading}
                      error={pinError}
                    />
                  </>
                )}
                <button className="text-sm text-gray-500 underline" onClick={() => setShowForgotPin(false)}>Cancel</button>
                {message && <div className="text-sm text-gray-600">{message}</div>}
              </div>
            ) : showPinEntry ? (
              /* PIN entry for users with PIN set */
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-lg font-semibold mb-2">Enter your PIN</div>
                  <div className="text-sm text-gray-600">Phone: +256{phoneRest}</div>
                </div>
                <PinInput
                  title=""
                  onSubmit={handlePinSubmit}
                  loading={pinLoading}
                  error={pinError}
                  lockedUntil={pinLockoutUntil || undefined}
                  onForgot={handleForgotPin}
                />
                
              </div>
            ) : (
              /* Standard phone input and OTP flow */
              <>
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Phone Number</label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700">256</span>
                    <input
                      className="w-full px-3 py-2 border rounded-r-md"
                      value={phoneRest}
                      onChange={(e) => { setPhoneRest(e.target.value); setPlayerExists(null); setHasPin(false); }}
                      onBlur={() => { if (phoneRest) checkPlayerAndPin(phoneRest); }}
                      placeholder="7XXXXXXXX"
                    />
                  </div>
                </div>

                {playerExists === false && (
                  <div className="text-sm text-yellow-600">
                    No account found for this number. Please play a game first to create an account.
                  </div>
                )}

                {playerExists && !hasPin && (
                  <div className="text-sm text-yellow-600">
                    PIN not set for this account. Please play a game first to set up PIN.
                  </div>
                )}

                {playerExists === null && phoneRest && (
                  <div className="text-sm text-gray-500">Checking account...</div>
                )}

                {message && <div className="text-sm text-gray-600">{message}</div>}
              </>
            )}
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