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
  // Calculate if we need to wrap based on card count and screen size
  const needsWrapping = cards.length > 7; // Threshold for wrapping
  
  if (needsWrapping) {
    // Multi-row layout for many cards
    const cardsPerRow = Math.ceil(cards.length / 2); // Split into 2 rows max
    const firstRow = cards.slice(0, cardsPerRow);
    const secondRow = cards.slice(cardsPerRow);
    
    return (
      <div className="flex flex-col items-center gap-1 p-2 sm:p-4">
        {/* First row */}
        <div className="flex justify-center items-end gap-1 sm:gap-2">
          <div className="flex items-end relative min-w-fit">
            {firstRow.map((card, index) => {
              const playable = myTurn && canPlayCard(card, topCard, currentSuit, drawStack);
              
              return (
                <div
                  key={`${card.rank}-${card.suit}-${index}`}
                  className={`${index > 0 ? '-ml-4 sm:-ml-3' : ''}`}
                  style={{ zIndex: index }}
                >
                  <Card
                    card={card}
                    onClick={() => onCardClick(card)}
                    disabled={myTurn ? !playable : false}
                    className={`${myTurn && playable ? 'hover:-translate-y-2 sm:hover:-translate-y-3 cursor-pointer' : 'cursor-default'}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Second row */}
        {secondRow.length > 0 && (
          <div className="flex justify-center items-end gap-1 sm:gap-2">
            <div className="flex items-end relative min-w-fit">
              {secondRow.map((card, index) => {
                const playable = myTurn && canPlayCard(card, topCard, currentSuit, drawStack);
                
                return (
                  <div
                    key={`${card.rank}-${card.suit}-${cardsPerRow + index}`}
                    className={`${index > 0 ? '-ml-4 sm:-ml-3' : ''}`}
                    style={{ zIndex: index }}
                  >
                    <Card
                      card={card}
                      onClick={() => onCardClick(card)}
                      disabled={myTurn ? !playable : false}
                      className={`${myTurn && playable ? 'hover:-translate-y-2 sm:hover:-translate-y-3 cursor-pointer' : 'cursor-default'}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // Single row layout for normal card counts
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