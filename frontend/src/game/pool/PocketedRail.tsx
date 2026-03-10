// Miniclip-style side rail — all pocketed balls in chronological order.
// Newest ball enters from the funnel at the top; balls stack downward.

const RAIL_W  = 44;  // total panel width
const TUBE_W  = 28;  // inner tube width (ball + side gaps)
const BALL_SZ = 22;  // ball sprite size

// Funnel geometry: full width at y=0, narrows to TUBE_W at y=FUNNEL_H.
const FUNNEL_H  = 18;
const TUBE_L    = (RAIL_W - TUBE_W) / 2;  // left x of tube
const TUBE_R    = (RAIL_W + TUBE_W) / 2;  // right x of tube

// Sprite sheet constants (same as PlayerBar BallSprite).
const SHEET_W = 256, SHEET_H = 512, FRAME_W = 102, FRAME_H = 102, GUI_COLS = 2;

const STYLES = `
@keyframes railBallIn {
  0%   { opacity: 0; transform: translateY(-${BALL_SZ + 8}px) scale(0.75); }
  55%  {             transform: translateY(3px)  scale(1.06); }
  100% { opacity: 1; transform: translateY(0)    scale(1); }
}`;

function RailBall({ ballId }: { ballId: number }) {
  if (ballId === 8) {
    const inner = Math.round(BALL_SZ * 0.52);
    return (
      <div style={{
        width: BALL_SZ, height: BALL_SZ, borderRadius: '50%', flexShrink: 0,
        background: 'radial-gradient(circle at 38% 35%, #4b5563 0%, #111 55%, #000 100%)',
        border: '1px solid rgba(255,255,255,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: inner, height: inner, borderRadius: '50%', background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.round(BALL_SZ * 0.3), fontWeight: 900, color: '#000', lineHeight: 1,
        }}>8</div>
      </div>
    );
  }

  const isSolid = ballId <= 7;
  const src   = isSolid ? '/pool/img/guiSolids.webp' : '/pool/img/guiStripes.webp';
  const frame = isSolid ? ballId - 1 : ballId - 9;
  const col   = frame % GUI_COLS;
  const row   = Math.floor(frame / GUI_COLS);
  const sx    = BALL_SZ / FRAME_W;
  const sy    = BALL_SZ / FRAME_H;

  return (
    <div style={{
      width: BALL_SZ, height: BALL_SZ, borderRadius: '50%', flexShrink: 0,
      backgroundImage: `url(${src})`,
      backgroundSize: `${SHEET_W * sx}px ${SHEET_H * sy}px`,
      backgroundPosition: `${-col * FRAME_W * sx}px ${-row * FRAME_H * sy}px`,
      backgroundRepeat: 'no-repeat',
    }} />
  );
}

interface PocketedRailProps {
  /** Ball IDs in the order they were pocketed (oldest first). */
  pocketedOrder: number[];
}

export default function PocketedRail({ pocketedOrder }: PocketedRailProps) {
  // Newest at top → reverse for display.
  const display = [...pocketedOrder].reverse();

  return (
    <>
      <style>{STYLES}</style>
      <div style={{
        width: RAIL_W,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'linear-gradient(180deg, #111827 0%, #0d1424 100%)',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
        overflow: 'hidden',
      }}>

        {/* ── Funnel opening ── */}
        <svg
          width={RAIL_W}
          height={FUNNEL_H}
          style={{ flexShrink: 0, display: 'block' }}
        >
          {/* Funnel fill */}
          <polygon
            points={`0,0 ${RAIL_W},0 ${TUBE_R},${FUNNEL_H} ${TUBE_L},${FUNNEL_H}`}
            fill="#1c2a42"
          />
          {/* Left slant border */}
          <line x1={1} y1={0} x2={TUBE_L} y2={FUNNEL_H}
            stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          {/* Right slant border */}
          <line x1={RAIL_W - 1} y1={0} x2={TUBE_R} y2={FUNNEL_H}
            stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          {/* Top rim highlight */}
          <line x1={0} y1={0} x2={RAIL_W} y2={0}
            stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} />
        </svg>

        {/* ── Tube ── */}
        <div style={{
          width: TUBE_W,
          flex: 1,
          borderLeft:  '1px solid rgba(255,255,255,0.10)',
          borderRight: '1px solid rgba(255,255,255,0.10)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          paddingTop: 4,
          overflow: 'hidden',
        }}>
          {display.map(ballId => (
            <div
              key={ballId}
              style={{ animation: 'railBallIn 0.38s cubic-bezier(0.34,1.4,0.64,1) both', flexShrink: 0 }}
            >
              <RailBall ballId={ballId} />
            </div>
          ))}
        </div>

      </div>
    </>
  );
}
