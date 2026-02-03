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
    <div className="flex justify-center items-end gap-1 sm:gap-2 p-2 sm:p-4 overflow-x-auto">
      <div className="flex items-end relative min-w-fit">
        {cards.map((card, index) => {
          const playable = myTurn && canPlayCard(card, topCard, currentSuit, drawStack);

          return (
            <div
              key={`${card.rank}-${card.suit}-${index}`}
              className={`${index > 0 ? '-ml-5 sm:-ml-4 md:-ml-3' : ''}`}
              style={{ zIndex: index }}
            >
              <Card
                card={card}
                onClick={() => onCardClick(card)}
                disabled={myTurn ? !playable : false}
                className={`${myTurn && playable ? 'hover:-translate-y-3 sm:hover:-translate-y-6 cursor-pointer' : 'cursor-default'}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};