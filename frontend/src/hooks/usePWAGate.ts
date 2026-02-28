import { useState, useCallback } from 'react';

// Capture beforeinstallprompt at module load — must be before React renders
let deferredPrompt: any = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
}

export function usePWAGate() {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid || ('ontouchstart' in window && window.innerWidth < 1024);

  const [installing, setInstalling] = useState(false);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    setInstalling(true);
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      return outcome === 'accepted';
    } finally {
      setInstalling(false);
    }
  }, []);

  return {
    isInstalled: isStandalone,
    isMobile,
    isIOS,
    isAndroid,
    canPrompt: !!deferredPrompt,
    installing,
    promptInstall,
  };
}
