// Game over screen — shown when a pool game ends.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type PoolGameOverData, type RematchStatus } from '../../../types/pool.types';

interface GameOverScreenProps {
  gameOver: PoolGameOverData;
  stakeAmount: number;
  rematchStatus?: RematchStatus;
  onRematch?: () => void;
  onRematchAccept?: () => void;
}

const STYLES = `
@keyframes cardIn {
  0%   { opacity: 0; transform: scale(0.88) translateY(24px); }
  100% { opacity: 1; transform: scale(1)    translateY(0); }
}
@keyframes floatIcon {
  0%, 100% { transform: translateY(0px) scale(1); }
  50%       { transform: translateY(-10px) scale(1.04); }
}
@keyframes glowGold {
  0%, 100% { box-shadow: 0 0 24px 6px rgba(251,191,36,0.45), 0 0 80px 20px rgba(251,191,36,0.12); }
  50%       { box-shadow: 0 0 40px 10px rgba(251,191,36,0.75), 0 0 120px 40px rgba(251,191,36,0.22); }
}
@keyframes glowRed {
  0%, 100% { box-shadow: 0 0 20px 4px rgba(239,68,68,0.35), 0 0 60px 12px rgba(239,68,68,0.10); }
  50%       { box-shadow: 0 0 36px 8px rgba(239,68,68,0.60), 0 0 100px 24px rgba(239,68,68,0.18); }
}
@keyframes shimmer {
  0%   { background-position: -300% center; }
  100% { background-position:  300% center; }
}
@keyframes slideUp {
  0%   { opacity: 0; transform: translateY(16px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes popIn {
  0%   { opacity: 0; transform: scale(0.6); }
  60%  {             transform: scale(1.08); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes sparkle {
  0%        { opacity: 0; transform: scale(0) rotate(0deg); }
  40%, 60%  { opacity: 1; transform: scale(1) rotate(180deg); }
  100%      { opacity: 0; transform: scale(0.5) rotate(360deg); }
}
@keyframes beamRotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;

const SPARKLE_POSITIONS = [
  { top: '8%',  left: '12%', delay: '0.0s', size: 14 },
  { top: '6%',  left: '72%', delay: '0.4s', size: 11 },
  { top: '28%', left: '4%',  delay: '0.8s', size: 9  },
  { top: '22%', left: '84%', delay: '0.2s', size: 13 },
  { top: '52%', left: '8%',  delay: '0.6s', size: 8  },
  { top: '48%', left: '88%', delay: '1.0s', size: 10 },
];

function StarSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2L13.8 8.6H20.6L15 12.7L16.8 19.3L12 15.2L7.2 19.3L9 12.7L3.4 8.6H10.2L12 2Z"
        fill="#fbbf24"
      />
    </svg>
  );
}

function TrophySVG() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="tg1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#fef3c7" />
          <stop offset="45%"  stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id="tg2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#fde68a" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      {/* Cup body */}
      <path d="M18 6 H46 V36 C46 48 38 54 32 56 C26 54 18 48 18 36 Z" fill="url(#tg1)" />
      {/* Left handle */}
      <path d="M18 10 H10 C10 26 16 32 18 32" fill="none" stroke="url(#tg2)" strokeWidth="3.5" strokeLinecap="round" />
      {/* Right handle */}
      <path d="M46 10 H54 C54 26 48 32 46 32" fill="none" stroke="url(#tg2)" strokeWidth="3.5" strokeLinecap="round" />
      {/* Stem */}
      <rect x="28" y="56" width="8"  height="5" rx="1.5" fill="url(#tg2)" />
      {/* Base */}
      <rect x="22" y="61" width="20" height="3" rx="1.5" fill="url(#tg2)" />
      {/* Inner star */}
      <path d="M32 18 L33.5 23 L38.5 23 L34.5 26.5 L36 31.5 L32 28 L28 31.5 L29.5 26.5 L25.5 23 L30.5 23 Z"
        fill="rgba(255,255,255,0.88)" />
      {/* Shine */}
      <ellipse cx="25" cy="16" rx="3.5" ry="5.5" fill="rgba(255,255,255,0.22)" transform="rotate(-15 25 16)" />
    </svg>
  );
}

function EightBallSVG() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <defs>
        <radialGradient id="bg1" cx="38%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#374151" />
          <stop offset="55%"  stopColor="#111827" />
          <stop offset="100%" stopColor="#030712" />
        </radialGradient>
        <radialGradient id="shine1" cx="30%" cy="28%" r="50%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#bg1)" />
      <circle cx="32" cy="32" r="30" fill="url(#shine1)" />
      {/* White circle */}
      <circle cx="32" cy="30" r="13" fill="white" />
      {/* 8 */}
      <text x="32" y="36" textAnchor="middle" fill="#111827"
        fontSize="16" fontWeight="800" fontFamily="Arial, sans-serif">8</text>
      {/* Gloss */}
      <ellipse cx="24" cy="22" rx="6" ry="4" fill="rgba(255,255,255,0.12)" transform="rotate(-20 24 22)" />
    </svg>
  );
}

/** Countdown seconds remaining until expiresAt. */
function useCountdown(expiresAt: string | undefined): number {
  const [seconds, setSeconds] = useState(() =>
    expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)) : 0
  );
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [expiresAt]);
  return seconds;
}

export default function GameOverScreen({
  gameOver,
  stakeAmount,
  rematchStatus = { status: 'idle' },
  onRematch,
  onRematchAccept,
}: GameOverScreenProps) {
  const navigate = useNavigate();
  const youWon = gameOver.isWinner;
  const [accepting, setAccepting] = useState(false);
  const winnings = Math.round((stakeAmount || 1000) * 2 * 0.85);

  const inviteExpiresAt = rematchStatus.status === 'incoming_invite' ? rematchStatus.expiresAt : undefined;
  const waitExpiresAt  = rematchStatus.status === 'waiting_opponent' ? rematchStatus.expiresAt : undefined;
  const inviteCountdown = useCountdown(inviteExpiresAt);
  const waitCountdown   = useCountdown(waitExpiresAt);

  const howLabel = (() => {
    if (youWon) {
      switch (gameOver.winType) {
        case 'pocket_8':    return '🎱 8-Ball Pocketed';
        case 'illegal_8ball': return '⚠️ Opponent Fouled';
        case 'concede':     return '🏳️ Opponent Conceded';
        case 'forfeit':     return '⏱️ Opponent Forfeited';
        default:            return gameOver.winType;
      }
    } else {
      switch (gameOver.winType) {
        case 'pocket_8':    return '🎱 Opponent Pocketed 8-Ball';
        case 'illegal_8ball': return '⚠️ Illegal 8-Ball Foul';
        case 'concede':     return '🏳️ You Conceded';
        case 'forfeit':     return '⏱️ You Forfeited';
        default:            return gameOver.winType;
      }
    }
  })();

  const accent   = youWon ? '#f59e0b' : '#ef4444';
  const accentLo = youWon ? 'rgba(251,191,36,0.18)' : 'rgba(239,68,68,0.14)';
  const accentBorder = youWon ? 'rgba(251,191,36,0.35)' : 'rgba(239,68,68,0.30)';

  // Derive rematch button label + action
  const rematchDisabled =
    rematchStatus.status === 'requesting' ||
    rematchStatus.status === 'waiting_opponent';

  const rematchLabel = (() => {
    switch (rematchStatus.status) {
      case 'requesting':      return 'Sending...';
      case 'waiting_opponent': return `Waiting... ${waitCountdown}s`;
      default:                return 'Rematch';
    }
  })();

  return (
    <>
      <style>{STYLES}</style>

      {/* Full-page backdrop */}
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflow: 'auto',
        background: youWon
          ? 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(120,80,0,0.45) 0%, #08100f 100%)'
          : 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(100,10,10,0.50) 0%, #080c18 100%)',
        position: 'relative',
      }}>

        {/* Subtle rotating beam (win only) */}
        {youWon && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: `conic-gradient(from 0deg at 50% 30%,
              transparent 0deg,
              rgba(251,191,36,0.04) 40deg,
              transparent 80deg,
              rgba(251,191,36,0.03) 130deg,
              transparent 180deg,
              rgba(251,191,36,0.04) 220deg,
              transparent 260deg,
              rgba(251,191,36,0.03) 310deg,
              transparent 360deg)`,
            animation: 'beamRotate 12s linear infinite',
            pointerEvents: 'none',
          }} />
        )}

        {/* Card */}
        <div style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: '380px',
          borderRadius: '24px',
          border: `1px solid ${accentBorder}`,
          background: 'rgba(12, 16, 30, 0.82)',
          backdropFilter: 'blur(20px)',
          padding: '40px 28px 32px',
          textAlign: 'center',
          animation: 'cardIn 0.55s cubic-bezier(0.34, 1.45, 0.64, 1) both',
          overflow: 'hidden',
        }}>

          {/* Card inner glow */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: '24px',
            background: `radial-gradient(ellipse 70% 40% at 50% 0%, ${accentLo} 0%, transparent 70%)`,
          }} />

          {/* Sparkles (win only) */}
          {youWon && SPARKLE_POSITIONS.map((s, i) => (
            <div key={i} style={{
              position: 'absolute',
              top: s.top, left: s.left,
              animation: `sparkle 2.4s ease-in-out ${s.delay} infinite`,
              zIndex: 0,
            }}>
              <StarSVG size={s.size} />
            </div>
          ))}

          {/* --- Icon --- */}
          <div style={{ position: 'relative', zIndex: 1, marginBottom: '22px' }}>
            <div style={{
              width: 96, height: 96,
              borderRadius: '50%',
              margin: '0 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: accentLo,
              border: `1.5px solid ${accentBorder}`,
              animation: youWon
                ? 'floatIcon 2.2s ease-in-out infinite, glowGold 2.2s ease-in-out infinite'
                : 'glowRed 3s ease-in-out infinite',
            }}>
              {youWon ? <TrophySVG /> : <EightBallSVG />}
            </div>
          </div>

          {/* --- Title --- */}
          <div style={{ position: 'relative', zIndex: 1, marginBottom: '10px' }}>
            {youWon ? (
              <h1 style={{
                margin: 0,
                fontSize: '52px',
                fontWeight: 900,
                letterSpacing: '4px',
                textTransform: 'uppercase',
                background: 'linear-gradient(90deg, #fef3c7 0%, #f59e0b 30%, #fde68a 50%, #f59e0b 70%, #fef3c7 100%)',
                backgroundSize: '300% auto',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                animation: 'shimmer 4s linear infinite',
                lineHeight: 1.05,
              }}>
                WIN
              </h1>
            ) : (
              <h1 style={{
                margin: 0,
                fontSize: '46px',
                fontWeight: 900,
                letterSpacing: '4px',
                textTransform: 'uppercase',
                color: '#ef4444',
                lineHeight: 1.05,
                textShadow: '0 0 30px rgba(239,68,68,0.5)',
              }}>
                DEFEAT
              </h1>
            )}
          </div>

          {/* --- How label --- */}
          <div style={{ marginBottom: '24px', animation: 'slideUp 0.4s ease 0.25s both' }}>
            <span style={{
              display: 'inline-block',
              padding: '5px 14px',
              borderRadius: '99px',
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.3px',
              background: accentLo,
              border: `1px solid ${accentBorder}`,
              color: youWon ? '#fde68a' : '#fca5a5',
            }}>
              {howLabel}
            </span>
          </div>

          {/* --- Result box --- */}
          <div style={{ marginBottom: '28px', animation: 'popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.4s both' }}>
            {youWon ? (
              <div style={{
                borderRadius: '16px',
                padding: '20px 16px',
                background: 'rgba(16,185,129,0.10)',
                border: '1px solid rgba(16,185,129,0.28)',
              }}>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', marginBottom: '6px', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  You earned
                </div>
                <div style={{
                  fontSize: '40px',
                  fontWeight: 800,
                  color: '#10b981',
                  lineHeight: 1,
                  marginBottom: '4px',
                  textShadow: '0 0 20px rgba(16,185,129,0.5)',
                }}>
                  +{winnings.toLocaleString()}
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(16,185,129,0.75)', letterSpacing: '1px' }}>
                  UGX
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.28)', marginTop: '8px' }}>
                  After 15% tax deduction
                </div>
              </div>
            ) : (
              <div style={{
                borderRadius: '16px',
                padding: '20px 16px',
                background: 'rgba(239,68,68,0.07)',
                border: '1px solid rgba(239,68,68,0.20)',
              }}>
                <div style={{ fontSize: '36px', marginBottom: '10px' }}>😤</div>
                <p style={{
                  margin: 0,
                  color: 'rgba(255,255,255,0.55)',
                  fontSize: '14px',
                  fontWeight: 500,
                  lineHeight: 1.5,
                }}>
                  Every champion lost before they won.<br />
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px' }}>Challenge them again.</span>
                </p>
              </div>
            )}
          </div>

          {/* --- Rematch status banners --- */}
          {rematchStatus.status === 'failed' && (
            <div style={{
              marginBottom: '12px',
              padding: '10px 14px',
              borderRadius: '10px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.30)',
              fontSize: '13px',
              color: '#fca5a5',
            }}>
              {rematchStatus.message}
            </div>
          )}
          {rematchStatus.status === 'expired' && (
            <div style={{
              marginBottom: '12px',
              padding: '10px 14px',
              borderRadius: '10px',
              background: 'rgba(156,163,175,0.10)',
              border: '1px solid rgba(156,163,175,0.20)',
              fontSize: '13px',
              color: 'rgba(255,255,255,0.45)',
            }}>
              Opponent didn't respond in time
            </div>
          )}

          {/* --- Incoming invite overlay --- */}
          {rematchStatus.status === 'incoming_invite' && (
            <div style={{
              marginBottom: '16px',
              padding: '16px',
              borderRadius: '14px',
              background: 'rgba(59,130,246,0.12)',
              border: '1px solid rgba(59,130,246,0.30)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)', marginBottom: '4px' }}>
                Rematch invite
              </div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>
                {rematchStatus.fromName} wants a rematch
              </div>
              <div style={{ fontSize: '13px', color: 'rgba(147,197,253,0.85)', marginBottom: '12px' }}>
                {rematchStatus.stake.toLocaleString()} UGX • {inviteCountdown}s remaining
              </div>
              <button
                onClick={() => { setAccepting(true); onRematchAccept?.(); }}
                disabled={accepting}
                style={{
                  width: '100%',
                  padding: '11px 0',
                  borderRadius: '10px',
                  border: '1px solid rgba(59,130,246,0.50)',
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.35), rgba(37,99,235,0.35))',
                  color: '#93c5fd',
                  fontSize: '13px',
                  fontWeight: 700,
                  letterSpacing: '0.8px',
                  textTransform: 'uppercase',
                  cursor: accepting ? 'default' : 'pointer',
                  opacity: accepting ? 0.5 : 1,
                }}
              >
                {accepting ? 'Joining...' : 'Accept Rematch'}
              </button>
            </div>
          )}

          {/* --- Buttons --- */}
          <div style={{
            display: 'flex',
            gap: '10px',
            animation: 'slideUp 0.4s ease 0.6s both',
          }}>
            <button
              onClick={() => navigate('/')}
              style={{
                flex: 1,
                padding: '13px 0',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.10)',
                background: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.70)',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.11)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            >
              Home
            </button>
            {/* Only show Rematch button when not showing the incoming invite panel */}
            {rematchStatus.status !== 'incoming_invite' && (
              <button
                onClick={onRematch}
                disabled={rematchDisabled || !onRematch}
                style={{
                  flex: 1,
                  padding: '13px 0',
                  borderRadius: '12px',
                  border: `1px solid ${accentBorder}`,
                  background: youWon
                    ? 'linear-gradient(135deg, rgba(245,158,11,0.28), rgba(180,83,9,0.28))'
                    : 'linear-gradient(135deg, rgba(239,68,68,0.28), rgba(153,27,27,0.28))',
                  color: rematchDisabled ? 'rgba(255,255,255,0.35)' : accent,
                  fontSize: '13px',
                  fontWeight: 700,
                  letterSpacing: '0.8px',
                  textTransform: 'uppercase',
                  cursor: rematchDisabled ? 'default' : 'pointer',
                  textShadow: rematchDisabled ? 'none' : `0 0 12px ${accentLo}`,
                  opacity: rematchDisabled ? 0.6 : 1,
                }}
                onMouseEnter={e => { if (!rematchDisabled) e.currentTarget.style.opacity = '0.8'; }}
                onMouseLeave={e => { if (!rematchDisabled) e.currentTarget.style.opacity = '1'; }}
              >
                {rematchLabel}
              </button>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
