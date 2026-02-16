// Small cue ball diagram to set spin (screw + english) via tap/drag.

import { useRef, useCallback } from 'react';

interface SpinSetterProps {
  screw: number;   // -1..1 (negative = backspin)
  english: number; // -1..1 (negative = left spin)
  onChange: (screw: number, english: number) => void;
  disabled: boolean;
}

const SIZE = 60;
const RADIUS = SIZE / 2 - 4;

export default function SpinSetter({ screw, english, onChange, disabled }: SpinSetterProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleInteraction = useCallback((clientX: number, clientY: number) => {
    if (disabled) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (clientX - cx) / RADIUS;
    let dy = (clientY - cy) / RADIUS;
    // Clamp to unit circle
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > 1) { dx /= mag; dy /= mag; }
    onChange(-dy, dx); // screw = up/down inverted, english = left/right
  }, [disabled, onChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    handleInteraction(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => handleInteraction(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [handleInteraction]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    handleInteraction(t.clientX, t.clientY);
    const onMove = (ev: TouchEvent) => {
      const touch = ev.touches[0];
      if (touch) handleInteraction(touch.clientX, touch.clientY);
    };
    const onEnd = () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  }, [handleInteraction]);

  // Dot position
  const dotX = SIZE / 2 + english * RADIUS;
  const dotY = SIZE / 2 - screw * RADIUS;

  return (
    <div
      ref={containerRef}
      className="relative select-none cursor-pointer"
      style={{ width: SIZE, height: SIZE, touchAction: 'none' }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onDoubleClick={() => onChange(0, 0)}
    >
      {/* Cue ball background */}
      <svg width={SIZE} height={SIZE}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="#f0f0f0" stroke="#999" strokeWidth={1.5} />
        {/* Cross-hair */}
        <line x1={SIZE / 2} y1={4} x2={SIZE / 2} y2={SIZE - 4} stroke="#ccc" strokeWidth={0.5} />
        <line x1={4} y1={SIZE / 2} x2={SIZE - 4} y2={SIZE / 2} stroke="#ccc" strokeWidth={0.5} />
        {/* Spin dot */}
        <circle cx={dotX} cy={dotY} r={5} fill={disabled ? '#999' : '#e63946'} />
      </svg>
      <span className="absolute bottom-[-14px] left-0 right-0 text-center text-[9px] text-gray-400">
        Spin
      </span>
    </div>
  );
}
