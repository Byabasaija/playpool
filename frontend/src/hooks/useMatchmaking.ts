import { useState, useCallback } from 'react';
import { initiateStake, pollMatchStatus, pollMatchStatusByPhone } from '../utils/apiClient';

// Prefetch common cards to speed up game loading
function prefetchCommonCards() {
  // Prefetch most common starting cards (numbers 2-10 in all suits)
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10'];
  const suits = ['H', 'D', 'C', 'S'];
  
  const imagesToPrefetch: string[] = [];
  ranks.forEach(rank => {
    suits.forEach(suit => {
      imagesToPrefetch.push(`https://deckofcardsapi.com/static/img/${rank}${suit}.png`);
    });
  });

  // Start prefetching in parallel
  imagesToPrefetch.forEach(url => {
    const img = new Image();
    img.src = url;
  });
  
  console.log('[PREFETCH] Started loading', imagesToPrefetch.length, 'common cards');
}

export type MatchmakingStage = 'form' | 'payment' | 'payment_pending' | 'matching' | 'found' | 'error' | 'expired' | 'declined' | 'private_created';

export function useMatchmaking() {
  const [stage, setStage] = useState<MatchmakingStage>('form');
  const [error, setError] = useState<string | null>(null);
  const [gameLink, setGameLink] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [displayName, setDisplayNameState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('playerDisplayName');
    } catch (e) {
      return null;
    }
  });
  const [privateMatch, setPrivateMatch] = useState<{ matchcode: string; expires_at?: string; queue_id?: number; queue_token?: string } | null>(null);

  const setDisplayName = useCallback((name: string | null) => {
    setDisplayNameState(name);
    try {
      if (name) sessionStorage.setItem('playerDisplayName', name);
      else sessionStorage.removeItem('playerDisplayName');
    } catch (e) {
      // ignore storage errors
    }
  }, []);

  const startPolling = useCallback(async (queueToken: string, displayName?: string) => {
    setIsLoading(true);
    setError(null);
    setStage('matching');

    // persist token for session
    try { sessionStorage.setItem('queueToken', queueToken); } catch (e) {}

    if (displayName) setDisplayName(displayName);

    try {
      const maxAttempts = 60; // 3 minutes max
      let attempts = 0;
      let pollInterval = 1000; // Start at 1 second for faster match detection

      const poll = async (): Promise<void> => {
        const result = await pollMatchStatus(queueToken);

        if (result.my_display_name) setDisplayName(result.my_display_name);

        if (result.status === 'matched' && result.game_link) {
          // Match found! Prefetch cards immediately
          prefetchCommonCards();
          
          // Persist player token from the returned game_link
          try {
            const u = new URL(result.game_link);
            const pt = u.searchParams.get('pt');
            const match = u.pathname.match(/\/g\/([^/?]+)/);
            if (pt && match && match[1]) {
              sessionStorage.setItem('playerToken_' + match[1], pt);
            }
          } catch (e) { }

          setGameLink(result.game_link);
          setStage('found');
          setIsLoading(false);
          return;
        }

        // Backend says queue expired
        if (result.status === 'expired') {
          setError(result.message || 'No opponent found. Your balance is available to play again or withdraw.');
          setStage('expired');
          setIsLoading(false);
          return;
        }

        // Backend says invite was declined
        if (result.status === 'declined') {
          setError(result.message || 'Your match invite was declined.');
          setStage('declined');
          setIsLoading(false);
          return;
        }

        if (result.status === 'not_found') {
          throw new Error(result.message || 'Session expired. Please try again.');
        }

        attempts++;
        if (attempts >= maxAttempts) {
          // Frontend timeout - treat as expired
          setError('No opponent found in this session. wait a bit and try again.');
          setStage('expired');
          setIsLoading(false);
          return;
        }

        // Check if expires_at has passed (if provided)
        if (result.expires_at) {
          const expiresAt = new Date(result.expires_at);
          if (expiresAt <= new Date()) {
            setError('Queue expired. Your balance is available to play again or withdraw.');
            setStage('expired');
            setIsLoading(false);
            return;
          }
        }

        // Adaptive backoff
        if (result.status === 'queued') {
          pollInterval = Math.min(pollInterval * 1.15, 3000);
        }
        setTimeout(poll, pollInterval);
      };

      await poll();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      setStage('error');
      setIsLoading(false);
    }
  }, [setDisplayName]);

  const startGame = useCallback(async (phone: string, stake: number, displayName?: string, opts?: { create_private?: boolean; matchcode?: string; invite_phone?: string; source?: string; action_token?: string }) => {
    setIsLoading(true);
    setError(null);
    setStage('payment');

    try {
      // Initiate stake
      const stakeResult = await initiateStake(phone, stake, displayName, opts);

      // Save player_token to localStorage if provided
      if (stakeResult.player_token) {
        localStorage.setItem('player_token', stakeResult.player_token);
      }

      // Handle PENDING payment status (real mobile money flow)
      if (stakeResult.status === 'PENDING') {
        setStage('payment_pending');
        setIsLoading(false);

        // Poll by phone to wait for payment confirmation
        const maxPaymentAttempts = 40; // 2 minutes (40 * 3 seconds)
        let paymentAttempts = 0;

        const pollPayment = async (): Promise<void> => {
          try {
            const result = await pollMatchStatusByPhone(phone);

            // Save player_token if provided
            if (result.player_token) {
              localStorage.setItem('player_token', result.player_token);
            }

            // If player appears in queue (payment confirmed), transition to matching
            if (result.status === 'queued' && result.queue_token) {
              // Store the queue token
              sessionStorage.setItem('queueToken', result.queue_token);

              // Store display name
              if (result.my_display_name) {
                setDisplayName(result.my_display_name);
              }

              // Now start regular polling with queue token
              setStage('matching');
              setIsLoading(true);
              startPolling(result.queue_token, displayName);
              return;
            }

            // If matched immediately (unlikely but possible)
            if (result.status === 'matched' && result.game_link) {
              // Start prefetching cards
              prefetchCommonCards();
              
              try {
                const u = new URL(result.game_link);
                const pt = u.searchParams.get('pt');
                const match = u.pathname.match(/\/g\/([^/?]+)/);
                if (pt && match && match[1]) {
                  sessionStorage.setItem('playerToken_' + match[1], pt);
                }
              } catch (e) { }

              setGameLink(result.game_link);
              setStage('found');
              setIsLoading(false);
              return;
            }

            // Still waiting for payment
            paymentAttempts++;
            if (paymentAttempts >= maxPaymentAttempts) {
              throw new Error('Payment timeout. If you completed the payment, refresh this page in a moment to check your queue status. Otherwise, please try again.');
            }

            setTimeout(pollPayment, 3000);
          } catch (err) {
            // If polling fails, keep trying unless we've hit max attempts
            paymentAttempts++;
            if (paymentAttempts >= maxPaymentAttempts) {
              throw err;
            }
            setTimeout(pollPayment, 3000);
          }
        };

        // Start polling for payment confirmation
        pollPayment();
        return;
      }

      // Handle private-created flow
      if (stakeResult.status === 'private_created') {
        setPrivateMatch({ matchcode: stakeResult.matchcode || '', expires_at: stakeResult.expires_at, queue_id: stakeResult.queue_id, queue_token: stakeResult.queue_token });
        setIsLoading(false);
        // Auto-start waiting for inviter if queue_token is available
        if (stakeResult.queue_token) {
          // startPolling will set stage to 'matching'
          startPolling(stakeResult.queue_token, displayName);
        } else {
          setStage('private_created' as MatchmakingStage);
        }
        return;
      }

      // Store player ID (queue token)
      sessionStorage.setItem('queueToken', stakeResult.queue_token || stakeResult.player_id);

      // Store display name if provided
      if (stakeResult.display_name) {
        setDisplayName(stakeResult.display_name);
      }

      // Check if immediately matched
      if (stakeResult.status === 'matched' && stakeResult.game_link) {
        // Start prefetching cards immediately
        prefetchCommonCards();
        
        // Persist the player token from the game_link (pt query param) for reconnect fallback
        try {
          const u = new URL(stakeResult.game_link);
          const pt = u.searchParams.get('pt');
          const match = u.pathname.match(/\/g\/([^/?]+)/);
          if (pt && match && match[1]) {
            sessionStorage.setItem('playerToken_' + match[1], pt);
          }
        } catch (e) {
          // ignore URL parsing errors
        }

        setGameLink(stakeResult.game_link);
        setStage('found');
        setIsLoading(false);
        return;
      }

      // Show matching stage
      setStage('matching');

      // Adaptive polling: Start aggressive, back off if no match
      const maxAttempts = 60; // 3 minutes max
      let attempts = 0;
      let pollInterval = 1000; // Start at 1 second for faster match detection

      const poll = async (): Promise<void> => {
        const token = stakeResult.queue_token || stakeResult.player_id;
        const result = await pollMatchStatus(token);

        // If server returns display names on match, persist them (helpful for UI)
        if (result.my_display_name) setDisplayName(result.my_display_name);

        if (result.status === 'matched' && result.game_link) {
          // Match found! Start prefetching cards immediately
          prefetchCommonCards();
          
          // Persist player token from the returned game_link
          try {
            const u = new URL(result.game_link);
            const pt = u.searchParams.get('pt');
            const match = u.pathname.match(/\/g\/([^/?]+)/);
            if (pt && match && match[1]) {
              sessionStorage.setItem('playerToken_' + match[1], pt);
            }
          } catch (e) { }

          setGameLink(result.game_link);
          setStage('found');
          setIsLoading(false);
          return;
        }

        // Backend says queue expired
        if (result.status === 'expired') {
          setError(result.message || 'No opponent found. Your balance is available to play again or withdraw.');
          setStage('expired');
          setIsLoading(false);
          return;
        }

        // Backend says invite was declined
        if (result.status === 'declined') {
          setError(result.message || 'Your match invite was declined.');
          setStage('declined');
          setIsLoading(false);
          return;
        }

        if (result.status === 'not_found') {
          throw new Error(result.message || 'Session expired. Please try again.');
        }

        attempts++;
        if (attempts >= maxAttempts) {
          // Frontend timeout - treat as expired
          setError('No opponent found in this session. wait a bit and try again.');
          setStage('expired');
          setIsLoading(false);
          return;
        }

        // Check if expires_at has passed (if provided)
        if (result.expires_at) {
          const expiresAt = new Date(result.expires_at);
          if (expiresAt <= new Date()) {
            setError('Queue expired. Your balance is available to play again or withdraw.');
            setStage('expired');
            setIsLoading(false);
            return;
          }
        }

        // Adaptive backoff
        if (result.status === 'queued') {
          pollInterval = Math.min(pollInterval * 1.15, 3000);
        }
        setTimeout(poll, pollInterval);
      };

      await poll();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      setStage('error');
      setIsLoading(false);
    }
  }, [setDisplayName, startPolling]);

  const reset = useCallback(() => {
    setStage('form');
    setError(null);
    setGameLink(null);
    setIsLoading(false);
    setDisplayName(null);
    setPrivateMatch(null);
    // Clear session-scoped queue token
    try { sessionStorage.removeItem('queueToken'); } catch (e) {}
  }, [setDisplayName]);

  return {
    stage,
    error,
    gameLink,
    isLoading,
    startGame,
    startPolling,
    reset,
    displayName,
    privateMatch,
  };
}