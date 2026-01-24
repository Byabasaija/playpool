import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { formatPhone, validatePhone } from '../utils/phoneUtils';

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
      navigate(gameLink);
    }
  }, [stage, gameLink, navigate]);

  const [phoneRest, setPhoneRest] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [stake, setStake] = useState<number>(1000);
  const [minStake] = useState<number>(1000);
  const [matchCode, setMatchCode] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    // Parse URL params
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('match_code');
      const s = params.get('stake');
      const invitePhone = params.get('invite_phone');
      if (code) setMatchCode(code.toUpperCase());
      if (s && !Number.isNaN(Number(s))) setStake(Number(s));
      if (invitePhone) {
        // normalize and strip leading 256 for the input field
        const normalized = formatPhone(invitePhone);
        if (normalized && normalized.startsWith('256')) {
          setPhoneRest(normalized.slice(3));
        } else {
          setPhoneRest(invitePhone);
        }
      } else {
        setDisplayName(generateRandomName());
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const handleConfirm = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);

    const full = '256' + phoneRest.replace(/\D/g, '');
    if (!validatePhone(full)) {
      setFormError('Please enter a valid Ugandan phone number (e.g., 7XXXXXXXX)');
      return;
    }

    if (stake < minStake) {
      setFormError(`Minimum stake is ${minStake} UGX`);
      return;
    }

    // Ensure we have a match code to join
    if (!matchCode || matchCode.length !== 6) {
      setFormError('Missing/invalid match code');
      return;
    }

    // Call startGame with match_code to join the private match
    try {
      await startGame(full, stake, displayName || generateRandomName(), { match_code: matchCode });
      // startGame will manage navigation on match found
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to join match');
    }
  };

  return (
    <div className="max-w-md mx-auto rounded-2xl p-8">
      <div className="text-center mb-4">
        <img src="/logo.png" alt="PlayMatatu Logo" width={180} className="mx-auto" />
      </div>
      <h2 className="text-2xl font-bold mb-4">Join PlayMatatu Match</h2>
      <form onSubmit={handleConfirm} className="space-y-4">
        <div>
          <p className="text-sm text-gray-600">Match code: <span className="font-mono">{matchCode || '—'}</span></p>
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-2">Phone Number</label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700">256</span>
            <input
              name="phone"
              type="tel"
              value={phoneRest}
              onChange={(e) => setPhoneRest(e.target.value)}
              placeholder="7XX XXX XXX"
              className="w-full px-4 py-3 border border-gray-300 rounded-r-lg"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
            placeholder="Your display name"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-2">Stake (UGX)</label>
          <input
            type="number"
            min={minStake}
            value={stake}
            onChange={(e) => setStake(Number(e.target.value))}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg"
          />
          <p className="mt-1 text-sm text-gray-500">This stake is prefilled from the invite; you can change it before confirming.</p>
        </div>

        {formError && <p className="text-red-600 text-sm">{formError}</p>}
        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? 'Processing...' : 'Confirm & Pay'}
        </button>
      </form>
    </div>
  );
};
