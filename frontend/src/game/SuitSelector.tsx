import React from 'react';
import { Card } from '../types/game.types';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../utils/cardUtils';

interface SuitSelectorProps {
  onSelectSuit: (suit: Card['suit']) => void;
  onClose: () => void;
}

export const SuitSelector: React.FC<SuitSelectorProps> = ({ onSelectSuit, onClose }) => {
  const suits: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
      <div className="flex items-center pointer-events-auto space-x-4">
        {suits.map((suit) => (
          <button
            key={suit}
            onClick={() => {
              onSelectSuit(suit);
              onClose();
            }}
            className="w-14 h-14 rounded-full bg-white shadow-sm border border-gray-200 hover:scale-105 transition-transform flex items-center justify-center text-3xl"
            style={{ color: SUIT_COLORS[suit] }}
            aria-label={`Select ${suit}`}
          >
            {SUIT_SYMBOLS[suit]}
          </button>
        ))}
      </div>
    </div>
  );
};