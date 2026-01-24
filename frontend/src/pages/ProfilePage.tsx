import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const ProfilePage: React.FC = () => {
  const [phoneRest, setPhoneRest] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [playerExists, setPlayerExists] = useState<boolean | null>(null);
  const [allowCreate, setAllowCreate] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      fetchProfile(token);
    }
  }, [token]);

  const fetchProfile = async (t: string) => {
    try {
      const resp = await fetch('/api/v1/me', { headers: { 'Authorization': `Bearer ${t}` } });
      if (!resp.ok) throw new Error('Failed to fetch profile');
      const data = await resp.json();
      setProfile(data);

      // fetch stats by phone if available
      if (data && data.phone) {
        const sresp = await fetch(`/api/v1/player/${encodeURIComponent(data.phone)}/stats`);
        if (sresp.ok) {
          const sdata = await sresp.json();
          setStats(sdata);
        }
      }
    } catch (e) {
      console.error(e);
      setMessage('Failed to load profile');
    }
  };

  const requestOtp = async () => {
    setMessage(null);
    setLoading(true);
    try {
      const resp = await fetch('/api/v1/auth/request-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '256' + phoneRest.replace(/\D/g, '') })
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMessage(data.error || 'Failed to request OTP');
      } else {
        setOtpRequested(true);
        setMessage('OTP sent via SMS');
      }
    } catch (e) {
      setMessage('Network error');
    }
    setLoading(false);
  };

  const verifyOtp = async () => {
    setMessage(null);
    setLoading(true);
    try {
      const resp = await fetch('/api/v1/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '256' + phoneRest.replace(/\D/g, ''), code })
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMessage(data.error || 'Invalid code');
      } else {
        // store token
        if (data.token) {
          localStorage.setItem('auth_token', data.token);
          setToken(data.token);
          setMessage('Verified');
        }
      }
    } catch (e) {
      setMessage('Network error');
    }
    setLoading(false);
  };

  const signOut = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setProfile(null);
    setStats(null);
    navigate('/');
  };

  const simulateWithdraw = () => {
    // placeholder only - do not perform any backend action
    setMessage('Withdraw placeholder: no real withdrawal performed');
  };

  const checkPlayerExists = async (phoneToCheckRest: string) => {
    setPlayerExists(null);
    const fullPhone = '256' + phoneToCheckRest.replace(/\D/g, '')
    try {
      const resp = await fetch(`/api/v1/player/${encodeURIComponent(fullPhone)}`);
      if (resp.ok) {
        const p = await resp.json();
        setPlayerExists(true);
        // optionally prefill display name preview
        if (p.display_name) setMessage(`Existing user: ${p.display_name}`);
      } else if (resp.status === 404) {
        setPlayerExists(false);
      } else {
        setPlayerExists(false);
      }
    } catch (e) {
      setPlayerExists(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md mx-auto rounded-2xl p-8 bg-white shadow">
        <div className="text-center mb-6">
          <img src="/logo.png" alt="PlayMatatu Logo" width={160} className="mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Profile</h2>
        </div>

        {!token ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-700 mb-2">Phone Number</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-gray-100 text-gray-700">256</span>
                <input
                  className="w-full px-3 py-2 border rounded-r-md"
                  value={phoneRest}
                  onChange={(e) => { setPhoneRest(e.target.value); setPlayerExists(null); setAllowCreate(false); }}
                  onBlur={() => { if (phoneRest) checkPlayerExists(phoneRest); }}
                  placeholder="7XXXXXXXX"
                />
              </div>
            </div>

            {playerExists === false && (
              <div className="text-sm text-yellow-600">
                No account found for this number. <button className="underline" onClick={() => setAllowCreate(true)}>Create account</button> to continue.
              </div>
            )}

            {!otpRequested ? (
              <button className="w-full bg-[#373536] text-white py-2 rounded flex items-center justify-center disabled:opacity-50" onClick={requestOtp} disabled={loading || (playerExists === false && !allowCreate)}>
                {loading ? (<div className="animate-spin h-4 w-4 border-b-2 border-white rounded-full mr-2" />) : null}
                Request OTP
              </button>
            ) : (
              <div className="space-y-2">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Enter 4-digit code</label>
                  <input maxLength={4} className="w-full px-3 py-2 border rounded" value={code} onChange={(e) => setCode(e.target.value)} placeholder="1234" />
                </div>
                <button className="w-full bg-[#373536] text-white py-2 rounded flex items-center justify-center disabled:opacity-50" onClick={verifyOtp} disabled={loading}>
                  {loading ? (<div className="animate-spin h-4 w-4 border-b-2 border-white rounded-full mr-2" />) : null}
                  Verify
                </button>
              </div>
            )}

            {message && <div className="text-sm text-red-600">{message}</div>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 border rounded">
              <div className="text-sm text-gray-500">Signed in as</div>
              <div className="font-semibold text-lg">{profile?.display_name || 'Player'}</div>
              <div className="text-xs text-gray-400">{profile?.phone}</div>
            </div>

            <div className="p-4 border rounded space-y-2">
              <div className="font-semibold">Balances</div>
              <div>Available balance: <span className="font-bold">{profile?.fee_exempt_balance ?? 0} UGX</span></div>
              <div>Total winnings: <span className="font-bold">{profile?.total_winnings ?? 0} UGX</span></div>
            </div>

            <div className="p-4 border rounded space-y-2">
              <div className="font-semibold">Stats</div>
              <div>Games played: {stats?.games_played ?? profile?.total_games_played ?? 0}</div>
              <div>Games won: {stats?.games_won ?? profile?.total_games_won ?? 0}</div>
              <div>Win rate: {(stats?.win_rate ?? 0).toFixed(1)}%</div>
              <div>Current streak: {stats?.current_streak ?? 0}</div>
              <div>Rank: {stats?.rank ?? 'Bronze'}</div>
            </div>

            <div className="flex gap-3">
              <button className="flex-1 bg-[#373536] text-white py-2 rounded" onClick={() => navigate('/')}>New game</button>
              <button className="flex-1 bg-white border py-2 rounded" onClick={simulateWithdraw}>Withdraw</button>
            </div>

            <div className="pt-4 text-center">
              <button className="text-sm text-gray-600 underline" onClick={signOut}>Sign out</button>
            </div>

            {message && <div className="text-sm text-gray-600 text-center">{message}</div>}
          </div>
        )}
      </div>
    </div>
  );
};