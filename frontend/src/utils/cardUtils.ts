import { Card } from '../types/game.types';

export const SUIT_SYMBOLS: Record<Card['suit'], string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

export const SUIT_COLORS: Record<Card['suit'], string> = {
  hearts: '#e74c3c',
  diamonds: '#e74c3c',
  clubs: '#2c3e50',
  spades: '#2c3e50'
};

export function getCardImageUrl(card: Card): string {
  const rankMap: Record<string, string> = {
    'A': 'A', '2': '2', '3': '3', '4': '4', '5': '5',
    '6': '6', '7': '7', '8': '8', '9': '9', '10': '0',
    'J': 'J', 'Q': 'Q', 'K': 'K'
  };
  const suitMap: Record<string, string> = {
    'hearts': 'H', 'diamonds': 'D', 'clubs': 'C', 'spades': 'S'
  };
  
  const rank = rankMap[card.rank] || card.rank;
  const suit = suitMap[card.suit] || card.suit.charAt(0).toUpperCase();
  const code = rank + suit;
  
  return `https://deckofcardsapi.com/static/img/${code}.png`;
}

export function getCardBackUrl(): string {
  return 'https://deckofcardsapi.com/static/img/back.png';
}

export function cardToCode(card: Card): string {
  return card.rank + card.suit.charAt(0).toUpperCase();
}

export function canPlayCard(
  card: Card,
  topCard: Card | null,
  currentSuit: Card['suit'] | null,
  drawStack: number
): boolean {
  if (!topCard) return true;
  
  // If there's a draw stack, only 2s can be played to counter
  if (drawStack > 0) {
    return card.rank === '2';
  }
  
  // Ace is wild suit - can be played on anything EXCEPT a 2
  if (card.rank === 'A') {
    return topCard.rank !== '2';
  }
  
  // Check suit or rank match
  return card.suit === currentSuit || card.rank === topCard.rank;
}
