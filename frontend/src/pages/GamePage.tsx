import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameState } from '../hooks/useGameState';
import { useWebSocket } from '../hooks/useWebsockets';
import { GameBoard } from '../game/GameBoard';
import { WSMessage, OutgoingWSMessage } from '../types/websocket.types';
import { useSound } from '../hooks/useSound';
import { useSoundContext } from '../components/SoundProvider';
import { Card as CardType } from '../types/game.types';

//@ts-ignore
const API_BASE = import.meta.env.VITE_BACKEND_URL + '/api/v1';


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
  const [lastCardAlert, setLastCardAlert] = useState<string | null>(null);
  const lastCardTimerRef = useRef<number | null>(null);
  const prevOpponentCountRef = useRef<number>(0);

  const { gameState, gameOver, updateFromWSMessage, setCanPass, addCardsToHand, updateOpponentCardCount, setTokens } = useGameState();
  
  // Sound effects
  const { isMuted, toggleMute } = useSoundContext();
  const playCardSound = useSound('/woosh.mp3');
  const drawCardSound = useSound('/drawcard.mp3');
  const passSound = useSound('/playcard.mp3');
  const startGameSound = useSound('/startgame.mp3');
  const endGameSound = useSound('/endgame.mp3');
  const notificationSound = useSound('/bell-notification.mp3');
  const wrongSound = useSound('/wrongplay.mp3');
  
  // Announce when opponent is down to 1 card
  useEffect(() => {
    if (
      gameState.opponentCardCount === 1 &&
      prevOpponentCountRef.current > 1
    ) {
      if (lastCardTimerRef.current) {
        window.clearTimeout(lastCardTimerRef.current);
      }
      setLastCardAlert(gameState.opponentDisplayName || 'Opponent');
      notificationSound();
      lastCardTimerRef.current = window.setTimeout(() => {
        setLastCardAlert(null);
        lastCardTimerRef.current = null;
      }, 3000);
    }
    prevOpponentCountRef.current = gameState.opponentCardCount;
  }, [gameState.opponentCardCount, gameState.opponentDisplayName, notificationSound]);

  // Play end game sound when game ends
  const gameOverPlayedRef = useRef(false);
  useEffect(() => {
    if (gameOver && !gameOverPlayedRef.current) {
      endGameSound();
      gameOverPlayedRef.current = true;
    }
  }, [gameOver, endGameSound]);
  
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
        startGameSound();
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
        
        // Play sound for opponent's card play (softer volume)
        const actingPlayer = (message as any).player as string | undefined;
        if (actingPlayer && actingPlayer !== gameState.playerId) {
          playCardSound();
        }
        
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
        // Play draw sound for opponent
        drawCardSound();
        break;

      case 'turn_passed':
        // Clear pass capability when a pass has been executed
        drawPendingRef.current = false;
        setCanPass(false);
        // Play sound so opponent hears the pass
        passSound();
        console.log('Received turn_passed:', message);
        break;

      case 'player_connected':
        // Opponent reconnected - clear disconnect countdown
        console.log('Opponent reconnected:', message.player);
        setDisconnectForfeitAt(null);
        setDisconnectRemaining(null);
        break;

      case 'player_disconnected':
        // Opponent disconnected - start countdown
        try {
          const graceSeconds = (message as any).grace_seconds as number | undefined;
          const disconnectedAt = (message as any).disconnected_at as number | undefined;
          console.log('[DISCONNECT] warning received', { graceSeconds, disconnectedAt });
          
          if (graceSeconds && disconnectedAt) {
            // Calculate forfeit time from disconnect timestamp + grace period
            setDisconnectForfeitAt((disconnectedAt * 1000) + (graceSeconds * 1000));
            setDisconnectRemaining(graceSeconds);
          }
        } catch (e) {
          console.error('[DISCONNECT] Failed to parse disconnect warning:', e);
        }
        break;

      case 'error':
        console.error('Game error:', message.message);
        wrongSound();
        break;

      case 'player_idle_warning':
        // payload: { player, forfeit_at }
        notificationSound(); // Play alert sound for idle warning
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
            const resp = await fetch(`${API_BASE}/game/${gt}?pt=${playerToken}`);
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
    if (message.type === 'play_card') {
      playCardSound();
      drawPendingRef.current = false;
      setCanPass(false);
    } else if (message.type === 'draw_card') {
      drawCardSound();
    }
    sendWSMessage(message);
  }, [sendWSMessage, playCardSound, drawCardSound, setCanPass]);

  const handlePassTurn = useCallback(() => {
    passSound();
    console.log('Sending pass_turn');
    sendWSMessage({
      type: 'pass_turn',
      data: {}
    });
    setCanPass(false);
  }, [sendWSMessage, setCanPass, passSound]);

  const drawPendingRef = useRef(false);
  const [idleForfeitAt, setIdleForfeitAt] = useState<number | null>(null);
  const [idlePlayer, setIdlePlayer] = useState<string | null>(null);
  const [idleRemaining, setIdleRemaining] = useState<number | null>(null);

  // Disconnect countdown state
  const [disconnectForfeitAt, setDisconnectForfeitAt] = useState<number | null>(null);
  const [disconnectRemaining, setDisconnectRemaining] = useState<number | null>(null);

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

  // Countdown tick for disconnect forfeit
  useEffect(() => {
    if (!disconnectForfeitAt) {
      setDisconnectRemaining(null);
      return;
    }
    const update = () => {
      const now = Date.now();
      const rem = Math.max(0, Math.ceil((disconnectForfeitAt - now) / 1000));
      setDisconnectRemaining(rem);
      if (rem <= 0) {
        setDisconnectForfeitAt(null);
        setDisconnectRemaining(null);
      }
    };
    update();
    const t = window.setInterval(update, 1000);
    return () => window.clearInterval(t);
  }, [disconnectForfeitAt]);

  // Fetch an immediate REST snapshot of the game state on mount as a fallback
  React.useEffect(() => {
    if (!gt || !playerToken) return;
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/game/${gt}?pt=${playerToken}`);
        if (!resp.ok) {
          // Game no longer exists on server — redirect home
          if (resp.status === 404) navigate('/', { replace: true });
          return;
        }
        const data = await resp.json();
        if (cancelled) return;
        // If server returned player-specific state, apply it as a 'game_state' message
        if (data && Object.keys(data).length > 0) {
          updateFromWSMessage({ type: 'game_state', ...(data as any) } as any);
          if ((data as any).my_hand && (data as any).my_hand.length > 0) {
            setGameStarted(true);
          }
          // Game already completed — make sure we skip "Waiting for Opponent"
          if ((data as any).winner) {
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
    const winType = (gameOver as any).winType || 'classic';
    const playerPoints = (gameOver as any).playerPoints;
    const opponentPoints = (gameOver as any).opponentPoints;

    // Check if it's a forfeit/concede win
    const isConcede = winType === 'concede';
    const isForfeit = winType === 'forfeit';

    return (
      <div className="min-h-screen flex items-center justify-center bg-white relative overflow-hidden">
        <div className="p-8 text-center max-w-md mx-auto relative z-10">
          {/* Animated emoji circle */}
          <div className="mb-6">
            <div className={`h-24 w-24 rounded-full mx-auto flex items-center justify-center text-5xl ${
              isDraw ? 'bg-yellow-100' : 
              (youWon ? 'bg-green-100 animate-bounce' : 'bg-red-100')
            }`}>
              {isDraw ? '🤝' : (youWon ? '🎉' : '😢')}
            </div>
          </div>

          {/* Title */}
          <h2 className={`text-3xl font-bold mb-4 ${
            isDraw ? 'text-yellow-600' : (youWon ? 'text-green-600' : 'text-red-600')
          }`}>
            {isDraw ? 'It\'s a Draw!' : (youWon ? 'You Won! 🏆' : 'You Lost')}
          </h2>

          {/* Win type badge */}
          <div className="mb-4">
            <span className={`inline-block px-4 py-1 rounded-full text-sm font-semibold ${
              winType === 'classic' ? 'bg-[#373536] text-white' : 
              winType === 'chop' ? 'bg-orange-500 text-white' :
              isConcede ? 'bg-[#373536] text-white' :
              isForfeit ? 'bg-[#373536] text-white' : 'bg-gray-500 text-white'
            }`}>
              {winType === 'classic' ? '👑 Classic Win' : 
               winType === 'chop' ? '✂️ Chop Win' :
               isConcede ? '🏳️ Conceeded' :
               isForfeit ? '⏱️ Forfeited' : 'Win'}
            </span>
          </div>

          {/* Points display for chop wins */}
          {winType === 'chop' && playerPoints !== undefined && opponentPoints !== undefined && (
            <div className="mb-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="text-gray-600 text-sm mb-3 font-semibold">Final Score</div>
              <div className="grid grid-cols-2 gap-4">
                <div className={`p-3 rounded-lg ${youWon ? 'bg-green-50 border-2 border-green-500' : 'bg-white border border-gray-200'}`}>
                  <div className="text-gray-500 text-xs mb-1">You</div>
                  <div className={`text-2xl font-bold ${youWon ? 'text-green-600' : 'text-gray-700'}`}>
                    {playerPoints}
                  </div>
                  <div className="text-gray-400 text-xs">points</div>
                </div>
                <div className={`p-3 rounded-lg ${!youWon && !isDraw ? 'bg-red-50 border-2 border-red-500' : 'bg-white border border-gray-200'}`}>
                  <div className="text-gray-500 text-xs mb-1">Opponent</div>
                  <div className={`text-2xl font-bold ${!youWon && !isDraw ? 'text-red-600' : 'text-gray-700'}`}>
                    {opponentPoints}
                  </div>
                  <div className="text-gray-400 text-xs">points</div>
                </div>
              </div>
            </div>
          )}

          {/* Winnings/Message section */}
          <div className="space-y-3 mb-6">
            {isDraw ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="font-semibold text-yellow-800">Stakes refunded to your account</p>
              </div>
            ) : youWon ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-2xl font-bold text-green-600 mb-1">
                  +{((gameState.stakeAmount || 1000) * 2 * 0.85).toLocaleString()} UGX
                </p>
                <p className="text-sm text-gray-600">
                  Money credited to your account (after 15% tax)
                </p>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="font-semibold text-red-800">Better luck next time! 💪</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 justify-center items-center">
            <button
              onClick={() => navigate('/')}
              className="flex-1 bg-[#373536] text-white py-2 px-4 rounded-lg text-sm font-semibold hover:bg-[#2c2b2a] transition-colors"
            >
              NewGame
            </button>

            <button
              onClick={() => {
                const opponent = gameState.opponentPhone;
                const stake = gameState.stakeAmount || 1000;
                if (opponent) {
                  navigate(`/rematch?opponent=${encodeURIComponent(opponent)}&stake=${stake}`);
                } else {
                  
                  alert('Unable to rematch: opponent information not available');
                }
              }}
              className="flex-1 bg-[#111827] text-white py-2 px-4 rounded-lg text-sm font-semibold hover:opacity-90 transition-colors"
            >
              Rematch
            </button>
          </div>
          
          <button
            onClick={() => {
              const phone = gameState.myPhone || localStorage.getItem('playmatatu_phone') || localStorage.getItem('matatu_phone');
              if (phone) {
                navigate(`/profile?phone=${encodeURIComponent(phone)}&withdraw=1`);
              } else {
                navigate('/profile?withdraw=1');
              }
            }}
            className="w-full mt-3 py-2 px-4 text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Withdraw
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen w-full overflow-hidden relative" 
      style={{ 
        backgroundImage: backgroundLoaded ? "url('/background.webp')" : 'none',
        backgroundSize: 'cover', 
        backgroundPosition: 'center',
        backgroundColor: backgroundLoaded ? 'transparent' : '#2a2a2a' // Fallback dark color instead of white
      }}
    >
      {/* Mute button in top right corner */}
      <button
        onClick={toggleMute}
        className="absolute top-4 right-4 z-50 bg-black bg-opacity-50 hover:bg-opacity-70 text-white p-3 rounded-full transition-all"
        aria-label={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        )}
      </button>

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
        lastCardAlert={lastCardAlert}
      />

      {notice && (
        <div className="fixed top-6 right-6 bg-black bg-opacity-60 text-white px-4 py-2 rounded">
          {notice}
        </div>
      )}

      {/* Disconnect countdown banner */}
      {disconnectRemaining !== null && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-40">
          <div className={`
            px-4 py-3 rounded-lg shadow-lg text-center font-semibold text-sm
            ${disconnectRemaining <= 10 ? 'bg-red-500 text-white animate-pulse' : 
              disconnectRemaining <= 20 ? 'bg-orange-400 text-white' : 
              'bg-blue-400 text-white'}
            transition-all duration-300
          `}>
            <div className="flex items-center gap-2">
              <span>📡</span>
              <span>Opponent disconnected</span>
              <span className="font-bold">{disconnectRemaining}s</span>
            </div>
          </div>
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