import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { validatePhone, formatPhone } from '../utils/phoneUtils';
import { getPlayerProfile, requeuePlayer, getConfig,
  //  requestOTP, verifyOTPAction 
  } from '../utils/apiClient';

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
  const [showRetryPrivate, setShowRetryPrivate] = useState(false);
  const [retryInvitePhoneRest, setRetryInvitePhoneRest] = useState<string>('');
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [recentPrivate, setRecentPrivate] = useState<{match_code: string; expires_at?: string; queue_token?: string} | null>(null);
  const [playerWinnings, setPlayerWinnings] = useState<number>(0);
  // const [otpSent, setOtpSent] = useState(false);
  // const [otpCode, setOtpCode] = useState('');
  // const [actionToken, setActionToken] = useState<string | null>(null);
  // const [otpError, setOtpError] = useState<string | null>(null);
  // const [otpLoading, setOtpLoading] = useState(false);
  const navigate = useNavigate();
  
  // const baseUrl = import.meta.env.VITE_BACKEND_URL
  const { stage, gameLink, isLoading, startGame, startPolling, reset, displayName, error, privateMatch } = useMatchmaking();

  const [displayNameInput, setDisplayNameInput] = useState<string>('');
  const [expiredQueue, setExpiredQueue] = useState<{id:number, stake_amount:number, match_code?: string, is_private?: boolean} | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

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
      if (profile && profile.player_winnings !== undefined) {
        setPlayerWinnings(profile.player_winnings);
      }
    } catch (e) {
      setDisplayNameInput(generateRandomName());
      setExpiredQueue(null);
      setPlayerWinnings(0);
    }
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

    if (expiredQueue) {
      // Requeue flow
      try {
        const res = await requeuePlayer(full, expiredQueue.id);
        if (res && res.status === 'matched' && res.game_id) {
          // navigate to matched game
          navigate(`/g/${res.game_token}`);
        } else if (res && res.status === 'queued') {
          const token = res.queue_token || res.player_id;
          try { sessionStorage.setItem('queueToken', token); } catch (e) {}
          // start polling using existing requeue token
          startPolling(token, displayNameInput || generateRandomName());
        }
      } catch (err) {
        console.error('Requeue failed', err);
      }
      return;
    }

    if (matchCodeInput) opts.match_code = matchCodeInput.trim().toUpperCase();

    // Include action token if using winnings
    // if (useWinnings && actionToken) {
    //   opts.source = 'winnings';
    //   opts.action_token = actionToken;
    // }

    await startGame(full, stake, displayNameInput || generateRandomName(), opts);
  };


  // Redirect when game is found
  React.useEffect(() => {
    if (stage === 'found' && gameLink) {
      // Extract token from game link and navigate
      const tokenMatch = gameLink.match(/\/g\/([^/?]+)/);
      if (tokenMatch) {
        // navigate(`/g/${tokenMatch[1]}`);
        navigate(gameLink)
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
        return (
          <div className="max-w-md mx-auto rounded-2xl p-8">
            <div className="text-center mb-4 mb-md-5">
                     <div className="mb-3">
                        <img src="public/logo.png" alt="PlayMatatu Logo" width={200}/>
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
								disabled={!!expiredQueue}
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
				  }} disabled={!!expiredQueue} className="mr-2" />
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
					  disabled={!!expiredQueue}
				  />
				</div>

                <div className="mt-1 text-sm text-gray-500">
                  {commission !== null ? (<span>Commission: {commission} UGX — Total payable: {stake + commission} UGX</span>) : null}
                </div>
                {playerWinnings > 0 && commission !== null && (
                  <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">
                      <span className="font-medium">Available Balance: {playerWinnings.toLocaleString()} UGX</span>
                      {playerWinnings >= stake + commission ? (
                        <span className="block mt-1 text-green-700">Your balance will be used automatically - no payment needed!</span>
                      ) : (
                        <span className="block mt-1 text-yellow-700">Insufficient for this stake. Mobile Money payment will be required.</span>
                      )}
                    </p>
                  </div>
                )}
                {expiredQueue && (
                  <div className="mt-2 text-sm text-yellow-600">
                    <div>You have pending stake UGX {expiredQueue.stake_amount}.</div>
                    <div className="mt-2 flex items-center space-x-2">
                      {expiredQueue.is_private ? (
                        <>
                          <button onClick={async () => {
                            // requeue public (small action)
                            setRetryError(null);
                            try {
                              const myPhone = '256' + phoneRest.replace(/\D/g, '');
                              const res = await requeuePlayer(myPhone, expiredQueue.id);
                              if (res && res.status === 'queued') {
                                const token = res.queue_token || res.player_id;
                                try { sessionStorage.setItem('queueToken', token); } catch (e) {}
                                startPolling(token, displayNameInput || generateRandomName());
                              }
                            } catch (err:any) {
                              setRetryError(err.message || String(err));
                            }
                          }} className="px-3 py-1 bg-[#373536] text-white rounded">Requeue public</button>

                          <button onClick={() => { setShowRetryPrivate((s)=>!s); setRetryError(null); }} className="px-3 py-1 bg-yellow-500 text-black rounded">Retry private (resend invite)</button>
                        </>
                      ) : null}
                    </div>
                    {showRetryPrivate && (
                      <div className="mt-3">
                        <label className="block text-sm text-gray-700 mb-1">Invite phone to send to</label>
                        <div className="flex">
                          <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700">256</span>
                          <input type="tel" value={retryInvitePhoneRest} onChange={(e)=>setRetryInvitePhoneRest(e.target.value)} placeholder="7XX XXX XXX" className="w-full px-4 py-3 border border-gray-300 rounded-r-lg" />
                        </div>
                        <div className="mt-2 flex items-center space-x-2">
                          <button onClick={async () => {
                            // perform requeue private
                            setRetryLoading(true); setRetryError(null);
                            const myPhone = '256' + phoneRest.replace(/\D/g, '');
                            const inviteFull = retryInvitePhoneRest ? ('256' + retryInvitePhoneRest.replace(/\D/g, '')) : undefined;
                            try {
                              const res = await requeuePlayer(myPhone, expiredQueue.id, undefined, { mode: 'private', invite_phone: inviteFull });
                              if (res && res.status === 'private_created') {
                                setRecentPrivate({ match_code: res.match_code, expires_at: res.expires_at, queue_token: res.queue_token });
                                if (res.queue_token) {
                                  startPolling(res.queue_token, displayNameInput || generateRandomName());
                                }
                                setShowRetryPrivate(false);
                              } else {
                                setRetryError('Failed to recreate private match');
                              }
                            } catch (err:any) {
                              setRetryError(err.message || String(err));
                            } finally {
                              setRetryLoading(false);
                            }
                          }} disabled={retryLoading} className="px-3 py-2 bg-[#373536] text-white rounded">{retryLoading ? 'Retrying...' : 'Retry private'}</button>
                          <button onClick={() => setShowRetryPrivate(false)} className="px-3 py-2 bg-white border rounded">Cancel</button>
                        </div>
                        {retryError && <div className="mt-2 text-sm text-red-600">{retryError}</div>}
                      </div>
                    )}
                    {recentPrivate && (
                      <div className="mt-3">
                        <div className="bg-gray-100 p-3 rounded-lg inline-block">
                          <div className="font-mono text-lg">{recentPrivate.match_code}</div>
                          {recentPrivate.expires_at && <div className="text-sm text-gray-500">Expires: {new Date(recentPrivate.expires_at).toLocaleString()}</div>}
                        </div>
                        <div className="mt-2">
                          <div className="flex items-center">
                            <input readOnly value={buildInviteLink(recentPrivate.match_code, stake, retryInvitePhoneRest || undefined)} className="px-3 py-2 border rounded-l-lg w-72 bg-white text-sm" />
                            <button onClick={async () => { await navigator.clipboard.writeText(buildInviteLink(recentPrivate.match_code, stake, retryInvitePhoneRest || undefined)); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }} className="px-3 py-2 bg-gray-100 rounded-r-lg border">{copiedLink ? 'Copied' : 'Copy'}</button>
                          </div>
                          <div className="mt-2">
                            <button onClick={handleShare} className="px-4 py-2 bg-gray-100 rounded-lg border">Share</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                 )}
              </div>

              <div className="mt-4">
                
                {!expiredQueue && (
                  <>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Match Options</label>
                  <div className="flex items-center space-x-3 mb-2">
                    <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={!!matchCodeInput} id="create-private" />
                    <label htmlFor="create-private" className="text-sm">Invite a friend (generate code)</label>
                  </div>
                  </>
                )}
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

              {/* main submit button: hide when expired private (we show small actions instead) */}
              {!(expiredQueue && expiredQueue.is_private) && (
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold  transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Processing...' : (expiredQueue ? 'Requeue' : 'Play Now')}
                </button>
              )}
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
            <h2 className="text-2xl font-bold text-gray-900 mb-2">No Opponent Found</h2>
            <p className="text-gray-600 mb-4">
              {error || "We couldn't find an opponent within the time limit."}
            </p>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <p className="text-green-800 text-sm">
                Your stake amount has been added to your balance and is available to play again or withdraw.
              </p>
            </div>
            <div className="flex flex-col space-y-3">
              <button
                onClick={reset}
                className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors"
              >
                Play Again
              </button>
              <button
                onClick={() => navigate('/profile')}
                className="w-full bg-white border border-gray-300 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                View Balance / Withdraw
              </button>
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
    </div>
  );
};