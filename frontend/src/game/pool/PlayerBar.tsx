// Top bar showing both players' info, turn indicator, and countdown timer.

import { type BallGroup } from './PoolCanvas';

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
}

const GROUP_LABEL: Record<BallGroup, string> = {
  SOLIDS: 'Solids',
  STRIPES: 'Stripes',
  ANY: '',
  '8BALL': '8-Ball',
};

const GROUP_COLOR: Record<BallGroup, string> = {
  SOLIDS: '#FFD700',
  STRIPES: '#0000FF',
  ANY: '#888',
  '8BALL': '#000',
};

export default function PlayerBar({
  myName, opponentName, myGroup, opponentGroup, myTurn,
  stakeAmount, myConnected, opponentConnected, idleRemaining, idleIsMe,
}: PlayerBarProps) {
  return (
    <div className="flex items-center justify-between w-full max-w-[900px] mx-auto px-2 py-1.5"
      style={{ fontFamily: 'Arial, sans-serif' }}>

      {/* My side */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
        myTurn ? 'bg-green-600 text-white shadow-lg' : 'bg-gray-800 text-gray-300'
      }`}>
        <div className="w-2 h-2 rounded-full" style={{
          backgroundColor: myConnected ? '#4ade80' : '#ef4444',
        }} />
        <span className="text-sm font-semibold truncate max-w-[100px]">{myName || 'You'}</span>
        {myGroup !== 'ANY' && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{
            backgroundColor: GROUP_COLOR[myGroup],
            color: myGroup === '8BALL' ? '#fff' : '#000',
          }}>
            {GROUP_LABEL[myGroup]}
          </span>
        )}
      </div>

      {/* Center — stake + idle timer */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-xs text-gray-400 font-medium">
          {stakeAmount > 0 ? `${stakeAmount.toLocaleString()} UGX` : 'Free Play'}
        </span>
        {idleRemaining !== null && (
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
            idleRemaining <= 10 ? 'bg-red-500 text-white animate-pulse' :
            idleRemaining <= 20 ? 'bg-orange-400 text-white' :
            'bg-yellow-300 text-black'
          }`}>
            {idleIsMe ? 'You' : 'Opponent'}: {idleRemaining}s
          </span>
        )}
      </div>

      {/* Opponent side */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
        !myTurn ? 'bg-red-600 text-white shadow-lg' : 'bg-gray-800 text-gray-300'
      }`}>
        {opponentGroup !== 'ANY' && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{
            backgroundColor: GROUP_COLOR[opponentGroup],
            color: opponentGroup === '8BALL' ? '#fff' : '#000',
          }}>
            {GROUP_LABEL[opponentGroup]}
          </span>
        )}
        <span className="text-sm font-semibold truncate max-w-[100px]">{opponentName || 'Opponent'}</span>
        <div className="w-2 h-2 rounded-full" style={{
          backgroundColor: opponentConnected ? '#4ade80' : '#ef4444',
        }} />
      </div>
    </div>
  );
}
