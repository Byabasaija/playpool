import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { validatePhone, formatPhone } from '../utils/phoneUtils';
import { getPlayerProfile, getConfig, checkPlayerStatus, verifyPIN, checkSession } from '../utils/apiClient';
import PinInput from '../components/PinInput';

function generateRandomName() {
  const adj = ['Swift', 'Wise', 'Bold', 'Brave', 'Cool', 'Quick', 'Smart', 'Epic', 'Prime', 'Pro'];
  const noun = ['Lion', 'Eagle', 'Shark', 'Tiger', 'Wolf', 'Hawk', 'Dragon', 'Ninja', 'King', 'Ace'];
  return `${adj[Math.floor(Math.random() * adj.length)]}${noun[Math.floor(Math.random() * noun.length)]}`;
}

export const RematchPage: React.FC = () => {
  const navigate = useNavigate();
  const { stage, gameLink, isLoading, startGame, displayName, error, reset, privateMatch } = useMatchmaking();

  // Get opponent phone and stake from URL
  const params = new URLSearchParams(window.location.search);
  const opponentPhone = params.get('opponent') || '';
  const stakeParam = params.get('stake');
  const initialStake = stakeParam ? Number(stakeParam) : 1000;

  // Authenticated state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [playerPhone, setPlayerPhone] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState<string>('');
  const [commission, setCommission] = useState<number | null>(null);
  const [playerWinnings, setPlayerWinnings] = useState<number>(0);
  const [useWinnings, setUseWinnings] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // PIN state
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | undefined>(undefined);
  const [pinLockoutUntil, setPinLockoutUntil] = useState<string | undefined>(undefined);

  // Helper function to build invite link (similar to LandingPage)
  const buildInviteLink = (matchCode: string, stake: number, invitePhone?: string) => {
    const base = window.location.origin + '/join';
    const params = new URLSearchParams();
    params.set('match_code', matchCode);
    params.set('stake', stake.toString());
    if (invitePhone) params.set('invite_phone', formatPhone(invitePhone));
    return base + '?' + params.toString();
  };

  // Share functionality
  const handleShare = async () => {
    if (!privateMatch) return;
    const link = buildInviteLink(privateMatch.match_code, initialStake, opponentPhone);
    const text = `Join my PlayMatatu rematch. Code: ${privateMatch.match_code}. Stake: ${initialStake} UGX`;
    
    if (navigator.share) {
      try {
        await navigator.share({ title: 'PlayMatatu Rematch', text, url: link });
      } catch (e) {
        await navigator.clipboard.writeText(link);
      }
    } else {
      await navigator.clipboard.writeText(link);
    }
  };

  // Load config
  React.useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setCommission(cfg.commission_flat);
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  React.useEffect(() => {
    if (displayName) setDisplayNameInput(displayName);
  }, [displayName]);

  // Redirect when game is found
  React.useEffect(() => {
    if (stage === 'found' && gameLink) {
      // Check if it's an absolute URL
      if (gameLink.startsWith('http')) {
        const url = new URL(gameLink);
        navigate(url.pathname + url.search);
      } else {
        const token = gameLink.split('/g/')[1]?.split('?')[0];
        if (token) navigate(`/g/${token}${gameLink.includes('?') ? gameLink.substring(gameLink.indexOf('?')) : ''}`);
      }
    }
  }, [stage, gameLink, navigate]);

  // Try session cookie first, then fall back to PIN entry
  React.useEffect(() => {
    const storedPhone = localStorage.getItem('playmatatu_phone') || localStorage.getItem('matatu_phone');
    if (!storedPhone || isAuthenticated || playerPhone) return;

    setPlayerPhone(storedPhone);

    // Try existing session cookie first
    checkSession().then(async (session) => {
      if (session && session.phone === storedPhone) {
        // Valid session — skip PIN
        await loadPlayerProfile(storedPhone);
        setIsAuthenticated(true);
        return;
      }
      // No session — prompt for PIN
      checkPlayerStatusAndPromptPin(storedPhone);
    });
  }, []);

  const checkPlayerStatusAndPromptPin = async (phone: string) => {
    try {
      const status = await checkPlayerStatus(phone);
      if (status.exists && status.has_pin) {
        // Player exists with PIN - show PIN entry (handled by UI state)
        return;
      } else if (status.exists && !status.has_pin) {
        setPinError('PIN not set for this account. Please set a PIN first.');
        return;
      } else {
        setPinError('Account not found. Please play a game first.');
        return;
      }
    } catch (e) {
      setPinError('Unable to verify account. Please check your connection.');
    }
  };

  const handleVerifyPIN = async (pin: string) => {
    setPinLoading(true);
    setPinError(undefined);
    try {
      // Single verifyPIN call — cookie is set automatically by the backend
      await verifyPIN(playerPhone, pin, 'rematch');

      // Load player profile after PIN verification
      await loadPlayerProfile(playerPhone);
      setIsAuthenticated(true);
    } catch (err: any) {
      if (err.lockout_until) {
        setPinLockoutUntil(err.lockout_until);
        setPinError(`Too many attempts. Try again after ${new Date(err.lockout_until).toLocaleTimeString()}`);
      } else {
        setPinError(err.message || 'Invalid PIN');
      }
    } finally {
      setPinLoading(false);
    }
  };

  const loadPlayerProfile = async (phone: string) => {
    try {
      const profile = await getPlayerProfile(phone);
      if (profile) {
        if (profile.player_winnings !== undefined) {
          setPlayerWinnings(profile.player_winnings);
        }
        if (profile.display_name) {
          setDisplayNameInput(profile.display_name);
        } else {
          setDisplayNameInput(generateRandomName());
        }
      }
    } catch (e) {
      setDisplayNameInput(generateRandomName());
    }
  };
  const handleSubmit = async () => {
    // Validate opponent phone
    const formattedOpponent = formatPhone(opponentPhone);
    if (!validatePhone(formattedOpponent)) {
      setPinError('Invalid opponent phone number');
      return;
    }

    // Check if using winnings and validate balance
    if (useWinnings) {
      const requiredAmount = commission !== null ? initialStake + commission : initialStake;
      if (playerWinnings < requiredAmount) {
        setPinError(`Insufficient winnings (need ${requiredAmount} UGX including commission)`);
        return;
      }
    }

    const opts: any = {
      create_private: true,
      invite_phone: formattedOpponent
    };

    // Cookie auth handles winnings authorization
    if (useWinnings) {
      opts.source = 'winnings';
    }

    await startGame(playerPhone, initialStake, displayNameInput || generateRandomName(), opts);
  };

  if (stage === 'payment_pending') {
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
  }

  if (stage === 'matching') {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8 text-center">
        <div className="mb-6">
          <div className="h-12 w-12 bg-[#373536] rounded-full mx-auto flex items-center justify-center animate-pulse">
            <span className="text-white text-xl">🔄</span>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Rematch Invite Sent</h2>
        <p className="text-gray-600 mb-4">We've sent the rematch invite — waiting for {opponentPhone.slice(-9)} to join.</p>
        
        {privateMatch && (
          <>
            <div className="bg-gray-100 p-4 rounded-lg inline-block mb-4">
              <div className="text-2xl font-mono">{privateMatch.match_code}</div>
              {privateMatch.expires_at && (
                <div className="text-sm text-gray-500">Expires: {new Date(privateMatch.expires_at).toLocaleString()}</div>
              )}
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-600 mb-1">Stake Amount:</div>
              <div className="text-lg font-semibold">{initialStake.toLocaleString()} UGX</div>
            </div>

            <div className="flex flex-col items-center space-y-3">
              <div className="flex items-center space-x-2">
                <input 
                  readOnly 
                  value={buildInviteLink(privateMatch.match_code, initialStake, opponentPhone)} 
                  className="px-3 py-2 border rounded-l-lg w-72 bg-white text-sm" 
                />
                <button 
                  onClick={async () => { 
                    await navigator.clipboard.writeText(buildInviteLink(privateMatch.match_code, initialStake, opponentPhone)); 
                    setCopiedLink(true); 
                    setTimeout(() => setCopiedLink(false), 2000); 
                  }} 
                  className="px-3 py-2 bg-gray-100 rounded-r-lg border"
                >
                  {copiedLink ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="flex space-x-3">
                <button 
                  onClick={handleShare} 
                  className="px-4 py-2 bg-gray-100 rounded-lg border"
                >
                  Share
                </button>
                <button 
                  onClick={() => { reset(); navigate('/'); }} 
                  className="px-4 py-2 bg-white rounded-lg border"
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}

        {!privateMatch && (
          <div className="mt-6">
            <button
              onClick={() => { reset(); navigate('/'); }}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto rounded-2xl p-8">
      <div className="text-center mb-4">
        <img src="/logo.webp" alt="PlayMatatu Logo" width={160} height={113} className="mx-auto mb-4" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Rematch</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {!isAuthenticated ? (
        /* PIN Entry - First Step */
        <div className="space-y-4">
          <div className="text-center mb-6">
            <div className="text-lg font-semibold mb-2">Rematch for: {initialStake.toLocaleString()} UGX</div>
            <div className="text-sm text-gray-600">
              {playerPhone ? `Phone: ${playerPhone}` : 'Verifying account...'}
            </div>
          </div>
          
          <PinInput
            title="Enter your PIN"
            onSubmit={handleVerifyPIN}
            loading={pinLoading}
            error={pinError}
            lockedUntil={pinLockoutUntil}
          />
          
          <button
            onClick={() => navigate('/')}
            className="w-full py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        /* Authenticated - Minimal UI */
        <div className="space-y-4">
          <div className="text-center mb-6">
            <div className="text-lg font-semibold mb-2">Rematch for: {initialStake.toLocaleString()} UGX</div>
            <div className="text-sm text-gray-600">{displayNameInput} • {playerPhone}</div>
            {playerWinnings > 0 && (
              <div className="text-sm text-green-600 mt-1">Balance: {playerWinnings.toLocaleString()} UGX</div>
            )}
          </div>

          {/* Use Winnings Toggle - simple and small */}
          {playerWinnings > 0 && (
            <div className="mb-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWinnings}
                  onChange={(e) => setUseWinnings(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm">Use winnings for this game</span>
              </label>
            </div>
          )}

          {pinError && (
            <div className="p-3 bg-red-50 text-red-700 rounded text-sm">
              {pinError}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="w-full py-3 bg-[#373536] text-white rounded-lg font-semibold hover:bg-[#2c2b2a] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Sending Invite...' : 'Send Rematch Invite'}
          </button>

          <button
            onClick={() => navigate('/')}
            className="w-full py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};
