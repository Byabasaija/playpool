// Top bar with player names, ball indicators inline, and stake — like 8 Ball Pool.

import { type BallGroup, type BallState } from './PoolCanvas';

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

function BallDots({ ids, balls }: { ids: number[]; balls: BallState[] }) {
  return (
    <div className="flex gap-[3px]">
      {ids.map(id => {
        const active = balls.find(b => b.id === id)?.active ?? true;
        return (
          <div
            key={id}
            className="w-[9px] h-[9px] rounded-full border border-gray-600"
            style={{
              backgroundColor: active ? '#333' : '#1a1a1a',
              opacity: active ? 1 : 0.25,
            }}
          />
        );
      })}
    </div>
  );
}

export default function PlayerBar({
  myName, opponentName, myGroup, opponentGroup, myTurn,
  stakeAmount, myConnected, opponentConnected, idleRemaining, idleIsMe, balls,
}: PlayerBarProps) {
  const myBallIds = myGroup === 'SOLIDS' ? SOLIDS : myGroup === 'STRIPES' ? STRIPES : [];
  const oppBallIds = opponentGroup === 'SOLIDS' ? SOLIDS : opponentGroup === 'STRIPES' ? STRIPES : [];

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
        {myBallIds.length > 0 && <BallDots ids={myBallIds} balls={balls} />}
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
        {oppBallIds.length > 0 && <BallDots ids={oppBallIds} balls={balls} />}
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
