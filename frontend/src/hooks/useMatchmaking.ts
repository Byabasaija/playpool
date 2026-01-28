import { useState, useCallback } from 'react';
import { initiateStake, pollMatchStatus } from '../utils/apiClient';

export type MatchmakingStage = 'form' | 'payment' | 'matching' | 'found' | 'error' | 'private_created';

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
  const [privateMatch, setPrivateMatch] = useState<{ match_code: string; expires_at?: string; queue_id?: number; queue_token?: string } | null>(null);

  const setDisplayName = useCallback((name: string | null) => {
    setDisplayNameState(name);
    try {
      if (name) sessionStorage.setItem('playerDisplayName', name);
      else sessionStorage.removeItem('playerDisplayName');
    } catch (e) {
      // ignore storage errors
    }
  }, []);

  const startGame = useCallback(async (phone: string, stake: number, displayName?: string, opts?: { create_private?: boolean; match_code?: string }) => {
    setIsLoading(true);
    setError(null);
    setStage('payment');

    try {
      // Initiate stake
      const stakeResult = await initiateStake(phone, stake, displayName, opts);
      
      // Handle private-created flow
      if (stakeResult.status === 'private_created') {
        setPrivateMatch({ match_code: stakeResult.match_code || '', expires_at: stakeResult.expires_at, queue_id: stakeResult.queue_id, queue_token: stakeResult.queue_token });
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

      // Poll for match
      const maxAttempts = 180;
      let attempts = 0;

      const poll = async (): Promise<void> => {
        const token = stakeResult.queue_token || stakeResult.player_id;
        const result = await pollMatchStatus(token);

        // If server returns display names on match, persist them (helpful for UI)
        if (result.my_display_name) setDisplayName(result.my_display_name);

        if (result.status === 'matched' && result.game_link) {
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

        if (result.status === 'not_found') {
          throw new Error(result.message || 'Session expired. Please try again.');
        }

        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error('No opponent found. Please try again later.');
        }

        setTimeout(poll, 3000);
      };

      await poll();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      setStage('error');
      setIsLoading(false);
    }
  }, [setDisplayName]);

  const startPolling = useCallback(async (queueToken: string, displayName?: string) => {
    setIsLoading(true);
    setError(null);
    setStage('matching');

    // persist token for session
    try { sessionStorage.setItem('queueToken', queueToken); } catch (e) {}

    if (displayName) setDisplayName(displayName);

    try {
      const maxAttempts = 180;
      let attempts = 0;

      const poll = async (): Promise<void> => {
        const result = await pollMatchStatus(queueToken);

        if (result.my_display_name) setDisplayName(result.my_display_name);

        if (result.status === 'matched' && result.game_link) {
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

        if (result.status === 'not_found') {
          throw new Error(result.message || 'Session expired. Please try again.');
        }

        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error('No opponent found. Please try again later.');
        }

        setTimeout(poll, 3000);
      };

      await poll();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      setStage('error');
      setIsLoading(false);
    }
  }, [setDisplayName]);

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