import React, { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Card as CardType } from '../types/game.types';
import { Card } from './Card';

interface DiscardPileProps {
  cards: CardType[];
}

// Simple deterministic hash for a string
function hashString(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Simple deterministic pseudo-random from seed (0..1)
function seededRand(seed: number) {
  // LCG
  const m = 0x80000000; // 2**31
  const a = 1103515245;
  const c = 12345;
  seed = (a * seed + c) % m;
  return seed / (m - 1);
}

const DiscardPileInner: React.FC<DiscardPileProps> = ({ cards }) => {
  // If there are no cards in the discard pile, render invisible placeholder to maintain layout balance
  if (!cards || cards.length === 0) {
    return <div className="relative w-24 h-36 invisible" />;
  }

  // Compute deterministic transforms so they don't change on each parent re-render
  const transforms = useMemo(() => {
    return cards.map((card, index) => {
      const offset = index * 2;
      const rotation = index * 5 - 8;
      let finalRotation = rotation;
      let finalX = offset;
      let finalY = offset;

      if (index === cards.length - 1) {
        const seedBase = hashString(`${card.rank}-${card.suit}-${index}`);
        const r1 = seededRand(seedBase);
        const r2 = seededRand(seedBase + 1);
        const r3 = seededRand(seedBase + 2);
        const randomRotation = (r1 - 0.5) * 20; // -10..10
        const randomX = (r2 - 0.5) * 6; // -3..3
        const randomY = (r3 - 0.5) * 6;
        finalRotation += randomRotation;
        finalX += randomX;
        finalY += randomY;
      }

      return { finalRotation, finalX, finalY };
    });
  }, [cards]);

  return (
    <div className="relative w-24 h-36">
      <AnimatePresence mode="sync">
        {cards.map((card, index) => {
          const { finalRotation, finalX, finalY } = transforms[index];
          const cardId = `discard-${card.rank}-${card.suit}`;
          const isTopCard = index === cards.length - 1;
          
          return (
            <div
              key={cardId}
              className="absolute top-0 left-0"
              style={{
                transform: `translate(${finalX}px, ${finalY}px) rotate(${finalRotation}deg)`,
                zIndex: index
              }}
            >
              <Card 
                card={card}
                layoutId={`${card.rank}-${card.suit}`}
                initial={isTopCard ? { opacity: 0, scale: 0.5, rotate: -90 } : false}
                animate={isTopCard ? { 
                  opacity: 1, 
                  scale: 1, 
                  rotate: 0,
                  transition: { 
                    type: 'spring', 
                    stiffness: 200, 
                    damping: 20,
                    opacity: { duration: 0.2 }
                  }
                } : false}
              />
            </div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

// Shallow content comparator for cards array
function cardsEqual(prev: DiscardPileProps, next: DiscardPileProps) {
  const a = prev.cards;
  const b = next.cards;
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].rank !== b[i].rank || a[i].suit !== b[i].suit) return false;
  }
  return true;
}

const MemoDiscardPile = React.memo(DiscardPileInner, cardsEqual);
console.log('[UI] DiscardPile export type:', typeof MemoDiscardPile);
export const DiscardPile = MemoDiscardPile;
export default MemoDiscardPile;