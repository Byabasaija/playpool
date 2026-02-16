import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { getConfig, checkPlayerStatus, verifyPIN, requestOTP, verifyOTPAction, resetPIN, getProfile, getPlayerStats, getWithdraws, requestWithdraw, checkSession, playerLogout } from '../utils/apiClient';
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
  const [amountError, setAmountError] = useState<string | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const withdrawInputRef = useRef<HTMLInputElement | null>(null);

  // PIN-related state
  const [hasPin, setHasPin] = useState<boolean>(false);
  const [showPinEntry, setShowPinEntry] = useState<boolean>(false); // Start false, set true after auth check
  const [pinError, setPinError] = useState<string | undefined>(undefined);
  const [pinLoading, setPinLoading] = useState<boolean>(false);
  const [pinLockoutUntil, setPinLockoutUntil] = useState<string | null>(null);
  const [showForgotPin, setShowForgotPin] = useState<boolean>(false);
  const [forgotPinStep, setForgotPinStep] = useState<'otp' | 'new_pin' | 'confirm_pin'>('otp');
  const [newPin, setNewPin] = useState<string>('');

  // Authentication checking state (prevents flicker)
  const [authChecking, setAuthChecking] = useState(true);
  
  // Session-only token (not persisted)
  const [token, setToken] = useState<string | null>(null);
  const [loadingWithdraws, setLoadingWithdraws] = useState(false);
  const [otpActionToken, setOtpActionToken] = useState<string | null>(null);
  // Forgot PIN OTP flow state
  const [otpRequested, setOtpRequested] = useState(false);
  const [code, setCode] = useState('');
  // Withdrawal PIN modal
  const [showWithdrawPinModal, setShowWithdrawPinModal] = useState(false);
  const [withdrawPinError, setWithdrawPinError] = useState<string | undefined>();
  const [withdrawPinLoading, setWithdrawPinLoading] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Initialize: try session cookie first, then fall back to PIN entry
  useEffect(() => {
    const phoneParam = searchParams.get('phone');

    checkSession().then(async (session) => {
      if (session) {
        // Valid session — skip PIN, load profile directly via cookie
        const rest = session.phone.replace(/^256/, '');
        setPhoneRest(rest);
        setShowPinEntry(false);
        localStorage.setItem('matatu_phone', session.phone);
        await fetchAllProfileData();
        if (searchParams.get('withdraw') === '1') {
          setShowWithdrawForm(true);
        }
        setAuthChecking(false);
        return;
      }

      // No session — fall back to phone/PIN check
      if (phoneParam && !token && !phoneRest) {
        const rest = phoneParam.startsWith('256') ? phoneParam.slice(3) : phoneParam;
        setPhoneRest(rest);
        checkPlayerAndPin(rest);
      } else {
        setAuthChecking(false);
      }
    }).catch(() => {
      setAuthChecking(false);
    });
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
    playerLogout();
    localStorage.removeItem('matatu_phone');
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
          setMessage('No PIN set. Please set a PIN from the home page to access your profile.');
        }
      } else {
        setPlayerExists(false);
        setMessage('No account found for this number. Please play a game first to create an account.');
      }
    } catch (e) {
      setPlayerExists(false);
    } finally {
      setAuthChecking(false);
    }
  };

  // Fetch all profile data — uses token if provided, otherwise cookie auth
  const fetchAllProfileData = async (t?: string) => {
    try {
      const data = await getProfile(t);
      setProfile(data);

      if (data && data.phone) {
        try {
          const sdata = await getPlayerStats(data.phone);
          setStats(sdata);
        } catch (e) {
          // Stats fetch is non-critical
        }
      }

      try {
        setLoadingWithdraws(true);
        const wdata = await getWithdraws(t);
        setWithdraws(wdata.withdraws || []);
      } catch (e) {
        // Withdraws fetch failed, but profile succeeded
      } finally {
        setLoadingWithdraws(false);
      }
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

  const minWithdraw = config?.min_withdraw_amount ?? 0;
  const availableWinnings = profile?.player_winnings ?? profile?.total_winnings ?? 0;

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
    // Show PIN modal for fresh verification
    setShowConfirmModal(false);
    setShowWithdrawPinModal(true);
    setWithdrawPinError(undefined);
  };

  const handleWithdrawPinSubmit = async (pin: string) => {
    setWithdrawPinLoading(true);
    setWithdrawPinError(undefined);
    const fullPhone = '256' + phoneRest.replace(/\D/g, '');
    try {
      // Fresh PIN verify — also refreshes cookie
      const result = await verifyPIN(fullPhone, pin, 'view_profile');

      // Use cookie or token for withdrawal
      try {
        await requestWithdraw(result.action_token, Number(withdrawAmount), 'MOMO', '');
        setMessage('Withdraw requested');
        setShowWithdrawPinModal(false);
        setWithdrawAmount('');
        // Refresh profile data using cookie
        await fetchAllProfileData();
      } catch (err: any) {
        setWithdrawPinError(err.message || 'Failed to request withdraw');
      }
    } catch (e: any) {
      if (e.locked_until) {
        setWithdrawPinError('Account locked. Try again later.');
      } else {
        setWithdrawPinError(e.message || 'Incorrect PIN');
      }
    }
    setWithdrawPinLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md mx-auto rounded-2xl p-8">
        {/* Show loading while checking authentication */}
        {authChecking ? (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D4A574] mx-auto mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <Link to="/">
                <img src="/logo.webp" alt="PlayMatatu Logo" width={160} height={113} className="mx-auto mb-4" />
              </Link>
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
                    No PIN set. <button className="underline text-blue-600" onClick={() => navigate('/')}>Go to home page</button> to set up your PIN.
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

              {showWithdrawForm && (
                <div className="mt-3">
                  <div className="text-sm">Available to withdraw: <span className="font-bold">{availableWinnings} UGX</span></div>
                  <div className="text-sm mt-2">Amount (UGX)</div>
                  <label htmlFor="withdraw-amount" className="sr-only">Amount in UGX</label>
                  <input ref={withdrawInputRef} id="withdraw-amount" type="number" className="w-full px-3 py-2 border rounded" value={withdrawAmount as any} onChange={(e) => setWithdrawAmount(e.target.value === '' ? '' : Number(e.target.value))} aria-describedby="withdraw-help" />

                  <div id="withdraw-help" className="text-xs text-gray-500 mt-2">
                    {minWithdraw ? `Min ${minWithdraw} UGX` : null}
                  </div>


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
              </div>
              <div className="mt-6 flex gap-3">
                <button ref={confirmBtnRef} className="flex-1 bg-[#373536] text-white py-2 rounded" onClick={confirmWithdraw}>Confirm</button>
                <button className="flex-1 bg-white border py-2 rounded" onClick={() => setShowConfirmModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Withdrawal PIN verification modal */}
        {showWithdrawPinModal && (
          <div className="fixed inset-0 flex items-center justify-center z-50" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black opacity-40" onClick={() => setShowWithdrawPinModal(false)} aria-hidden="true"></div>
            <div className="bg-white rounded-lg p-6 z-10 max-w-sm w-full mx-4">
              <h2 className="text-lg font-semibold text-center mb-1">Authorize Withdrawal</h2>
              <p className="text-sm text-gray-600 text-center mb-4">{withdrawAmount} UGX</p>
              <PinInput
                title="Enter PIN"
                subtitle="Enter your PIN to confirm withdrawal"
                onSubmit={handleWithdrawPinSubmit}
                loading={withdrawPinLoading}
                error={withdrawPinError}
              />
              <button
                className="w-full mt-3 text-sm text-gray-500 underline"
                onClick={() => { setShowWithdrawPinModal(false); setWithdrawPinError(undefined); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
};