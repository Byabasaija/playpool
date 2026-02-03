import React from 'react';

interface TurnIndicatorProps {
  myTurn: boolean;
  canPass: boolean;
  onPass: () => void;
}

export const TurnIndicator: React.FC<TurnIndicatorProps> = ({
  myTurn,
  canPass,
  onPass
}) => {
  // WAIT (not your turn)
  if (!myTurn) {
    return (
      <div className="relative w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 flex items-center justify-center">
      </div>
    );
  }

  // PASS (you can pass)
  if (canPass) {
    return (
      <div className="relative w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 flex items-center justify-center">
        <button
          onClick={onPass}
          className="relative w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-500 text-gray-900 font-bold text-sm sm:text-base md:text-lg flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-transform ring-4 sm:ring-6 ring-yellow-300/25"
          aria-label="Pass"
        >
          PASS
        </button>
      </div>
    );
  }

  // PLAY (indicator that it's your turn to play)
  return (
    <div className="relative w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 flex items-center justify-center">
      {/* pulsing ring behind the button */}
      <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping"></div>
      <button
        className="relative w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-green-500 to-green-600 text-white font-bold text-sm sm:text-base md:text-lg flex items-center justify-center shadow-2xl cursor-default"
        disabled
        aria-label="Play"
      >
        YOUR TURN 
      </button>
    </div>
  );
};