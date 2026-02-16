// Slide-in notification for fouls and turn messages.

import { useEffect, useState } from 'react';

interface FoulNotificationProps {
  message: string | null;
  isFoul: boolean;
}

export default function FoulNotification({ message, isFoul }: FoulNotificationProps) {
  const [visible, setVisible] = useState(false);
  const [currentMsg, setCurrentMsg] = useState<string | null>(null);

  useEffect(() => {
    if (message) {
      setCurrentMsg(message);
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2500);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message]);

  if (!currentMsg) return null;

  return (
    <div
      className={`
        fixed top-16 left-1/2 -translate-x-1/2 z-50
        px-5 py-2.5 rounded-lg shadow-xl font-semibold text-sm
        transition-all duration-300 ease-in-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}
        ${isFoul
          ? 'bg-red-500 text-white border border-red-300'
          : 'bg-blue-500 text-white border border-blue-300'
        }
      `}
    >
      {isFoul ? 'FOUL: ' : ''}{currentMsg}
    </div>
  );
}
