// Game over screen — shown when a pool game ends.

import { useNavigate } from 'react-router-dom';
import { type PoolGameOverData } from '../../../types/pool.types';

interface GameOverScreenProps {
  gameOver: PoolGameOverData;
  stakeAmount: number;
}

export default function GameOverScreen({ gameOver, stakeAmount }: GameOverScreenProps) {
  const navigate = useNavigate();
  const youWon = gameOver.isWinner;

  const winTypeLabel = (() => {
    switch (gameOver.winType) {
      case 'pocket_8': return '8-Ball Victory';
      case 'illegal_8ball': return 'Illegal 8-Ball';
      case 'scratch_on_8': return 'Scratch on 8-Ball';
      case 'concede': return 'Conceded';
      case 'forfeit': return 'Forfeit';
      default: return gameOver.winType;
    }
  })();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0e1628]">
      <div className="p-8 text-center max-w-md mx-auto">
        <div className="mb-6">
          <div className={`h-24 w-24 rounded-full mx-auto flex items-center justify-center text-5xl ${
            youWon ? 'bg-green-900 animate-bounce' : 'bg-red-900'
          }`}>
            {youWon ? '!' : '..'}
          </div>
        </div>

        <h2 className={`text-3xl font-bold mb-4 ${youWon ? 'text-green-400' : 'text-red-400'}`}>
          {youWon ? 'You Won!' : 'You Lost'}
        </h2>

        <div className="mb-4">
          <span className="inline-block px-4 py-1 rounded-full text-sm font-semibold bg-gray-700 text-white">
            {winTypeLabel}
          </span>
        </div>

        <div className="space-y-3 mb-6">
          {youWon ? (
            <div className="bg-green-900/50 border border-green-600 rounded-lg p-4">
              <p className="text-2xl font-bold text-green-400 mb-1">
                +{((stakeAmount || 1000) * 2 * 0.85).toLocaleString()} UGX
              </p>
              <p className="text-sm text-gray-400">After 15% tax</p>
            </div>
          ) : (
            <div className="bg-red-900/50 border border-red-600 rounded-lg p-4">
              <p className="font-semibold text-red-300">Better luck next time!</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => navigate('/')}
            className="flex-1 bg-gray-700 text-white py-2 px-4 rounded-lg text-sm font-semibold hover:bg-gray-600"
          >
            New Game
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg text-sm font-semibold hover:bg-green-500"
          >
            Rematch
          </button>
        </div>
      </div>
    </div>
  );
}
