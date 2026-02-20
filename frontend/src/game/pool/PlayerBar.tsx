// Top bar with player names, ball indicators inline, and stake — like 8 Ball Pool.

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
  idleRemaining: number | null;
  idleIsMe: boolean;
  balls: BallState[];
}

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];

// guiSolids.png / guiStripes.png: 256x512, 2 columns x 4 rows, 102x102 per frame
// Frame index 0-6 maps to balls 1-7 (solids) or 9-15 (stripes)
const GUI_FRAME_W = 102;
const GUI_FRAME_H = 102;
const GUI_COLS = 2;
const GUI_SHEET_W = 256;
const GUI_SHEET_H = 512;

function BallSprite({ ballId, isSolid, active }: { ballId: number; isSolid: boolean; active: boolean }) {
  // Frame index: 0-6
  const frame = isSolid ? ballId - 1 : ballId - 9;
  const col = frame % GUI_COLS;
  const row = Math.floor(frame / GUI_COLS);
  const src = isSolid ? '/pool/img/guiSolids.png' : '/pool/img/guiStripes.png';

  // Use background-image with background-position for sprite extraction
  const DISPLAY_SIZE = 20;
  const scaleX = DISPLAY_SIZE / GUI_FRAME_W;
  const scaleY = DISPLAY_SIZE / GUI_FRAME_H;

  return (
    <div
      style={{
        width: DISPLAY_SIZE,
        height: DISPLAY_SIZE,
        backgroundImage: `url(${src})`,
        backgroundSize: `${GUI_SHEET_W * scaleX}px ${GUI_SHEET_H * scaleY}px`,
        backgroundPosition: `${-col * GUI_FRAME_W * scaleX}px ${-row * GUI_FRAME_H * scaleY}px`,
        backgroundRepeat: 'no-repeat',
        opacity: active ? 1 : 0.2,
        borderRadius: '50%',
        flexShrink: 0,
      }}
    />
  );
}

function BallIndicators({ ids, balls, isSolid }: { ids: number[]; balls: BallState[]; isSolid: boolean }) {
  return (
    <div className="flex gap-[2px] items-center">
      {ids.map(id => {
        const active = balls.find(b => b.id === id)?.active ?? true;
        return <BallSprite key={id} ballId={id} isSolid={isSolid} active={active} />;
      })}
    </div>
  );
}

export default function PlayerBar({
  myName, opponentName, myGroup, opponentGroup, myTurn,
  stakeAmount, myConnected, opponentConnected, idleRemaining, idleIsMe, balls,
}: PlayerBarProps) {
  const myBallIds = myGroup === 'SOLIDS' ? SOLIDS : myGroup === 'STRIPES' ? STRIPES : [];
  const myIsSolid = myGroup === 'SOLIDS';
  const oppBallIds = opponentGroup === 'SOLIDS' ? SOLIDS : opponentGroup === 'STRIPES' ? STRIPES : [];
  const oppIsSolid = opponentGroup === 'SOLIDS';

  return (
    <div className="flex items-center justify-between w-full px-2 py-1"
      style={{ fontFamily: 'Arial, sans-serif' }}>

      {/* My side */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold truncate ${
          myTurn ? 'bg-green-700/90 text-white' : 'bg-gray-800/70 text-gray-400'
        }`}>
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
            backgroundColor: myConnected ? '#4ade80' : '#ef4444',
          }} />
          <span className="truncate max-w-[80px]">{myName}</span>
        </div>
        {myBallIds.length > 0 && <BallIndicators ids={myBallIds} balls={balls} isSolid={myIsSolid} />}
      </div>

      {/* Center — stake + idle */}
      <div className="flex flex-col items-center gap-0 px-2 flex-shrink-0">
        <span className="text-[11px] text-yellow-400 font-bold leading-tight">
          {stakeAmount > 0 ? `${stakeAmount.toLocaleString()} UGX` : 'Free'}
        </span>
        {idleRemaining !== null && (
          <span className={`text-[9px] font-bold px-1.5 py-0 rounded leading-tight ${
            idleRemaining <= 10 ? 'bg-red-500 text-white animate-pulse' :
            'bg-yellow-300 text-black'
          }`}>
            {idleIsMe ? 'You' : 'Opp'}: {idleRemaining}s
          </span>
        )}
      </div>

      {/* Opponent side */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-end">
        {oppBallIds.length > 0 && <BallIndicators ids={oppBallIds} balls={balls} isSolid={oppIsSolid} />}
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold truncate ${
          !myTurn ? 'bg-red-700/90 text-white' : 'bg-gray-800/70 text-gray-400'
        }`}>
          <span className="truncate max-w-[80px]">{opponentName}</span>
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
            backgroundColor: opponentConnected ? '#4ade80' : '#ef4444',
          }} />
        </div>
      </div>
    </div>
  );
}
