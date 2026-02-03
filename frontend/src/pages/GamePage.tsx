import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameState } from '../hooks/useGameState';
import { useWebSocket } from '../hooks/useWebsockets';
import { GameBoard } from '../game/GameBoard';
import { WSMessage, OutgoingWSMessage } from '../types/websocket.types';
import { useSound } from '../hooks/useSound';
import { Card as CardType } from '../types/game.types';



export const GamePage: React.FC = () => {
  const navigate = useNavigate();
  // Background image preloading
  const [backgroundLoaded, setBackgroundLoaded] = useState(false);
  // Token resolution state
  const [tokensReady, setTokensReady] = useState(false);
  const [resolvedGameToken, setResolvedGameToken] = useState('');
  const [resolvedPlayerToken, setResolvedPlayerToken] = useState('');
  
  useEffect(() => {
    const img = new Image();
    img.src = '/background.webp';
    img.onload = () => setBackgroundLoaded(true);
    img.onerror = () => setBackgroundLoaded(true); // Fallback in case of error
  }, []);
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

    // prefer explicit pt param, fallback to saved token in sessionStorage
    let tokenToUse = playerToken;
    if (!tokenToUse && gt) {
      try {
        tokenToUse = sessionStorage.getItem('playerToken_' + gt) || '';
        if (tokenToUse) console.log('[RECOVER] Using saved playerToken from sessionStorage');
      } catch (e) {
        // ignore
      }
    }

    if (gt && tokenToUse) {
      // Set resolved tokens and mark as ready
      setResolvedGameToken(gt);
      setResolvedPlayerToken(tokenToUse);
      setTokensReady(true);
      setTokens(gt, tokenToUse);
    }
  }, [playerToken, setTokens, gt]);

  const handleOpen = useCallback(async () => {
    console.log('WebSocket connected - waiting for initial game_state message');
    // Removed redundant REST call - WebSocket game_state message is guaranteed on connect
    // This optimization saves 200-500ms per game start by trusting the WebSocket flow
  }, []);

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
          }, 3000);
        }
        // Clear any pending pass state when a play happens
        drawPendingRef.current = false;
        setCanPass(false);

        // If the acting player is THIS client, clear the idle banner
        try {
          const actingPlayer = (message as any).player as string | undefined;
          console.log('[IDLE] card_played actingPlayer', actingPlayer, 'idlePlayerRef', idlePlayerRef.current, 'playerIdRef', playerIdRef.current);
          if (actingPlayer && playerIdRef.current && actingPlayer === playerIdRef.current) {
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
          console.log('[IDLE] cards_drawn received: idlePlayerRef', idlePlayerRef.current, 'playerIdRef', playerIdRef.current);
          if (playerIdRef.current && idlePlayerRef.current && playerIdRef.current === idlePlayerRef.current) {
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
          console.log('[IDLE] warning received', { player, fa, remaining });
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

      case 'player_idle_canceled':
        try {
          const player = (message as any).player as string | undefined;
          console.log('[IDLE] cancel received for player', player);
          // Clear any banner regardless of which side receives it (authoritative cancel)
          setIdleForfeitAt(null);
          setIdlePlayer(null);
          setIdleRemaining(null);
        } catch (e) {}
        break;

      case 'player_forfeit':
      case 'player_conceded':
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
          console.error('Failed to refresh state after forfeit/concede:', e);
        }
        break;

      default:
        console.log('Unhandled message type:', message.type);
    }
  }, [updateFromWSMessage, addCardsToHand, updateOpponentCardCount, setCanPass]);

  const { connected, send: sendWSMessage } = useWebSocket({
    gameToken: tokensReady ? resolvedGameToken : '',
    playerToken: tokensReady ? resolvedPlayerToken : '',
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

  // Refs to ensure WS handlers see the latest playerId and idlePlayer without recreating callbacks
  const playerIdRef = useRef<string | null>(null);
  const idlePlayerRef = useRef<string | null>(null);
  useEffect(() => { playerIdRef.current = gameState.playerId; }, [gameState.playerId]);
  useEffect(() => { idlePlayerRef.current = idlePlayer; }, [idlePlayer]);

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
    const isDraw = (gameOver as any).isDraw === true;

    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="p-8 text-center max-w-md mx-auto">
          <div className="mb-6">
            <div className={`h-20 w-20 rounded-full mx-auto flex items-center justify-center text-4xl ${
              isDraw ? 'bg-gray-100 text-gray-700' : (youWon ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600')
            }`}>
              {isDraw ? '🤝' : (youWon ? '🎉' : '😔')}
            </div>
          </div>

          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            {isDraw ? 'It\'s a draw' : (youWon ? 'You Won!' : 'You Lost')}
          </h2>

          <div className="space-y-3 text-gray-700">
            {isDraw ? (
              <p className="font-semibold">Stakes refunded to your account</p>
            ) : youWon ? (
              <div className="space-y-2">
                <p className="text-2xl font-bold text-green-600">
                  You won {((gameState.stakeAmount || 1000) * 2 * 0.85).toLocaleString()} UGX!
                </p>
                <p className="text-sm text-gray-600">
                  Money has been credited to your account (after 15% tax).
                </p>
              </div>
            ) : (
              <p className="font-semibold">Better luck next time</p>
            )}
          </div>

          <div className="flex gap-3 mt-6 justify-center">
            <button
              onClick={() => navigate('/')}
              className="bg-[#373536] text-white py-2 px-4 rounded-md text-sm font-semibold hover:bg-[#2c2b2a] transition-colors"
            >
              New Game
              </button>

              <button
                onClick={() => {
                  const opponent = gameState.opponentPhone;
                  const stake = gameState.stakeAmount || 1000;
                  if (opponent) {
                    navigate(`/rematch?opponent=${encodeURIComponent(opponent)}&stake=${stake}`);
                  } else {
                    console.log('Cannot rematch: opponent phone not available', { gameState });
                    alert('Unable to rematch: opponent information not available');
                  }
                }}
                className="bg-[#111827] text-white py-2 px-4 rounded-md text-sm font-semibold hover:opacity-90 transition-colors"
              >
                Rematch
              </button>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen w-full overflow-hidden" 
      style={{ 
        backgroundImage: backgroundLoaded ? "url('/background.webp')" : 'none',
        backgroundSize: 'cover', 
        backgroundPosition: 'center',
        backgroundColor: backgroundLoaded ? 'transparent' : '#2a2a2a' // Fallback dark color instead of white
      }}
    >
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
        revealedSuit={revealedSuit}
      />

      {notice && (
        <div className="fixed top-6 right-6 bg-black bg-opacity-60 text-white px-4 py-2 rounded">
          {notice}
        </div>
      )}

      {/* Idle warning badge (non-blocking, top center) */}
      {idleRemaining !== null && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-40">
          <div className={`
            px-3 py-2 rounded-lg shadow-lg text-center font-semibold text-xs sm:text-sm
            ${idleRemaining <= 10 ? 'bg-red-500 text-white animate-pulse' : 
              idleRemaining <= 20 ? 'bg-orange-400 text-white' : 
              'bg-yellow-300 text-black'}
            transition-all duration-300
          `}>
            <div className="flex items-center gap-1">
              <span>⚠️</span>
              <span>
                {idlePlayer && idlePlayer === (gameState as any).playerId ? 'Inactive' : `${(gameState as any).opponentDisplayName || 'Opponent'} inactive`}
              </span>
              <span className="font-bold">{idleRemaining}s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};