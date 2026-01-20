import React from 'react';
import { Card as CardType } from '../types/game.types';
import { Card } from './Card';

interface DiscardPileProps {
  cards: CardType[];
}

export const DiscardPile: React.FC<DiscardPileProps> = ({ cards }) => {
  // If there are no cards in the discard pile, render nothing
  if (!cards || cards.length === 0) {
    return null;
  }

  return (
    <div className="relative w-24 h-36">
      {cards.map((card, index) => {
        const offset = index * 2;
        const rotation = index * 5 - 8;
        
        let finalRotation = rotation;
        let finalX = offset;
        let finalY = offset;
        
        // Top card gets additional random rotation
        if (index === cards.length - 1) {
          const randomRotation = (Math.random() - 0.5) * 20;
          const randomX = (Math.random() - 0.5) * 6;
          const randomY = (Math.random() - 0.5) * 6;
          finalRotation += randomRotation;
          finalX += randomX;
          finalY += randomY;
        }

        return (
          <div
            key={`${card.rank}-${card.suit}-${index}`}
            className="absolute top-0 left-0"
            style={{
              transform: `translate(${finalX}px, ${finalY}px) rotate(${finalRotation}deg)`,
              zIndex: index
            }}
          >
            <Card card={card} />
          </div>
        );
      })}
    </div>
  );
};