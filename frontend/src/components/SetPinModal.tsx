import { useState, useCallback } from 'react';
import PinInput from './PinInput';
import { setPIN } from '../utils/apiClient';

type Step = 'enter-pin' | 'confirm-pin' | 'saving' | 'done';

interface SetPinModalProps {
  phone: string;
  onComplete: () => void;
  onCancel?: () => void;
}

/**
 * SetPinModal - Used after a game to prompt user to set their PIN.
 * Since the user just played a game, their phone is already verified,
 * so we skip OTP verification and go directly to PIN setup.
 */
export default function SetPinModal({ phone, onComplete, onCancel }: SetPinModalProps) {
  const [step, setStep] = useState<Step>('enter-pin');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEnterPin = useCallback((pin: string) => {
    setNewPin(pin);
    setError('');
    setStep('confirm-pin');
  }, []);

  const handleConfirmPin = useCallback(async (confirmedPin: string) => {
    if (confirmedPin !== newPin) {
      setError('PINs do not match');
      return;
    }

    setLoading(true);
    setError('');
    setStep('saving');

    try {
      // No action_token needed - user is verified via player_token from localStorage
      await setPIN(phone, newPin);
      setStep('done');
      // Small delay before completing
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to set PIN');
      setStep('confirm-pin');
    } finally {
      setLoading(false);
    }
  }, [newPin, phone, onComplete]);

  const handleBack = () => {
    setError('');
    if (step === 'confirm-pin') {
      setStep('enter-pin');
      setNewPin('');
    } else if (step === 'enter-pin' && onCancel) {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black opacity-40" onClick={onCancel} />
      
      {/* Modal */}
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-lg z-10">

        {/* Step: Enter PIN */}
        {step === 'enter-pin' && (
          <div>
            <PinInput
              title="Create Your PIN"
              subtitle="Choose a 4-digit PIN you'll remember"
              onSubmit={handleEnterPin}
              loading={loading}
              error={error}
            />
            <button
              onClick={handleBack}
              className="w-full mt-4 text-gray-500 hover:text-gray-700 text-sm"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step: Confirm PIN */}
        {step === 'confirm-pin' && (
          <div>
            <PinInput
              title="Confirm Your PIN"
              subtitle="Enter the same PIN again"
              onSubmit={handleConfirmPin}
              loading={loading}
              error={error}
            />
            <button
              onClick={handleBack}
              className="w-full mt-4 text-gray-500 hover:text-gray-700 text-sm"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step: Saving */}
        {step === 'saving' && (
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#373536] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Setting up your PIN...</p>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="text-center">
            <h2 className="text-xl font-bold text-[#373536] mb-2">PIN Set Successfully!</h2>
            <p className="text-gray-600 text-sm">
              You can now use your PIN to quickly access your account.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
