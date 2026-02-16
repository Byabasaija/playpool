import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { validatePhone, formatPhone } from '../utils/phoneUtils';
import { getPlayerProfile, checkPlayerStatus, verifyPIN, declineMatchInvite, checkSession, getMatchDetails, requestOTP, playerLogout } from '../utils/apiClient';
import PinInput from '../components/PinInput';
import SetPinModal from '../components/SetPinModal';

function generateRandomName() {
  const adjectives = ["Lucky", "Swift", "Brave", "Jolly", "Mighty", "Quiet", "Clever", "Happy", "Kitenge", "Zesty"];
  const nouns = ["Zebu", "Rider", "Matatu", "Champion", "Sevens", "Ace", "Mamba", "Jua", "Lion", "Drift"];
  const ai = Math.floor(Math.random() * adjectives.length);
  const ni = Math.floor(Math.random() * nouns.length);
  const num = Math.floor(Math.random() * 1000);
  return `${adjectives[ai]} ${nouns[ni]} ${num}`;
}

export const JoinPage: React.FC = () => {
  const { startGame, isLoading, error, stage, gameLink } = useMatchmaking();
  const navigate = useNavigate();

  // Redirect when game is found (for join flow)
  useEffect(() => {
    if (stage === 'found' && gameLink) {
      // Check if it's an absolute URL
      if (gameLink.startsWith('http')) {
        const url = new URL(gameLink);
        navigate(url.pathname + url.search);
      } else {
        navigate(gameLink);
      }
    }
  }, [stage, gameLink, navigate]);

  // Match details state
  const [matchCode, setMatchCode] = useState('');
  const [stake, setStake] = useState<number>(1000);
  const [inviterPhone, setInviterPhone] = useState('');
  const [inviterProfile, setInviterProfile] = useState<any>(null);
  const [loadingMatch, setLoadingMatch] = useState(false);

  // User authentication state (like LandingPage)
  const [phoneRest, setPhoneRest] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [useWinnings, setUseWinnings] = useState(false);

  // PIN authentication state
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [playerHasPin, setPlayerHasPin] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinAttemptsRemaining, setPinAttemptsRemaining] = useState<number | undefined>();
  const [pinLockedUntil, setPinLockedUntil] = useState<string | undefined>();

  // Authenticated user state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [playerBalance, setPlayerBalance] = useState<number>(0);
  const [playerProfile, setPlayerProfile] = useState<any>(null);

  // Authentication checking state (prevents flicker)
  const [authChecking, setAuthChecking] = useState(() => {
    // Optimistic: if localStorage has phone, assume checking session
    return localStorage.getItem('matatu_phone') ? true : false;
  });

  // PIN setup flow state
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pendingGameData, setPendingGameData] = useState<any>(null);

  // Form state
  const [formError, setFormError] = useState<string | null>(null);

  // URL parsing and match details fetch
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('matchcode');

    if (!code) {
      setFormError('No match code provided');
      return;
    }

    setMatchCode(code.toUpperCase());
    setLoadingMatch(true);

    // Fetch match details from backend
    getMatchDetails(code)
      .then(async (matchData) => {
        setStake(matchData.stake_amount);
        const inviterPhoneNum = matchData.inviter_phone;
        
        if (inviterPhoneNum) {
          const normalized = formatPhone(inviterPhoneNum);
          setInviterPhone(normalized);

          // Fetch inviter profile for display
          try {
            const profile = await getPlayerProfile(normalized);
            setInviterProfile({
              display_name: profile?.display_name || 'Player',
              phone_number: normalized,
            });
          } catch (err) {
            setInviterProfile({
              display_name: 'Player',
              phone_number: normalized,
            });
          }
        }

        // Check if current visitor has an active session
        try {
          const mySession = await checkSession();
          if (mySession) {
            // Logged-in visitor — load their profile and skip PIN
            const me = await getPlayerProfile(mySession.phone);
            if (me) {
              setPlayerProfile(me);
              setPhoneRest(mySession.phone.replace(/^256/, ''));
              setDisplayNameInput(me.display_name || '');
              setPlayerBalance(me.player_winnings || 0);
              setIsAuthenticated(true);
            }
          }
        } catch (e) {
          // ignore session check errors
        } finally {
          setAuthChecking(false);
        }
      })
      .catch((err) => {
        setFormError(err.message || 'Failed to load match details');
      })
      .finally(() => {
        setLoadingMatch(false);
      });
  }, []);

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
        // Handle expired queue if needed
      }
    } catch (e) {
      setDisplayNameInput(generateRandomName());
    }
  };

  // Handle PIN verification for returning users
  const handlePinVerify = async (pin: string) => {
    const full = '256' + phoneRest.replace(/\D/g, '');
    setPinLoading(true);
    setPinError('');
    setPinAttemptsRemaining(undefined);

    try {
      // Single verifyPIN call — cookie is set automatically by the backend
      await verifyPIN(full, pin, 'view_profile');

      // PIN verified successfully - save phone, cookie is now set
      localStorage.setItem('matatu_phone', full);

      // Load profile data including balance
      const profile = await getPlayerProfile(full);
      if (profile) {
        setPlayerBalance(profile.player_winnings || 0);
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
  };

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

  // Handle logout - clear session and reset to unauthenticated state
  const handleLogout = async () => {
    try {
      await playerLogout();
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      // Clear local state regardless of API call result
      localStorage.removeItem('matatu_phone');
      setIsAuthenticated(false);
      setShowPinEntry(false);
      setPlayerHasPin(false);
      setPhoneRest('');
      setDisplayNameInput('');
      setPlayerBalance(0);
      setPinError('');
    }
  };

  const handleJoinMatch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Combine prefix + rest for validation
    const full = '256' + phoneRest.replace(/\D/g, '');

    if (!validatePhone(full)) {
      setPhoneError('Please enter a valid Ugandan phone number (9 digits after 256)');
      return;
    }

    try {
      // Check if user needs to set up PIN before starting game
      const playerStatus = await checkPlayerStatus(full);
      if (!playerStatus.has_pin) {
        // User either doesn't exist or exists but has no PIN - show PIN setup
        const gameData = { full, stake, displayNameInput, matchcode: matchCode };
        setPendingGameData(gameData);
        setShowPinSetup(true);
        return;
      }
    } catch (err) {
      console.warn('Failed to check player status:', err);
      // Continue with game start - PIN setup will be optional
    }

    // Use winnings if selected — cookie auth handles authorization
    const opts: any = { matchcode: matchCode };
    if (useWinnings) {
      opts.source = 'winnings';
    }

    await startGame(full, stake, displayNameInput || generateRandomName(), opts);
  };

  const handleDecline = async () => {
    try {
      setFormError(null);
      await declineMatchInvite(inviterPhone, matchCode);
      // Navigate back with a success message or indication
      navigate('/', { state: { message: 'Match invite declined' } });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to decline invite');
    }
  };

  // Handle PIN setup completion - proceed with game start
  const handlePinSetupComplete = async () => {
    setShowPinSetup(false);
    if (pendingGameData) {
      const { full, stake, displayNameInput, matchcode } = pendingGameData;

      // Store phone in localStorage so LandingPage can check session on return
      localStorage.setItem('matatu_phone', full.replace(/^256/, ''));

      // Use winnings if selected — cookie auth handles authorization
      const opts: any = { matchcode };
      if (useWinnings) {
        opts.source = 'winnings';
      }

      await startGame(full, stake, displayNameInput || generateRandomName(), opts);
      setPendingGameData(null);
    }
  };

  // Show loading while fetching match details
  if (loadingMatch) {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D4A574] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading match details...</p>
        </div>
      </div>
    );
  }

  // Show loading while checking authentication
  if (authChecking) {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D4A574] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show error if match loading failed
  if (formError && !matchCode) {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8">
        <div className="text-center mb-6">
          <Link to="/">
            <img src="/logo.webp" alt="PlayMatatu Logo" width={180} height={127} className="mx-auto" />
          </Link>
        </div>
        <div className="text-center">
          <div className="text-red-500 mb-4">{formError}</div>
          <button
            onClick={() => navigate('/')}
            className="py-2 px-6 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Show PIN entry for returning users with PIN
  if (showPinEntry && playerHasPin) {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8">
        <div className="text-center mb-6">
          <Link to="/">
            <img src="/logo.webp" alt="PlayMatatu Logo" width={200} height={141} className="mx-auto"/>
          </Link>
        </div>

        {/* Match details header */}
        <div className="p-4 mb-6">
          <p className="text-sm text-gray-600">Match invitation from {inviterProfile?.display_name || 'Player'}</p>
          <p className="text-sm text-gray-600">Required stake is {stake.toLocaleString()} UGX</p>
        </div>

        <h2 className="text-xl font-bold text-[#373536] mb-1">Welcome back{displayNameInput ? `, ${displayNameInput}` : ''}!</h2>
        <p className="text-gray-600 text-sm">256{phoneRest}</p>

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

        <button
          onClick={handleLogout}
          className="w-full mt-4 py-2 px-4 text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Not you? Logout
        </button>

        <div className="mt-6">
          <button
            onClick={handleDecline}
            className="w-full px-4 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
          >
            Decline Invite
          </button>
        </div>
      </div>
    );
  }

  // Authenticated user - show join confirmation
  if (isAuthenticated && playerProfile) {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8">
        <div className="text-center mb-4">
          <Link to="/">
            <img src="/logo.webp" alt="PlayMatatu Logo" width={200} height={141} className="mx-auto"/>
          </Link>
        </div>

        {/* Match details header */}
        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <p className="text-sm text-gray-600">Match invitation from {inviterProfile?.display_name || 'Player'}</p>
          <p className="text-sm text-gray-600">Required stake is {stake.toLocaleString()} UGX</p>
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
                  onChange={(e) => setUseWinnings(e.target.checked)}
                  className="mr-2 h-4 w-4 accent-[#373536]"
                />
                <span className="text-sm text-gray-700">
                  Use Balance ({playerBalance.toLocaleString()} UGX)
                </span>
              </label>
            </div>
          )}
        </div>

        {formError && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {formError}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleJoinMatch}
            disabled={isLoading}
            className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Join Match'}
          </button>

          <button
            onClick={handleDecline}
            className="w-full px-4 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
          >
            Decline Invite
          </button>
        </div>

        <div className="flex gap-2 mt-4">
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

        <button
          onClick={handleLogout}
          className="w-full mt-3 py-2 px-4 text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Logout
        </button>
      </div>
    );
  }

  // Default: Show phone input form (unauthenticated)
  return (
    <div className="max-w-md mx-auto rounded-2xl p-8">
      <div className="text-center mb-4 mb-md-5">
        <div className="mb-3">
          <Link to="/">
            <img src="/logo.webp" alt="PlayMatatu Logo" width={200} height={141}/>
          </Link>
        </div>
      </div>

      {/* Match details header */}
      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <p className="text-sm text-gray-600">Match invitation from {inviterProfile?.display_name || 'Player'}</p>
        <p className="text-sm text-gray-600">Required stake is {stake.toLocaleString()} UGX</p>
      </div>

      <form onSubmit={handleJoinMatch} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Your Phone Number
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

        {formError && (
          <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {formError}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Join Match'}
          </button>

          <button
            type="button"
            onClick={handleDecline}
            className="w-full px-4 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
          >
            Decline Invite
          </button>
        </div>
      </form>

      {/* PIN Setup Modal for new users */}
      {showPinSetup && (
        <SetPinModal
          phone={`256${phoneRest}`}
          onComplete={handlePinSetupComplete}
          onCancel={() => setShowPinSetup(false)}
        />
      )}
    </div>
  );
};
