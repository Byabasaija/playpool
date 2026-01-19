import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { validatePhone } from '../utils/phoneUtils';

export const LandingPage: React.FC = () => {
  const [phone, setPhone] = useState('');
  const [stake, setStake] = useState(1000);
  const [phoneError, setPhoneError] = useState('');
  const navigate = useNavigate();
  
  // const baseUrl = import.meta.env.VITE_BACKEND_URL
  const { stage, error, gameLink, isLoading, startGame, reset, displayName } = useMatchmaking();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validatePhone(phone)) {
      setPhoneError('Please enter a valid Ugandan phone number');
      return;
    }

    setPhoneError('');
    await startGame(phone, stake);
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
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+256 7XX XXX XXX"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                  required
                />
                {phoneError && (
                  <p className="mt-1 text-sm text-red-600">{phoneError}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Stake Amount (UGX)
                </label>
                <select
                  value={stake}
                  onChange={(e) => setStake(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                >
                  <option value={1000}>1,000 UGX</option>
                  <option value={2000}>2,000 UGX</option>
                  <option value={5000}>5,000 UGX</option>
                  <option value={10000}>10,000 UGX</option>
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  Win up to {stake * 1.8} UGX!
                </p>
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
            <p className="text-red-600 mb-4">Something went wrong. Please try again.</p>
            <button
              onClick={reset}
              className="bg-[#373536] text-white py-2 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors"
            >
              Try Again
            </button>
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