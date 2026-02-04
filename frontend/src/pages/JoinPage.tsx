import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { formatPhone } from '../utils/phoneUtils';
import { getPlayerProfile, checkPlayerStatus, verifyPIN, declineMatchInvite } from '../utils/apiClient';
import PinInput from '../components/PinInput';

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

  // State management
  const [invitePhone, setInvitePhone] = useState('');
  const [matchCode, setMatchCode] = useState('');
  const [stake, setStake] = useState<number>(1000);
  const [playerExists, setPlayerExists] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [playerProfile, setPlayerProfile] = useState<any>(null);
  const [useWinnings, setUseWinnings] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // URL parsing and player check
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('match_code');
    const s = params.get('stake');
    const phone = params.get('invite_phone');
    
    if (code) setMatchCode(code.toUpperCase());
    if (s && !Number.isNaN(Number(s))) setStake(Number(s));
    if (phone) {
      const normalized = formatPhone(phone);
      setInvitePhone(normalized);
      
      // Check if player exists in database
      checkPlayerStatus(normalized).then(async (status) => {
        if (status && status.exists) {
          setPlayerExists(true);
          // Fetch full profile for display (balance info)
          try {
            const profile = await getPlayerProfile(normalized);
            setPlayerProfile({
              display_name: status.display_name,
              phone_number: normalized,
              player_winnings: profile?.player_winnings || 0
            });
          } catch (err) {
            // Fallback to basic info if profile fetch fails
            setPlayerProfile({ 
              display_name: status.display_name,
              phone_number: normalized 
            });
          }
        } else {
          setPlayerExists(false);
        }
      }).catch(() => {
        setPlayerExists(false);
      });
    }
  }, []);

  const handlePinSubmit = async (pin: string) => {
    if (!invitePhone) return;
    
    try {
      setFormError(null);
      // Verify PIN for profile access
      await verifyPIN(invitePhone, pin, 'view_profile');
      
      // Also get winnings token in case user wants to use winnings later
      try {
        const winningsResult = await verifyPIN(invitePhone, pin, 'stake_winnings');
        if (winningsResult.action_token) {
          sessionStorage.setItem('join_action_token', winningsResult.action_token);
        }
      } catch (err) {
        // Non-fatal if winnings token fails - user can still join
        console.warn('Failed to get winnings token:', err);
      }
      
      setIsAuthenticated(true);
      // Refresh player profile for latest balance
      const profile = await getPlayerProfile(invitePhone);
      setPlayerProfile(profile);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to verify PIN');
    }
  };

  const handleJoinMatch = async () => {
    try {
      setFormError(null);
      
      // For authenticated players, use their profile data
      if (isAuthenticated && playerProfile) {
        const opts: any = { match_code: matchCode };
        if (useWinnings) {
          opts.source = 'winnings';
          // Include the action token for winnings authentication
          const actionToken = sessionStorage.getItem('join_action_token');
          if (actionToken) {
            opts.action_token = actionToken;
            // Clean up the token after use
            sessionStorage.removeItem('join_action_token');
          }
        }
        await startGame(invitePhone, stake, playerProfile.display_name, opts);
      } else {
        // For new/guest players, use phone and generate display name
        const displayName = generateRandomName();
        await startGame(invitePhone, stake, displayName, { 
          match_code: matchCode
        });
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to join match');
    }
  };

  const handleDecline = async () => {
    try {
      setFormError(null);
      await declineMatchInvite(invitePhone, matchCode);
      // Navigate back with a success message or indication
      navigate('/', { state: { message: 'Match invite declined' } });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to decline invite');
    }
  };

  // Show PIN entry for existing players
  if (playerExists && !isAuthenticated) {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8">
        <div className="text-center mb-6">
          <img src="/logo.webp" alt="PlayMatatu Logo" width={180} height={127} className="mx-auto" />
        </div>
        
        <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">Join Match</h2>
        
        {playerProfile && (
          <div className="text-center mb-6">
            <div className="text-xl font-semibold text-gray-900 mb-1">
              {playerProfile.display_name || 'Player'}
            </div>
            <div className="text-gray-600 mb-2">
              {formatPhone(invitePhone)}
            </div>
            <div className="text-sm text-gray-600">
              Balance: <span className="font-semibold text-green-600">
                {(playerProfile.player_winnings || 0).toLocaleString()}
              </span>
            </div>
          </div>
        )}

        <div className="text-center mb-6">
          <div className="text-lg text-gray-700">
            Joining for: <span className="font-bold text-gray-900">{stake.toLocaleString()}</span>
          </div>
        </div>

        <p className="text-gray-600 mb-6 text-center">
          Enter your PIN to continue
        </p>

        <PinInput onSubmit={handlePinSubmit} />
        
        {formError && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {formError}
          </div>
        )}

        <div className="mt-6 space-y-3">
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

  // Show confirmation screen for authenticated players
  if (isAuthenticated && playerProfile) {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8">
        <div className="text-center mb-6">
          <img src="/logo.webp" alt="PlayMatatu Logo" width={180} height={127} className="mx-auto" />
        </div>
        
        <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">Join Match</h2>
        
        <div className="text-center mb-6">
          <div className="text-xl font-semibold text-gray-900 mb-1">
            {playerProfile.display_name || 'Player'}
          </div>
          <div className="text-gray-600 mb-2">
            {formatPhone(invitePhone)}
          </div>
          <div className="text-sm text-gray-600">
            Balance: <span className="font-semibold text-green-600">
              {(playerProfile.player_winnings || 0).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="text-center mb-6">
          <div className="text-lg text-gray-700">
            Joining for: <span className="font-bold text-gray-900">{stake.toLocaleString()}</span>
          </div>
        </div>

        {(playerProfile.player_winnings > 0) && (
          <div className="mb-6">
            <label className="flex items-center justify-center space-x-3">
              <input
                type="checkbox"
                checked={useWinnings}
                onChange={(e) => setUseWinnings(e.target.checked)}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm">Use balance</span>
            </label>
          </div>
        )}

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
            {isLoading ? 'Processing...' : 'Confirm & Pay'}
          </button>
          
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

  // Show guest form for new players (with prefilled, non-editable values)
  return (
    <div className="max-w-md mx-auto rounded-2xl p-8">
      <div className="text-center mb-4">
        <img src="/logo.webp" alt="PlayMatatu Logo" width={180} height={127} className="mx-auto" />
      </div>
      <h2 className="text-2xl font-bold mb-4">Join PlayMatatu Match</h2>
      
      <div className="space-y-4">
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600 mb-2">Match Details:</div>
          <div className="text-sm text-gray-600">Match Code:</div>
          <div className="font-mono text-lg mb-2">{matchCode}</div>
          <div className="text-sm text-gray-600">Stake Amount:</div>
          <div className="font-semibold text-lg">{stake.toLocaleString()} UGX</div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600 mb-2">Playing as:</div>
          <div className="font-semibold">{formatPhone(invitePhone)}</div>
          <div className="text-sm text-gray-500">Guest Player</div>
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
            onClick={handleJoinMatch}
            disabled={isLoading}
            className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Confirm & Pay'}
          </button>
          
          <button
            onClick={handleDecline}
            className="w-full px-4 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
          >
            Decline Invite
          </button>
        </div>
      </div>
    </div>
  );
};
