export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
}

export interface GameState {
  gameId: string | null;
  gameToken: string | null;
  playerToken: string | null;
  playerId: string | null;
  myHand: Card[];
  opponentCardCount: number;
  topCard: Card | null;
  discardPileCards: Card[];
  currentSuit: Card['suit'] | null;
  targetSuit: Card['suit'] | null;
  targetCard: Card | null;
  myTurn: boolean;
  drawStack: number;
  deckCount: number;
  stakeAmount: number;
  connected: boolean;
  canPass: boolean;

  // Persisted display names (optional)
  myDisplayName?: string | null;
  opponentDisplayName?: string | null;

  // Connection flags
  myConnected?: boolean;
  opponentConnected?: boolean;

  // Transient server-provided winner info (optional)
  winner?: string | null;
  winType?: string | null;
  lastPlayerPoints?: number | null;
  lastOpponentPoints?: number | null;
}

export type WinType = 'classic' | 'chop';

export interface GameOverData {
  isWinner: boolean;
  winType: WinType;
  playerPoints?: number;
  opponentPoints?: number;
  isDraw?: boolean;
}