import React from 'react';
import { Card } from './Card';
import { Card as CardType } from '../types/game.types';
import { getCardImageUrl } from '../utils/cardUtils';

interface DeckStackProps {
  deckCount: number;
  chopCard: CardType | null;
  onDrawCard: () => void;
  disabled: boolean;
}

export const DeckStack: React.FC<DeckStackProps> = ({
  deckCount,
  chopCard,
  onDrawCard,
  disabled
}) => {
  return (
    <div className="relative" style={{ width: '100px', height: '90px' }} >
      {/* Chop Card (underneath, extended to the right for better visibility) */}
      {chopCard && (
        <div className="absolute left-4 sm:left-6 top-1/2 transform -translate-y-1/2 -rotate-90 z-0">
          <img
            src={getCardImageUrl(chopCard)}
            alt={`${chopCard.rank} of ${chopCard.suit} (Chop Card)`}
            className="w-16 h-24 sm:w-20 sm:h-30 md:w-24 md:h-36 rounded-lg shadow-lg"
          />
        </div>
      )}

      {/* Deck Stack */}
      <button
        onClick={onDrawCard}
        disabled={disabled}
        className={`relative z-10 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:scale-105'} transition-transform`}
      >
        {/* Slight offset backs for depth - smaller offsets on mobile */}
        <div className="absolute top-0 left-0 transform -translate-x-2 -translate-y-2 sm:-translate-x-3 sm:-translate-y-3">
          <Card faceDown />
        </div>
        <div className="absolute top-0 left-0 transform -translate-x-1 -translate-y-1">
          <Card faceDown />
        </div>
        <Card faceDown />

        {/* Card count badge - smaller on mobile */}
        <div className="absolute -bottom-1 -right-1 sm:-bottom-2 sm:-right-2 bg-blue-600 text-white rounded-full w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center text-xs sm:text-sm font-bold shadow-lg">
          {deckCount}
        </div>
      </button>
    </div>
  );
};