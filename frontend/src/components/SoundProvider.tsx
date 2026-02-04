import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode, ReactElement } from 'react';

// Sound Manager Context
interface SoundContextType {
  isMuted: boolean;
  toggleMute: () => void;
}

const SoundContext = createContext<SoundContextType>({
  isMuted: false,
  toggleMute: () => {}
});

export const useSoundContext = () => useContext(SoundContext);

export function SoundProvider({ children }: { children: ReactNode }): ReactElement {
  const [isMuted, setIsMuted] = useState(false);
  
  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  return (
    <SoundContext.Provider value={{ isMuted, toggleMute }}>
      {children}
    </SoundContext.Provider>
  );
}
