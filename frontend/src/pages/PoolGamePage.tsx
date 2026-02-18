// Pool game page with sprite-based rendering.

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePoolGameState } from '../hooks/usePoolGameState';
import { usePoolWebSocket } from '../hooks/usePoolWebSocket';
import { PoolWSMessage } from '../types/pool.types';
import { ShotAnimator, type BallFrame, type ServerBallPosition, type PocketEvent } from '../game/pool/ShotAnimator';
import { loadPoolAssets, PoolAssets } from '../game/pool/AssetLoader';
import { SoundManager } from '../game/pool/SoundManager';
import { updateBallRotation } from '../game/pool/BallRenderer';
import PoolCanvas, { type ShotParams, type PocketingAnim, physToCanvas } from '../game/pool/PoolCanvas';
import PlayerBar from '../game/pool/PlayerBar';
import SpinSetter from '../game/pool/SpinSetter';
import FoulNotification from '../game/pool/FoulNotification';

export const PoolGamePage: React.FC = () => {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<PoolAssets | null>(null);
  const [assetsError, setAssetsError] = useState(false);
  const [tokensReady, setTokensReady] = useState(false);
  const [resolvedGameToken, setResolvedGameToken] = useState('');
  const [resolvedPlayerToken, setResolvedPlayerToken] = useState('');
  const [gameStarted, setGameStarted] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [foulMessage, setFoulMessage] = useState<string | null>(null);
  const [isFoul, setIsFoul] = useState(false);
  const [screw, setScrew] = useState(0);
  const [english, setEnglish] = useState(0);
  const [showGuideLine, setShowGuideLine] = useState(true);
  const [pocketingBalls, setPocketingBalls] = useState<PocketingAnim[]>([]);
  const [isPortrait, setIsPortrait] = useState(window.innerHeight > window.innerWidth);

  // Idle/disconnect state
  const [idleRemaining, setIdleRemaining] = useState<number | null>(null);
  const [idlePlayer, setIdlePlayer] = useState<string | null>(null);
  const [disconnectRemaining, setDisconnectRemaining] = useState<number | null>(null);

  const urlParams = new URLSearchParams(window.location.search);
  const playerToken = urlParams.get('pt');
  const gameTokenMatch = window.location.pathname.match(/\/g\/([^/?]+)/);
  const gt = gameTokenMatch?.[1] || '';

  const { gameState, gameOver, updateFromWSMessage, applyShotResult, setBallPositions, setTokens } = usePoolGameState();

  // Load assets on mount
  useEffect(() => {
    loadPoolAssets().then(setAssets).catch(() => setAssetsError(true));
  }, []);

  // Force landscape orientation on game screen
  useEffect(() => {
    try { (screen.orientation as any)?.lock?.('landscape').catch(() => {}); } catch {}
    const handler = () => setIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    return () => {
      try { (screen.orientation as any)?.unlock?.(); } catch {}
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, []);

  // Sound manager (created once assets load)
  const soundRef = useRef<SoundManager | null>(null);
  const firstHitRef = useRef(false);

  // Shot animator ref
  const animatorRef = useRef<ShotAnimator | null>(null);
  if (!animatorRef.current) {
    animatorRef.current = new ShotAnimator(
      (balls: BallFrame[]) => {
        // Update ball rotation from velocity data
        for (const b of balls) {
          updateBallRotation(b.id, b.vx, b.vy);
        }
        setBallPositions(balls.map(b => ({ id: b.id, x: b.x, y: b.y, active: b.active })));
      },
      (serverPositions: ServerBallPosition[]) => {
        setBallPositions(serverPositions.map(b => ({ id: b.id, x: b.x, y: b.y, active: b.active })));
        setAnimating(false);
      },
      (event) => {
        // Sound on collision
        const isFirst = !firstHitRef.current && event.ballId === 0;
        if (isFirst) firstHitRef.current = true;
        soundRef.current?.playCollision(event, isFirst);
      },
    );
    animatorRef.current.setOnPocket((evt: PocketEvent) => {
      // Find ball's current canvas position from current state
      const ball = gameState.balls.find(b => b.id === evt.ballId);
      if (!ball) return;
      const [startX, startY] = physToCanvas(ball.x, ball.y);
      const [targetX, targetY] = physToCanvas(evt.pocketX, evt.pocketY);
      setPocketingBalls(prev => [...prev, {
        ballId: evt.ballId,
        startX, startY,
        targetX, targetY,
        startTime: performance.now(),
        duration: 350,
      }]);
      // Auto-clean after animation completes
      setTimeout(() => {
        setPocketingBalls(prev => prev.filter(p => p.ballId !== evt.ballId));
      }, 400);
    });
  }

  // Initialize sound manager when assets load
  useEffect(() => {
    if (assets && !soundRef.current) {
      soundRef.current = new SoundManager(assets);
    }
  }, [assets]);

  // Resolve tokens from URL
  useEffect(() => {
    let tokenToUse = playerToken;
    if (!tokenToUse && gt) {
      try {
        tokenToUse = sessionStorage.getItem('playerToken_' + gt) || '';
      } catch (e) {}
    }
    if (gt && tokenToUse) {
      setResolvedGameToken(gt);
      setResolvedPlayerToken(tokenToUse);
      setTokensReady(true);
      setTokens(gt, tokenToUse);
    }
  }, [playerToken, setTokens, gt]);

  const handleWSMessage = useCallback((message: PoolWSMessage) => {
    switch (message.type) {
      case 'waiting_for_opponent':
        break;

      case 'game_starting':
        setGameStarted(true);
        break;

      case 'game_state':
      case 'game_update':
        updateFromWSMessage(message);
        if (message.balls && message.balls.length > 0) {
          setGameStarted(true);
        }
        break;

      case 'shot_result': {
        const shotParams = message.shot_params;
        const serverBalls = message.ball_positions;
        if (shotParams && serverBalls) {
          setAnimating(true);
          firstHitRef.current = false;
          soundRef.current?.resumeAudioContext();
          animatorRef.current?.start(
            gameState.balls,
            { angle: shotParams.angle, power: shotParams.power, screw: shotParams.screw, english: shotParams.english },
            serverBalls,
          );
        }

        if (message.foul) {
          setFoulMessage(message.foul.message);
          setIsFoul(true);
        } else if (message.pocketed_balls && message.pocketed_balls.length > 0) {
          const pocketed = message.pocketed_balls.filter(id => id !== 0);
          if (pocketed.length > 0) {
            setFoulMessage(`Pocketed: ${pocketed.join(', ')}`);
            setIsFoul(false);
          }
        }

        applyShotResult(message);
        break;
      }

      case 'ball_placed':
        if (message.x !== undefined && message.y !== undefined) {
          const newBalls = gameState.balls.map(b =>
            b.id === 0 ? { ...b, x: message.x!, y: message.y!, active: true } : b
          );
          setBallPositions(newBalls);
        }
        break;

      case 'player_connected':
        break;

      case 'player_disconnected':
        if (message.grace_seconds && message.disconnected_at) {
          setDisconnectRemaining(message.grace_seconds);
        }
        break;

      case 'player_idle_warning':
        if (message.remaining_seconds != null) {
          setIdleRemaining(message.remaining_seconds);
          setIdlePlayer(message.player || null);
        }
        break;

      case 'player_idle_canceled':
        setIdleRemaining(null);
        setIdlePlayer(null);
        break;

      case 'player_conceded':
      case 'player_forfeit':
        updateFromWSMessage(message);
        break;

      case 'error':
        console.error('[Pool] Error:', message.message);
        break;
    }
  }, [updateFromWSMessage, applyShotResult, setBallPositions, gameState.balls]);

  const { connected, send: sendWSMessage } = usePoolWebSocket({
    gameToken: tokensReady ? resolvedGameToken : '',
    playerToken: tokensReady ? resolvedPlayerToken : '',
    onMessage: handleWSMessage,
    onClose: useCallback(() => console.log('[Pool WS] Disconnected'), []),
    onError: useCallback((e: Event) => console.error('[Pool WS] Error:', e), []),
    autoReconnect: true,
  });

  const handleTakeShot = useCallback((params: ShotParams) => {
    sendWSMessage({
      type: 'take_shot',
      data: { angle: params.angle, power: params.power, screw, english },
    });
  }, [sendWSMessage, screw, english]);

  const handlePlaceCueBall = useCallback((x: number, y: number) => {
    sendWSMessage({
      type: 'place_cue_ball',
      data: { x, y },
    });
  }, [sendWSMessage]);

  const handleConcede = useCallback(() => {
    if (confirm('Are you sure you want to concede?')) {
      sendWSMessage({ type: 'concede', data: {} });
    }
  }, [sendWSMessage]);

  // Idle countdown tick
  useEffect(() => {
    if (idleRemaining === null) return;
    if (idleRemaining <= 0) { setIdleRemaining(null); setIdlePlayer(null); return; }
    const t = setInterval(() => {
      setIdleRemaining(prev => {
        if (prev === null || prev <= 1) { setIdlePlayer(null); return null; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [idleRemaining]);

  // Disconnect countdown tick
  useEffect(() => {
    if (disconnectRemaining === null) return;
    if (disconnectRemaining <= 0) { setDisconnectRemaining(null); return; }
    const t = setInterval(() => {
      setDisconnectRemaining(prev => {
        if (prev === null || prev <= 1) return null;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [disconnectRemaining]);

  // Loading assets
  if (!assets) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0e1628]">
        {assetsError ? (
          <div className="text-center text-red-400">
            <p className="mb-2">Failed to load game assets</p>
            <button onClick={() => window.location.reload()} className="text-sm text-white underline">Retry</button>
          </div>
        ) : (
          <div className="text-center text-white">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto mb-3"></div>
            <p className="text-sm text-gray-400">Loading game...</p>
          </div>
        )}
      </div>
    );
  }

  // Connecting to WS
  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0e1628]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400"></div>
      </div>
    );
  }

  // Waiting for opponent
  if (!gameStarted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0e1628]">
        <div className="text-center text-white">
          <div className="animate-pulse mb-4">
            <div className="h-16 w-16 bg-green-600 rounded-full mx-auto flex items-center justify-center text-2xl">
              8
            </div>
          </div>
          <h2 className="text-xl font-bold mb-2">Waiting for Opponent</h2>
          <p className="text-gray-400 text-sm">Game starts when opponent joins...</p>
        </div>
      </div>
    );
  }

  // Game over
  if (gameOver) {
    const youWon = gameOver.isWinner;
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0e1628]">
        <div className="p-8 text-center max-w-md mx-auto">
          <div className="mb-6">
            <div className={`h-24 w-24 rounded-full mx-auto flex items-center justify-center text-5xl ${
              youWon ? 'bg-green-900 animate-bounce' : 'bg-red-900'
            }`}>
              {youWon ? '!' : '..'}
            </div>
          </div>

          <h2 className={`text-3xl font-bold mb-4 ${youWon ? 'text-green-400' : 'text-red-400'}`}>
            {youWon ? 'You Won!' : 'You Lost'}
          </h2>

          <div className="mb-4">
            <span className="inline-block px-4 py-1 rounded-full text-sm font-semibold bg-gray-700 text-white">
              {gameOver.winType === 'pocket_8' ? '8-Ball Victory' :
               gameOver.winType === 'illegal_8ball' ? 'Illegal 8-Ball' :
               gameOver.winType === 'scratch_on_8' ? 'Scratch on 8-Ball' :
               gameOver.winType === 'concede' ? 'Conceded' :
               gameOver.winType === 'forfeit' ? 'Forfeit' : gameOver.winType}
            </span>
          </div>

          <div className="space-y-3 mb-6">
            {youWon ? (
              <div className="bg-green-900/50 border border-green-600 rounded-lg p-4">
                <p className="text-2xl font-bold text-green-400 mb-1">
                  +{((gameState.stakeAmount || 1000) * 2 * 0.85).toLocaleString()} UGX
                </p>
                <p className="text-sm text-gray-400">After 15% tax</p>
              </div>
            ) : (
              <div className="bg-red-900/50 border border-red-600 rounded-lg p-4">
                <p className="font-semibold text-red-300">Better luck next time!</p>
              </div>
            )}
          </div>

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate('/')}
              className="flex-1 bg-gray-700 text-white py-2 px-4 rounded-lg text-sm font-semibold hover:bg-gray-600"
            >
              New Game
            </button>
            <button
              onClick={() => navigate('/')}
              className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg text-sm font-semibold hover:bg-green-500"
            >
              Rematch
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Portrait rotation styles — rotate entire game view when phone is held upright
  const portraitStyle: React.CSSProperties = isPortrait ? {
    position: 'fixed',
    top: '50%',
    left: '50%',
    width: '100vh',
    height: '100vw',
    transform: 'translate(-50%, -50%) rotate(90deg)',
    transformOrigin: 'center center',
    overflow: 'hidden',
  } : {};

  // Main game view: PlayerBar on top, table centered, controls overlaid on right
  return (
    <div style={portraitStyle} className="h-screen bg-[#0e1628] flex flex-col overflow-hidden">
      {/* Player bar — compact, with ball indicators inline */}
      <PlayerBar
        myName={gameState.myDisplayName || 'You'}
        opponentName={gameState.opponentDisplayName || 'Opponent'}
        myGroup={gameState.myGroup}
        opponentGroup={gameState.opponentGroup}
        myTurn={gameState.myTurn}
        stakeAmount={gameState.stakeAmount}
        myConnected={gameState.myConnected}
        opponentConnected={gameState.opponentConnected}
        idleRemaining={idleRemaining}
        idleIsMe={idlePlayer === gameState.playerId}
        balls={gameState.balls}
      />

      {/* Table area — fills remaining space, centered */}
      <div className="flex-1 relative flex items-center justify-center min-h-0">
        <PoolCanvas
          balls={gameState.balls}
          myTurn={gameState.myTurn}
          ballInHand={gameState.ballInHand && gameState.ballInHandPlayer === gameState.playerId}
          isBreakShot={gameState.isBreakShot}
          myGroup={gameState.myGroup}
          opponentGroup={gameState.opponentGroup}
          animating={animating}
          onTakeShot={handleTakeShot}
          onPlaceCueBall={handlePlaceCueBall}
          assets={assets}
          showGuideLine={showGuideLine}
          pocketingBalls={pocketingBalls}
        />

        {/* Right-side controls — overlaid on top of canvas area */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 z-10">
          <SpinSetter
            screw={screw}
            english={english}
            onChange={(s, e) => { setScrew(s); setEnglish(e); }}
            disabled={!gameState.myTurn || animating}
          />

          <button
            onClick={() => setShowGuideLine(prev => !prev)}
            className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
              showGuideLine ? 'text-green-400 bg-green-900/40' : 'text-gray-500 bg-gray-800/40'
            }`}
          >
            Guide
          </button>

          <button
            onClick={handleConcede}
            className="text-[9px] text-gray-600 hover:text-red-400 transition-colors"
          >
            Concede
          </button>
        </div>
      </div>

      {/* Foul notification */}
      <FoulNotification message={foulMessage} isFoul={isFoul} />

      {/* Disconnect countdown */}
      {disconnectRemaining !== null && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-40">
          <div className={`px-3 py-2 rounded-lg shadow-lg text-center font-semibold text-xs ${
            disconnectRemaining <= 10 ? 'bg-red-500 text-white animate-pulse' :
            'bg-blue-400 text-white'
          }`}>
            Opponent disconnected: {disconnectRemaining}s
          </div>
        </div>
      )}
    </div>
  );
};
