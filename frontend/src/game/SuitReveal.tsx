import React from 'react';
import { Card as CardType } from '../types/game.types';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../utils/cardUtils';

interface SuitRevealProps {
  suit: CardType['suit'] | null;
}

export const SuitReveal: React.FC<SuitRevealProps> = ({ suit }) => {
  if (!suit) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
      <div className="bg-white/90 rounded-2xl px-8 py-6 shadow-2xl flex items-center gap-4 pointer-events-auto">
        <div className="text-6xl" style={{ color: SUIT_COLORS[suit] }}>
          {SUIT_SYMBOLS[suit]}
        </div>
      </div>
    </div>
  );
};
