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
  const disconnectedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (gameState.opponentConnected === true) {
      // Clear any pending 'opponent disconnected' debounce
      if (disconnectedTimerRef.current) {
        window.clearTimeout(disconnectedTimerRef.current);
        disconnectedTimerRef.current = null;
      }
      setNotice('Opponent online');
      setTimeout(() => setNotice(null), 3000);
    } else if (gameState.opponentConnected === false) {
      // Debounce short-lived disconnects (e.g., dev StrictMode or brief network flaps)
      if (disconnectedTimerRef.current) {
        window.clearTimeout(disconnectedTimerRef.current);
      }
      disconnectedTimerRef.current = window.setTimeout(() => {
        setNotice('Opponent disconnected');
        setTimeout(() => setNotice(null), 3000);
        disconnectedTimerRef.current = null;
      }, 2000);
    }

    return () => {
      if (disconnectedTimerRef.current) {
        window.clearTimeout(disconnectedTimerRef.current);
        disconnectedTimerRef.current = null;
      }
    };
  }, [gameState.opponentConnected]);
  
  const playClick = useSound('/play.mp3');

  // Extract tokens from URL parameters
  useEffect(() => {
    console.log(gameTokenMatch, playerToken, "yes", urlParams.get("pt"), )

    // prefer explicit pt param, fallback to saved token in localStorage
    let tokenToUse = playerToken;
    if (!tokenToUse && gt) {
      try {
        tokenToUse = localStorage.getItem('playerToken_' + gt) || '';
        if (tokenToUse) console.log('[RECOVER] Using saved playerToken from localStorage');
      } catch (e) {
        // ignore
      }
    }

    if (gt && tokenToUse) {
      setTokens(gt, tokenToUse);
    }
  }, [playerToken, setTokens, gt]);

  const handleOpen = useCallback(async () => {
    console.log('WebSocket connected');

    // If game hasn't started yet, try a REST snapshot to recover any missed initial game_state
    if (!gameStarted && gt) {
      const tokenToUse = playerToken || (typeof window !== 'undefined' ? (localStorage.getItem('playerToken_' + gt) || '') : '');
      if (!tokenToUse) return;

      try {
        const resp = await fetch(`/api/v1/game/${gt}?pt=${tokenToUse}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data && Object.keys(data).length > 0) {
          updateFromWSMessage({ type: 'game_state', ...(data as any) } as any);
          if ((data as any).my_hand && (data as any).my_hand.length > 0) {
            setGameStarted(true);
          }
        }
      } catch (e) {
        console.error('Snapshot fetch on WS open failed:', e);
      }
    }
  }, [gameStarted, gt, playerToken, updateFromWSMessage]);

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

        // If the idle player actually played, clear the idle banner
        try {
          const actingPlayer = (message as any).player as string | undefined;
          if (actingPlayer && idlePlayer && actingPlayer === idlePlayer) {
            setIdleForfeitAt(null);
            setIdlePlayer(null);
            setIdleRemaining(null);
          }
        } catch (e) {
          // ignore
        }
        break;

      case 'cards_drawn':
        if (message.cards) {
          addCardsToHand(message.cards);
        }
        updateFromWSMessage(message);
        // After drawing, player should be able to pass if they choose
        drawPendingRef.current = true;
        setCanPass(true);

        // If I (the drawer) was the idle player, clear the idle banner
        try {
          if (idlePlayer && idlePlayer === (gameState as any).playerId) {
            setIdleForfeitAt(null);
            setIdlePlayer(null);
            setIdleRemaining(null);
          }
        } catch (e) {}
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

      case 'player_idle_warning':
        // payload: { player, forfeit_at }
        try {
          const fa = (message as any).forfeit_at || (message as any).forfeitAt;
          const remaining = (message as any).remaining_seconds || (message as any).remainingSeconds;
          const player = (message as any).player as string | undefined;
          if (remaining != null) {
            // Use server-reported remaining seconds to avoid clock skew
            setIdleForfeitAt(Date.now() + Number(remaining) * 1000);
            setIdlePlayer(player || null);
            setIdleRemaining(Number(remaining));
          } else if (fa) {
            setIdleForfeitAt(new Date(fa).getTime());
            setIdlePlayer(player || null);
          }
        } catch (e) {
          // ignore
        }
        break;

      case 'player_forfeit':
        // final case: refresh a snapshot to pick up final state
        try {
          (async () => {
            if (!gt || !playerToken) return;
            const resp = await fetch(`/api/v1/game/${gt}?pt=${playerToken}`);
            if (!resp.ok) return;
            const data = await resp.json();
            updateFromWSMessage({ type: 'game_state', ...(data as any) } as any);
            setIdleForfeitAt(null);
            setIdlePlayer(null);
          })();
        } catch (e) {
          console.error('Failed to refresh state after forfeit:', e);
        }
        break;

      default:
        console.log('Unhandled message type:', message.type);
    }
  }, [updateFromWSMessage, addCardsToHand, updateOpponentCardCount, setCanPass]);

  const { connected, send: sendWSMessage } = useWebSocket({
    gameToken: gt,
    playerToken: playerToken || '',
    onMessage: handleWSMessage,
    onOpen: handleOpen,
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
  const [idleForfeitAt, setIdleForfeitAt] = useState<number | null>(null);
  const [idlePlayer, setIdlePlayer] = useState<string | null>(null);
  const [idleRemaining, setIdleRemaining] = useState<number | null>(null);

  // Countdown tick for idle forfeit
  useEffect(() => {
    if (!idleForfeitAt) {
      setIdleRemaining(null);
      return;
    }
    const update = () => {
      const now = Date.now();
      const rem = Math.max(0, Math.ceil((idleForfeitAt - now) / 1000));
      setIdleRemaining(rem);
      if (rem <= 0) {
        setIdleForfeitAt(null);
        setIdlePlayer(null);
        setIdleRemaining(null);
      }
    };
    update();
    const t = window.setInterval(update, 1000);
    return () => window.clearInterval(t);
  }, [idleForfeitAt]);

  // Fetch an immediate REST snapshot of the game state on mount as a fallback
  React.useEffect(() => {
    if (!gt || !playerToken) return;
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(`/api/v1/game/${gt}?pt=${playerToken}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (cancelled) return;
        // If server returned player-specific state, apply it as a 'game_state' message
        if (data && Object.keys(data).length > 0) {
          updateFromWSMessage({ type: 'game_state', ...(data as any) } as any);
          if ((data as any).my_hand && (data as any).my_hand.length > 0) {
            setGameStarted(true);
          }
        }
      } catch (e) {
        console.error('Failed to fetch game snapshot:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [gt, playerToken, updateFromWSMessage]);

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
        <div className="p-8 text-center max-w-md mx-auto">
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

    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="p-8 text-center max-w-md mx-auto">
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

          <div className="space-y-3 text-gray-700">
            <p className="font-semibold">{youWon ? 'Classic win' : 'Better luck next time'}</p>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => window.location.href = '/'}
              className="flex-1 bg-[#373536] text-white py-2 px-4 rounded-md text-sm font-semibold hover:bg-[#2c2b2a] transition-colors"
            >
              New game
            </button>

            <button
              onClick={() => window.location.href = '/profile'}
              className="flex-1 bg-white border py-2 px-4 rounded-md text-sm font-semibold hover:bg-gray-50 transition-colors"
            >
              Profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundImage: "url('/background.jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}>
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

      {/* Idle warning banner (non-blocking, minimal) */}
      {idleRemaining !== null && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-yellow-100 text-black px-4 py-2 rounded">
          {idlePlayer && idlePlayer === (gameState as any).playerId ? (
            <span>You are inactive — will forfeit in {idleRemaining}s</span>
          ) : (
            <span>{(gameState as any).opponentDisplayName || 'Opponent'} inactive — will forfeit in {idleRemaining}s</span>
          )}
        </div>
      )}
    </div>
  );
};