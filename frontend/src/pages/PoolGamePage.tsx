// Pool game page — mobile-first layout with 8 Ball Pool style UI.

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTouchDevice } from '../hooks/useTouchDevice';
import { usePoolGameState } from '../hooks/usePoolGameState';
import { usePoolWebSocket } from '../hooks/usePoolWebSocket';
import { PoolWSMessage } from '../types/pool.types';
import { ShotAnimator, type BallFrame, type PocketEvent } from '../game/pool/ShotAnimator';
import { loadPoolAssets, PoolAssets } from '../game/pool/AssetLoader';
import { SoundManager } from '../game/pool/SoundManager';
import { updateBallRotation } from '../game/pool/BallRenderer';
import PoolCanvas, { PoolCanvasHandle } from '../game/pool/PoolCanvas';
import PowerBar from '../game/pool/PowerBar';
import { type ShotParams, type PocketingAnim } from '../game/pool/types';
import { physToCanvas, canvasToPhys } from '../game/pool/canvasLayout';
import PlayerBar from '../game/pool/PlayerBar';
import SideRail from '../game/pool/SideRails';
import SpinSetter from '../game/pool/SpinSetter';
import FoulNotification from '../game/pool/FoulNotification';
import GameOverScreen from '../game/pool/ui/GameOverScreen';

const SHOT_TIMER_SECONDS = 30;

export const PoolGamePage: React.FC = () => {
  const [assets, setAssets] = useState<PoolAssets | null>(null);
  const [assetsError, setAssetsError] = useState(false);
  const aimAngleRef = useRef(0);
  const poolCanvasRef = useRef<PoolCanvasHandle>(null);
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
  const isTouchDevice = useTouchDevice();
  // only treat the session as touch-enabled once we actually see a touch event
  const [touchedOnce, setTouchedOnce] = useState(false);
  useEffect(() => {
    if (touchedOnce) return;
    const handle = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        setTouchedOnce(true);
        window.removeEventListener('pointerdown', handle);
      }
    };
    window.addEventListener('pointerdown', handle);
    return () => window.removeEventListener('pointerdown', handle);
  }, [touchedOnce]);

  // the value actually passed to components; avoids false positives from
  // CSS media or devices with a coarse pointer that aren't really touch
  const effectiveTouch = isTouchDevice && touchedOnce;

  // show overlay prompting rotation when in portrait on touch devices
  const [showRotateOverlay, setShowRotateOverlay] = useState(effectiveTouch && isPortrait);
  // incremented whenever a scratch occurs (for resetting ghost position)
  const [scratchCount, setScratchCount] = useState(0);

  // Shot timer state
  const [shotTimer, setShotTimer] = useState<number | null>(null);
  const shotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Disconnect state
  const [disconnectRemaining, setDisconnectRemaining] = useState<number | null>(null);

  const urlParams = new URLSearchParams(window.location.search);
  const playerToken = urlParams.get('pt');
  const gameTokenMatch = window.location.pathname.match(/\/g\/([^/?]+)/);
  const gt = gameTokenMatch?.[1] || '';

  const { gameState, gameOver, updateFromWSMessage, applyShotResult, setBallPositions, setTokens } = usePoolGameState();
  const [localBallInHand, setLocalBallInHand] = useState(false);
  // tracks whether we have already placed the cue ball during the current
  // break shot — once placed the derived ball-in-hand condition must stay
  // false so the cue stick appears and the player can actually shoot.
  const [breakBallPlaced, setBreakBallPlaced] = useState(false);

  // reset breakBallPlaced whenever isBreakShot changes (new game → true resets
  // any stale value from the previous game; break done → false is also fine)
  useEffect(() => {
    setBreakBallPlaced(false);
  }, [gameState.isBreakShot]);
  // opponent's cue ball position streamed in real-time during their ball-in-hand
  const [opponentBallInHandPos, setOpponentBallInHandPos] = useState<{ x: number; y: number } | null>(null);
  const cueBallMoveThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // after a shot_result we have authoritative local physics positions; skip
  // ball positions from the next game_update to prevent server rollback
  const skipNextBallsUpdateRef = useRef(false);

  // debug logging for ball-in-hand state
  useEffect(() => {
    console.log('[Pool] gameState.ballInHand', gameState.ballInHand, 'ballInHandPlayer', gameState.ballInHandPlayer, 'currentTurn', gameState.currentTurn, 'isBreakShot', gameState.isBreakShot, 'myTurn', gameState.myTurn);
  }, [gameState.ballInHand, gameState.ballInHandPlayer, gameState.currentTurn, gameState.isBreakShot, gameState.myTurn]);

  // Load assets on mount
  useEffect(() => {
    loadPoolAssets().then(setAssets).catch(() => setAssetsError(true));
  }, []);

  // track portrait state and show rotation overlay when appropriate
  useEffect(() => {
    const handler = () => {
      const portrait = window.innerHeight > window.innerWidth;
      setIsPortrait(portrait);
      if (portrait && effectiveTouch) {
        setShowRotateOverlay(true);
      } else {
        setShowRotateOverlay(false);
      }
    };
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    // vh hack for mobile browsers (iOS)
    const setVh = () => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    };
    setVh();
    window.addEventListener('resize', setVh);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
      window.removeEventListener('resize', setVh);
    };
  }, [effectiveTouch]);

  // Sound manager (created once assets load)
  const soundRef = useRef<SoundManager | null>(null);
  const firstHitRef = useRef(false);

  // Collision tracking for shot_complete (client-authoritative physics)
  const isMyShotRef = useRef(false);
  const sendWSMessageRef = useRef<typeof sendWSMessage>(null as any);
  const collisionDataRef = useRef({
    pocketedBalls: [] as number[],
    firstContactBallId: -1,
    cushionAfterContact: false,
    breakCushionBallIds: new Set<number>(),
    ballContactMade: false,
  });

  // Shot animator ref
  const animatorRef = useRef<ShotAnimator | null>(null);
  if (!animatorRef.current) {
    animatorRef.current = new ShotAnimator(
      (balls: BallFrame[]) => {
        for (const b of balls) {
          updateBallRotation(b.id, b.vx, b.vy, b.grip, b.ySpin);
        }
        setBallPositions(balls.map(b => ({ id: b.id, x: b.x, y: b.y, active: b.active })));
      },
      (finalPositions: BallFrame[]) => {
        setBallPositions(finalPositions.map(b => ({ id: b.id, x: b.x, y: b.y, active: b.active })));
        setAnimating(false);

        if (isMyShotRef.current) {
          isMyShotRef.current = false;
          const cd = collisionDataRef.current;
          sendWSMessageRef.current({
            type: 'shot_complete',
            data: {
              ball_positions: finalPositions.map(b => ({ id: b.id, x: b.x, y: b.y, active: b.active })),
              pocketed_balls: cd.pocketedBalls,
              first_contact_ball_id: cd.firstContactBallId,
              cushion_after_contact: cd.cushionAfterContact,
              break_cushion_count: cd.breakCushionBallIds.size,
            },
          });
        }
      },
      (event) => {
        const isFirst = !firstHitRef.current && event.ballId === 0;
        if (isFirst) firstHitRef.current = true;
        soundRef.current?.playCollision(event, isFirst);

        if (isMyShotRef.current) {
          const cd = collisionDataRef.current;
          if (event.type === 'pocket') {
            cd.pocketedBalls.push(event.ballId);
          } else if (event.type === 'ball' && event.ballId === 0 && !cd.ballContactMade) {
            cd.firstContactBallId = event.targetId;
            cd.ballContactMade = true;
          } else if ((event.type === 'line' || event.type === 'vertex') && cd.ballContactMade) {
            cd.cushionAfterContact = true;
            if (event.ballId !== 0) {
              cd.breakCushionBallIds.add(event.ballId);
            }
          } else if ((event.type === 'line' || event.type === 'vertex') && !cd.ballContactMade && event.ballId !== 0) {
            cd.breakCushionBallIds.add(event.ballId);
          }
        }
      },
    );
    animatorRef.current.setOnPocket((evt: PocketEvent) => {
      // use physics position if supplied, otherwise fallback to game state
      let startX: number, startY: number;
      if (evt.ballX !== undefined && evt.ballY !== undefined) {
        [startX, startY] = physToCanvas(evt.ballX, evt.ballY);
      } else {
        const ball = gameState.balls.find(b => b.id === evt.ballId);
        if (!ball) return;
        [startX, startY] = physToCanvas(ball.x, ball.y);
      }
      const [targetX, targetY] = physToCanvas(evt.pocketX, evt.pocketY);
      setPocketingBalls(prev => [...prev, {
        ballId: evt.ballId,
        startX, startY,
        targetX, targetY,
        startTime: performance.now(),
        duration: 350,
      }]);
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

  // --- Shot timer: 30s countdown when it's a player's turn ---
  const startShotTimer = useCallback(() => {
    if (shotTimerRef.current) clearInterval(shotTimerRef.current);
    setShotTimer(SHOT_TIMER_SECONDS);
    shotTimerRef.current = setInterval(() => {
      setShotTimer(prev => {
        if (prev === null || prev <= 1) {
          if (shotTimerRef.current) clearInterval(shotTimerRef.current);
          shotTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopShotTimer = useCallback(() => {
    if (shotTimerRef.current) {
      clearInterval(shotTimerRef.current);
      shotTimerRef.current = null;
    }
    setShotTimer(null);
  }, []);

  // Start/restart timer when *my* turn begins; stop when it ends or animation/game stops
  useEffect(() => {
    if (gameStarted && gameState.myTurn && !animating && !gameOver) {
      startShotTimer();
    } else {
      stopShotTimer();
    }
    return () => stopShotTimer();
  }, [gameState.myTurn, gameStarted, animating, gameOver, startShotTimer, stopShotTimer]);

  // Pause timer during animation
  useEffect(() => {
    if (animating) {
      stopShotTimer();
    }
  }, [animating, stopShotTimer]);

  // Handle timer expiry: send turn_timeout if it's my turn
  useEffect(() => {
    if (shotTimer === 0 && gameState.myTurn && !animating) {
      console.log('[Pool] shot timer expired; sending turn_timeout');
      sendWSMessageRef.current?.({
        type: 'turn_timeout',
        data: {},
      });
      stopShotTimer();
    }
  }, [shotTimer, gameState.myTurn, animating, stopShotTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (shotTimerRef.current) clearInterval(shotTimerRef.current);
    };
  }, []);



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
        updateFromWSMessage(message);
        // reset per-game client state on (re)connect or new game
        setLocalBallInHand(false);
        setBreakBallPlaced(false);
        setOpponentBallInHandPos(null);
        if (message.balls && message.balls.length > 0) setGameStarted(true);
        break;

      case 'game_update': {
        // strip balls from game_update right after a shot so the server can't
        // roll back to pre-shot positions (local physics is the authority)
        const msgToApply = skipNextBallsUpdateRef.current
          ? { ...message, balls: undefined }
          : message;
        skipNextBallsUpdateRef.current = false;
        updateFromWSMessage(msgToApply);
        if (message.balls && message.balls.length > 0) setGameStarted(true);
        break;
      }

      case 'shot_relay': {
        const relayParams = message.shot_params;
        if (relayParams) {
          setAnimating(true);
          firstHitRef.current = false;
          soundRef.current?.resumeAudioContext();
          animatorRef.current?.start(
            gameState.balls,
            { angle: relayParams.angle, power: relayParams.power, screw: relayParams.screw, english: relayParams.english },
          );
        }
        break;
      }

      case 'shot_result': {
        console.log('[Pool] received shot_result', {
          player: message.player,
          pocketed: message.pocketed_balls,
          foul: message.foul?.type,
          ball_in_hand: message.ball_in_hand,
          next_turn: message.next_turn,
        });

        // if the message explains that the *next* turn is ours and we have
        // ball_in_hand, record locally as well. this avoids cases where the
        // reducer state doesn't flip quickly enough.
        if (message.ball_in_hand && message.next_turn === gameState.playerId) {
          setLocalBallInHand(true);
        }

        // track scratches so the canvas can reposition the ghost for cases
        // where the player already had ball-in-hand when they scratched again
        if (message.foul && message.foul.type === 'scratch') {
          setScratchCount(prev => prev + 1);
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
        skipNextBallsUpdateRef.current = true;
        break;
      }

      case 'cue_ball_move':
        // opponent is dragging their cue ball — update position in real-time
        if (message.x !== undefined && message.y !== undefined) {
          setOpponentBallInHandPos({ x: message.x, y: message.y });
        }
        break;

      case 'ball_placed':
        if (message.x !== undefined && message.y !== undefined) {
          const newBalls = gameState.balls.map(b =>
            b.id === 0 ? { ...b, x: message.x!, y: message.y!, active: true } : b
          );
          setBallPositions(newBalls);
        }
        // placement confirmed — stop showing the streamed position
        setOpponentBallInHandPos(null);
        break;

      case 'player_connected':
        break;

      case 'player_disconnected':
        if (message.grace_seconds && message.disconnected_at) {
          setDisconnectRemaining(message.grace_seconds);
        }
        break;

      case 'player_conceded':
      case 'player_forfeit':
        updateFromWSMessage(message);
        break;

      case 'error':
        console.error('[Pool] Error:', message.message);
        break;
    }
  }, [updateFromWSMessage, applyShotResult, setBallPositions, gameState.balls, animating]);

  const { connected, send: sendWSMessage } = usePoolWebSocket({
    gameToken: tokensReady ? resolvedGameToken : '',
    playerToken: tokensReady ? resolvedPlayerToken : '',
    onMessage: handleWSMessage,
    onClose: useCallback(() => console.log('[Pool WS] Disconnected'), []),
    onError: useCallback((e: Event) => console.error('[Pool WS] Error:', e), []),
    autoReconnect: true,
  });

  // Keep sendWSMessage ref current for ShotAnimator onComplete callback
  useEffect(() => {
    sendWSMessageRef.current = sendWSMessage;
  }, [sendWSMessage]);

  const handleTakeShot = useCallback((params: ShotParams) => {
    const fullParams = { angle: params.angle, power: params.power, screw, english };
    sendWSMessage({ type: 'take_shot', data: fullParams });

    // Reset collision tracking for this shot
    isMyShotRef.current = true;
    collisionDataRef.current = {
      pocketedBalls: [],
      firstContactBallId: -1,
      cushionAfterContact: false,
      breakCushionBallIds: new Set(),
      ballContactMade: false,
    };

    // Start local animation immediately
    setAnimating(true);
    firstHitRef.current = false;
    soundRef.current?.resumeAudioContext();
    animatorRef.current?.start(
      gameState.balls,
      fullParams,
    );
  }, [sendWSMessage, screw, english, gameState.balls]);

  const handleBallInHandPosChanged = useCallback((pos: { cx: number; cy: number } | null) => {
    if (!pos) return;
    // throttle to ~100 ms so we don't flood the socket on every pointer move
    if (cueBallMoveThrottleRef.current) return;
    cueBallMoveThrottleRef.current = setTimeout(() => {
      cueBallMoveThrottleRef.current = null;
    }, 100);
    const [px, py] = canvasToPhys(pos.cx, pos.cy);
    sendWSMessage({ type: 'cue_ball_move', data: { x: px, y: py } });
  }, [sendWSMessage]);

  const handlePlaceCueBall = useCallback((x: number, y: number) => {
    sendWSMessage({ type: 'place_cue_ball', data: { x, y } });
    setLocalBallInHand(false);
    setBreakBallPlaced(true);
    // update local physics immediately so the ball visually moves to the placed
    // position without waiting for the server game_update round-trip
    setBallPositions(gameState.balls.map(b => b.id === 0 ? { ...b, x, y, active: true } : b));
  }, [sendWSMessage, gameState.balls, setBallPositions]);


  const handleConcede = useCallback(() => {
    if (confirm('Are you sure you want to concede?')) {
      sendWSMessage({ type: 'concede', data: {} });
    }
  }, [sendWSMessage]);

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
    return <GameOverScreen gameOver={gameOver} stakeAmount={gameState.stakeAmount} />;
  }

  // Layout: full‑viewport game area.
  // We no longer rotate the container; instead we show a prompt when the
  // device is in portrait on touch devices.
  // --vh variable still used to work around mobile viewport height bugs.
  const containerStyle: React.CSSProperties = {
    width: '100vw',
    height: 'calc(var(--vh, 1vh) * 100)',
  };

  // Main game view
  return (
    <div className="bg-[#0e1628] flex flex-col overflow-hidden" style={containerStyle}>
      {/* Portrait rotate hint overlay */}
      {showRotateOverlay && isPortrait && effectiveTouch && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50 pointer-events-none">
          <div className="text-white text-center px-4">
            <svg
              className="w-12 h-12 mx-auto mb-2 animate-spin duration-2000"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="1 4 1 10 7 10" />
              <polyline points="23 20 23 14 17 14" />
            </svg>
            <p className="text-lg font-semibold">Rotate your device</p>
          </div>
        </div>
      )}
      {/* Player bar — 8 Ball Pool style with avatars + timer */}
      <PlayerBar
        myName={gameState.myDisplayName || 'You'}
        opponentName={gameState.opponentDisplayName || 'Opponent'}
        myGroup={gameState.myGroup}
        opponentGroup={gameState.opponentGroup}
        myTurn={gameState.myTurn}
        stakeAmount={gameState.stakeAmount}
        myConnected={gameState.myConnected}
        opponentConnected={gameState.opponentConnected}
        balls={gameState.balls}
        shotTimer={shotTimer}
      />

      {/* Table area with responsive right-side rail */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        {/* left bar (power) — touch only; desktop uses canvas pullback drag */}
        {assets && effectiveTouch && (
          <PowerBar poolCanvasRef={poolCanvasRef} assets={assets} />
        )}

        {/* Pool table canvas — fills available space */}
        <div className="flex-1 min-w-0 h-full flex items-center justify-center">
          <PoolCanvas
            ref={poolCanvasRef}
            balls={gameState.balls}
            myTurn={gameState.myTurn}
            ballInHand={(gameState.ballInHand || localBallInHand || (gameState.isBreakShot && gameState.myTurn && !breakBallPlaced))}
            scratchCount={scratchCount}
            isBreakShot={gameState.isBreakShot}
            myGroup={gameState.myGroup}
            opponentGroup={gameState.opponentGroup}
            animating={animating}
            onTakeShot={handleTakeShot}
            onPlaceCueBall={handlePlaceCueBall}
            onBallInHandPosChanged={handleBallInHandPosChanged}
            opponentCueBallPos={opponentBallInHandPos}
            assets={assets}
            showGuideLine={showGuideLine}
            pocketingBalls={pocketingBalls}
            aimAngleRef={aimAngleRef}
          />
        </div>

        {/* Right-side controls — now part of flex row, not overlay */}
        <div className="flex flex-col items-center gap-1.5 z-10 ml-1">
          <SideRail
            balls={gameState.balls}
            myGroup={gameState.myGroup}
            oppGroup={gameState.opponentGroup}
            side="right"
          />

          <SpinSetter
            screw={screw}
            english={english}
            onChange={(s, e) => { setScrew(s); setEnglish(e); }}
            disabled={!gameState.myTurn || animating}
          />

          <button
            onClick={() => setShowGuideLine(prev => !prev)}
            className={`text-xs font-semibold px-2 py-1 rounded transition-colors duration-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              showGuideLine
                ? 'text-green-400 bg-green-900/40 hover:bg-green-800/60 focus:ring-green-400'
                : 'text-gray-500 bg-gray-800/40 hover:bg-gray-700/60 focus:ring-gray-400'
            }`}
          >
            Guide
          </button>

          <button
            onClick={handleConcede}
            className="text-xs font-semibold px-2 py-1 rounded bg-gray-800/40 text-gray-600 hover:bg-red-800/60 hover:text-red-400 transition-colors duration-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-400"
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
