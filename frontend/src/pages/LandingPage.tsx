import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { validatePhone } from '../utils/phoneUtils';
import { getPlayerProfile, requeuePlayer, getConfig } from '../utils/apiClient';

export const LandingPage: React.FC = () => {
  const [phoneRest, setPhoneRest] = useState('');
  const [stake, setStake] = useState(1000);
  const [phoneError, setPhoneError] = useState('');
  const [commission, setCommission] = useState<number | null>(null);
  const [minStake, setMinStake] = useState<number>(1000);
  const [customStakeInput, setCustomStakeInput] = useState<string>('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [matchCodeInput, setMatchCodeInput] = useState('');
  const navigate = useNavigate();
  
  // const baseUrl = import.meta.env.VITE_BACKEND_URL
  const { stage, gameLink, isLoading, startGame, startPolling, reset, displayName, error, privateMatch } = useMatchmaking();

  const [displayNameInput, setDisplayNameInput] = useState<string>('');
  const [expiredQueue, setExpiredQueue] = useState<{id:number, stake_amount:number} | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  React.useEffect(() => {
    if (displayName) setDisplayNameInput(displayName);
  }, [displayName]);

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
    } catch (e) {
      setDisplayNameInput(generateRandomName());
      setExpiredQueue(null);
    }
  };

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

    // If match code is supplied, validate format
    if (matchCodeInput) {
      const code = matchCodeInput.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        setPhoneError('Invalid match code format (expect 6 chars, letters and digits)');
        return;
      }
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

    const opts: any = {};
    if (isPrivate) opts.create_private = true;
    if (matchCodeInput) opts.match_code = matchCodeInput.trim().toUpperCase();

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

  const handleShare = async () => {
    if (!privateMatch) return;
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
      await navigator.clipboard.writeText(`${text}`);
      alert('Code copied to clipboard. Share it with your friend!');
    } catch (e) {
      // as last resort, open sms: on mobile
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Stake Amount (UGX)
                </label>
                <select
                  value={stake}
                  onChange={(e) => setStake(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                  disabled={!!expiredQueue}
                >
                  <option value={1000}>1,000 UGX</option>
                  <option value={2000}>2,000 UGX</option>
                  <option value={5000}>5,000 UGX</option>
                  <option value={10000}>10,000 UGX</option>
                </select>

                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Or enter custom stake</label>
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

                <p className="mt-1 text-sm text-gray-500">
                  {commission !== null ? (<span>Commission: {commission} UGX — Total payable: {stake + commission} UGX</span>) : null}
                </p>
                {expiredQueue && (
                  <p className="mt-2 text-sm text-yellow-600">You have pending stake UGX {expiredQueue.stake_amount}. Click Requeue to retry.</p>
                )}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Match Options</label>
                <div className="flex items-center space-x-3 mb-2">
                  <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={!!matchCodeInput} id="create-private" />
                  <label htmlFor="create-private" className="text-sm">Create a private match (generate code)</label>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Or join with a code</label>
                  <input
                    type="text"
                    value={matchCodeInput}
                    onChange={(e) => setMatchCodeInput(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
                    placeholder="Enter 6-character code"
                    maxLength={6}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                    disabled={isPrivate}
                  />
                  <p className="mt-1 text-sm text-gray-500">Either create a private match or provide a friend’s code to join directly.</p>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold  transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Processing...' : (expiredQueue ? 'Requeue' : 'Play Now')}
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
            <p className="text-gray-600">Please check your phone for the Mobile Money prompt...</p>
          </div>
        );

      case 'matching':
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