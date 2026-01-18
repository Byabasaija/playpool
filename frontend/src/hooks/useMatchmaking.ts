import { useState, useCallback } from 'react';
import { initiateStake, pollMatchStatus } from '../utils/apiClient';

export type MatchmakingStage = 'form' | 'payment' | 'matching' | 'found' | 'error';

export function useMatchmaking() {
  const [stage, setStage] = useState<MatchmakingStage>('form');
  const [error, setError] = useState<string | null>(null);
  const [gameLink, setGameLink] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const startGame = useCallback(async (phone: string, stake: number) => {
    setIsLoading(true);
    setError(null);
    setStage('payment');

    try {
      // Initiate stake
      const stakeResult = await initiateStake(phone, stake);
      
      // Store player ID
      localStorage.setItem('playerId', stakeResult.player_id);

      // Check if immediately matched
      if (stakeResult.status === 'matched' && stakeResult.game_link) {
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
        const result = await pollMatchStatus(stakeResult.player_id);

        if (result.status === 'matched' && result.game_link) {
          setGameLink(result.game_link);
          setStage('found');
          setIsLoading(false);
          return;
        }

        if (result.status === 'not_found') {
          throw new Error('Session expired. Please try again.');
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
  }, []);

  const reset = useCallback(() => {
    setStage('form');
    setError(null);
    setGameLink(null);
    setIsLoading(false);
  }, []);

  return {
    stage,
    error,
    gameLink,
    isLoading,
    startGame,
    reset
  };
}