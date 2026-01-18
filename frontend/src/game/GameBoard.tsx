import React, { useState } from 'react';
import { Card as CardType } from '../types/game.types';
import { PlayerHand } from './PlayerHand';
import { OpponentHand } from './OpponentHand';
import { DiscardPile } from './DiscardPile';
import { DeckStack } from './DeckStack';
import { TurnIndicator } from './TurnIndicator';
import { SuitSelector } from './SuitSelector';
import { cardToCode } from '../utils/cardUtils';
import { OutgoingWSMessage } from '../types/websocket.types';

interface GameBoardProps {
  myHand: CardType[];
  opponentCardCount: number;
  discardPileCards: CardType[];
  deckCount: number;
  chopCard: CardType | null;
  topCard: CardType | null;
  currentSuit: CardType['suit'] | null;
  myTurn: boolean;
  drawStack: number;
  canPass: boolean;
  sendMessage: (message: OutgoingWSMessage) => void;
  onPassTurn: () => void;
}

export const GameBoard: React.FC<GameBoardProps> = ({
  myHand,
  opponentCardCount,
  discardPileCards,
  deckCount,
  chopCard,
  topCard,
  currentSuit,
  myTurn,
  drawStack,
  canPass,
  sendMessage,
  onPassTurn
}) => {
  const [showSuitSelector, setShowSuitSelector] = useState(false);
  const [pendingAce, setPendingAce] = useState<CardType | null>(null);

  const handleCardClick = (card: CardType) => {
    if (!myTurn) return;

    // Ace requires suit selection
    if (card.rank === 'A') {
      setPendingAce(card);
      setShowSuitSelector(true);
      return;
    }

    // Play the card
    sendMessage({
      type: 'play_card',
      data: {
        card: cardToCode(card)
      }
    });
  };

  const handleSuitSelect = (suit: CardType['suit']) => {
    if (pendingAce) {
      sendMessage({
        type: 'play_card',
        data: {
          card: cardToCode(pendingAce),
          declared_suit: suit
        }
      });
      setPendingAce(null);
    }
  };

  const handleDrawCard = () => {
    if (!myTurn) return;
    sendMessage({
      type: 'draw_card',
      data: {}
    });
  };

  return (
    <div className="relative w-full h-screen flex flex-col" style={{ backgroundImage: "url('/background.jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}>
      {/* Opponent Hand (Top) */}
      <div className="flex-none">
        <OpponentHand cardCount={opponentCardCount} />
      </div>

      {/* Game Center Area */}
      <div className="flex-1 flex items-center justify-center gap-12">
        {/* Deck */}
        <DeckStack
          deckCount={deckCount}
          chopCard={chopCard}
          onDrawCard={handleDrawCard}
          disabled={!myTurn}
        />

        {/* Turn Indicator */}
        <TurnIndicator
          myTurn={myTurn}
          canPass={canPass}
          onPass={onPassTurn}
        />

        {/* Discard Pile */}
        <DiscardPile cards={discardPileCards} />
      </div>

      {/* Player Hand (Bottom) */}
      <div className="flex-none">
        <PlayerHand
          cards={myHand}
          onCardClick={handleCardClick}
          myTurn={myTurn}
          topCard={topCard}
          currentSuit={currentSuit}
          drawStack={drawStack}
        />
      </div>

      {/* Suit Selector Modal */}
      {showSuitSelector && (
        <SuitSelector
          onSelectSuit={handleSuitSelect}
          onClose={() => {
            setShowSuitSelector(false);
            setPendingAce(null);
          }}
        />
      )}
    </div>
  );
};