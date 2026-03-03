import { useEffect, useState } from 'react';

// Returns true for genuine touch-primary devices (phones, tablets, DevTools simulation).
// Uses (hover: none) + (pointer: coarse) which is false on Mac trackpads/mice
// even when they occasionally produce touch events, but true on real mobile devices
// and Chrome DevTools device simulation.
export function useTouchDevice(): boolean {
  const isInitial = typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  const [touch, setTouch] = useState<boolean>(isInitial);

  useEffect(() => {
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setTouch(true);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return touch;
}
