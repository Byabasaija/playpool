import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { validatePhone, formatPhone } from '../utils/phoneUtils';
import { getPlayerProfile, getConfig, requestOTP, verifyOTPAction } from '../utils/apiClient';

function generateRandomName() {
  const adj = ['Swift', 'Wise', 'Bold', 'Brave', 'Cool', 'Quick', 'Smart', 'Epic', 'Prime', 'Pro'];
  const noun = ['Lion', 'Eagle', 'Shark', 'Tiger', 'Wolf', 'Hawk', 'Dragon', 'Ninja', 'King', 'Ace'];
  return `${adj[Math.floor(Math.random() * adj.length)]}${noun[Math.floor(Math.random() * noun.length)]}`;
}

export const RematchPage: React.FC = () => {
  const navigate = useNavigate();
  const { stage, gameLink, isLoading, startGame, startPolling, reset, displayName, error } = useMatchmaking();

  // Get opponent phone and stake from URL
  const params = new URLSearchParams(window.location.search);
  const opponentPhone = params.get('opponent') || '';
  const stakeParam = params.get('stake');
  const initialStake = stakeParam ? Number(stakeParam) : 1000;

  const [phoneRest, setPhoneRest] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState<string>('');
  const [phoneError, setPhoneError] = useState('');
  const [commission, setCommission] = useState<number | null>(null);
  const [useWinnings, setUseWinnings] = useState(false);
  const [playerWinnings, setPlayerWinnings] = useState<number>(0);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [actionToken, setActionToken] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);

  // Load config and player profile
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
      const token = gameLink.split('/g/')[1]?.split('?')[0];
      if (token) navigate(`/g/${token}${gameLink.includes('?') ? gameLink.substring(gameLink.indexOf('?')) : ''}`);
    }
  }, [stage, gameLink, navigate]);

  const handleGetWinningsBalance = async (phone: string) => {
    try {
      const profile = await getPlayerProfile(phone);
      if (profile && profile.player_winnings !== undefined) {
        setPlayerWinnings(profile.player_winnings);
      }
      if (profile && profile.display_name) {
        setDisplayNameInput(profile.display_name);
      } else {
        setDisplayNameInput(generateRandomName());
      }
    } catch (e) {
      setDisplayNameInput(generateRandomName());
    }
  };

  const handleRequestOTP = async () => {
    const full = formatPhone(phoneRest);
    if (!validatePhone(full)) {
      setOtpError('Invalid phone number');
      return;
    }
    setOtpLoading(true);
    setOtpError(null);
    try {
      await requestOTP(full);
      setOtpSent(true);
    } catch (err: any) {
      setOtpError(err.message || 'Failed to send OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    const full = formatPhone(phoneRest);
    if (!otpCode.trim()) {
      setOtpError('Please enter OTP code');
      return;
    }
    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await verifyOTPAction(full, otpCode.trim(), 'stake_winnings');
      setActionToken(res.action_token);
      setOtpSent(false);
    } catch (err: any) {
      setOtpError(err.message || 'Invalid OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSubmit = async () => {
    const full = formatPhone(phoneRest);
    if (!validatePhone(full)) {
      setPhoneError('Please enter a valid Ugandan phone number');
      return;
    }

    // Validate opponent phone
    const formattedOpponent = formatPhone(opponentPhone);
    if (!validatePhone(formattedOpponent)) {
      setPhoneError('Invalid opponent phone number');
      return;
    }

    // Check winnings balance if using winnings
    if (useWinnings) {
      if (!actionToken) {
        setPhoneError('Please verify OTP first');
        return;
      }
      const requiredAmount = commission !== null ? initialStake + commission : initialStake;
      if (playerWinnings < requiredAmount) {
        setPhoneError(`Insufficient winnings (need ${requiredAmount} UGX including commission)`);
        return;
      }
    }

    setPhoneError('');

    const opts: any = {
      create_private: true,
      invite_phone: formattedOpponent
    };

    if (useWinnings && actionToken) {
      opts.source = 'winnings';
      opts.action_token = actionToken;
    }

    await startGame(full, initialStake, displayNameInput || generateRandomName(), opts);
  };

  if (stage === 'matching') {
    return (
      <div className="max-w-md mx-auto rounded-2xl p-8 text-center">
        <div className="mb-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#373536] mx-auto"></div>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Sending Rematch Invite</h2>
        <p className="text-gray-600">Waiting for {opponentPhone.slice(-9)} to accept...</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto rounded-2xl p-8">
      <div className="text-center mb-4">
        <img src="/logo.png" alt="PlayMatatu Logo" width={160} className="mx-auto mb-4" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Rematch</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {/* Opponent Info */}
      <div className="mb-4 p-3 bg-gray-50 rounded">
        <div className="text-sm text-gray-600">Playing against:</div>
        <div className="font-semibold text-gray-800">{opponentPhone}</div>
      </div>

      {/* Stake Info */}
      <div className="mb-4 p-3 bg-gray-50 rounded">
        <div className="text-sm text-gray-600">Stake amount:</div>
        <div className="font-semibold text-gray-800">{initialStake} UGX</div>
        {commission !== null && (
          <div className="text-xs text-gray-500 mt-1">+ {commission} UGX commission</div>
        )}
      </div>

        {/* Phone Input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Your Phone</label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700">256</span>
            <input
              type="tel"
              value={phoneRest}
              onChange={(e) => {
                setPhoneRest(e.target.value);
                setPhoneError('');
              }}
              onBlur={() => {
                const full = formatPhone(phoneRest);
                if (validatePhone(full)) {
                  handleGetWinningsBalance(full);
                }
              }}
              placeholder="7XX XXX XXX"
              className="w-full px-4 py-3 border border-gray-300 rounded-r-lg"
              maxLength={9}
            />
          </div>
          {phoneError && <div className="mt-1 text-sm text-red-600">{phoneError}</div>}
        </div>

        {/* Display Name */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Display Name</label>
          <input
            type="text"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value)}
            placeholder="Your display name"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg"
            maxLength={50}
          />
        </div>

        {/* Display player winnings if available */}
        {playerWinnings > 0 && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded">
            <p className="text-sm text-green-800">
              💰 Available Winnings: <strong>{playerWinnings.toLocaleString()} UGX</strong>
            </p>
          </div>
        )}

        {/* Use Winnings Toggle */}
        {playerWinnings > 0 && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={useWinnings}
                onChange={(e) => {
                  setUseWinnings(e.target.checked);
                  if (e.target.checked) {
                    setOtpSent(false);
                    setActionToken(null);
                    setOtpCode('');
                    setOtpError(null);
                  }
                }}
                className="mr-3"
              />
              <div className="flex-1">
                <span className="text-blue-900 font-medium">Use Winnings</span>
                <div className="text-sm text-blue-700 mt-1">Balance: {playerWinnings} UGX</div>
              </div>
            </label>

            {/* OTP Flow */}
            {useWinnings && !actionToken && (
              <div className="mt-3 pt-3 border-t border-blue-300">
                {!otpSent ? (
                  <button
                    onClick={handleRequestOTP}
                    disabled={otpLoading}
                    className="w-full py-2 bg-[#373536] text-white rounded-lg font-semibold hover:bg-[#2c2b2a] disabled:opacity-50"
                  >
                    {otpLoading ? 'Sending...' : 'Request OTP'}
                  </button>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="Enter OTP code"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-2"
                      maxLength={6}
                    />
                    <button
                      onClick={handleVerifyOTP}
                      disabled={otpLoading}
                      className="w-full py-2 bg-[#373536] text-white rounded-lg font-semibold hover:bg-[#2c2b2a] disabled:opacity-50"
                    >
                      {otpLoading ? 'Verifying...' : 'Verify OTP'}
                    </button>
                  </div>
                )}
                {otpError && <div className="mt-2 text-sm text-red-600">{otpError}</div>}
              </div>
            )}

            {useWinnings && actionToken && (
              <div className="mt-2 text-sm text-green-600">✓ OTP verified</div>
            )}
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={isLoading || (useWinnings && !actionToken)}
          className="w-full py-3 bg-[#373536] text-white rounded-lg font-semibold hover:bg-[#2c2b2a] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Sending Invite...' : 'Rematch'}
        </button>

        <button
          onClick={() => navigate('/')}
          className="w-full mt-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
        >
          Cancel
        </button>
    </div>
  );
};
