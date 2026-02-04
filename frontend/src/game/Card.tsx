import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { Card as CardType } from '../types/game.types';
import { SUIT_SYMBOLS } from '../utils/cardUtils';

interface CardProps {
  card?: CardType;
  faceDown?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  layoutId?: string;  // For layout animations
  initial?: HTMLMotionProps<"div">['initial'];
  animate?: HTMLMotionProps<"div">['animate'];
  exit?: HTMLMotionProps<"div">['exit'];
  transition?: HTMLMotionProps<"div">['transition'];
}

export const Card: React.FC<CardProps> = ({
  card,
  faceDown = false,
  onClick,
  className = '',
  style,
  disabled = false,
  layoutId,
  initial,
  animate,
  exit,
  transition
}) => {
  const isRed = card && (card.suit === 'hearts' || card.suit === 'diamonds');

  if (faceDown || !card) {
    return (
      <motion.div
        layoutId={layoutId}
        initial={initial}
        animate={animate}
        exit={exit}
        transition={transition || { type: 'spring', stiffness: 300, damping: 30 }}
        className={`relative w-16 h-24 sm:w-20 sm:h-30 md:w-24 md:h-36 rounded-lg shadow-lg border-2 border-gray-200 overflow-hidden ${className}`}
        style={{ backgroundImage: "url('/card_back_orange.webp')", backgroundSize: 'cover', backgroundPosition: 'center', ...style }}
        role="img"
        aria-label="Card back"
      >
      </motion.div>
    );
  }

  return (
    <motion.div
      layoutId={layoutId}
      initial={initial}
      animate={animate}
      exit={exit}
      transition={transition || { type: 'spring', stiffness: 300, damping: 30 }}
      whileHover={!disabled ? { scale: 1.05, y: -8 } : undefined}
      className={`relative w-16 h-24 sm:w-20 sm:h-30 md:w-24 md:h-36 bg-white rounded-lg shadow-lg ${
        disabled ? 'cursor-not-allowed pointer-events-none' : 'cursor-pointer'
      } ${className}`}
      onClick={!disabled ? onClick : undefined}
      style={style}
      role={disabled ? undefined : 'button'}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      {/* Top left corner */}
      <div className={`absolute top-1 left-1 sm:top-2 sm:left-2 text-xs sm:text-sm font-bold ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
        <div>{card.rank}</div>
        <div className="text-sm sm:text-lg">{SUIT_SYMBOLS[card.suit]}</div>
      </div>

      {/* Center suit large */}
      <div className="absolute inset-0 flex items-center justify-center text-2xl sm:text-3xl md:text-4xl" style={{ color: isRed ? '#e74c3c' : '#2c3e50' }}>
        {SUIT_SYMBOLS[card.suit]}
      </div>

      {/* Bottom right corner */}
      <div className={`absolute bottom-1 right-1 sm:bottom-2 sm:right-2 text-xs sm:text-sm font-bold ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
        <div className="text-right">{card.rank}</div>
        <div className="text-right">{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </motion.div>
  );
};
