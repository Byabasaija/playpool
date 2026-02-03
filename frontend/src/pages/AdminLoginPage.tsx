import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = '/api/v1';

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/admin/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, token }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send OTP');
      }

      setOtpSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/admin/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify OTP');
      }

      // Store admin session in sessionStorage
      sessionStorage.setItem('admin_session', data.admin_session);
      sessionStorage.setItem('admin_phone', phone);

      // Navigate to admin dashboard
      navigate('/pm-admin/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-6">
          <img src="/logo.webp" alt="PlayMatatu Logo" width={160} className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Admin Login</h1>
          <p className="text-gray-600 text-sm mt-2">Enter your admin credentials</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        {!otpSent ? (
          <form onSubmit={handleRequestOTP} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="256XXXXXXXXX"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Admin Token</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter admin token"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#373536] text-white rounded-lg font-semibold hover:bg-[#2c2b2a] disabled:opacity-50"
            >
              {loading ? 'Sending OTP...' : 'Request OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOTP} className="space-y-4">
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
              OTP sent to {phone}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Enter OTP</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit OTP"
                maxLength={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#373536] text-white rounded-lg font-semibold hover:bg-[#2c2b2a] disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>

            <button
              type="button"
              onClick={() => {
                setOtpSent(false);
                setOtp('');
                setError(null);
              }}
              className="w-full py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
