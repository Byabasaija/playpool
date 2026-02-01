import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { requeuePlayer, verifyOTPAction, requestOTP, checkPlayerStatus, verifyPIN, resetPIN } from '../utils/apiClient';
import PinInput from '../components/PinInput';

export const RequeuePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const phone = searchParams.get('phone');
  const navigate = useNavigate();

  // OTP state
  const [otpCode, setOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);

  // Requeue state
  const [requeueLoading, setRequeueLoading] = useState(false);
  const [requeueError, setRequeueError] = useState<string | null>(null);

  // PIN state
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | undefined>(undefined);
  const [pinLockoutUntil, setPinLockoutUntil] = useState<string | undefined>(undefined);

  // Forgot PIN state
  const [showForgotPin, setShowForgotPin] = useState(false);
  const [forgotPinStep, setForgotPinStep] = useState<'otp' | 'new_pin' | 'confirm_pin'>('otp');
  const [newPin, setNewPin] = useState('');
  const [otpActionToken, setOtpActionToken] = useState<string | null>(null);

  useEffect(() => {
    if (!phone) {
      navigate('/');
      return;
    }
    // Check if player has PIN
    checkPlayerStatus(phone).then(status => {
      setHasPin(status.has_pin ?? false);
    }).catch(() => {
      setHasPin(false);
    });
  }, [phone, navigate]);

  const handleVerifyPIN = async (pin: string) => {
    if (!phone) return;

    setPinLoading(true);
    setPinError(undefined);

    try {
      await verifyPIN(phone, pin, 'requeue');
      setOtpVerified(true); // Reuse this to indicate verified
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

  const handleForgotPin = () => {
    setShowForgotPin(true);
    setForgotPinStep('otp');
    setOtpCode('');
    setNewPin('');
    setOtpActionToken(null);
    setOtpError(null);
  };

  const requestForgotPinOtp = async () => {
    if (!phone) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      await requestOTP(phone);
      setOtpError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP';
      setOtpError(message);
    }
    setOtpLoading(false);
  };

  const verifyForgotPinOtp = async () => {
    if (!phone) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      const result = await verifyOTPAction(phone, otpCode, 'reset_pin');
      if (result.action_token) {
        setOtpActionToken(result.action_token);
        setForgotPinStep('new_pin');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid OTP';
      setOtpError(message);
    }
    setOtpLoading(false);
  };

  const handleNewPinSubmit = (pin: string) => {
    setNewPin(pin);
    setForgotPinStep('confirm_pin');
  };

  const handleConfirmPinSubmit = async (pin: string) => {
    if (pin !== newPin) {
      setPinError('PINs do not match');
      return;
    }
    if (!phone || !otpActionToken) return;

    setPinLoading(true);
    try {
      await resetPIN(phone, pin, otpActionToken);
      setShowForgotPin(false);
      setHasPin(true);
      setPinError(undefined);
    } catch (err: any) {
      setPinError(err.message || 'Failed to reset PIN');
    }
    setPinLoading(false);
  };

  const handleVerifyOTP = async () => {
    if (!phone) return;
    if (otpCode.length !== 4) {
      setOtpError('Please enter the 4-digit code');
      return;
    }

    setOtpLoading(true);
    setOtpError(null);

    try {
      await verifyOTPAction(phone, otpCode, 'requeue');
      setOtpVerified(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid OTP code';
      setOtpError(message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleRequeue = async () => {
    if (!phone) return;

    setRequeueLoading(true);
    setRequeueError(null);

    try {
      const result = await requeuePlayer(phone);
      if (result.queue_token) {
        // Store queue token and phone for landing page to pick up
        sessionStorage.setItem('queueToken', result.queue_token);
        sessionStorage.setItem('requeuePhone', phone);
        // Redirect to landing page with requeue flag
        navigate('/?requeue=1');
      } else {
        setRequeueError('Could not rejoin queue. Your stake may have already been used.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rejoin queue';
      setRequeueError(message);
    } finally {
      setRequeueLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (!phone) return;

    setResendLoading(true);
    setOtpError(null);

    try {
      await requestOTP(phone);
      setOtpError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resend OTP';
      setOtpError(message);
    } finally {
      setResendLoading(false);
    }
  };

  if (!phone) {
    return null;
  }

  // Still checking if player has PIN
  if (hasPin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // Forgot PIN flow
  if (showForgotPin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md mx-auto rounded-2xl p-8 text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Reset PIN</h2>
          
          {forgotPinStep === 'otp' && (
            <>
              <p className="text-gray-600 mb-4">We'll send a code to verify your identity</p>
              {otpCode === '' ? (
                <button
                  onClick={requestForgotPinOtp}
                  disabled={otpLoading}
                  className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold disabled:opacity-50"
                >
                  {otpLoading ? 'Sending...' : 'Send OTP'}
                </button>
              ) : null}
              {otpError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {otpError}
                </div>
              )}
              <div className="mt-4">
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Enter 4-digit code"
                  maxLength={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-widest font-mono"
                />
              </div>
              {otpCode.length === 4 && (
                <button
                  onClick={verifyForgotPinOtp}
                  disabled={otpLoading}
                  className="mt-4 w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold disabled:opacity-50"
                >
                  {otpLoading ? 'Verifying...' : 'Verify Code'}
                </button>
              )}
            </>
          )}

          {forgotPinStep === 'new_pin' && (
            <>
              <p className="text-gray-600 mb-4">Enter your new 4-digit PIN</p>
              <PinInput
                title="New PIN"
                onSubmit={handleNewPinSubmit}
                loading={pinLoading}
                error={pinError}
              />
            </>
          )}

          {forgotPinStep === 'confirm_pin' && (
            <>
              <p className="text-gray-600 mb-4">Confirm your new PIN</p>
              <PinInput
                title="Confirm PIN"
                onSubmit={handleConfirmPinSubmit}
                loading={pinLoading}
                error={pinError}
              />
            </>
          )}

          <button
            onClick={() => setShowForgotPin(false)}
            className="mt-4 text-gray-500 text-sm underline"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Verification screen (PIN or OTP)
  if (!otpVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md mx-auto rounded-2xl p-8 text-center">
          <div className="mb-6">
            <div className="h-16 w-16 bg-blue-100 rounded-full mx-auto flex items-center justify-center">
              <span className="text-blue-600 text-3xl">🔐</span>
            </div>
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {hasPin ? 'Enter Your PIN' : 'Verify Your Phone'}
          </h2>
          <p className="text-gray-600 mb-2">
            Phone: <span className="font-semibold">{phone}</span>
          </p>
          <p className="text-gray-500 text-sm mb-6">
            {hasPin 
              ? 'Enter your 4-digit PIN to rejoin the queue.'
              : 'Enter the 4-digit code sent to your phone to rejoin the queue.'}
          </p>

          {hasPin ? (
            /* PIN entry */
            <>
              <PinInput
                title=""
                onSubmit={handleVerifyPIN}
                loading={pinLoading}
                error={pinError}
                lockedUntil={pinLockoutUntil}
                onForgot={handleForgotPin}
              />
              <button
                onClick={() => setHasPin(false)}
                className="mt-4 text-gray-500 text-sm underline"
              >
                Use OTP instead
              </button>
            </>
          ) : (
            /* OTP entry */
            <>
              <div className="mb-4">
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Enter 4-digit code"
                  maxLength={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-widest font-mono"
                  autoFocus
                />
              </div>

              {otpError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {otpError}
                </div>
              )}

              <div className="flex flex-col space-y-3">
                <button
                  onClick={handleVerifyOTP}
                  disabled={otpLoading || otpCode.length !== 4}
                  className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors disabled:opacity-50"
                >
                  {otpLoading ? 'Verifying...' : 'Verify Code'}
                </button>

                <button
                  onClick={handleResendOTP}
                  disabled={resendLoading}
                  className="w-full bg-white border border-gray-300 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {resendLoading ? 'Sending...' : 'Resend Code'}
                </button>

                <button
                  onClick={() => navigate('/')}
                  className="text-gray-500 text-sm underline"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Verified - show requeue button
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md mx-auto rounded-2xl p-8 text-center">
        <div className="mb-6">
          <div className="h-16 w-16 bg-green-100 rounded-full mx-auto flex items-center justify-center">
            <span className="text-green-600 text-3xl">✓</span>
          </div>
        </div>

        <h2 className="text-xl font-bold text-gray-900 mb-2">Phone Verified</h2>
        <p className="text-gray-600 mb-6">
          You're ready to rejoin the queue and find an opponent.
        </p>

        {requeueError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {requeueError}
          </div>
        )}

        <div className="flex flex-col space-y-3">
          <button
            onClick={handleRequeue}
            disabled={requeueLoading}
            className="w-full bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors disabled:opacity-50"
          >
            {requeueLoading ? 'Rejoining Queue...' : 'Rejoin Queue'}
          </button>

          <button
            onClick={() => navigate('/')}
            className="w-full bg-white border border-gray-300 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
