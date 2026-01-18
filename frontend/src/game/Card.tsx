import React from 'react';
import { Card as CardType } from '../types/game.types';
import { SUIT_SYMBOLS } from '../utils/cardUtils';

interface CardProps {
  card?: CardType;
  faceDown?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

export const Card: React.FC<CardProps> = ({
  card,
  faceDown = false,
  onClick,
  className = '',
  style,
  disabled = false
}) => {
  const isRed = card && (card.suit === 'hearts' || card.suit === 'diamonds');

  if (faceDown || !card) {
    return (
      <div
        className={`relative w-24 h-36 rounded-lg shadow-lg border-2 border-gray-200 overflow-hidden ${className}`}
        style={{ backgroundImage: "url('/Kitenge.jpg')", backgroundSize: 'cover', backgroundPosition: 'center', ...style }}
        role="img"
        aria-label="Card back"
      >
      </div>
    );
  }

  return (
    <div
      className={`relative w-24 h-36 bg-white rounded-lg shadow-lg ${
        disabled ? 'cursor-not-allowed pointer-events-none' : 'cursor-pointer hover:scale-105'
      } transition-transform ${className}`}
      onClick={!disabled ? onClick : undefined}
      style={style}
      role={disabled ? undefined : 'button'}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      {/* Top left corner */}
      <div className={`absolute top-2 left-2 text-sm font-bold ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
        <div>{card.rank}</div>
        <div className="text-lg">{SUIT_SYMBOLS[card.suit]}</div>
      </div>

      {/* Center suit large */}
      <div className="absolute inset-0 flex items-center justify-center text-4xl" style={{ color: isRed ? '#e74c3c' : '#2c3e50' }}>
        {SUIT_SYMBOLS[card.suit]}
      </div>

      {/* Bottom right corner */}
      <div className={`absolute bottom-2 right-2 text-sm font-bold ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
        <div className="text-right">{card.rank}</div>
        <div className="text-right">{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
};
