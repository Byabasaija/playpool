import React from 'react';
import { Card as CardType } from '../types/game.types';
import { Card } from './Card';
import { canPlayCard } from '../utils/cardUtils';

interface PlayerHandProps {
  cards: CardType[];
  onCardClick: (card: CardType) => void;
  myTurn: boolean;
  topCard: CardType | null;
  currentSuit: CardType['suit'] | null;
  drawStack: number;
}

export const PlayerHand: React.FC<PlayerHandProps> = ({
  cards,
  onCardClick,
  myTurn,
  topCard,
  currentSuit,
  drawStack
}) => {
  return (
    <div className="flex justify-center items-end gap-2 p-4">
      <div className="relative" style={{ width: Math.max(200, cards.length * 48) }}>
        {cards.map((card, index) => {
          const playable = myTurn && canPlayCard(card, topCard, currentSuit, drawStack);
          const offset = index * 28; // px overlap

          return (
            <div
              key={`${card.rank}-${card.suit}-${index}`}
              style={{
                position: 'absolute',
                left: `${offset}px`,
                bottom: 0,
                zIndex: index
              }}
            >
              <Card
                card={card}
                onClick={() => onCardClick(card)}
                disabled={myTurn ? !playable : false}
                className={`${myTurn && playable ? 'hover:-translate-y-6 cursor-pointer' : 'cursor-default'}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};