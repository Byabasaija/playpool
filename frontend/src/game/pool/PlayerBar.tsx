// Top bar with player avatars, circular shot timer, ball indicators, and stake — 8 Ball Pool style.

import { useState, useEffect } from 'react';
import { type BallGroup, type BallState } from './types';

interface PlayerBarProps {
  myName: string;
  opponentName: string;
  myGroup: BallGroup;
  opponentGroup: BallGroup;
  myTurn: boolean;
  stakeAmount: number;
  myConnected: boolean;
  opponentConnected: boolean;
  balls: BallState[];
  shotTimer: number | null; // seconds remaining (null = no timer active)
}

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];
const SHOT_TIMER_MAX = 15;

// guiSolids.png / guiStripes.png: 256x512, 2 columns x 4 rows, 102x102 per frame
const GUI_FRAME_W = 102;
const GUI_FRAME_H = 102;
const GUI_COLS = 2;
const GUI_SHEET_W = 256;
const GUI_SHEET_H = 512;

function BallSprite({ ballId, isSolid, active, size = 16 }: { ballId: number; isSolid: boolean; active: boolean; size?: number }) {
  const frame = isSolid ? ballId - 1 : ballId - 9;
  const col = frame % GUI_COLS;
  const row = Math.floor(frame / GUI_COLS);
  const src = isSolid ? '/pool/img/guiSolids.webp' : '/pool/img/guiStripes.webp';

  const scaleX = size / GUI_FRAME_W;
  const scaleY = size / GUI_FRAME_H;

  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${src})`,
        backgroundSize: `${GUI_SHEET_W * scaleX}px ${GUI_SHEET_H * scaleY}px`,
        backgroundPosition: `${-col * GUI_FRAME_W * scaleX}px ${-row * GUI_FRAME_H * scaleY}px`,
        backgroundRepeat: 'no-repeat',
        opacity: active ? 1 : 0.15,
        borderRadius: '50%',
        flexShrink: 0,
      }}
    />
  );
}

function BallIndicators({ ids, balls, isSolid, size }: { ids: number[]; balls: BallState[]; isSolid: boolean; size: number }) {
  return (
    <div className="flex gap-[2px] items-center">
      {ids.map(id => {
        const active = balls.find(b => b.id === id)?.active ?? true;
        return <BallSprite key={id} ballId={id} isSolid={isSolid} active={active} size={size} />;
      })}
    </div>
  );
}

// Generic placeholder dots when groups not yet assigned
function PlaceholderDots({ count }: { count: number }) {
  return (
    <div className="flex gap-[2px] items-center">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        />
      ))}
    </div>
  );
}

function Avatar({ name, isActive, timer, connected, size = 36 }: {
  name: string;
  isActive: boolean;
  timer: number | null;
  connected: boolean;
  size?: number;
}) {
  const initial = name.charAt(0).toUpperCase();
  // Generate a consistent color from the name
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const bg = `hsl(${hue}, 50%, 35%)`;

  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const timerProgress = timer !== null ? timer / SHOT_TIMER_MAX : 0;
  const dashOffset = circumference * (1 - timerProgress);

  // Timer color: green → yellow → red
  const timerColor = timer !== null
    ? timer > 10 ? '#4ade80' : timer > 5 ? '#facc15' : '#ef4444'
    : '#4ade80';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {/* Avatar circle */}
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.44,
          fontWeight: 700,
          color: '#fff',
          border: isActive ? `2px solid ${timerColor}` : '2px solid rgba(255,255,255,0.15)',
          boxShadow: isActive ? `0 0 8px ${timerColor}40` : 'none',
          transition: 'border-color 0.3s, box-shadow 0.3s',
        }}
      >
        {initial}
      </div>

      {/* Circular timer ring (SVG overlay) */}
      {isActive && timer !== null && (
        <svg
          width={size}
          height={size}
          style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={timerColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
          />
        </svg>
      )}

      {/* Connection indicator dot */}
      <div
        style={{
          position: 'absolute',
          bottom: -1,
          right: -1,
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: connected ? '#4ade80' : '#ef4444',
          border: '1.5px solid #0e1628',
        }}
      />
    </div>
  );
}

export default function PlayerBar({
  myName, opponentName, myGroup, opponentGroup, myTurn,
  stakeAmount, myConnected, opponentConnected, balls, shotTimer,
}: PlayerBarProps) {
  // responsive sizing
  const [winW, setWinW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setWinW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  const small = winW < 480;

  const myBallIds = myGroup === 'SOLIDS' ? SOLIDS : myGroup === 'STRIPES' ? STRIPES : [];
  const myIsSolid = myGroup === 'SOLIDS';
  const oppBallIds = opponentGroup === 'SOLIDS' ? SOLIDS : opponentGroup === 'STRIPES' ? STRIPES : [];
  const oppIsSolid = opponentGroup === 'SOLIDS';
  const groupsAssigned = myGroup !== 'ANY';

  return (
    <div
      className="flex flex-wrap items-center w-full px-2"
      style={{
        height: small ? 40 : 48,
        padding: small ? '2px 4px' : undefined,
        background: 'linear-gradient(180deg, #1a2744 0%, #0e1628 100%)',
        fontFamily: 'Arial, sans-serif',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* My side */}
      <div
        className="flex items-center gap-2 min-w-0 flex-1"
        style={{
          padding: small ? '2px 4px' : '4px 8px',
          borderRadius: 6,
          background: myTurn ? 'rgba(74,222,128,0.08)' : 'transparent',
          transition: 'background 0.3s',
        }}
      >
        <Avatar
          name={myName}
          isActive={myTurn}
          timer={myTurn ? shotTimer : null}
          connected={myConnected}
          size={small ? 28 : 36}
        />
        <div className="flex flex-col min-w-0 gap-0.5">
          <span className="text-[11px] font-semibold text-white truncate max-w-[70px]">
            {myName}
          </span>
          {groupsAssigned
            ? <BallIndicators ids={myBallIds} balls={balls} isSolid={myIsSolid} size={small ? 12 : 16} />
            : <PlaceholderDots count={7} />
          }
        </div>
      </div>

      {/* Center — stake */}
      <div className="flex flex-col items-center gap-0 px-3 flex-shrink-0">
        <span className="text-[13px] text-yellow-400 font-bold leading-tight">
          {stakeAmount > 0 ? `${stakeAmount.toLocaleString()}` : 'Free'}
        </span>
        {stakeAmount > 0 && (
          <span className="text-[8px] text-yellow-600 font-medium leading-tight">UGX</span>
        )}
      </div>

      {/* Opponent side */}
      <div
        className="flex items-center gap-2 min-w-0 flex-1 justify-end"
        style={{
          padding: '4px 8px',
          borderRadius: 6,
          background: !myTurn ? 'rgba(239,68,68,0.08)' : 'transparent',
          transition: 'background 0.3s',
        }}
      >
        <div className="flex flex-col items-end min-w-0 gap-0.5">
          <span className="text-[11px] font-semibold text-white truncate max-w-[70px]">
            {opponentName}
          </span>
          {groupsAssigned
            ? <BallIndicators ids={oppBallIds} balls={balls} isSolid={oppIsSolid} size={small ? 12 : 16} />
            : <PlaceholderDots count={7} />
          }
        </div>
        <Avatar
          name={opponentName}
          isActive={!myTurn}
          timer={!myTurn ? shotTimer : null}
          connected={opponentConnected}
          size={small ? 28 : 36}
        />
      </div>
    </div>
  );
}
