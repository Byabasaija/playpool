import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { validatePhone, formatPhone } from '../utils/phoneUtils';
import { getPlayerProfile, requeuePlayer, getConfig, requestOTP, checkPlayerStatus, verifyPIN } from '../utils/apiClient';
import PinInput from '../components/PinInput';
import SetPinModal from '../components/SetPinModal';

export const LandingPage: React.FC = () => {
  const [phoneRest, setPhoneRest] = useState('');
  const [stake, setStake] = useState(1000);
  const [phoneError, setPhoneError] = useState('');
  const [commission, setCommission] = useState<number | null>(null);
  const [minStake, setMinStake] = useState<number>(1000);
  const [customStakeInput, setCustomStakeInput] = useState<string>('');
  const [useCustomStake, setUseCustomStake] = useState<boolean>(false);
  const [selectedPredefinedStake, setSelectedPredefinedStake] = useState<number>(1000);
  const [isPrivate, setIsPrivate] = useState(false);
  const [matchCodeInput, setMatchCodeInput] = useState('');
  const [invitePhoneRest, setInvitePhoneRest] = useState<string>('');
  const invitePhoneRef = React.useRef<HTMLInputElement | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const navigate = useNavigate();
  const { stage, gameLink, isLoading, startGame, startPolling, reset, displayName, error, privateMatch } = useMatchmaking();

  const [displayNameInput, setDisplayNameInput] = useState<string>('');
  const [expiredQueue, setExpiredQueue] = useState<{id:number, stake_amount:number, match_code?: string, is_private?: boolean} | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [requeueLoading, setRequeueLoading] = useState(false);
  const [requeueError, setRequeueError] = useState<string | null>(null);

  // PIN authentication state
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [playerHasPin, setPlayerHasPin] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinAttemptsRemaining, setPinAttemptsRemaining] = useState<number | undefined>();
  const [pinLockedUntil, setPinLockedUntil] = useState<string | undefined>();

  // Authenticated user state (after PIN verification)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [playerBalance, setPlayerBalance] = useState<number>(0);
  const [useWinnings, setUseWinnings] = useState<boolean>(false);
  
  // PIN setup flow state
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pendingGameData, setPendingGameData] = useState<any>(null);

  // Check localStorage for remembered phone on mount
  React.useEffect(() => {
    const savedPhone = localStorage.getItem('matatu_phone');
    if (savedPhone) {
      // Check if this player has a PIN
      checkPlayerStatus(savedPhone).then((status) => {
        if (status.exists && status.has_pin) {
          setPhoneRest(savedPhone.replace(/^256/, ''));
          setDisplayNameInput(status.display_name || '');
          setPlayerHasPin(true);
          setShowPinEntry(true);
        }
      }).catch(() => {
        // Ignore errors, just show normal form
      });
    }
  }, []);

  React.useEffect(() => {
    if (displayName) setDisplayNameInput(displayName);
  }, [displayName]);

  // If player has a pending/expired stake, hide private-invite option and clear isPrivate
  React.useEffect(() => {
    if (expiredQueue && isPrivate) {
      setIsPrivate(false);
    }
  }, [expiredQueue]);

  // Focus invite phone input when private invite toggle is enabled
  React.useEffect(() => {
    if (isPrivate && invitePhoneRef.current) {
      setTimeout(() => invitePhoneRef.current?.focus(), 50);
    }
  }, [isPrivate]);

  React.useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setCommission(cfg.commission_flat);
        setMinStake(cfg.min_stake_amount || 1000);
      } catch (e) {
        // ignore if not available
      }
    })();
  }, []);

  React.useEffect(() => {
    // Prefill from URL (join links): ?match_code=ABC123&stake=5000&invite_phone=2567...
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('match_code');
      const stakeParam = params.get('stake');
      const invitePhoneParam = params.get('invite_phone');
      if (code) {
        setMatchCodeInput(code.toUpperCase());
      }
      if (invitePhoneParam) {
        // store the rest portion (strip leading 256)
        const normalized = formatPhone(invitePhoneParam);
        if (normalized && normalized.startsWith('256')) {
          setInvitePhoneRest(normalized.slice(3));
        } else {
          setInvitePhoneRest(invitePhoneParam);
        }
        // Try to load profile for the prefilled invite phone to prefill display name
        (async () => {
          try {
            const profile = await getPlayerProfile(formatPhone(invitePhoneParam));
            if (profile && profile.display_name) {
              setDisplayNameInput(profile.display_name);
            } else {
              setDisplayNameInput(generateRandomName());
            }
            if (profile && profile.expired_queue) setExpiredQueue(profile.expired_queue);
          } catch (e) {
            setDisplayNameInput(generateRandomName());
          }
        })();
      }
      if (stakeParam) {
        const s = Number(stakeParam);
        if ([1000, 2000, 5000, 10000].includes(s)) {
          setSelectedPredefinedStake(s);
          setStake(s);
          setUseCustomStake(false);
        } else if (!Number.isNaN(s) && s > 0) {
          setUseCustomStake(true);
          setCustomStakeInput(String(s));
          setStake(s);
        }
      }
    } catch (e) {
      // ignore malformed params
    }
  }, []);

  // Handle requeue redirect (from /requeue page or SMS link)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('requeue') === '1') {
      const queueToken = sessionStorage.getItem('queueToken');
      const phone = sessionStorage.getItem('requeuePhone');
      if (queueToken) {
        // Clean up URL and session storage
        window.history.replaceState({}, '', '/');
        sessionStorage.removeItem('requeuePhone');
        // Restore phone to state for display
        if (phone) setPhoneRest(phone.replace(/^256/, ''));
        // Start polling with the queue token
        startPolling(queueToken);
      }
    }
  }, [startPolling]);

  const generateRandomName = () => {
    const adjectives = ["Lucky", "Swift", "Brave", "Jolly", "Mighty", "Quiet", "Clever", "Happy", "Kitenge", "Zesty"];
    const nouns = ["Zebu", "Rider", "Matatu", "Champion", "Sevens", "Ace", "Mamba", "Jua", "Lion", "Drift"];
    const ai = Math.floor(Math.random() * adjectives.length);
    const ni = Math.floor(Math.random() * nouns.length);
    const num = Math.floor(Math.random() * 1000);
    return `${adjectives[ai]} ${nouns[ni]} ${num}`;
  };

  const handlePhoneBlur = async () => {
    const full = '256' + phoneRest.replace(/\D/g, '');
    if (!validatePhone(full)) return;

    try {
      // Check if player has PIN
      const status = await checkPlayerStatus(full);
      if (status.exists && status.has_pin) {
        setPlayerHasPin(true);
        setShowPinEntry(true);
        if (status.display_name) setDisplayNameInput(status.display_name);
        return;
      }

      const profile = await getPlayerProfile(full);
      if (profile && profile.display_name) {
        setDisplayNameInput(profile.display_name);
      } else {
        setDisplayNameInput(generateRandomName());
      }
      if (profile && profile.expired_queue) {
        setExpiredQueue(profile.expired_queue);
      } else {
        setExpiredQueue(null);
      }
    } catch (e) {
      setDisplayNameInput(generateRandomName());
      setExpiredQueue(null);
    }
  };

  // Handle "Play Again" from expired screen - direct requeue without going back to form
  const handlePlayAgain = async () => {
    const full = '256' + phoneRest.replace(/\D/g, '');
    if (!validatePhone(full)) {
      // If phone somehow invalid, fall back to reset
      reset();
      return;
    }

    try {
      const result = await requeuePlayer(full);
      if (result.queue_token) {
        // Start polling with the new queue token
        startPolling(result.queue_token, displayNameInput || undefined);
      } else {
        // Fallback if no queue_token returned
        reset();
      }
    } catch (err) {
      console.error('Requeue failed:', err);
      // If requeue fails, fall back to form
      reset();
    }
  };

  // Handle requeue with OTP verification - sends OTP and navigates to /requeue page
  const handleRequeueWithOTP = async () => {
    const full = '256' + phoneRest.replace(/\D/g, '');
    if (!validatePhone(full)) {
      setRequeueError('Invalid phone number');
      return;
    }

    setRequeueLoading(true);
    setRequeueError(null);

    try {
      await requestOTP(full);
      // Navigate to requeue page with phone param - OTP will be verified there
      navigate(`/requeue?phone=${full}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP';
      setRequeueError(message);
      setRequeueLoading(false);
    }
  };

  // Handle PIN verification for returning users
  const handlePinVerify = useCallback(async (pin: string) => {
    const full = '256' + phoneRest.replace(/\D/g, '');
    setPinLoading(true);
    setPinError('');
    setPinAttemptsRemaining(undefined);

    try {
      // Verify PIN for profile access
      await verifyPIN(full, pin, 'view_profile');
      
      // Also get winnings token in case user wants to use winnings later
      try {
        const winningsResult = await verifyPIN(full, pin, 'stake_winnings');
        if (winningsResult.action_token) {
          sessionStorage.setItem('landing_action_token', winningsResult.action_token);
        }
      } catch (err) {
        // Non-fatal if winnings token fails - user can still view profile
        console.warn('Failed to get winnings token:', err);
      }
      
      // PIN verified successfully - save phone to localStorage
      localStorage.setItem('matatu_phone', full);
      
      // Load profile data including balance
      const profile = await getPlayerProfile(full);
      if (profile) {
        setPlayerBalance(profile.player_winnings || 0);
        if (profile.expired_queue) {
          setExpiredQueue(profile.expired_queue);
        }
      }
      
      // Mark as authenticated and hide PIN entry
      setShowPinEntry(false);
      setIsAuthenticated(true);
    } catch (err: any) {
      if (err.locked_until) {
        setPinLockedUntil(err.locked_until);
        setPinError('Account locked due to too many failed attempts');
      } else {
        setPinError(err.message || 'Incorrect PIN');
        setPinAttemptsRemaining(err.attempts_remaining);
      }
    } finally {
      setPinLoading(false);
    }
  }, [phoneRest]);

  // Handle "Forgot PIN" - switch to OTP flow
  const handleForgotPin = async () => {
    const full = '256' + phoneRest.replace(/\D/g, '');
    try {
      await requestOTP(full);
      // Navigate to profile page with reset_pin intent
      navigate(`/profile?phone=${full}&reset_pin=1`);
    } catch (err: any) {
      setPinError(err.message || 'Failed to send OTP');
    }
  };

  

  // Handle useWinnings toggle change
  const handleUseWinningsChange = (enabled: boolean) => {
    if (enabled) {
      // Check if we have the required action token
      const actionToken = sessionStorage.getItem('landing_action_token');
      if (!actionToken) {
        alert('Winnings authorization expired. Please re-enter your PIN to refresh your session.');
        setShowPinEntry(true);
        setIsAuthenticated(false);
        return;
      }
    }
    setUseWinnings(enabled);
  };

  // const handleRequestOTP = async () => {
  //   const full = '256' + phoneRest.replace(/\D/g, '');
  //   if (!validatePhone(full)) {
  //     setOtpError('Please enter a valid phone number first');
  //     return;
  //   }

  //   setOtpLoading(true);
  //   setOtpError(null);
  //   try {
  //     await requestOTP(full);
  //     setOtpSent(true);
  //   } catch (err: any) {
  //     setOtpError(err.message || 'Failed to send OTP');
  //   } finally {
  //     setOtpLoading(false);
  //   }
  // };

  // const handleVerifyOTP = async () => {
  //   const full = '256' + phoneRest.replace(/\D/g, '');

  //   if (otpCode.length !== 4) {
  //     setOtpError('Please enter the 4-digit code');
  //     return;
  //   }

  //   setOtpLoading(true);
  //   setOtpError(null);
  //   try {
  //     const result = await verifyOTPAction(full, otpCode, 'stake_winnings');
  //     setActionToken(result.action_token);
  //     setOtpError(null);
  //   } catch (err: any) {
  //     setOtpError(err.message || 'Invalid OTP code');
  //     setActionToken(null);
  //   } finally {
  //     setOtpLoading(false);
  //   }
  // };

  const handleCustomStakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, '');
    setCustomStakeInput(val);
    if (val === '') return;
    const n = Number(val);
    if (!Number.isNaN(n)) setStake(n);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Combine prefix + rest for validation
    const full = '256' + phoneRest.replace(/\D/g, '');

    if (!validatePhone(full)) {
      setPhoneError('Please enter a valid Ugandan phone number (9 digits after 256)');
      return;
    }

    if (stake < minStake) {
      setPhoneError(`Minimum stake amount is ${minStake} UGX`);
      return;
    }

    // Validate winnings flow
    // if (useWinnings && !actionToken) {
    //   setPhoneError('Please verify OTP to use winnings');
    //   return;
    // }

    // if (useWinnings && commission !== null && playerWinnings < stake + commission) {
    //   setPhoneError(`Insufficient winnings (need ${stake + commission} UGX including commission)`);
    //   return;
    // }

    // If match code is supplied, validate format
    if (matchCodeInput) {
      const code = matchCodeInput.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        setPhoneError('Invalid match code format (expect 6 chars, letters and digits)');
        return;
      }
    }

    const opts: any = {};
    // If private invite, require an invite phone and validate it
    if (isPrivate) {
      const formattedInvite = formatPhone(invitePhoneRest || '');
      if (!validatePhone(formattedInvite)) {
        setPhoneError('Invite phone is required and must be a valid Ugandan number');
        return;
      }
      opts.invite_phone = formattedInvite;
      opts.create_private = true;
    }
    setPhoneError('');

    // Check if user needs to set up PIN before starting game
    try {
      const playerStatus = await checkPlayerStatus(full);
      if (!playerStatus.has_pin) {
        // User either doesn't exist or exists but has no PIN - show PIN setup
        const gameData = { full, stake, displayNameInput, opts };
        setPendingGameData(gameData);
        setShowPinSetup(true);
        return;
      }
    } catch (err) {
      console.warn('Failed to check player status:', err);
      // Continue with game start - PIN setup will be optional
    }

    // Prepare game options

    // Use winnings if selected (requires action token)
    if (useWinnings) {
      opts.source = 'winnings';
      const actionToken = sessionStorage.getItem('landing_action_token');
      if (actionToken) {
        opts.action_token = actionToken;
        // Clean up the token after use
        sessionStorage.removeItem('landing_action_token');
      } else {
        // This shouldn't happen due to toggle validation, but handle gracefully
        throw new Error('Winnings authorization expired. Please refresh and try again.');
      }
    }

    await startGame(full, stake, displayNameInput || generateRandomName(), opts);
  };

  // Handle PIN setup completion - proceed with game start
  const handlePinSetupComplete = async () => {
    setShowPinSetup(false);
    if (pendingGameData) {
      const { full, stake, displayNameInput, opts } = pendingGameData;
      
      // Add match code if specified
      if (matchCodeInput) opts.match_code = matchCodeInput.trim().toUpperCase();

      // Use winnings if selected (requires action token)
      if (useWinnings) {
        opts.source = 'winnings';
        const actionToken = sessionStorage.getItem('landing_action_token');
        if (actionToken) {
          opts.action_token = actionToken;
          // Clean up the token after use
          sessionStorage.removeItem('landing_action_token');
        } else {
          // This shouldn't happen due to toggle validation, but handle gracefully
          throw new Error('Winnings authorization expired. Please refresh and try again.');
        }
      }

      await startGame(full, stake, displayNameInput || generateRandomName(), opts);
      setPendingGameData(null);
    }
  };


  // Redirect when game is found
  React.useEffect(() => {
    if (stage === 'found' && gameLink) {
      // Check if it's an absolute URL
      if (gameLink.startsWith('http')) {
        const url = new URL(gameLink);
        navigate(url.pathname + url.search);
      } else {
        // Extract token from relative game link and navigate
        const tokenMatch = gameLink.match(/\/g\/([^/?]+)/);
        if (tokenMatch) {
          navigate(`/g/${tokenMatch[1]}`);
        }
      }
    }
  }, [stage, gameLink, navigate]);

  React.useEffect(() => {
    let timer: any;
    if (privateMatch?.expires_at) {
      const expireTs = new Date(privateMatch.expires_at).getTime();
      const update = () => {
        const now = Date.now();
        const diff = Math.max(0, Math.floor((expireTs - now) / 1000));
        setTimeLeft(diff);
        if (diff <= 0) {
          clearInterval(timer);
        }
      };
      update();
      timer = setInterval(update, 1000);
    } else {
      setTimeLeft(null);
    }
    return () => clearInterval(timer);
  }, [privateMatch]);

  const buildInviteLink = (matchCode?: string, stakeAmount?: number, invitePhoneRestParam?: string) => {
    const base = window.location.origin + '/join';
    const params = new URLSearchParams();
    if (matchCode) params.set('match_code', matchCode);
    if (stakeAmount) params.set('stake', String(stakeAmount));
    if (invitePhoneRestParam) params.set('invite_phone', formatPhone(invitePhoneRestParam));
    return base + '?' + params.toString();
  };

  const handleShare = async () => {
    if (!privateMatch) return;
    const link = buildInviteLink(privateMatch.match_code, stake, invitePhoneRest || undefined);
    const text = `Join my PlayMatatu private match. Code: ${privateMatch.match_code}. Expires: ${privateMatch.expires_at ? new Date(privateMatch.expires_at).toLocaleString() : ''}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'PlayMatatu Invite', text });
        return;
      } catch (e) {
        // fallthrough to clipboard fallback
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      alert('Link copied to clipboard. Share it with your friend!');
    } catch (e) {
      // fallback open sms
      window.location.href = `sms:?body=${encodeURIComponent(text)}`;
    }
  };

  const handleWaitForFriend = async () => {
    if (!privateMatch?.queue_token) {
      alert('Queue token not available for polling');
      return;
    }
    // start polling using manager hook
    startPolling(privateMatch.queue_token, displayNameInput || generateRandomName());
  };

  const renderContent = () => {
    switch (stage) {
      case 'form':
        // Show PIN entry for returning users with PIN
        if (showPinEntry && playerHasPin) {
          return (
            <div className="max-w-md mx-auto rounded-2xl p-8">
              <div className="text-center mb-6">
                <div className="mb-3">
                  <img src="/logo.png" alt="PlayMatatu Logo" width={200} className="mx-auto"/>
                </div>
                <h2 className="text-xl font-bold text-[#373536] mb-1">Welcome back{displayNameInput ? `, ${displayNameInput}` : ''}!</h2>
                <p className="text-gray-600 text-sm">256{phoneRest}</p>
              </div>

              <PinInput
                title="Enter your PIN"
                subtitle="Enter your 4-digit PIN to continue"
                onSubmit={handlePinVerify}
                onForgot={handleForgotPin}
                loading={pinLoading}
                error={pinError}
                attemptsRemaining={pinAttemptsRemaining}
                lockedUntil={pinLockedUntil}
              />
            </div>
          );
        }

        // Authenticated dashboard (after PIN verification)
        if (isAuthenticated) {
          // If has pending stake, show requeue UI
          if (expiredQueue) {
            return (
              <div className="max-w-md mx-auto rounded-2xl p-8">
                <div className="text-center mb-4">
                  <img src="/logo.png" alt="PlayMatatu Logo" width={200} className="mx-auto"/>
                </div>
                
                <div className="text-center mb-4">
                  <p className="text-sm text-gray-600">{displayNameInput || 'Player'} • 256{phoneRest}</p>
                  <p className="text-2xl font-bold text-[#373536]">{playerBalance.toLocaleString()} UGX</p>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-yellow-800">
                    Pending stake: <span className="font-bold">{expiredQueue.stake_amount.toLocaleString()} UGX</span>
                    {expiredQueue.is_private && expiredQueue.match_code && (
                      <span className="block text-xs mt-1">Code: {expiredQueue.match_code}</span>
                    )}
                  </p>
                </div>

                {requeueError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                    {requeueError}
                  </div>
                )}

                <button
                  onClick={handlePlayAgain}
                  disabled={isLoading}
                  className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors disabled:opacity-50 mb-3"
                >
                  {isLoading ? 'Rejoining...' : 'Rejoin Queue'}
                </button>

                <div className="flex gap-2">
                  <button
                    onClick={() => navigate(`/profile?phone=256${phoneRest}`)}
                    className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                  >
                    Profile
                  </button>
                  <button
                    onClick={() => navigate(`/profile?phone=256${phoneRest}&withdraw=1`)}
                    className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            );
          }

          // No pending stake - show play form
          return (
            <div className="max-w-md mx-auto rounded-2xl p-8">
              <div className="text-center mb-4">
                <img src="/logo.png" alt="PlayMatatu Logo" width={200} className="mx-auto"/>
              </div>
              
              <div className="text-center mb-6">
                <p className="text-sm text-gray-600">{displayNameInput || 'Player'} • 256{phoneRest}</p>
                <p className="text-2xl font-bold text-[#373536]">{playerBalance.toLocaleString()} UGX</p>
                
                {/* Use Winnings Toggle */}
                {playerBalance > 0 && (
                  <div className="mt-3">
                    <label className="flex items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useWinnings}
                        onChange={(e) => handleUseWinningsChange(e.target.checked)}
                        className="mr-2 h-4 w-4 accent-[#373536]"
                      />
                      <span className="text-sm text-gray-700">
                        Use Balance ({playerBalance.toLocaleString()} UGX)
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Stake Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Stake Amount</label>
                <div className="grid grid-cols-2 gap-2">
                  {[1000, 2000, 5000, 10000].map((opt) => (
                    <label key={opt} className={`flex items-center space-x-2 px-3 py-2 border rounded-lg cursor-pointer ${selectedPredefinedStake === opt && !useCustomStake ? 'border-[#373536] bg-gray-50' : 'border-gray-300 bg-white'}`}>
                      <input
                        type="radio"
                        name="auth-stake"
                        value={opt}
                        checked={selectedPredefinedStake === opt && !useCustomStake}
                        onChange={() => { setSelectedPredefinedStake(opt); setStake(opt); setUseCustomStake(false); setCustomStakeInput(''); }}
                        className="accent-[#373536]"
                      />
                      <span>{opt.toLocaleString()} UGX</span>
                    </label>
                  ))}
                </div>

                <div className="mt-3 flex items-center">
                  <input id="auth-stake-other" type="checkbox" checked={useCustomStake} onChange={(e) => {
                    const checked = e.target.checked;
                    setUseCustomStake(checked);
                    if (checked) {
                      setCustomStakeInput(String(selectedPredefinedStake));
                      setStake(Number(selectedPredefinedStake));
                    } else {
                      setStake(selectedPredefinedStake);
                    }
                  }} className="mr-2" />
                  <label htmlFor="auth-stake-other" className="text-sm">Custom amount</label>
                </div>

                {useCustomStake && (
                  <div className="mt-3">
                    <input
                      type="number"
                      min={minStake}
                      value={customStakeInput}
                      onChange={handleCustomStakeChange}
                      placeholder={`${minStake} or more`}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                    />
                  </div>
                )}

                {commission !== null && (
                  <p className="mt-1 text-sm text-gray-500">
                   Entry fee: {commission} UGX — Total: {stake + commission} UGX
                  </p>
                )}
              </div>

              {/* Private Match Option */}
              <div className="mb-4">
                <div className="flex items-center space-x-2 mb-2">
                  <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} id="auth-create-private" />
                  <label htmlFor="auth-create-private" className="text-sm">Invite a friend</label>
                </div>
                {isPrivate && (
                  <div className="mt-2">
                    <div className="flex">
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700 text-sm">256</span>
                      <input
                        type="tel"
                        value={invitePhoneRest}
                        onChange={(e) => setInvitePhoneRest(e.target.value)}
                        placeholder="7XX XXX XXX"
                        className="w-full px-3 py-2 border border-gray-300 rounded-r-lg text-sm"
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">We'll send them the invite code via SMS.</p>
                  </div>
                )}
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={() => {
                  // Ensure sufficient balance when using winnings
                  if (useWinnings && playerBalance < stake + (commission || 0)) {
                    alert('Insufficient balance. Please check and try again.');
                    return;
                  }

                  const full = '256' + phoneRest.replace(/\D/g, '');
                  const inviteFull = isPrivate && invitePhoneRest ? '256' + invitePhoneRest.replace(/\D/g, '') : undefined;
                  
                  const opts: { create_private?: boolean; invite_phone?: string; source?: string; action_token?: string } = {
                    create_private: isPrivate,
                    invite_phone: inviteFull
                  };

                  // Add winnings source if using balance
                  if (useWinnings) {
                    opts.source = 'winnings';
                    const actionToken = sessionStorage.getItem('landing_action_token');
                    if (actionToken) {
                      opts.action_token = actionToken;
                      // Clean up the token after use
                      sessionStorage.removeItem('landing_action_token');
                    }
                  }

                  startGame(full, stake, displayNameInput || undefined, opts);
                }}
                disabled={isLoading}
                className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors disabled:opacity-50 mb-3"
              >
                {isLoading ? 'Processing...' : 'Play Now'}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/profile?phone=256${phoneRest}`)}
                  className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  Profile
                </button>
                <button
                  onClick={() => navigate(`/profile?phone=256${phoneRest}&withdraw=1`)}
                  className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  Withdraw
                </button>
              </div>
            </div>
          );
        }

        // If user has an expired queue, show dedicated pending stake UI (no form)
        if (expiredQueue) {
          return (
            <div className="max-w-md mx-auto rounded-2xl p-8">
              <div className="text-center mb-4 mb-md-5">
                <div className="mb-3">
                  <img src="/logo.png" alt="PlayMatatu Logo" width={200}/>
                </div>
              </div>

              <div className="text-center">
                <div className="mb-6">
                  <div className="h-16 w-16 bg-yellow-100 rounded-full mx-auto flex items-center justify-center">
                    <span className="text-yellow-600 text-3xl">💰</span>
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-gray-900 mb-2">Pending Stake Found</h2>
                <p className="text-gray-600 mb-2">
                  Phone: <span className="font-semibold">256{phoneRest}</span>
                </p>
                <p className="text-gray-600 mb-4">
                  You have a pending stake of <span className="font-bold text-lg">{expiredQueue.stake_amount.toLocaleString()} UGX</span>
                </p>

                {expiredQueue.is_private && expiredQueue.match_code && (
                  <p className="text-sm text-gray-500 mb-4">
                    Private match code: <span className="font-mono">{expiredQueue.match_code}</span>
                  </p>
                )}

                <p className="text-sm text-gray-500 mb-6">
                  Click the button below to rejoin the queue. We'll send a verification code to your phone.
                </p>

                {requeueError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                    {requeueError}
                  </div>
                )}

                <div className="flex flex-col space-y-3">
                  <button
                    onClick={handleRequeueWithOTP}
                    disabled={requeueLoading}
                    className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors disabled:opacity-50"
                  >
                    {requeueLoading ? 'Sending verification...' : 'Requeue'}
                  </button>
                
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className="max-w-md mx-auto rounded-2xl p-8">
            <div className="text-center mb-4 mb-md-5">
                     <div className="mb-3">
                        <img src="/logo.png" alt="PlayMatatu Logo" width={200}/>
                    </div>

                </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700">256</span>
                  <input
                    name="phone"
                    type="tel"
                    value={phoneRest}
                    onChange={(e) => setPhoneRest(e.target.value)}
                    onBlur={handlePhoneBlur}
                    placeholder="7XX XXX XXX"
                    className="w-full px-4 py-3 border border-gray-300 rounded-r-lg"
                    required
                  />
                </div>
                {phoneError && (
                  <p className="mt-1 text-sm text-red-600">{phoneError}</p>
                )}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Display Name</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={displayNameInput}
                    onChange={(e) => setDisplayNameInput(e.target.value)}
                    maxLength={50}
                    placeholder="Your display name"
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setDisplayNameInput(generateRandomName())}
                    className="px-3 py-2 bg-gray-100 rounded-lg border"
                  >
                    Randomize
                  </button>
                </div>
                <p className="mt-1 text-sm text-gray-500">You can change this name later in your profile.</p>
              </div>

              {/* COMMENTED OUT - MVP launch without winnings staking
              Display player winnings if available
              {playerWinnings > 0 && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-sm text-green-800">
                    💰 Available Winnings: <strong>{playerWinnings.toLocaleString()} UGX</strong>
                  </p>
                </div>
              )}

              Use Winnings Toggle & OTP Flow
              {playerWinnings > 0 && !expiredQueue && (
                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useWinnings}
                      onChange={(e) => {
                        setUseWinnings(e.target.checked);
                        if (!e.target.checked) {
                          setOtpSent(false);
                          setOtpCode('');
                          setActionToken(null);
                          setOtpError(null);
                        }
                      }}
                      className="mr-3 h-5 w-5"
                    />
                    <span className="text-blue-900 font-medium">
                      Use Winnings
                    </span>
                  </label>

                  {useWinnings && (
                    <div className="mt-4 space-y-3">
                      {!otpSent && (
                        <button
                          type="button"
                          onClick={handleRequestOTP}
                          disabled={otpLoading}
                          className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                        >
                          {otpLoading ? 'Sending...' : 'Send OTP Code'}
                        </button>
                      )}

                      {otpSent && !actionToken && (
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Enter 4-digit code:
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={otpCode}
                              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                              placeholder="1234"
                              maxLength={4}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded text-center text-lg tracking-widest"
                            />
                            <button
                              type="button"
                              onClick={handleVerifyOTP}
                              disabled={otpLoading || otpCode.length !== 4}
                              className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                            >
                              {otpLoading ? 'Verifying...' : 'Verify'}
                            </button>
                          </div>
                        </div>
                      )}

                      {actionToken && (
                        <div className="p-2 bg-green-100 border border-green-300 rounded text-green-800 text-sm">
                          ✓ OTP Verified! You can now stake using your winnings.
                        </div>
                      )}

                      {otpError && (
                        <div className="p-2 bg-red-100 border border-red-300 rounded text-red-800 text-sm">
                          {otpError}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              */}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Stake Amount (UGX)
                </label>
				<div className="grid grid-cols-2 gap-2">
				  {[1000, 2000, 5000, 10000].map((opt) => (
						<label key={opt} className={`flex items-center space-x-2 px-3 py-2 border rounded-lg cursor-pointer ${selectedPredefinedStake === opt && !useCustomStake ? 'border-[#373536] bg-gray-50' : 'border-gray-300 bg-white'}`}>
						  <input
								type="radio"
								name="stake"
								value={opt}
								checked={selectedPredefinedStake === opt && !useCustomStake}
								onChange={() => { setSelectedPredefinedStake(opt); setStake(opt); setUseCustomStake(false); setCustomStakeInput(''); }}
								className="accent-[#373536]"
							  />
							  <span>{opt.toLocaleString()} UGX</span>
						</label>
				  ))}
				</div>

				<div className="mt-3 flex items-center">
				  <input id="stake-other" type="checkbox" checked={useCustomStake} onChange={(e) => {
					const checked = e.target.checked;
					setUseCustomStake(checked);
					if (checked) {
						setCustomStakeInput(String(selectedPredefinedStake));
						setStake(Number(selectedPredefinedStake));
					} else {
						setStake(selectedPredefinedStake);
					}
				  }} className="mr-2" />
				  <label htmlFor="stake-other" className="text-sm">Stake other?</label>
				</div>

				<div style={{ display: useCustomStake ? 'block' : 'none' }} className="mt-3">
				  <label className="block text-sm font-medium text-gray-700 mb-2">Enter custom stake</label>
				  <input
					  type="number"
					  min={minStake}
					  value={customStakeInput}
					  onChange={handleCustomStakeChange}
					  placeholder={`1000 or more`}
					  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
				  />
				</div>

                <div className="mt-1 text-sm text-gray-500">
                  {commission !== null ? (<span>Commission: {commission} UGX — Total payable: {stake + commission} UGX</span>) : null}
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Match Options</label>
                <div className="flex items-center space-x-3 mb-2">
                  <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={!!matchCodeInput} id="create-private" />
                  <label htmlFor="create-private" className="text-sm">Invite a friend (generate code)</label>
                </div>
                <div style={{ display: isPrivate ? 'block' : 'none' }} className="mt-3">
                  <label className="block text-sm text-gray-700 mb-1">Invite phone (required)</label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700">256</span>
                    <input
                      type="tel"
                      value={invitePhoneRest}
                      onChange={(e) => setInvitePhoneRest(e.target.value)}
                      ref={invitePhoneRef}
                      placeholder="7XX XXX XXX"
                      className="w-full px-4 py-3 border border-gray-300 rounded-r-lg"
                    />
                  </div>
                   <p className="mt-1 text-sm text-gray-500">We will send the code to this number via SMS and also show the link to you so you can copy it if SMS fails.</p>
                 </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold  transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Processing...' : 'Play Now'}
              </button>
            </form>
          </div>
        );

      case 'payment':
        return (
          <div className="max-w-md mx-auto  rounded-2xl p-8 text-center">
            <div className="mb-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#373536] mx-auto"></div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing Payment</h2>
            <p className="text-gray-600">Initiating Mobile Money payment...</p>
          </div>
        );

      case 'payment_pending':
        return (
          <div className="max-w-md mx-auto rounded-2xl p-8 text-center">
            <div className="mb-6">
              <div className="animate-pulse">
                <div className="h-16 w-16 bg-yellow-100 rounded-full mx-auto flex items-center justify-center">
                  <span className="text-yellow-600 text-3xl">📱</span>
                </div>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Complete Payment on Your Phone</h2>
            <p className="text-gray-600 mb-4">Check your phone for the Mobile Money payment prompt.</p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
              <p className="text-sm text-blue-900">
                <strong>What to do:</strong>
              </p>
              <ol className="list-decimal list-inside text-sm text-blue-800 mt-2 space-y-1">
                <li>Check for an MTN or Airtel Money prompt on your phone</li>
                <li>Enter your Mobile Money PIN to approve the payment</li>
                <li>Wait for confirmation</li>
              </ol>
            </div>
            <div className="mt-6">
              <div className="inline-flex items-center space-x-2 text-gray-600">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                <span className="text-sm">Waiting for payment confirmation... Changed your mind? <button onClick={() => reset()} className="text-blue-600 underline">Cancel</button></span>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500">This may take some time. Do not close this page.</p>
          </div>
        );

      case 'matching':
        // If we're waiting for a private match, show the code and sharing affordance while polling
        if (privateMatch) {
          return (
            <div className="max-w-md mx-auto p-8 text-center">
              <div className="mb-6">
                <div className="h-12 w-12 bg-[#373536] rounded-full mx-auto flex items-center justify-center animate-pulse">
                  <span className="text-white text-xl">🔒</span>
                </div>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Waiting for Friend</h2>
              <p className="text-gray-600 mb-4">We've sent the invite — waiting for your friend to join.</p>
              <div className="bg-gray-100 p-4 rounded-lg inline-block">
                <div className="text-2xl font-mono">{privateMatch.match_code}</div>
                {privateMatch.expires_at && (
                  <div className="text-sm text-gray-500">Expires: {new Date(privateMatch.expires_at).toLocaleString()}</div>
                )}
              </div>
              <div className="mt-4 flex flex-col items-center space-y-3">
                <div className="flex items-center space-x-2">
                  <input readOnly value={buildInviteLink(privateMatch.match_code, stake, invitePhoneRest || undefined)} className="px-3 py-2 border rounded-l-lg w-72 bg-white text-sm" />
                  <button onClick={async () => { await navigator.clipboard.writeText(buildInviteLink(privateMatch.match_code, stake, invitePhoneRest || undefined)); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }} className="px-3 py-2 bg-gray-100 rounded-r-lg border">{copiedLink ? 'Copied' : 'Copy'}</button>
                </div>
                <div className="flex space-x-3">
                  <button onClick={handleShare} className="px-4 py-2 bg-gray-100 rounded-lg border">Share</button>
                  <button onClick={() => { reset(); }} className="px-4 py-2 bg-white rounded-lg border">Cancel</button>
                </div>
              </div>
            </div>
          );
        }

        // Default public matching UI
        return (
          <div className="max-w-md mx-auto p-8 text-center">
            <div className="mb-6">
              <div className="animate-pulse">
                <div className="h-12 w-12 bg-[#373536] rounded-full mx-auto flex items-center justify-center">
                  <span className="text-white text-xl">🎯</span>
                </div>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Finding Opponent</h2>
            <p className="text-gray-600">Matching you with another player...</p>
            {displayName && (
              <p className="mt-4 text-sm text-gray-700">You are playing as <span className="font-semibold">{displayName}</span></p>
            )}
            <div className="mt-4">
              <div className="animate-pulse bg-gray-200 h-2 rounded-full">
                <div className="bg-[#373536] h-2 rounded-full animate-pulse" style={{width: '60%'}}></div>
              </div>
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="max-w-md mx-auto p-8 text-center">
            <div className="mb-6">
              <div className="h-12 w-12 bg-red-100 rounded-full mx-auto flex items-center justify-center">
                <span className="text-red-600 text-xl">❌</span>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Error</h2>
            <p className="text-red-600 mb-4">{error || 'Something went wrong. Please try again.'}</p>
            <button
              onClick={reset}
              className="bg-[#373536] text-white py-2 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors"
            >
              Try Again
            </button>
          </div>
        );

      case 'private_created':
        return (
          <div className="max-w-md mx-auto rounded-2xl p-8 text-center">
            <div className="mb-6">
              <div className="h-12 w-12 bg-[#373536] rounded-full mx-auto flex items-center justify-center">
                <span className="text-white text-xl">🔒</span>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Private Match Created</h2>
            <p className="text-gray-600 mb-4">Share this code with your friend to join the match:</p>
            <div className="bg-gray-100 p-4 rounded-lg inline-block">
              <div className="text-2xl font-mono" id="private-code">{privateMatch?.match_code}</div>
              {privateMatch?.expires_at && (
                <div className="text-sm text-gray-500">Expires: {new Date(privateMatch.expires_at).toLocaleString()}</div>
              )}
              {timeLeft !== null && timeLeft > 0 && (
                <div className="text-sm text-gray-600 mt-2">Time remaining: {Math.floor(timeLeft/60)}:{String(timeLeft%60).padStart(2,'0')}</div>
              )}
            </div>
            <div className="mt-6">
              <button onClick={handleShare} className="px-4 py-2 bg-[#22c55e] text-white rounded-lg mr-3">Share</button>
              <button onClick={() => { navigator.clipboard?.writeText(privateMatch?.match_code || ''); }} className="px-4 py-2 bg-[#373536] text-white rounded-lg mr-3">Copy Code</button>
              <button onClick={handleWaitForFriend} disabled={!privateMatch?.queue_token} className="px-4 py-2 bg-[#0ea5e9] text-white rounded-lg mr-3">Wait for Friend</button>
              <button onClick={() => { reset(); }} className="px-4 py-2 border rounded-lg">Done</button>
            </div>
          </div>
        );

      case 'expired':
        return (
          <div className="max-w-md mx-auto rounded-2xl p-8 text-center">
            <div className="mb-6">
              <div className="h-16 w-16 bg-yellow-100 rounded-full mx-auto flex items-center justify-center">
                <span className="text-yellow-600 text-3xl">⏰</span>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Session Timed Out</h2>
            <p className="text-gray-600 mb-4">
              No opponent found for now. Your stake is still available.
            </p>
            <p className="text-gray-500 text-sm mb-6">
              We've sent you an SMS with a link to rejoin the queue anytime.
            </p>
            <div className="flex flex-col space-y-3">
              <button
                onClick={handlePlayAgain}
                className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors"
              >
                Requeue Now
              </button>
              {/* <button
                onClick={() => navigate('/profile')}
                className="w-full bg-white border border-gray-300 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                View Balance / Withdraw
              </button> */}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {renderContent()}
      
      {/* PIN Setup Modal */}
      {showPinSetup && pendingGameData && (
        <SetPinModal
          phone={pendingGameData.full}
          onComplete={handlePinSetupComplete}
          onCancel={() => {
            setShowPinSetup(false);
            setPendingGameData(null);
          }}
        />
      )}
    </div>
  );
};