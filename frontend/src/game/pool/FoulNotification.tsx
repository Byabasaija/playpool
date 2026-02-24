// Slide-in notification for fouls and turn messages.

import { useEffect, useState } from 'react';

interface FoulNotificationProps {
  message: string | null;
  isFoul: boolean;
}

export default function FoulNotification({ message, isFoul }: FoulNotificationProps) {
  const [visible, setVisible] = useState(false);
  const [currentMsg, setCurrentMsg] = useState<string | null>(null);

  // show message briefly then hide
  useEffect(() => {
    if (message) {
      setCurrentMsg(message);
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message]);

  if (!currentMsg) return null;

  return (
    <div
      className={`
        fixed top-4 left-1/2 transform -translate-x-1/2 z-50
        px-3 py-1.5 rounded-md text-xs font-medium
        transition-opacity duration-250 ease-in-out
        ${visible ? 'opacity-90' : 'opacity-0 pointer-events-none'}
        ${isFoul ? 'bg-black text-yellow-300' : 'bg-black text-white'}
      `}
    >
      {currentMsg}
    </div>
  );
}
