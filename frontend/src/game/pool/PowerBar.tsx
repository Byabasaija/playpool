import React, { useRef, useLayoutEffect, useCallback } from 'react';
import { POWER_BAR_SCALE, POWER_BAR_WIDTH_SCALE } from './PoolCanvas';
import { PoolCanvasHandle } from './PoolCanvas';
import { PoolAssets } from './AssetLoader';

interface PowerBarProps {
  // ref may be null while the canvas is not yet mounted
  poolCanvasRef: React.RefObject<PoolCanvasHandle | null>;
  assets: PoolAssets | null;
}

/**
 * Vertical power‑bar that sits to the left of the table. It behaves very
 * similarly to the old overlay version except that it's part of the
 * flex layout rather than absolutely positioned over the canvas. This
 * keeps the table dimensions simple and prevents taps from leaking
 * through to the board.
 */
export default function PowerBar({ poolCanvasRef, assets }: PowerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLImageElement>(null);
  const startY = useRef<number | null>(null);

  // resize whenever the canvas changes size or assets load
  useLayoutEffect(() => {
    if (!assets) return;
    const canvas = poolCanvasRef.current?.canvas;
    const bar = barRef.current;
    if (!canvas || !bar) return;

    const reposition = () => {
      const rect = canvas.getBoundingClientRect();
      const barH = rect.height * POWER_BAR_SCALE;
      const ratio = assets.images.powerBarBG.height / assets.images.powerBarBG.width;
      const barW = barH * ratio * POWER_BAR_WIDTH_SCALE;
      bar.style.width = `${barW}px`;
      bar.style.height = `${rect.height}px`;
    };

    reposition();
    const ro = new ResizeObserver(reposition);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [assets, poolCanvasRef]);

  const onDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
    e.preventDefault();
    e.stopPropagation();

    startY.current = e.clientY;
    if (cueRef.current) cueRef.current.style.transform = 'rotate(-90deg)';
    poolCanvasRef.current?.beginPowerDrag();
    try { barRef.current?.setPointerCapture(e.pointerId); } catch {}
  }, [poolCanvasRef]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (startY.current === null) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = e.clientY - startY.current;
    const barH = barRef.current?.clientHeight || 0;
    const r = Math.max(0, Math.min(barH, dy));
    poolCanvasRef.current?.updatePowerFromDrag(r);
    if (cueRef.current) {
      cueRef.current.style.transform = `translateY(${r}px) rotate(-90deg)`;
    }
  }, [poolCanvasRef]);

  const onUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    poolCanvasRef.current?.endPowerDrag();
    startY.current = null;
    if (cueRef.current) cueRef.current.style.transform = 'rotate(-90deg)';
    try { barRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, [poolCanvasRef]);

  return (
    <div
      ref={barRef}
      className="relative flex-shrink-0 h-full touch-action-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        touchAction: 'none',
        background: 'linear-gradient(180deg, #2a1a0a 0%, #4a2a10 20%, #3a2010 80%, #2a1a0a 100%)',
        borderRadius: '8px 0 0 8px',
        boxShadow: 'inset -2px 0 4px rgba(0,0,0,0.5), 2px 0 8px rgba(0,0,0,0.3)',
        border: '1px solid rgba(139,90,43,0.4)',
      }}
    >
      <img
        src="/pool/img/powerBarBG.png"
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
      />
      <img
        src="/pool/img/powerBarBase.png"
        className="absolute top-[-13px] left-0 w-full h-full pointer-events-none"
      />
      <img
        src="/pool/img/powerBarTop.png"
        className="absolute top-[-13px] left-0 w-full h-full pointer-events-none"
      />
      <img
        ref={cueRef}
        src="/pool/img/cue.png"
        className="absolute right-0 top-0 pointer-events-none"
        style={{ transform: 'rotate(-90deg)' }}
      />
    </div>
  );
}
