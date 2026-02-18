// Pool game sound effects manager.

import { PoolAssets } from './AssetLoader';
import { CollisionEvent } from './PhysicsEngine';

export class SoundManager {
  private assets: PoolAssets;
  private enabled = true;
  private audioCtxResumed = false;

  constructor(assets: PoolAssets) {
    this.assets = assets;
  }

  /** Must be called from a user gesture to enable audio on mobile. */
  resumeAudioContext(): void {
    if (this.audioCtxResumed) return;
    this.audioCtxResumed = true;
    // Create and resume an AudioContext to unlock audio on iOS/Android
    try {
      const ctx = new AudioContext();
      ctx.resume().then(() => ctx.close());
    } catch {}
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Play a sound effect for a physics collision event. */
  playCollision(event: CollisionEvent, isFirstHit: boolean): void {
    if (!this.enabled) return;
    const vol = Math.min(1, event.speed / 4000);
    if (vol < 0.05) return;

    switch (event.type) {
      case 'ball':
        if (event.ballId === 0 && isFirstHit) {
          this.play(this.assets.audio.cueHit, vol);
        } else {
          this.play(this.assets.audio.ballHit, vol);
        }
        break;
      case 'line':
      case 'vertex':
        this.play(this.assets.audio.cushionHit, vol);
        break;
      case 'pocket':
        this.play(this.assets.audio.pocketHit, 0.7);
        break;
    }
  }

  playDing(): void {
    if (this.enabled) this.play(this.assets.audio.ding, 0.5);
  }

  playCheer(): void {
    if (this.enabled) this.play(this.assets.audio.cheer, 0.6);
  }

  private play(audio: HTMLAudioElement, volume: number): void {
    try {
      const clone = audio.cloneNode() as HTMLAudioElement;
      clone.volume = Math.min(1, Math.max(0, volume));
      clone.play().catch(() => {});
    } catch {}
  }
}
