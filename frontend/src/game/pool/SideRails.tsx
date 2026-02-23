// Side rail collection areas for pocketed balls — flanks the pool table like in 8 Ball Pool.

import { type BallState, type BallGroup } from './types';

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];

// guiSolids.png / guiStripes.png: 256x512, 2 columns x 4 rows, 102x102 per frame
const GUI_FRAME_W = 102;
const GUI_FRAME_H = 102;
const GUI_COLS = 2;
const GUI_SHEET_W = 256;
const GUI_SHEET_H = 512;

function RailBallSprite({ ballId, size = 22 }: { ballId: number; size?: number }) {
  const isSolid = ballId >= 1 && ballId <= 7;
  const frame = isSolid ? ballId - 1 : ballId - 9;
  const col = frame % GUI_COLS;
  const row = Math.floor(frame / GUI_COLS);
  const src = isSolid ? '/pool/img/guiSolids.png' : '/pool/img/guiStripes.png';

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
        borderRadius: '50%',
        flexShrink: 0,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
      }}
    />
  );
}

interface SideRailProps {
  balls: BallState[];
  group: BallGroup;
  side: 'left' | 'right';
}

export default function SideRail({ balls, group, side }: SideRailProps) {
  const ballIds = group === 'SOLIDS' ? SOLIDS : group === 'STRIPES' ? STRIPES : [];
  const pocketed = ballIds.filter(id => {
    const ball = balls.find(b => b.id === id);
    return ball && !ball.active;
  });

  return (
    <div
      className="flex flex-col items-center justify-center gap-1 py-2"
      style={{
        width: 36,
        minWidth: 36,
        background: 'linear-gradient(180deg, #2a1a0a 0%, #4a2a10 20%, #3a2010 80%, #2a1a0a 100%)',
        borderRadius: side === 'left' ? '8px 0 0 8px' : '0 8px 8px 0',
        boxShadow: side === 'left'
          ? 'inset -2px 0 4px rgba(0,0,0,0.5), 2px 0 8px rgba(0,0,0,0.3)'
          : 'inset 2px 0 4px rgba(0,0,0,0.5), -2px 0 8px rgba(0,0,0,0.3)',
        border: '1px solid rgba(139,90,43,0.4)',
      }}
    >
      {/* Decorative top notch */}
      <div style={{
        width: 16,
        height: 3,
        background: 'linear-gradient(90deg, transparent, rgba(139,90,43,0.6), transparent)',
        borderRadius: 2,
        marginBottom: 2,
      }} />

      {/* Pocketed balls */}
      <div className="flex flex-col items-center gap-0.5">
        {pocketed.map(id => (
          <RailBallSprite key={id} ballId={id} size={20} />
        ))}
      </div>

      {/* Empty slots for remaining */}
      {pocketed.length < ballIds.length && (
        <div className="flex flex-col items-center gap-0.5 mt-auto">
          {Array.from({ length: Math.min(3, ballIds.length - pocketed.length) }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(139,90,43,0.2)',
              }}
            />
          ))}
        </div>
      )}

      {/* Decorative bottom notch */}
      <div style={{
        width: 16,
        height: 3,
        background: 'linear-gradient(90deg, transparent, rgba(139,90,43,0.6), transparent)',
        borderRadius: 2,
        marginTop: 2,
      }} />
    </div>
  );
}
