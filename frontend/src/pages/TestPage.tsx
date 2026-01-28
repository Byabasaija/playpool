import React, { useState, useCallback, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebsockets';
import { WSMessage } from '../types/websocket.types';
import { Card } from '../types/game.types';

interface PlayerState {
  playerId: string;
  hand: Card[];
  myTurn: boolean;
  opponentCardCount: number;
}

export const TestPage: React.FC = () => {
  const [gameData, setGameData] = useState('');
  const [parsedData, setParsedData] = useState<any>(null);
  const [player1State, setPlayer1State] = useState<PlayerState | null>(null);
  const [player2State, setPlayer2State] = useState<PlayerState | null>(null);
  const [topCard, setTopCard] = useState<Card | null>(null);
  const [currentSuit, setCurrentSuit] = useState<string | null>(null);
  const [targetSuit, setTargetSuit] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');

  const handlePlayer1Message = useCallback((msg: WSMessage) => {
    console.log('[Player 1] Message:', msg);

    // Handle game over from card_played message
    if (msg.type === 'card_played' && msg.game_over) {
      setGameOver(true);
      setWinner(msg.winner || null);
      if (msg.win_type) {
        setMessage(`Game Over! Result: ${msg.win_type === 'draw' ? "It's a Draw!" : 'Winner: ' + msg.winner}`);
      }
    }

    if (msg.type === 'game_state' || msg.type === 'game_update') {
      setPlayer1State({
        playerId: msg.my_id || '',
        hand: msg.my_hand || [],
        myTurn: msg.my_turn ?? false,
        opponentCardCount: msg.opponent_card_count || 0,
      });
      if (msg.top_card) setTopCard(msg.top_card);
      if (msg.current_suit) setCurrentSuit(msg.current_suit);
      if (msg.target_suit) setTargetSuit(msg.target_suit);
      if (msg.game_over) {
        setWinner(msg.winner || null);
        setGameOver(true);
      }
    }
    if (msg.message) setMessage(msg.message);
  }, []);

  const handlePlayer2Message = useCallback((msg: WSMessage) => {
    console.log('[Player 2] Message:', msg);
    if (msg.type === 'game_state' || msg.type === 'game_update') {
      setPlayer2State({
        playerId: msg.my_id || '',
        hand: msg.my_hand || [],
        myTurn: msg.my_turn ?? false,
        opponentCardCount: msg.opponent_card_count || 0,
      });
    }
  }, []);

  // Memoize WebSocket configs to prevent reconnections on re-render
  const ws1Config = useMemo(() => ({
    gameToken: parsedData?.game_token || '',
    playerToken: parsedData?.player1_token || '',
    onMessage: handlePlayer1Message,
    onOpen: () => console.log('[Player 1] ✅ CONNECTED'),
    onClose: () => console.log('[Player 1] ❌ DISCONNECTED'),
    onError: (err: Event) => console.error('[Player 1] ERROR:', err),
  }), [parsedData?.game_token, parsedData?.player1_token, handlePlayer1Message]);

  const ws2Config = useMemo(() => ({
    gameToken: parsedData?.game_token || '',
    playerToken: parsedData?.player2_token || '',
    onMessage: handlePlayer2Message,
    onOpen: () => console.log('[Player 2] ✅ CONNECTED'),
    onClose: () => console.log('[Player 2] ❌ DISCONNECTED'),
    onError: (err: Event) => console.error('[Player 2] ERROR:', err),
  }), [parsedData?.game_token, parsedData?.player2_token, handlePlayer2Message]);

  const ws1 = useWebSocket(ws1Config);
  const ws2 = useWebSocket(ws2Config);

  const handleLoadGame = () => {
    try {
      const data = JSON.parse(gameData);
      console.log('📦 Parsed game data:', {
        game_token: data.game_token,
        player1_token: data.player1_token,
        player2_token: data.player2_token,
        has_player1_token: !!data.player1_token,
        has_player2_token: !!data.player2_token,
      });
      setParsedData(data);
      setMessage('Game loaded! Connecting players...');
    } catch (e) {
      alert('Invalid JSON');
      console.error('JSON parse error:', e);
    }
  };

  const playCard = (playerNum: 1 | 2, card: Card) => {
    const ws = playerNum === 1 ? ws1 : ws2;
    if (!ws.connected) {
      alert(`Player ${playerNum} not connected`);
      return;
    }

    ws.send({
      type: 'play_card',
      data: {
        card: `${card.rank}${card.suit[0].toUpperCase()}`,
        declared_suit: card.rank === 'A' ? 'hearts' : undefined,
      },
    });
  };

  const drawCard = (playerNum: 1 | 2) => {
    const ws = playerNum === 1 ? ws1 : ws2;
    if (!ws.connected) {
      alert(`Player ${playerNum} not connected`);
      return;
    }
    ws.send({ type: 'draw_card', data: {} });
  };

  const renderCard = (card: Card, onClick?: () => void, disabled?: boolean) => {
    const suitSymbols: { [key: string]: string } = {
      hearts: '♥',
      diamonds: '♦',
      clubs: '♣',
      spades: '♠',
    };
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

    return (
      <button
        key={`${card.suit}-${card.rank}`}
        onClick={onClick}
        disabled={disabled}
        className={`
          border-2 rounded px-3 py-2 min-w-[60px] text-sm font-bold
          ${isRed ? 'text-red-600' : 'text-black'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 cursor-pointer'}
          ${card.suit === targetSuit && card.rank === '7' ? 'ring-2 ring-yellow-400' : ''}
        `}
      >
        {card.rank}{suitSymbols[card.suit]}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Test Draw Game</h1>

        {!parsedData ? (
          <div className="bg-white p-6 rounded shadow">
            <h2 className="text-xl font-semibold mb-4">Step 1: Paste Test Game JSON</h2>
            <p className="text-sm text-gray-600 mb-4">
              Run: <code className="bg-gray-100 px-2 py-1 rounded">POST /api/v1/game/test/draw</code>
            </p>
            <textarea
              className="w-full border rounded p-3 font-mono text-sm h-32 mb-4"
              placeholder='Paste JSON response here...'
              value={gameData}
              onChange={(e) => setGameData(e.target.value)}
            />
            <button
              onClick={handleLoadGame}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
            >
              Load Game
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status Bar */}
            <div className="bg-white p-4 rounded shadow">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Game ID:</span> {parsedData.game_id}
                </div>
                <div>
                  <span className="font-semibold">Target Suit:</span> {targetSuit || parsedData.target_suit}
                </div>
                <div>
                  <span className="font-semibold">Player 1:</span>{' '}
                  {ws1.connected ? '🟢 Connected' : '🔴 Disconnected'}
                </div>
                <div>
                  <span className="font-semibold">Player 2:</span>{' '}
                  {ws2.connected ? '🟢 Connected' : '🔴 Disconnected'}
                </div>
              </div>
              {message && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm">
                  {message}
                </div>
              )}
            </div>

            {/* Game Over */}
            {gameOver && (
              <div className="bg-yellow-50 border-2 border-yellow-400 p-6 rounded text-center">
                <h2 className="text-2xl font-bold mb-2">
                  {winner ? (winner === player1State?.playerId ? 'Player 1 Wins!' : 'Player 2 Wins!') : "It's a Draw!"}
                </h2>
                <p className="text-gray-700">Check the console and backend logs for draw refund details</p>
              </div>
            )}

            {/* Table State */}
            <div className="bg-white p-6 rounded shadow">
              <h3 className="font-semibold mb-3">Table</h3>
              <div className="flex gap-4 items-center">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Top Card</div>
                  {topCard ? renderCard(topCard) : <div className="text-gray-400">None</div>}
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Current Suit</div>
                  <div className="text-lg">{currentSuit || 'None'}</div>
                </div>
              </div>
            </div>

            {/* Player 1 */}
            <div className={`bg-white p-6 rounded shadow ${player1State?.myTurn ? 'ring-2 ring-green-400' : ''}`}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-lg">
                  Player 1 {player1State?.myTurn ? '(Your Turn)' : ''}
                </h3>
                <button
                  onClick={() => drawCard(1)}
                  disabled={!player1State?.myTurn || !ws1.connected}
                  className="bg-gray-200 px-4 py-2 rounded text-sm hover:bg-gray-300 disabled:opacity-50"
                >
                  Draw Card
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {player1State?.hand.map((card) =>
                  renderCard(
                    card,
                    () => playCard(1, card),
                    !player1State?.myTurn || !ws1.connected
                  )
                )}
              </div>
              <div className="text-sm text-gray-500 mt-2">
                Opponent has {player1State?.opponentCardCount || 0} cards
              </div>
            </div>

            {/* Player 2 */}
            <div className={`bg-white p-6 rounded shadow ${player2State?.myTurn ? 'ring-2 ring-green-400' : ''}`}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-lg">
                  Player 2 {player2State?.myTurn ? '(Your Turn)' : ''}
                </h3>
                <button
                  onClick={() => drawCard(2)}
                  disabled={!player2State?.myTurn || !ws2.connected}
                  className="bg-gray-200 px-4 py-2 rounded text-sm hover:bg-gray-300 disabled:opacity-50"
                >
                  Draw Card
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {player2State?.hand.map((card) =>
                  renderCard(
                    card,
                    () => playCard(2, card),
                    !player2State?.myTurn || !ws2.connected
                  )
                )}
              </div>
              <div className="text-sm text-gray-500 mt-2">
                Opponent has {player2State?.opponentCardCount || 0} cards
              </div>
            </div>

            {/* Instructions */}
            <div className="bg-blue-50 p-4 rounded border border-blue-200 text-sm">
              <p className="font-semibold mb-2">Instructions:</p>
              <p>{parsedData.instructions}</p>
              <p className="mt-2 text-yellow-700">
                Note: The 7♥ is highlighted with a yellow ring - click it to trigger the draw!
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
