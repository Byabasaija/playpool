import React, { useRef, useCallback, useState, useEffect } from 'react';
import { PoolCanvasHandle, POWER_BAR_SCALE } from './PoolCanvas';
import { PoolAssets } from './AssetLoader';
import { TABLE_H } from './canvasLayout';

interface PowerBarProps {
  poolCanvasRef: React.RefObject<PoolCanvasHandle | null>;
  assets: PoolAssets | null;
  isPortrait?: boolean;
}

const BAR_W = 44;
const MIN_DRAG_PX = 10; // minimum downward movement before drag is recognized

// Must match PoolCanvas's barHConst so full screen drag = full power
const BAR_H_CONST = TABLE_H * POWER_BAR_SCALE;

export default function PowerBar({ poolCanvasRef, isPortrait = false }: PowerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const dragStarted = useRef(false);
  const [fill, setFill] = useState(0);       // 0..1 drag fraction
  const [containerH, setContainerH] = useState(300);

  useEffect(() => {
    if (!barRef.current) return;
    const ro = new ResizeObserver(([e]) => setContainerH(e.contentRect.height));
    ro.observe(barRef.current);
    return () => ro.disconnect();
  }, []);

  const onDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startY.current = e.clientY;
    dragStarted.current = false;
    setFill(0);
    // Capture pointer so drag works even if finger leaves the element
    try { barRef.current?.setPointerCapture(e.pointerId); } catch {}
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (startY.current === null) return;
    e.preventDefault();
    e.stopPropagation();
    // Portrait: bar sits at the bottom of the screen — drag UP (decreasing clientY) = more power
    // Landscape: bar on the left — drag DOWN (increasing clientY) = more power
    const dy = isPortrait ? (startY.current - e.clientY) : (e.clientY - startY.current);

    // Only start drag after meaningful downward movement
    if (!dragStarted.current) {
      if (dy < MIN_DRAG_PX) return;
      dragStarted.current = true;
      poolCanvasRef.current?.beginPowerDrag();
    }

    const barH = barRef.current?.clientHeight || containerH;
    const fraction = Math.max(0, Math.min(1, dy / barH));
    setFill(fraction);
    // Map fraction to canvas units — full drag always = MAX_POWER regardless of screen size
    poolCanvasRef.current?.updatePowerFromDrag(fraction * BAR_H_CONST);
  }, [poolCanvasRef, containerH, isPortrait]);

  const onUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only fire if user actually dragged — ignore taps
    if (dragStarted.current) {
      poolCanvasRef.current?.endPowerDrag();
    }
    dragStarted.current = false;
    startY.current = null;
    setFill(0);
    try { barRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, [poolCanvasRef]);

  const powerColor =
    fill < 0.4 ? '#22c55e' :
    fill < 0.7 ? '#eab308' : '#ef4444';

  // Cue geometry
  const CUE_LEN = Math.max(60, containerH * 0.75);
  const maxPull = Math.max(0, containerH - CUE_LEN - 8);
  const cueTop = 4 + fill * maxPull;
  const dragging = startY.current !== null;

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
        touchAction: 'none',
        cursor: 'ns-resize',
        position: 'relative',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}
    >
      {/* Power glow track */}
      {fill > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 0, left: 3, right: 3,
          height: `${fill * 100}%`,
          background: `linear-gradient(to top, ${powerColor}55, transparent)`,
          borderRadius: 6,
          pointerEvents: 'none',
        }} />
      )}

      {/* Cue stick */}
      <div style={{
        position: 'absolute',
        top: cueTop,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 10,
        height: CUE_LEN,
        pointerEvents: 'none',
        transition: dragging ? 'none' : 'top 0.15s ease',
      }}>
        {/* Tip */}
        <div style={{
          position: 'absolute',
          top: 0, left: '50%',
          transform: 'translateX(-50%)',
          width: 7, height: 9,
          borderRadius: '3px 3px 0 0',
          background: '#87ceeb',
          boxShadow: fill > 0 ? `0 0 6px ${powerColor}` : 'none',
        }} />
        {/* Shaft — tapers from narrow (top) to wide (bottom) */}
        <div style={{
          position: 'absolute',
          top: 8, left: '50%',
          transform: 'translateX(-50%)',
          width: 7,
          height: CUE_LEN - 18,
          background: 'linear-gradient(to bottom, #f5dfa0 0%, #c4940a 45%, #8b5a0a 80%, #5a3a05 100%)',
          borderRadius: '0 0 1px 1px',
          boxShadow: fill > 0
            ? `0 0 ${4 + fill * 10}px ${powerColor}66`
            : '1px 0 3px rgba(0,0,0,0.5), -1px 0 3px rgba(0,0,0,0.3)',
        }} />
        {/* Butt */}
        <div style={{
          position: 'absolute',
          bottom: 0, left: '50%',
          transform: 'translateX(-50%)',
          width: 11, height: 10,
          borderRadius: '0 0 4px 4px',
          background: '#2a1005',
        }} />
      </div>

      {/* Hint when idle */}
      {fill === 0 && (
        <div style={{
          position: 'absolute',
          bottom: 5, left: 0, right: 0,
          textAlign: 'center',
          fontSize: 8,
          color: 'rgba(255,255,255,0.2)',
          pointerEvents: 'none',
          lineHeight: 1.4,
        }}>
          pull<br/>↓
        </div>
      )}
    </div>
  );
}
