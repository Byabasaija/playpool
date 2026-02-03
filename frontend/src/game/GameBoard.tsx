import React, { useState } from 'react';
import { Card as CardType } from '../types/game.types';
import { PlayerHand } from './PlayerHand';
import { OpponentHand } from './OpponentHand';
import { DiscardPile } from './DiscardPile';
import { DeckStack } from './DeckStack';
import { TurnIndicator } from './TurnIndicator';
import { SuitSelector } from './SuitSelector';
// import { SuitReveal } from './SuitReveal';
import { cardToCode, SUIT_COLORS, SUIT_SYMBOLS } from '../utils/cardUtils';
import { OutgoingWSMessage } from '../types/websocket.types';
import { useSound } from '../hooks/useSound';
import { canPlayCard } from '../utils/cardUtils';

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
  myDisplayName?: string | null;
  opponentDisplayName?: string | null;
  myConnected?: boolean;
  opponentConnected?: boolean;
  revealedSuit?: CardType['suit'] | null;
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
  onPassTurn,
  myDisplayName,
  opponentDisplayName,
  myConnected,
  opponentConnected,
  revealedSuit
}) => {
  console.log('[UI] DiscardPile type in GameBoard:', typeof DiscardPile, DiscardPile);
  const [showSuitSelector, setShowSuitSelector] = useState(false);
  const [pendingAce, setPendingAce] = useState<CardType | null>(null);

  const wrongSound = useSound('/wrong.mp3');

  const handleCardClick = (card: CardType) => {
    // Provide immediate feedback when clicking invalid actions
    if (!myTurn) {
      wrongSound();
      return;
    }

    // Special-case: last-Ace wins immediately (but cannot bypass draw stack)
    const isLastAce = card.rank === 'A' && myHand.length === 1;
    if (isLastAce) {
      if (drawStack > 0) {
        wrongSound();
        return;
      }
      // Play last ace immediately without requiring declared suit
      sendMessage({
        type: 'play_card',
        data: {
          card: cardToCode(card)
        }
      });
      return;
    }

    // Local validation before sending to server
    if (!canPlayCard(card, topCard, currentSuit, drawStack)) {
      wrongSound();
      return;
    }

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
    if (!myTurn) {
      wrongSound();
      return;
    }
    sendMessage({
      type: 'draw_card',
      data: {}
    });
  };

  const statusDot = (online?: boolean) => (
    <span className={`inline-block h-3 w-3 rounded-full mr-2 ${online ? 'bg-green-400' : 'bg-yellow-400'}`} />
  );

  return (
    <div className="relative w-full min-h-screen flex flex-col justify-between items-center py-2 px-2 sm:py-4 sm:px-4 md:justify-center md:h-[600px] overflow-hidden">
      {/* Opponent Hand (Top) */}
      <div className="flex-none">
        <div className="flex items-center justify-center py-1 sm:py-2">
          {statusDot(opponentConnected)}
          <div className="font-semibold text-white text-sm sm:text-base">{opponentDisplayName || 'Opponent'}</div>
        </div>
        <OpponentHand cardCount={opponentCardCount} />
      </div>

      {/* Game Center Area */}
      <div className="flex-1 flex items-center justify-center gap-3 sm:gap-6 md:gap-12 relative min-h-[120px] sm:min-h-[150px]">
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
        
        {/* Suit Reveal - positioned in center of game area */}
        {revealedSuit && (
          <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div className="bg-white/95 rounded-xl px-6 py-4 shadow-2xl flex items-center gap-3 pointer-events-auto border-2 border-gray-200">
              <div className="text-4xl" style={{ color: SUIT_COLORS[revealedSuit] }}>
                {SUIT_SYMBOLS[revealedSuit]}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Player Hand (Bottom) */}
      <div className="flex-none mb-2 sm:mb-4">
        <div className="flex items-center justify-center py-1 sm:py-2 mb-1 sm:mb-2">
          {statusDot(myConnected)}
          <div className="font-semibold text-white text-sm sm:text-base">{myDisplayName || 'You'}</div>
        </div>
        <PlayerHand
          cards={myHand}
          onCardClick={handleCardClick}
          myTurn={myTurn}
          topCard={topCard}
          currentSuit={currentSuit}
          drawStack={drawStack}
        />

        {/* Concede button (small, placed near player hand) */}
        <div className="flex items-center justify-center mt-2">
          <button
            onClick={() => {
              if (!confirm('Are you sure you want to concede? This will immediately end the match and award the win to your opponent.')) return;
              sendMessage({ type: 'concede', data: {} });
            }}
            className="text-xs sm:text-sm bg-red-600 hover:bg-red-700 text-white py-1 px-2 sm:px-3 rounded-md shadow-sm"
          >
            CONCEDE
          </button>
        </div>
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