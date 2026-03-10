// Pool game page — mobile-first layout with 8 Ball Pool style UI.

import { useEffect, useState, useCallback, useRef } from 'react';

import { useTouchDevice } from '../hooks/useTouchDevice';
import { usePoolGameState } from '../hooks/usePoolGameState';
import { usePoolWebSocket } from '../hooks/usePoolWebSocket';
import { PoolWSMessage, type RematchStatus } from '../types/pool.types';
import { ShotAnimator, type BallFrame, type PocketEvent } from '../game/pool/ShotAnimator';
import { loadPoolAssets, PoolAssets } from '../game/pool/AssetLoader';
import { SoundManager } from '../game/pool/SoundManager';
import { updateBallRotation } from '../game/pool/BallRenderer';
import PoolCanvas, { PoolCanvasHandle } from '../game/pool/PoolCanvas';
import PowerBar from '../game/pool/PowerBar';
import { type ShotParams, type PocketingAnim } from '../game/pool/types';
import { physToCanvas, canvasToPhys } from '../game/pool/canvasLayout';
import PlayerBar from '../game/pool/PlayerBar';
import SpinSetter from '../game/pool/SpinSetter';
import FoulNotification from '../game/pool/FoulNotification';
import GameOverScreen from '../game/pool/ui/GameOverScreen';
import PocketedRail from '../game/pool/PocketedRail';

const SHOT_TIMER_FALLBACK_SECONDS = 30;

export const PoolGamePage: React.FC = () => {

  const [assets, setAssets] = useState<PoolAssets | null>(null);
  const [assetsError, setAssetsError] = useState(false);
  const aimAngleRef = useRef(0);
  const poolCanvasRef = useRef<PoolCanvasHandle>(null);
  const [tokensReady, setTokensReady] = useState(false);
  const [resolvedGameToken, setResolvedGameToken] = useState('');
  const [resolvedPlayerToken, setResolvedPlayerToken] = useState('');
  const [gameStarted, setGameStarted] = useState(false);
  const [gameCancelled, setGameCancelled] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [foulMessage, setFoulMessage] = useState<string | null>(null);
  const [isFoul, setIsFoul] = useState(false);
  const [notifPocketedBalls, setNotifPocketedBalls] = useState<number[] | null>(null);
  const [screw, setScrew] = useState(0);
  const [english, setEnglish] = useState(0);
  const showGuideLine = true; // guide line always on (toggle hidden)
  const [pocketingBalls, setPocketingBalls] = useState<PocketingAnim[]>([]);
  const [isPortrait, setIsPortrait] = useState(window.innerHeight > window.innerWidth);
  const isTouchDevice = useTouchDevice();
  // treat touch devices as touch-enabled immediately on load (no need to wait for first touch)
  const [touchedOnce, setTouchedOnce] = useState(isTouchDevice);
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

  // incremented whenever a scratch occurs (for resetting ghost position)
  const [scratchCount, setScratchCount] = useState(0);

  // Shot timer state
  const [shotTimer, setShotTimer] = useState<number | null>(null);
  const shotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Disconnect state
  const [disconnectRemaining, setDisconnectRemaining] = useState<number | null>(null);
  const [rematchStatus, setRematchStatus] = useState<RematchStatus>({ status: 'idle' });

  // Pocketed ball rail — ordered list of ball IDs as they fall in (oldest first)
  const [pocketedOrder, setPocketedOrder] = useState<number[]>([]);

  const urlParams = new URLSearchParams(window.location.search);
  const playerToken = urlParams.get('pt');
  const gameTokenMatch = window.location.pathname.match(/\/g\/([^/?]+)/);
  const gt = gameTokenMatch?.[1] || '';

  const { gameState, gameOver, updateFromWSMessage, applyShotResult, setBallPositions, updateCueBall, setTokens } = usePoolGameState();
  const [localBallInHand, setLocalBallInHand] = useState(false);
  // tracks whether we have already placed the cue ball during the current
  // break shot — once placed the derived ball-in-hand condition must stay
  // false so the cue stick appears and the player can actually shoot.
  const [breakBallPlaced, setBreakBallPlaced] = useState(false);
  // derived ball-in-hand flag used throughout this component and passed to PoolCanvas
  const ballInHand = gameState.ballInHand || localBallInHand || (gameState.isBreakShot && gameState.myTurn && !breakBallPlaced);

  // reset breakBallPlaced whenever isBreakShot changes (new game → true resets
  // any stale value from the previous game; break done → false is also fine)
  useEffect(() => {
    setBreakBallPlaced(false);
  }, [gameState.isBreakShot]);
  // opponent's cue ball position streamed in real-time during their ball-in-hand
  const [opponentBallInHandPos, setOpponentBallInHandPos] = useState<{ x: number; y: number } | null>(null);
  const cueBallMoveThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref for streaming opponent's live cue-aim angle+power to the ghost cue renderer.
  // Using a ref (not state) avoids recreating the RAF draw loop on every update.
  const opponentAimRef = useRef<{ angle: number; power: number } | null>(null);
  const cueAimThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the cue ball position set by handlePlaceCueBall so handleTakeShot
  // always uses the correct physics origin even when the React closure is stale
  // (race: auto-place + shot fire synchronously before React re-renders).
  const pendingCueBallRef = useRef<{ x: number; y: number } | null>(null);

  // When ball-in-hand ends without a shot, discard any pending cue position so
  // it does not override gameState.balls[0] on a later non-ball-in-hand shot.
  useEffect(() => {
    if (!ballInHand) {
      pendingCueBallRef.current = null;
    }
  }, [ballInHand]);

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
          console.log('[Shot] shot_complete', {
            firstContactBallId: cd.firstContactBallId,
            pocketedBalls: cd.pocketedBalls,
            cushionAfterContact: cd.cushionAfterContact,
            breakCushionCount: cd.breakCushionBallIds.size,
          });
          sendWSMessageRef.current({
            type: 'shot_complete',
            data: {
              pocketed_balls: cd.pocketedBalls,
              first_contact_ball_id: cd.firstContactBallId,
              cushion_after_contact: cd.cushionAfterContact,
              break_cushion_count: cd.breakCushionBallIds.size,
            },
          });
        }
      },
      (event) => {
        soundRef.current?.playCollision(event);

        if (isMyShotRef.current) {
          console.log('[Shot] onCollision event:', event.type, 'ballId:', event.ballId, 'targetId:', event.targetId);
          const cd = collisionDataRef.current;
          if (event.type === 'pocket') {
            cd.pocketedBalls.push(event.ballId);
          } else if (event.type === 'ball' && event.ballId === 0 && !cd.ballContactMade) {
            console.log('[Shot] first ball contact: cue -> ball', event.targetId);
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
      // Add to rail (skip cue ball — it comes back into play)
      if (evt.ballId !== 0) {
        setPocketedOrder(prev => [...prev, evt.ballId]);
      }
    });
  }

  // Initialize sound manager when assets load
  useEffect(() => {
    if (assets && !soundRef.current) {
      soundRef.current = new SoundManager(assets);
    }
  }, [assets]);

  // --- Shot timer: 30s countdown when it's a player's turn ---
  const startShotTimer = useCallback((expiresAt: string | null) => {
    if (shotTimerRef.current) clearInterval(shotTimerRef.current);
    // Seed from the server's authoritative expiry timestamp so both players
    // count down from the same clock. Fall back to the constant if not yet set.
    const initialSeconds = expiresAt
      ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
      : SHOT_TIMER_FALLBACK_SECONDS;
    setShotTimer(initialSeconds);
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

  // Start/restart timer when *my* turn begins; stop when it ends or animation/game stops.
  // Pass the server's turnExpiresAt so the display is seeded from the authoritative clock.
  useEffect(() => {
    if (gameStarted && gameState.myTurn && !animating && !gameOver) {
      startShotTimer(gameState.turnExpiresAt);
    } else {
      stopShotTimer();
    }
    return () => stopShotTimer();
  }, [gameState.myTurn, gameState.turnExpiresAt, gameStarted, animating, gameOver, startShotTimer, stopShotTimer]);

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

  // When a scratch occurs the cue ball ends up inactive (pocketed).
  // Once animation finishes and ball-in-hand is active, restore ball 0 to
  // the head-string so the player can see and pick it up.
  useEffect(() => {
    if (animating || !ballInHand) return;
    const cb = gameState.balls.find(b => b.id === 0);
    if (!cb || cb.active) return;
    // Only modify ball 0 — updateCueBall reads from reducer state so it can never
    // spread stale non-cue ball positions from a closure capture.
    updateCueBall(-34500, 0, true);
  }, [animating, ballInHand, gameState.balls, updateCueBall]);



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
        setPocketedOrder([]);
        if (message.breaker) {
          const iBreak = message.breaker === gameState.playerId;
          setFoulMessage(iBreak ? 'You won the coin toss — you break!' : 'Opponent won the coin toss — they break!');
          setIsFoul(false);
        }
        break;

      case 'game_state':
        updateFromWSMessage(message);
        // reset per-game client state on (re)connect or new game
        setLocalBallInHand(false);
        setBreakBallPlaced(false);
        setOpponentBallInHandPos(null);
        opponentAimRef.current = null;
        // Reconstruct pocketed rail from ball state (order unknown — sort by id)
        if (message.balls) {
          setPocketedOrder(
            message.balls.filter(b => b.id !== 0 && !b.active).map(b => b.id).sort((a, b) => a - b)
          );
        }
        // Always mark started — game_state is only sent after the game has been initialised.
        setGameStarted(true);
        break;

      case 'game_update':
        // Balls are omitted from game_update — clients own positions via physics.
        // Full ball state only arrives in game_state (connect / reconnect).
        updateFromWSMessage(message);
        break;

      case 'shot_relay': {
        // Opponent fired — stop showing their ghost cue immediately.
        opponentAimRef.current = null;
        const relayParams = message.shot_params;
        if (relayParams) {
          // Use the shooter's ball snapshot if provided — this guarantees both
          // clients seed PhysicsEngine from the exact same starting state.
          // Fall back to local gameState.balls only if the snapshot is missing
          // (e.g. old server version or unexpected message format).
          const relayBalls = message.balls && message.balls.length > 0
            ? message.balls
            : gameState.balls;
          setAnimating(true);
          soundRef.current?.resumeAudioContext();
          animatorRef.current?.start(
            relayBalls,
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

        // Always sync localBallInHand from shot_result. Setting it only when
        // true caused a stale true to persist when a ball-in-hand turn timed
        // out and the turn passed back to the opponent (double-timeout bug).
        setLocalBallInHand(!!message.ball_in_hand && message.next_turn === gameState.playerId);
        // Clear any lingering opponent ball-in-hand ghost (e.g. opponent timed
        // out mid-drag without placing — ball_placed never fires to clear it).
        setOpponentBallInHandPos(null);

        // track scratches so the canvas can reposition the ghost for cases
        // where the player already had ball-in-hand when they scratched again
        if (message.foul && message.foul.type === 'scratch') {
          setScratchCount(prev => prev + 1);
        }

        if (message.foul) {
          setFoulMessage(message.foul.message);
          setIsFoul(true);
          setNotifPocketedBalls(null);
        } else if (message.pocketed_balls && message.pocketed_balls.length > 0) {
          const pocketed = message.pocketed_balls.filter(id => id !== 0);
          if (pocketed.length > 0) {
            setNotifPocketedBalls(pocketed);
            setFoulMessage('pocketed');
            setIsFoul(false);
          }
        }

        applyShotResult(message);
        break;
      }

      case 'cue_ball_move':
        // opponent is dragging their cue ball — clear any stale ghost cue aim
        // data so the ghost cue doesn't linger at the old ball position.
        opponentAimRef.current = null;
        // update position in real-time
        if (message.x !== undefined && message.y !== undefined) {
          setOpponentBallInHandPos({ x: message.x, y: message.y });
        }
        break;

      case 'cue_aim':
        // opponent is aiming — update their ghost cue angle+power in real-time
        if (message.aim_angle !== undefined && message.aim_power !== undefined) {
          opponentAimRef.current = { angle: message.aim_angle, power: message.aim_power };
        }
        break;

      case 'ball_placed':
        // game_update no longer carries ball positions — apply the placed cue
        // ball directly here for both players. updateCueBall only touches ball 0
        // so it cannot spread stale non-cue ball positions from a closure capture.
        if (message.x !== undefined && message.y !== undefined) {
          updateCueBall(message.x, message.y, true);
        }
        setOpponentBallInHandPos(null);
        break;

      case 'player_connected':
        setDisconnectRemaining(null);
        break;

      case 'player_disconnected':
        if (message.grace_seconds) {
          setDisconnectRemaining(message.grace_seconds);
        }
        break;

      case 'player_conceded':
        updateFromWSMessage(message);
        break;

      case 'sync_request':
        // Server asks us to relay our live physics state to a reconnecting opponent.
        // We respond with our current ball positions; the server forwards them.
        if (message.target) {
          sendWSMessageRef.current({
            type: 'sync_response',
            data: {
              target: message.target,
              balls: gameState.balls,
            },
          });
          console.log('[Pool] sync_request received — relaying', gameState.balls.length, 'balls to', message.target);
        }
        break;

      case 'sync_response':
        // Server forwarded the opponent's live physics state after our reconnect.
        // Seed the renderer so the next shot starts from the correct positions.
        if (message.balls && message.balls.length > 0) {
          setBallPositions(message.balls);
          setGameStarted(true); // ensure game shows even if game_state had no balls
          console.log('[Pool] sync_response received — seeded', message.balls.length, 'balls');
        }
        break;

      case 'game_cancelled':
        // Both players disconnected — server cancelled the game and refunded stakes.
        setGameCancelled(true);
        break;

      case 'rematch_pending':
        // Server confirmed our rematch request was sent to opponent.
        setRematchStatus({ status: 'waiting_opponent', expiresAt: message.expires_at ?? '' });
        break;

      case 'rematch_invite':
        // Opponent wants a rematch — show the accept panel.
        console.log('[Rematch] rematch_invite received', message);
        setRematchStatus({
          status: 'incoming_invite',
          fromName: message.from_name ?? 'Opponent',
          stake: message.stake ?? 0,
          expiresAt: message.expires_at ?? '',
        });
        break;

      case 'rematch_ready': {
        // New game created — do a full page reload to ensure clean state.
        // Using navigate() keeps the same component instance (gameOver persists).
        const link = message.game_link ?? '';
        if (link.startsWith('http')) {
          const url = new URL(link);
          window.location.href = url.pathname + url.search;
        } else {
          window.location.href = link;
        }
        break;
      }

      case 'rematch_failed':
        setRematchStatus({ status: 'failed', message: message.message ?? 'Rematch failed' });
        break;

      case 'rematch_expired':
        setRematchStatus({ status: 'expired' });
        break;

      case 'error':
        console.error('[Pool] Error:', message.message);
        break;
    }
  }, [updateFromWSMessage, applyShotResult, updateCueBall, setBallPositions, gameState.balls, animating]);

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

    // If handlePlaceCueBall was called synchronously before this (same rAF tick,
    // before React re-renders), the closure's gameState.balls[0] may still hold
    // the old position. Override cue ball position with the pending placed position
    // so physics starts from the correct location and avoids a false no_contact foul.
    let ballsForShot = gameState.balls;
    if (pendingCueBallRef.current) {
      const { x, y } = pendingCueBallRef.current;
      pendingCueBallRef.current = null;
      ballsForShot = ballsForShot.map(b => b.id === 0 ? { ...b, x, y, active: true } : b);
    }

    const cueBallDebug = ballsForShot.find(b => b.id === 0);
    console.log('[Shot] handleTakeShot', {
      cueBall: cueBallDebug ? { x: cueBallDebug.x.toFixed(0), y: cueBallDebug.y.toFixed(0), active: cueBallDebug.active } : null,
      ballCount: ballsForShot.length,
      usedPending: ballsForShot !== gameState.balls,
    });
    sendWSMessage({ type: 'take_shot', data: { ...fullParams, balls: ballsForShot } });
    soundRef.current?.playCueStrike();

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
    soundRef.current?.resumeAudioContext();
    animatorRef.current?.start(
      ballsForShot,
      fullParams,
    );
  }, [sendWSMessage, screw, english, gameState.balls]);

  const handleAimChanged = useCallback((angle: number, power: number) => {
    // throttle to ~50 ms — smooth enough for a ghost cue without flooding the socket
    if (cueAimThrottleRef.current) return;
    cueAimThrottleRef.current = setTimeout(() => {
      cueAimThrottleRef.current = null;
    }, 50);
    sendWSMessage({ type: 'cue_aim', data: { angle, power } });
  }, [sendWSMessage]);

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
    // Optimistically move ball 0 to the placed position without waiting for the
    // server game_update round-trip. updateCueBall only touches ball 0 inside
    // the reducer, so it cannot spread stale non-cue ball positions.
    updateCueBall(x, y, true);
    // Also record the position in a ref so handleTakeShot can use it even if
    // it fires in the same synchronous call stack (before React re-renders).
    pendingCueBallRef.current = { x, y };
  }, [sendWSMessage, updateCueBall]);


  const handleConcede = useCallback(() => {
    if (confirm('Are you sure you want to concede?')) {
      sendWSMessage({ type: 'concede', data: {} });
    }
  }, [sendWSMessage]);

  // Lock body scroll while on game page
  useEffect(() => {
    document.body.classList.add('game-active');
    return () => document.body.classList.remove('game-active');
  }, []);

  // Keep screen awake during the game (works in PWA / Chrome Android)
  useEffect(() => {
    let wakeLock: any = null;
    const acquire = async () => {
      try { wakeLock = await (navigator as any).wakeLock?.request('screen'); } catch {}
    };
    acquire();
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      wakeLock?.release();
    };
  }, []);

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
    return (
      <GameOverScreen
        gameOver={gameOver}
        stakeAmount={gameState.stakeAmount}
        rematchStatus={rematchStatus}
        onRematch={() => {
          setRematchStatus({ status: 'requesting' });
          sendWSMessageRef.current({ type: 'rematch_request', data: {} });
        }}
        onRematchAccept={() => {
          sendWSMessageRef.current({ type: 'rematch_accept', data: {} });
        }}
      />
    );
  }

  // Both players disconnected — game cancelled, stakes refunded
  if (gameCancelled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0e1628]">
        <div className="text-center text-white max-w-sm px-6">
          <div className="text-4xl mb-4">↩</div>
          <h2 className="text-xl font-bold mb-2">Game Cancelled</h2>
          <p className="text-gray-400 text-sm mb-6">Both players disconnected. Your stake has been refunded to your account.</p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-semibold transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // 100dvh adjusts dynamically as browser bars show/hide (Chrome 108+, Safari 15.4+)
  // Falls back to --vh CSS var (set by resize effect) for older browsers
  const fullViewport: React.CSSProperties = {
    width: '100dvw',
    height: '100dvh',
    overflow: 'hidden',
    background: '#0e1628',
  };

  // Shared canvas props
  const canvasEl = (
    <PoolCanvas
      ref={poolCanvasRef}
      balls={gameState.balls}
      myTurn={gameState.myTurn}
      ballInHand={ballInHand}
      scratchCount={scratchCount}
      isBreakShot={gameState.isBreakShot}
      myGroup={gameState.myGroup}
      opponentGroup={gameState.opponentGroup}
      animating={animating}
      onTakeShot={handleTakeShot}
      onPlaceCueBall={handlePlaceCueBall}
      onBallInHandPosChanged={handleBallInHandPosChanged}
      opponentCueBallPos={opponentBallInHandPos}
      opponentAimRef={opponentAimRef}
      onAimChanged={handleAimChanged}
      assets={assets}
      showGuideLine={showGuideLine}
      pocketingBalls={pocketingBalls}
      aimAngleRef={aimAngleRef}
      isPortrait={effectiveTouch && isPortrait}
    />
  );

  const spinSetterEl = (
    <SpinSetter
      screw={screw}
      english={english}
      onChange={(s, e) => { setScrew(s); setEnglish(e); }}
      disabled={!gameState.myTurn || animating}
    />
  );

  const playerBarEl = (
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
      spinSetter={spinSetterEl}
      onConcede={handleConcede}
    />
  );

  const disconnectEl = disconnectRemaining !== null ? (
    <div className="fixed top-8 left-1/2 -translate-x-1/2 z-40">
      <div className={`px-3 py-2 rounded-lg shadow-lg text-center font-semibold text-xs ${
        disconnectRemaining <= 10 ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-400 text-white'
      }`}>
        Opponent disconnected: {disconnectRemaining}s
      </div>
    </div>
  ) : null;

  // ── MOBILE LAYOUT (touch devices) ────────────────────────────────────────
  if (effectiveTouch) {
    // The inner game panel — always laid out as landscape (PowerBar | Canvas | Controls)
    const gamePanel = (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0e1628' }}>
        {playerBarEl}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Left — power bar */}
          <PowerBar poolCanvasRef={poolCanvasRef} assets={assets} isPortrait={effectiveTouch && isPortrait} />

          {/* Centre — canvas */}
          <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {canvasEl}
          </div>

          {/* Right — pocketed ball rail */}
          <PocketedRail pocketedOrder={pocketedOrder} />
        </div>
        <FoulNotification message={foulMessage} isFoul={isFoul} pocketedBalls={notifPocketedBalls} />
        {disconnectEl}
      </div>
    );

    if (isPortrait) {
      // CSS-rotate the game 90° so it appears landscape inside the portrait screen.
      // Inner div uses swapped dimensions (100dvh wide × 100dvw tall) so after
      // rotation it fills the portrait viewport exactly — no orientation API needed.
      return (
        <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#0e1628' }}>
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '100dvh',
            height: '100dvw',
            transform: 'translate(-50%, -50%) rotate(90deg)',
          }}>
            {gamePanel}
          </div>
        </div>
      );
    }

    // Already landscape — render directly without rotation
    return (
      <div style={{ ...fullViewport, display: 'flex', flexDirection: 'column' }}>
        {gamePanel}
      </div>
    );
  }

  // ── DESKTOP LAYOUT (mouse / trackpad) ────────────────────────────────────
  return (
    <div className="bg-[#0e1628] flex flex-col overflow-hidden" style={fullViewport}>
      {playerBarEl}

      <div className="flex-1 flex items-center justify-center min-h-0">
        {/* Canvas */}
        <div className="flex-1 min-w-0 h-full flex items-center justify-center">
          {canvasEl}
        </div>

        {/* Right — pocketed ball rail */}
        <PocketedRail pocketedOrder={pocketedOrder} />
      </div>

      <FoulNotification message={foulMessage} isFoul={isFoul} pocketedBalls={notifPocketedBalls} />
      {disconnectEl}
    </div>
  );
};
