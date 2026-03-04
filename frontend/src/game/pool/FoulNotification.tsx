// Slide-in notification for fouls and turn messages.

import { useEffect, useState } from 'react';

// guiSolids.png / guiStripes.png: 256x512, 2 columns x 4 rows, 102x102 per frame
const GUI_FRAME_W = 102;
const GUI_FRAME_H = 102;
const GUI_COLS = 2;
const GUI_SHEET_W = 256;
const GUI_SHEET_H = 512;

function BallSprite({ ballId, size = 24 }: { ballId: number; size?: number }) {
  const isSolid = ballId >= 1 && ballId <= 7;
  const frame = isSolid ? ballId - 1 : ballId - 9;
  const col = frame % GUI_COLS;
  const row = Math.floor(frame / GUI_COLS);
  const src = isSolid ? '/pool/img/guiSolids.png' : '/pool/img/guiStripes.png';
  const scaleX = size / GUI_FRAME_W;
  const scaleY = size / GUI_FRAME_H;
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${src})`,
        backgroundSize: `${GUI_SHEET_W * scaleX}px ${GUI_SHEET_H * scaleY}px`,
        backgroundPosition: `${-col * GUI_FRAME_W * scaleX}px ${-row * GUI_FRAME_H * scaleY}px`,
        backgroundRepeat: 'no-repeat',
        borderRadius: '50%',
        flexShrink: 0,
      }}
    />
  );
}

interface FoulNotificationProps {
  message: string | null;
  isFoul: boolean;
  pocketedBalls?: number[] | null;
}

export default function FoulNotification({ message, isFoul, pocketedBalls }: FoulNotificationProps) {
  const [visible, setVisible] = useState(false);
  const [currentMsg, setCurrentMsg] = useState<string | null>(null);
  const [currentBalls, setCurrentBalls] = useState<number[] | null>(null);

  useEffect(() => {
    if (message) {
      setCurrentMsg(message);
      setCurrentBalls(pocketedBalls ?? null);
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message]);

  if (!currentMsg) return null;

  const balls = !isFoul && currentBalls && currentBalls.length > 0 ? currentBalls : null;

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
      {balls ? (
        <div className="flex items-center gap-1.5">
          {balls.map(id => <BallSprite key={id} ballId={id} size={22} />)}
        </div>
      ) : (
        currentMsg
      )}
    </div>
  );
}
