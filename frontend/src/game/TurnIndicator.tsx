import React from 'react';

interface TurnIndicatorProps {
  myTurn: boolean;
  canPass: boolean;
  onPass: () => void;
  opponentName?: string | null;
}

// Poker chip edge pattern (8 notches)
const greenChipEdge = `conic-gradient(
  #15803d 0deg 30deg, white 30deg 45deg,
  #15803d 45deg 75deg, white 75deg 90deg,
  #15803d 90deg 120deg, white 120deg 135deg,
  #15803d 135deg 165deg, white 165deg 180deg,
  #15803d 180deg 210deg, white 210deg 225deg,
  #15803d 225deg 255deg, white 255deg 270deg,
  #15803d 270deg 300deg, white 300deg 315deg,
  #15803d 315deg 345deg, white 345deg 360deg
)`;

const grayChipEdge = `conic-gradient(
  #4b5563 0deg 30deg, #9ca3af 30deg 45deg,
  #4b5563 45deg 75deg, #9ca3af 75deg 90deg,
  #4b5563 90deg 120deg, #9ca3af 120deg 135deg,
  #4b5563 135deg 165deg, #9ca3af 165deg 180deg,
  #4b5563 180deg 210deg, #9ca3af 210deg 225deg,
  #4b5563 225deg 255deg, #9ca3af 255deg 270deg,
  #4b5563 270deg 300deg, #9ca3af 300deg 315deg,
  #4b5563 315deg 345deg, #9ca3af 345deg 360deg
)`;

const ChipBody: React.FC<{
  label: string;
  sublabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  pulse?: boolean;
  variant?: 'green' | 'gray';
}> = ({ label, sublabel, onClick, disabled, pulse, variant = 'green' }) => {
  const isGray = variant === 'gray';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative w-14 h-14 sm:w-[72px] sm:h-[72px] md:w-20 md:h-20 rounded-full flex items-center justify-center ${
        !disabled ? 'hover:scale-105 active:scale-95 cursor-pointer' : 'cursor-default'
      } transition-transform`}
      aria-label={label}
    >
      {/* Pulse ring */}
      {pulse && (
        <div className="absolute inset-0 rounded-full bg-green-500/30 animate-ping" />
      )}

      {/* Outer notched edge */}
      <div
        className="absolute inset-0 rounded-full shadow-lg"
        style={{ background: isGray ? grayChipEdge : greenChipEdge }}
      />

      {/* Inner ring */}
      <div className={`absolute inset-[4px] sm:inset-[5px] md:inset-[6px] rounded-full border ${
        isGray ? 'bg-gray-600 border-gray-500/40' : 'bg-green-700 border-green-500/40'
      }`} />

      {/* Center */}
      <div className={`absolute inset-[7px] sm:inset-[9px] md:inset-[10px] rounded-full flex flex-col items-center justify-center ${
        isGray ? 'bg-gray-200' : 'bg-white'
      }`}>
        {sublabel && (
          <span className={`font-semibold text-[6px] sm:text-[7px] md:text-[8px] uppercase tracking-wide select-none leading-none ${
            isGray ? 'text-gray-500' : 'text-green-700'
          }`}>
            {sublabel}
          </span>
        )}
        <span className={`font-extrabold text-[9px] sm:text-[10px] md:text-xs tracking-wider select-none leading-tight ${
          isGray ? 'text-gray-500' : 'text-green-800'
        }`}>
          {label}
        </span>
      </div>
    </button>
  );
};

export const TurnIndicator: React.FC<TurnIndicatorProps> = ({
  myTurn,
  canPass,
  onPass,
  opponentName
}) => {
  // Not your turn — show disabled gray chip with opponent's name
  if (!myTurn) {
    const name = opponentName || 'Opponent';
    const shortName = name.length > 8 ? name.slice(0, 7) + '…' : name;
    return <ChipBody label="TURN" sublabel={shortName + "'s"} disabled variant="gray" />;
  }

  // PASS (you can pass)
  if (canPass) {
    return <ChipBody label="PASS" sublabel="" onClick={onPass} />;
  }

  // PLAY (your turn to play a card)
  return <ChipBody label="TURN" sublabel="Your" disabled pulse />;
};
