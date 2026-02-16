// Shows pocketed/remaining balls for both groups below the table.

import { type BallGroup, type BallState } from './PoolCanvas';

interface BallRackProps {
  balls: BallState[];
  myGroup: BallGroup;
}

const BALL_COLORS: Record<number, string> = {
  1: '#FFD700', 2: '#0000FF', 3: '#FF0000', 4: '#800080',
  5: '#FF6600', 6: '#008000', 7: '#800000', 8: '#000000',
  9: '#FFD700', 10: '#0000FF', 11: '#FF0000', 12: '#800080',
  13: '#FF6600', 14: '#008000', 15: '#800000',
};

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];

function MiniBar({ ids, balls, label }: { ids: number[]; balls: BallState[]; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-gray-400 w-12 text-right mr-1">{label}</span>
      {ids.map((id) => {
        const b = balls.find((x) => x.id === id);
        const pocketed = !b || !b.active;
        const color = BALL_COLORS[id];
        const isStripe = id >= 9;
        return (
          <div
            key={id}
            className="relative rounded-full border border-gray-600 flex items-center justify-center"
            style={{
              width: 18, height: 18,
              backgroundColor: pocketed ? '#333' : (isStripe ? '#fff' : color),
              opacity: pocketed ? 0.3 : 1,
            }}
          >
            {!pocketed && isStripe && (
              <div className="absolute rounded-full" style={{
                width: 18, height: 7, top: 5.5,
                backgroundColor: color,
              }} />
            )}
            <span className="relative text-[8px] font-bold" style={{
              color: pocketed ? '#666' : (id === 8 || (!isStripe && id !== 1) ? '#fff' : '#000'),
            }}>
              {id}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function BallRack({ balls, myGroup }: BallRackProps) {
  const solidsLabel = myGroup === 'SOLIDS' ? 'You' : myGroup === 'STRIPES' ? 'Opp' : 'Solids';
  const stripesLabel = myGroup === 'STRIPES' ? 'You' : myGroup === 'SOLIDS' ? 'Opp' : 'Stripes';

  return (
    <div className="flex flex-col items-center gap-1 w-full max-w-[900px] mx-auto py-1">
      <MiniBar ids={SOLIDS} balls={balls} label={solidsLabel} />
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-400 w-12 text-right mr-1">8</span>
        <div
          className="rounded-full border border-gray-600 flex items-center justify-center"
          style={{
            width: 18, height: 18,
            backgroundColor: balls.find((b) => b.id === 8)?.active ? '#000' : '#333',
            opacity: balls.find((b) => b.id === 8)?.active ? 1 : 0.3,
          }}
        >
          <span className="text-[8px] font-bold text-white">8</span>
        </div>
      </div>
      <MiniBar ids={STRIPES} balls={balls} label={stripesLabel} />
    </div>
  );
}
