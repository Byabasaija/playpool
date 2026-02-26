import { useEffect, useState } from 'react';

// Simple hook that determines whether the current environment should be
// treated as a touch-first device.  We use a combination of feature
// detection and a one-shot `touchstart` listener so that tablets which
// start out in laptop mode will flip to touch when the user actually
// touches the screen.
export function useTouchDevice(): boolean {
  const isInitial = typeof window !== 'undefined' && (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
  const [touch, setTouch] = useState<boolean>(isInitial);

  useEffect(() => {
    if (touch) return; // already detected
    const onFirstTouch = () => {
      setTouch(true);
      window.removeEventListener('touchstart', onFirstTouch);
    };
    window.addEventListener('touchstart', onFirstTouch, { once: true });
    return () => {
      window.removeEventListener('touchstart', onFirstTouch);
    };
  }, [touch]);

  return touch;
}
