import { useRef, useCallback } from 'react';

export function useSound(src: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const init = () => {
    if (!audioRef.current) {
      const a = new Audio(src);
      a.preload = 'auto';
      audioRef.current = a;
    }
  };

  const play = useCallback(() => {
    try {
      init();
      if (!audioRef.current) return;
      audioRef.current.currentTime = 0;
      // play may return a promise; ignore rejections caused by blockers
      void audioRef.current.play();
    } catch (e) {
      // ignore
    }
  }, [src]);

  return play;
}
