import React, { useRef, useCallback, useState } from 'react';
import { PoolCanvasHandle } from './PoolCanvas';
import { PoolAssets } from './AssetLoader';

interface PowerBarProps {
  poolCanvasRef: React.RefObject<PoolCanvasHandle | null>;
  assets: PoolAssets | null;
}

const BAR_W = 12; // px — thin like Miniclip
const TICKS = [0.25, 0.5, 0.75];

export default function PowerBar({ poolCanvasRef }: PowerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [fill, setFill] = useState(0); // 0..1

  const onDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startY.current = e.clientY;
    setFill(0);
    poolCanvasRef.current?.beginPowerDrag();
    try { barRef.current?.setPointerCapture(e.pointerId); } catch {}
  }, [poolCanvasRef]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (startY.current === null) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = e.clientY - startY.current;
    const barH = barRef.current?.clientHeight || 1;
    const r = Math.max(0, Math.min(barH, dy));
    setFill(r / barH);
    poolCanvasRef.current?.updatePowerFromDrag(r);
  }, [poolCanvasRef]);

  const onUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    poolCanvasRef.current?.endPowerDrag();
    startY.current = null;
    setFill(0);
    try { barRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, [poolCanvasRef]);

  // Color: green → yellow → red as power increases
  const fillColor =
    fill < 0.4
      ? `linear-gradient(to bottom, #22c55e, #4ade80)`
      : fill < 0.7
      ? `linear-gradient(to bottom, #eab308, #22c55e)`
      : `linear-gradient(to bottom, #ef4444, #f97316)`;

  return (
    <div
      ref={barRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        width: BAR_W,
        alignSelf: 'stretch',
        flexShrink: 0,
        marginRight: 4,
        touchAction: 'none',
        cursor: 'ns-resize',
        position: 'relative',
        background: '#111827',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {/* Colored fill — grows top-to-bottom as you drag down */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: `${fill * 100}%`,
          background: fillColor,
          transition: startY.current !== null ? 'none' : 'height 0.15s ease',
        }}
      />

      {/* Tick marks */}
      {TICKS.map(t => (
        <div
          key={t}
          style={{
            position: 'absolute',
            top: `${t * 100}%`,
            left: 1,
            right: 1,
            height: 1,
            background: 'rgba(255,255,255,0.18)',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Handle line at current drag position */}
      {fill > 0 && (
        <div
          style={{
            position: 'absolute',
            top: `${fill * 100}%`,
            left: 0,
            right: 0,
            height: 2,
            background: 'rgba(255,255,255,0.9)',
            boxShadow: '0 0 4px rgba(255,255,255,0.6)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
