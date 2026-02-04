import { useRef, useCallback, useEffect } from 'react';
import { useSoundContext } from '../components/SoundProvider';

export function useSound(src: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { isMuted } = useSoundContext();

  // Initialize audio element when src changes
  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = 0.7; // Slightly lower volume for better UX
    audioRef.current = audio;
    
    return () => {
      // Cleanup audio element
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [src]);

  const play = useCallback(() => {
    if (isMuted || !audioRef.current) return; // Don't play if muted or not initialized
    try {
      audioRef.current.currentTime = 0;
      void audioRef.current.play();
    } catch (e) {
      // ignore
    }
  }, [isMuted]);

  return play;
}
