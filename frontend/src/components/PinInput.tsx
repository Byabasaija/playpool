import { useRef, useState, useEffect, KeyboardEvent, ClipboardEvent } from 'react';

interface PinInputProps {
  onSubmit: (pin: string) => void;
  onForgot?: () => void;
  loading?: boolean;
  error?: string;
  title?: string;
  subtitle?: string;
  attemptsRemaining?: number;
  lockedUntil?: string;
}

export default function PinInput({
  onSubmit,
  onForgot,
  loading = false,
  error,
  title = 'Enter PIN',
  subtitle,
  attemptsRemaining,
  lockedUntil,
}: PinInputProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Auto-submit when all 4 digits entered
  useEffect(() => {
    if (digits.every(d => d !== '') && !loading) {
      onSubmit(digits.join(''));
    }
  }, [digits, loading, onSubmit]);

  // Clear on error
  useEffect(() => {
    if (error) {
      setDigits(['', '', '', '']);
      inputRefs.current[0]?.focus();
    }
  }, [error]);

  const handleChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    // Auto-advance to next input
    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index] === '' && index > 0) {
        // Move to previous input
        inputRefs.current[index - 1]?.focus();
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        setDigits(newDigits);
      } else {
        const newDigits = [...digits];
        newDigits[index] = '';
        setDigits(newDigits);
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted.length === 4) {
      setDigits(pasted.split(''));
    }
  };

  const isLocked = lockedUntil && new Date(lockedUntil) > new Date();
  const lockMinutes = isLocked 
    ? Math.ceil((new Date(lockedUntil!).getTime() - Date.now()) / 60000)
    : 0;

  return (
    <div className="flex flex-col items-center gap-4">
      {title && <h2 className="text-xl font-bold text-[#373536]">{title}</h2>}
      {subtitle && <p className="text-gray-600 text-sm">{subtitle}</p>}

      {isLocked ? (
        <div className="text-center">
          <p className="text-red-600 text-sm mb-2">
            Account locked due to too many failed attempts
          </p>
          <p className="text-gray-500 text-sm">
            Try again in {lockMinutes} minute{lockMinutes !== 1 ? 's' : ''}
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-3">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el; }}
                type="tel"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                disabled={loading}
                className={`
                  w-14 h-16 text-center text-2xl font-bold
                  bg-white border-2 rounded-lg
                  text-[#373536]
                  focus:outline-none focus:ring-2 focus:ring-[#373536]
                  disabled:opacity-50
                  ${error ? 'border-red-500 shake' : 'border-gray-300'}
                `}
                autoComplete="off"
              />
            ))}
          </div>

          {error && (
            <p className="text-red-600 text-sm text-center">
              {error}
              {attemptsRemaining !== undefined && attemptsRemaining > 0 && (
                <span className="block text-gray-500 mt-1">
                  {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
                </span>
              )}
            </p>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-gray-600">
              <div className="w-4 h-4 border-2 border-[#373536] border-t-transparent rounded-full animate-spin" />
              <span>Verifying...</span>
            </div>
          )}
        </>
      )}

      {onForgot && (
        <button
          type="button"
          onClick={onForgot}
          disabled={loading}
          className="text-[#373536] hover:underline text-sm mt-2 disabled:opacity-50"
        >
          Forgot PIN?
        </button>
      )}

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        .shake {
          animation: shake 0.3s ease-in-out;
        }
      `}</style>
    </div>
  );
}
