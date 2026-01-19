import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useGameState } from '../hooks/useGameState';
import { useWebSocket } from '../hooks/useWebsockets';
import { GameBoard } from '../game/GameBoard';
import { WSMessage, OutgoingWSMessage } from '../types/websocket.types';
import { useSound } from '../hooks/useSound';
import { SuitReveal } from '../game/SuitReveal';
import { Card as CardType } from '../types/game.types';

export const GamePage: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search)

  const playerToken = urlParams.get('pt')
  const gameTokenMatch = window.location.pathname.match(/\/g\/([^/?]+)/)
  const gt = gameTokenMatch?.[1] || ''

  const [gameStarted, setGameStarted] = useState(false);
  const [revealedSuit, setRevealedSuit] = useState<CardType['suit'] | null>(null);
  const revealTimerRef = useRef<number | null>(null);

  const { gameState, gameOver, updateFromWSMessage, setCanPass, addCardsToHand, updateOpponentCardCount, setTokens } = useGameState();
  
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (gameState.opponentConnected === true) {
      setNotice('Opponent online');
      setTimeout(() => setNotice(null), 3000);
    } else if (gameState.opponentConnected === false) {
      setNotice('Opponent disconnected');
      setTimeout(() => setNotice(null), 3000);
    }
  }, [gameState.opponentConnected]);
  
  const playClick = useSound('/play.mp3');

  // Extract tokens from URL parameters
  useEffect(() => {
    
    console.log(gameTokenMatch, playerToken, "yes", urlParams.get("pt"), )

    if (gt && playerToken) {
      setTokens(gt, playerToken);
    }
  }, [playerToken, setTokens, gt]);

  const handleWSMessage = useCallback((message: WSMessage) => {
    console.log('Received message:', message);

    switch (message.type) {
      case 'waiting_for_opponent':
        // Show waiting screen
        break;

      case 'game_starting':
        setGameStarted(true);
        break;

      case 'game_state':
      case 'game_update':
        updateFromWSMessage(message);
        // If receiving game state with actual game data, ensure game is marked as started
        if (message.my_hand && message.my_hand.length > 0) {
          setGameStarted(true);
        }
        break;

      case 'card_played':
        updateFromWSMessage(message);
        // Show the chosen suit briefly if this was an Ace play
        const playedCardStr = (message as any).card as string | undefined;
        const declaredSuit = (message as any).current_suit as CardType['suit'] | undefined;
        if (playedCardStr?.startsWith('A') && declaredSuit) {
          if (revealTimerRef.current) {
            window.clearTimeout(revealTimerRef.current);
          }
          setRevealedSuit(declaredSuit);
          revealTimerRef.current = window.setTimeout(() => {
            setRevealedSuit(null);
            revealTimerRef.current = null;
          }, 5000);
        }
        // Clear any pending pass state when a play happens
        drawPendingRef.current = false;
        setCanPass(false);
        break;

      case 'cards_drawn':
        if (message.cards) {
          addCardsToHand(message.cards);
        }
        updateFromWSMessage(message);
        // After drawing, player should be able to pass if they choose
        drawPendingRef.current = true;
        setCanPass(true);
        break;

      case 'opponent_drew':
        updateOpponentCardCount(message.count || 1);
        break;

      case 'turn_passed':
        // Clear pass capability when a pass has been executed
        drawPendingRef.current = false;
        setCanPass(false);
        console.log('Received turn_passed:', message);
        break;

      case 'player_connected':
        // Opponent reconnected - could show a notification here
        console.log('Opponent reconnected:', message.player);
        break;

      case 'error':
        console.error('Game error:', message.message);
        break;

      default:
        console.log('Unhandled message type:', message.type);
    }
  }, [updateFromWSMessage, addCardsToHand, updateOpponentCardCount, setCanPass]);

  const { connected, send: sendWSMessage } = useWebSocket({
    gameToken: gt,
    playerToken: playerToken || '',
    onMessage: handleWSMessage,
    onOpen: useCallback(() => console.log('WebSocket connected'), []),
    onClose: useCallback(() => console.log('WebSocket disconnected'), []),
    onError: useCallback((error: Event) => console.error('WebSocket error:', error), []),
    autoReconnect: true
  });

  const handleSendMessage = useCallback((message: OutgoingWSMessage) => {
    playClick();
    sendWSMessage(message);
    if (message.type === 'play_card') {
      drawPendingRef.current = false;
      setCanPass(false);
    }
  }, [sendWSMessage, playClick, setCanPass]);

  const handlePassTurn = useCallback(() => {
    playClick();
    console.log('Sending pass_turn');
    sendWSMessage({
      type: 'pass_turn',
      data: {}
    });
    setCanPass(false);
  }, [sendWSMessage, setCanPass, playClick]);

  const drawPendingRef = useRef(false);

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 mx-auto mb-4"></div>
        </div>
      </div>
    );
  }

  if (!gameStarted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-md mx-auto">
          <div className="mb-6">
            <div className="animate-pulse">
              <div className="h-12 w-12 bg-gray-600 rounded-full mx-auto flex items-center justify-center">
                <span className="text-white text-xl">🎮</span>
              </div>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Waiting for Opponent</h2>
          <p className="text-gray-600">Your game will start when another player joins...</p>
        </div>
      </div>
    );
  }

  if (gameOver) {
    const youWon = gameOver.isWinner;
    const winType = gameOver.winType || 'classic';
    const playerPoints = gameOver.playerPoints ?? 0;
    const opponentPoints = gameOver.opponentPoints ?? 0;
    const diff = Math.abs((playerPoints || 0) - (opponentPoints || 0));

    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-md mx-auto">
          <div className="mb-6">
            <div className={`h-20 w-20 rounded-full mx-auto flex items-center justify-center text-4xl ${
              youWon ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
            }`}>
              {youWon ? '🎉' : '😔'}
            </div>
          </div>

          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            {youWon ? 'You Won!' : 'You Lost'}
          </h2>

          {winType === 'chop' ? (
            <div className="space-y-3 text-gray-700">
              <p className="font-semibold">Chop result</p>
              <p>Your points: <span className="font-bold">{playerPoints}</span></p>
              <p>Opponent points: <span className="font-bold">{opponentPoints}</span></p>
              <p className="text-sm text-gray-500">{youWon ? `You won by ${diff} points` : `Opponent won by ${diff} points`}</p>
            </div>
          ) : (
            <div className="space-y-3 text-gray-700">
              <p className="font-semibold">Classic win</p>
            </div>
          )}

          <button
            onClick={() => window.location.href = '/'}
            className="mt-6 bg-[#373536] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#2c2b2a] transition-colors"
          >
            Play Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800 via-blue-800 to-purple-800">
      <GameBoard
        myHand={gameState.myHand}
        opponentCardCount={gameState.opponentCardCount}
        discardPileCards={gameState.discardPileCards}
        deckCount={gameState.deckCount}
        chopCard={gameState.targetCard}
        topCard={gameState.topCard}
        currentSuit={gameState.currentSuit}
        myTurn={gameState.myTurn}
        drawStack={gameState.drawStack}
        canPass={gameState.canPass}
        sendMessage={handleSendMessage}
        onPassTurn={handlePassTurn}
        myDisplayName={gameState.myDisplayName}
        opponentDisplayName={gameState.opponentDisplayName}
        myConnected={gameState.myConnected}
        opponentConnected={gameState.opponentConnected}
      />

      {revealedSuit && <SuitReveal suit={revealedSuit} />}
      {notice && (
        <div className="fixed top-6 right-6 bg-black bg-opacity-60 text-white px-4 py-2 rounded">
          {notice}
        </div>
      )}
    </div>
  );
};