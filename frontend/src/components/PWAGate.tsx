import { useLocation } from 'react-router-dom';
import { usePWAGate } from '../hooks/usePWAGate';

function InstallScreen({ isIOS, canPrompt, installing, onInstall }: {
  isIOS: boolean;
  canPrompt: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: '#0e1628',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
        padding: '0 32px',
        maxWidth: 320,
        width: '100%',
      }}>
        {/* Ball icon */}
        <svg viewBox="0 0 56 56" width="72" height="72">
          <circle cx="28" cy="28" r="26" fill="#1a6b3a" />
          <circle cx="28" cy="28" r="12" fill="white" />
          <text x="28" y="33" textAnchor="middle" fontSize="13" fontWeight="800" fill="#111">8</text>
        </svg>

        {/* Name + tagline */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
            PlayPool
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            Install to play
          </div>
        </div>

        {/* Action */}
        {!isIOS && canPrompt && (
          <button
            onClick={onInstall}
            disabled={installing}
            style={{
              width: '100%',
              padding: '14px 0',
              borderRadius: 14,
              border: 'none',
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              opacity: installing ? 0.7 : 1,
              boxShadow: '0 4px 20px rgba(22,163,74,0.35)',
            }}
          >
            {installing ? 'Installing…' : 'Install'}
          </button>
        )}

        {/* iOS steps */}
        {isIOS && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
            {[
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
                    <polyline points="16 6 12 2 8 6"/>
                    <line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                ),
                label: 'Tap Share',
              },
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                ),
                label: 'Add to Home Screen',
              },
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                  </svg>
                ),
                label: 'Open PlayPool',
              },
            ].map(({ icon, label }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'rgba(74,222,128,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {icon}
                </div>
                <span style={{ fontSize: 14, color: '#d1d5db' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Android fallback (no prompt available) */}
        {!isIOS && !canPrompt && (
          <p style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', margin: 0 }}>
            Tap <strong style={{ color: '#e5e7eb' }}>⋮</strong> → <strong style={{ color: '#4ade80' }}>Add to Home Screen</strong>
          </p>
        )}
      </div>
    </div>
  );
}

export function PWAGate({ children }: { children: React.ReactNode }) {
  const { isInstalled, isMobile, isIOS, canPrompt, installing, promptInstall } = usePWAGate();
  const location = useLocation();

  if (!isMobile || isInstalled || location.pathname.startsWith('/pm-admin')) {
    return <>{children}</>;
  }

  return (
    <InstallScreen
      isIOS={isIOS}
      canPrompt={canPrompt}
      installing={installing}
      onInstall={promptInstall}
    />
  );
}
