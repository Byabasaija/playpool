# Matatu Betting Platform - Technical Specification

## 1. Executive Summary

A real-money, peer-to-peer Matatu card game platform where players stake money via USSD or Web using Mobile Money, get matched with opponents, play via web/mobile interface, and winners receive payouts automatically.

**Key Design Decisions:**
- Phone number is the unique user identity (no passwords/emails)
- Monolithic Go backend serving both web and future mobile apps
- Virtual escrow system (ledger in DB, actual funds in MM collections account)
- Simple disconnect handling: 2-minute grace period, then forfeit

---

## 2. System Architecture

### 2.1 High-Level Components

```
┌─────────────┐                              ┌─────────────┐
│   Player    │         USSD                 │   Player    │
│   (Phone)   │◄────────────────────────────►│   (Web/App) │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       ▼                                            │
┌──────────────┐                                    │
│ USSD Gateway │                                    │
│  (Internal)  │                                    │
└──────┬───────┘                                    │
       │                                            │
       └──────────────────┬─────────────────────────┘
                          │
                   ┌──────▼───────┐
                   │   Backend    │
                   │   Server     │
                   │    (Go)      │
                   └──────┬───────┘
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
│ Mobile Money│    │   Database  │    │    SMS     │
│ Collections │    │ (PostgreSQL)│    │  Gateway   │
│  & Payout   │    │   + Redis   │    │            │
└─────────────┘    └─────────────┘    └────────────┘
```

### 2.2 Virtual Escrow Model

```
┌─────────────────────────────────────────────────────┐
│           MM Collections Account                    │
│           (Actual Money - Single Account)           │
└─────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐     ┌─────▼─────┐    ┌─────▼─────┐
   │ Game 1  │     │  Game 2   │    │  Disputed │
   │ Escrow  │     │  Escrow   │    │   Funds   │
   │ 2000 UGX│     │ 10000 UGX │    │  5000 UGX │
   └─────────┘     └───────────┘    └───────────┘
   (DB ledger)     (DB ledger)      (DB ledger)
```

- All stakes collected into single MM Collections account
- Virtual escrow tracked per-game in database (double-entry ledger)
- Payouts disbursed from same MM account
- Disputed/refund funds held until resolution

### 2.3 Technology Stack

**Backend (Go API Server - Pure JSON, No HTML):**
- Go 1.21+
- Gin or Echo (HTTP framework)
- gorilla/websocket (real-time gameplay with long-polling fallback)
- GORM or sqlx (database access)
- PostgreSQL (database)
- Redis (session management, caching, game state)
- Go routines (background tasks for payouts - no external job queue needed)

**Frontend (Static Files - Served by Nginx/CDN):**
- Vanilla HTML5/CSS3/JavaScript (no framework)
- Fetch API for REST calls
- Native WebSocket client for real-time gameplay
- Responsive design (mobile-first)
- Static files cached by browser/CDN

**Future Mobile Apps:**
- React Native or Flutter
- Same API as web (no backend changes needed)

**Infrastructure:**
- Direct binary deployment (systemd service)
- Nginx (serves static files + reverse proxy to API)
- SSL/TLS certificates
- Cloud hosting (AWS/DigitalOcean)

**External Services:**
- Mobile Money API (Company's MM Collections & Payout API)
- USSD Gateway (Company's internal USSD gateway)
- SMS Gateway (Africa's Talking)

**Why Decoupled Static + API:**
- Clean separation: Go speaks JSON only, no HTML templates
- Mobile-ready: Same API works for iOS/Android apps
- Fast: Static files cached, API is lean
- Simple: No build step, no npm, no React for web
- Scalable: Frontend on CDN, API scales independently

**Why Go over Python:**
- Better concurrency for WebSocket connections (goroutines)
- Lower latency for real-time gameplay
- Compile-time type safety (critical for payment logic)
- Single binary deployment, smaller memory footprint
- Handles more concurrent games with fewer servers

### 2.4 Project Structure

```
/playmatatu
├── /cmd
│   └── /server
│       └── main.go              ← Entry point
├── /internal
│   ├── /api                     ← HTTP handlers (JSON only)
│   ├── /game                    ← Game logic
│   ├── /matchmaking             ← Queue & matching
│   ├── /payment                 ← MM integration
│   ├── /ussd                    ← USSD handlers
│   └── /ws                      ← WebSocket handlers
├── /web                         ← Static frontend (served by Nginx)
│   ├── index.html               ← Landing page
│   ├── game.html                ← Game interface
│   ├── /css
│   │   └── styles.css
│   ├── /js
│   │   ├── app.js               ← API calls, WebSocket client
│   │   └── game.js              ← Game UI logic
│   └── /images
│       └── /cards               ← Card images
├── /configs
├── /migrations
├── /scripts
│   ├── deploy.sh
│   └── playmatatu.service    ← systemd service
└── go.mod
```

---

## 3. Game Rules - Matatu (Classic Ugandan 2-Player)

### 3.1 Objective

**Two ways to win:**
1. **Classic Win:** Be the first player to empty your hand of all cards
2. **The "Chop" (Sudden Death):** Play the Seven (7) of the Target Suit to end the game - lowest points wins

### 3.2 Setup (2 Players)

- **Deck:** Standard 52-card deck
- **Deal:** Each player receives **7 cards**
- **Determining the Chopper/Target Suit:**
  - Immediately after dealing, flip the next card from the stock pile face-up
  - If this card is a **Seven (7)**, shuffle it back and draw again until a **non-seven** appears
  - The **suit** of this face-up card becomes the **Target Suit** for the "Chop" mechanism
  - This card is set aside (not in play) - it only determines the Target Suit
- **Starting Play:** The first player (randomly determined) starts by **playing any card from their hand** onto the center discard pile

### 3.3 Gameplay

- Players alternate turns
- On your turn, play a single card that matches the top card of the discard pile by either **rank** or **suit**
- **Cannot Play:** If you have no valid card, you must draw cards from the stock pile **until a playable card is found**, then you may play it or pass

### 3.4 Special Cards

| Card | Power/Action |
|------|--------------|
| **Ace (A)** | **Wild/Change Suit:** Can be played on any card. The player declares a new suit (Hearts, Diamonds, Clubs, or Spades) that the opponent must follow. |
| **Two (2)** | **Draw 2 Stack:** Forces the opponent to draw 2 cards unless they also play a 2. Playing a 2 passes the draw penalty back to the first player (stacking the draws: 2+2=4, 2+2+2=6, etc.). |
| **Jack (J)** | **Skip:** Skips the opponent's turn (you play again immediately). |
| **Eight (8)** | **Skip:** Skips the opponent's turn (you play again immediately). |
| **Seven (7)** | **Regular card, BUT if it's the Target Suit Seven → triggers "The Chop"** (see below) |
| **Three (3), Queen (Q), King (K)** | No power (regular cards - match by rank or suit) |

### 3.5 Stacking Twos

- If you play a '2', your opponent can play their own '2' to pass the penalty back to you
- The penalty **accumulates** with each '2' played in sequence:
  - First 2: Opponent must draw 2 or play 2
  - Second 2: Draw penalty becomes 4 cards
  - Third 2: Draw penalty becomes 6 cards (and so on)
- The player who cannot counter with a '2' draws all stacked cards

### 3.6 Winning Conditions (Two Ways)

**1. Classic Win - Playing All Cards**
- The first player to legally play their final card wins the round outright
- Winner declares **"Matatu!"**
- Game ends immediately

**2. The "Chop" - Sudden Death Point Win**
- When a player plays the **Seven (7) of the Target Suit**, the game ends immediately
- Both players count the points in their remaining hands
- **The player with the LOWEST points wins the round**
- This is called "chopping" the game

### 3.7 Scoring (Only Used for "Chop" Wins)

Points are calculated only when the game ends via "The Chop":

| Cards | Points |
|-------|--------|
| Two (2) | 20 points |
| Ace (A) | 15 points |
| King (K) | 13 points |
| Queen (Q) | 12 points |
| Jack (J) | 11 points |
| Numbered Cards (3-10) | Face Value (3=3 pts, 4=4 pts, 7=7 pts, etc.) |

**Winner:** The player with the **lowest total point value** wins that round

### 3.8 Edge Cases

**Empty Drawing Stack:**
- If drawing stack is empty and player cannot play, shuffle discard pile (except top card) to form new drawing stack
- If still no cards available, game is "cut" using point scoring

**Jack/Eight in 2-Player:**
- Skip gives current player back-to-back turns (play again immediately)

**Invalid Play Attempt:**
- Server rejects invalid plays
- Player must retry with valid card or draw

**Seven of Target Suit:**
- Can be played like a regular card (matching rank or suit)
- Immediately triggers "The Chop" ending when played
- Game cannot continue after this card is played

---

## 4. User Flow

### 4.1 Entry Flow (USSD)

```
1. Player dials *XXX*1# (USSD code)

2. Menu appears:
   ┌─────────────────────────────┐
   │ Welcome to PlayMatatu      │
   │                             │
   │ 1. Play                     │
   │ 2. Rules                    │
   └─────────────────────────────┘

3. Player selects Play (presses 1)

4. System prompts for stake:
   ┌─────────────────────────────┐
   │ Enter stake amount (UGX):   │
   │ (Minimum: 1000 UGX)         │
   └─────────────────────────────┘

5. Player enters stake (e.g., types 2000)

6. If stake < 1000:
   ┌─────────────────────────────┐
   │ Invalid amount. Minimum     │
   │ stake is 1000 UGX.          │
   │                             │
   │ Enter stake amount (UGX):   │
   └─────────────────────────────┘

7. If stake valid, system confirms:
   ┌─────────────────────────────┐
   │ Confirm payment of 2000 UGX │
   │ to play Matatu?             │
   │                             │
   │ Win up to 3600 UGX!         │
   │                             │
   │ 1. Yes                      │
   │ 2. No                       │
   └─────────────────────────────┘

8. Player confirms (presses 1)

9. Mobile Money payment prompt appears on phone

10. Player enters MM PIN to authorize payment

11. System response:
   ┌─────────────────────────────┐
   │ Payment received!           │
   │ Finding opponent...         │
   │ You'll get an SMS when      │
   │ matched.                    │
   └─────────────────────────────┘

12. If player selects Rules (option 2 from main menu):
   ┌─────────────────────────────┐
   │ MATATU RULES:               │
   │ - Match card by suit/rank   │
   │ - 8: Change suit            │
   │ - 2: Next player draws 2    │
   │ - J/A: Skip opponent        │
   │ - K: Play on any card       │
   │ - First to finish wins!     │
   └─────────────────────────────┘
```

### 4.2 Entry Flow (Web)

```
1. Player visits https://playmatatu.ug

2. Landing page:
   ┌─────────────────────────────────────┐
   │         🃏 PlayMatatu               │
   │    Play Matatu, Win Real Money!     │
   │                                     │
   │  Enter your phone number:           │
   │  ┌───────────────────────────┐      │
   │  │ +256 7XX XXX XXX          │      │
   │  └───────────────────────────┘      │
   │                                     │
   │  Enter stake (min 1000 UGX):        │
   │  ┌───────────────────────────┐      │
   │  │ 2000                      │ UGX  │
   │  └───────────────────────────┘      │
   │  Win up to: 3,600 UGX               │
   │                                     │
   │         [ Play Now ]                │
   └─────────────────────────────────────┘

3. Player enters phone number & selects stake

4. System initiates Mobile Money collection request
   - MM payment prompt sent to player's phone
   - Web shows: "Waiting for payment..."

5. Player approves payment on their phone (enters MM PIN)

6. Payment confirmed:
   ┌─────────────────────────────────────┐
   │  ✓ Payment received!                │
   │                                     │
   │  Finding opponent...                │
   │  ⏳ You'll receive an SMS when      │
   │     matched, or wait here.          │
   │                                     │
   │  [Keep this tab open or close it]   │
   └─────────────────────────────────────┘

7. When matched:
   - If tab still open → redirect to game
   - If tab closed → SMS sent with game link
```

**Note:** Phone number serves as the unique identity. No registration, no passwords. The act of paying via Mobile Money verifies ownership of the phone number.

### 4.3 Matchmaking Flow

```
1. Player's stake added to matchmaking pool
   - Pool organized by stake amount
   - FIFO matching (first in, first matched)
   - Same phone number cannot match itself

2. When another player with same stake joins:
   - Create game session
   - Move both stakes to virtual escrow (DB ledger entry)
   - Generate unique game URLs (one per player)
   - Send SMS to both players

3. SMS content:
   ┌─────────────────────────────────────┐
   │ Opponent found! Click to play:      │
   │ https://playmatatu.ug/g/ABC123      │
   │                                     │
   │ Stake: 1000 UGX                    │
   │ Prize: 1800 UGX (after commission) │
   │ Valid for 10 minutes                │
   └─────────────────────────────────────┘
```

### 4.4 Link Expiry & No-Show Handling

| Scenario | Outcome |
|----------|--------|
| Both players click within 10 min | Game starts normally |
| Player A clicks, Player B doesn't (10 min expires) | Game cancelled. Player A: full refund + priority re-queue. Player B: refund minus 5% no-show fee. |
| Neither player clicks (10 min expires) | Both refunded in full. Both flagged if repeat behavior. |
| Player has 3+ no-shows in 24 hours | Temporary 1-hour block from matchmaking |

### 4.5 Gameplay Flow

```
1. Player clicks SMS/web link → Opens game in mobile browser

2. Loading screen:
   - Verify phone number (via game token)
   - Load game state
   - Establish WebSocket connection (with long-polling fallback)

3. Waiting screen (if opponent hasn't joined):
   ┌─────────────────────────────┐
   │ Waiting for opponent...     │
   │ ⏱️ 9:45 remaining           │
   └─────────────────────────────┘

4. Game starts when both players connected:
   - Cards dealt
   - Random player chosen to start
   - Game interface displays

5. Turn-based gameplay:
   - Active player sees "Your Turn"
   - Inactive player sees "Opponent's Turn"
   - Play card or draw
   - WebSocket updates both screens in real-time

6. Game ends:
   - Winner determined
   - Victory/Defeat screen shown
   - Payout initiated automatically
```

### 4.6 Payout Flow

```
1. Game ends → Winner determined by server

2. Server calculates payout:
   - Total pot: 2000 UGX (1000 x 2)
   - Commission: 10% = 200 UGX
   - Winner gets: 1800 UGX

3. Virtual escrow release:
   - Update DB ledger: game escrow → payout
   - Commission credited to platform revenue ledger

4. Automatic payout via Mobile Money Disbursement API:
   - Send 1800 UGX to winner's phone number
   - Retry up to 3 times on failure
   
5. Winner receives:
   - In-game notification: "You won 1800 UGX!"
   - Mobile Money SMS: "You have received 1800 UGX..."
   - Platform SMS: "Congrats! 1800 UGX sent to your number."

6. Loser receives:
   - In-game notification: "Better luck next time!"
   - Platform SMS: "Thanks for playing! Try again?"
```

---

## 5. Database Schema

### 5.1 Tables

```sql
-- Users/Players (phone number is the unique identity - no passwords)
CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_games_played INT DEFAULT 0,
    total_games_won INT DEFAULT 0,
    total_winnings DECIMAL(10,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_blocked BOOLEAN DEFAULT FALSE,
    block_reason VARCHAR(100),
    block_until TIMESTAMP,
    disconnect_count INT DEFAULT 0,
    no_show_count INT DEFAULT 0,
    last_active TIMESTAMP
);

-- Virtual Escrow Ledger (tracks funds per game)
CREATE TABLE escrow_ledger (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES game_sessions(id),
    entry_type VARCHAR(20), -- 'STAKE_IN', 'PAYOUT', 'COMMISSION', 'REFUND'
    player_id INT REFERENCES players(id),
    amount DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    description VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    player_id INT REFERENCES players(id),
    transaction_type VARCHAR(20), -- 'STAKE', 'PAYOUT', 'REFUND'
    amount DECIMAL(10,2) NOT NULL,
    momo_transaction_id VARCHAR(100),
    status VARCHAR(20), -- 'PENDING', 'COMPLETED', 'FAILED'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Game Sessions
CREATE TABLE game_sessions (
    id SERIAL PRIMARY KEY,
    game_token VARCHAR(100) UNIQUE NOT NULL,
    player1_id INT REFERENCES players(id),
    player2_id INT REFERENCES players(id),
    stake_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20), -- 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
    winner_id INT REFERENCES players(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    expiry_time TIMESTAMP NOT NULL
);

-- Game State (stored in Redis during gameplay, archived here after)
CREATE TABLE game_states (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES game_sessions(id),
    game_state JSONB NOT NULL, -- Full game state snapshot
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Game Moves (audit trail)
CREATE TABLE game_moves (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES game_sessions(id),
    player_id INT REFERENCES players(id),
    move_number INT NOT NULL,
    move_type VARCHAR(20), -- 'PLAY_CARD', 'DRAW_CARD', 'DECLARE_SUIT'
    card_played VARCHAR(5), -- e.g., 'AS', '7H', 'KC'
    suit_declared VARCHAR(10), -- for 8s
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Matchmaking Queue
CREATE TABLE matchmaking_queue (
    id SERIAL PRIMARY KEY,
    player_id INT REFERENCES players(id),
    phone_number VARCHAR(15) NOT NULL,
    stake_amount DECIMAL(10,2) NOT NULL,
    transaction_id INT REFERENCES transactions(id),
    status VARCHAR(20) DEFAULT 'WAITING', -- 'WAITING', 'MATCHED', 'EXPIRED'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    matched_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

-- Disputes (for manual review)
CREATE TABLE disputes (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES game_sessions(id),
    reported_by INT REFERENCES players(id),
    dispute_type VARCHAR(50), -- 'DISCONNECTION', 'CHEATING', 'PAYMENT_ISSUE'
    description TEXT,
    status VARCHAR(20) DEFAULT 'OPEN', -- 'OPEN', 'INVESTIGATING', 'RESOLVED'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);
```

### 5.2 Redis Data Structures

```
# Active game state (expires after game completion)
game:{session_id}:state = {
    "deck": [...],
    "discard_pile": [...],
    "player1_hand": [...],
    "player2_hand": [...],
    "current_turn": "player1_id",
    "last_played_card": "7H",
    "current_suit": "hearts",
    "special_effect_active": null,
    "draw_stack": 0
}

# Player session mapping
player:{phone_number}:session = "session_id"

# WebSocket connection tracking
session:{session_id}:connections = {
    "player1_id": "connection_id_1",
    "player2_id": "connection_id_2"
}
```

---

## 6. API Endpoints

### 6.1 USSD Webhook

```
POST /api/ussd
Content-Type: application/x-www-form-urlencoded

Request:
    sessionId: string
    serviceCode: string
    phoneNumber: string
    text: string (user's USSD input)

Response:
    CON {menu_text}     # Continue session
    END {final_text}    # End session
```

### 6.2 Mobile Money Callbacks

```
POST /api/momo/callback
Content-Type: application/json

Request:
    {
        "transaction_id": "MM_TXN_12345",
        "phone_number": "+256700123456",
        "amount": 1000,
        "status": "SUCCESS",
        "timestamp": "2025-01-15T10:30:00Z"
    }

Response:
    200 OK
```

### 6.3 Game REST API

```
GET /api/game/{game_token}
Headers:
    X-Phone-Number: +256700123456

Response:
    {
        "game_id": "abc123",
        "status": "IN_PROGRESS",
        "stake": 1000,
        "prize": 1800,
        "opponent_connected": true,
        "your_turn": true
    }
```

### 6.4 WebSocket Events

```
Client → Server Events:

connect:
    {
        "game_token": "abc123",
        "phone_number": "+256700123456"
    }

play_card:
    {
        "card": "7H"
    }

draw_card:
    {}

declare_suit:
    {
        "suit": "hearts"
    }

---

Server → Client Events:

game_start:
    {
        "your_hand": ["AS", "7H", "KC", "3D", "9S"],
        "opponent_card_count": 5,
        "top_card": "5C",
        "current_suit": "clubs",
        "your_turn": true
    }

card_played:
    {
        "player": "opponent",
        "card": "7D",
        "cards_remaining": 4,
        "new_top_card": "7D",
        "current_suit": "diamonds"
    }

card_drawn:
    {
        "player": "you",
        "card": "KH",
        "cards_remaining": 6
    }

turn_change:
    {
        "your_turn": true
    }

special_effect:
    {
        "effect": "skip",
        "message": "Opponent played Ace. You lose this turn!"
    }

game_over:
    {
        "winner": "you",
        "prize": 1800,
        "message": "Congratulations! You won 1800 UGX!"
    }

opponent_disconnected:
    {
        "message": "Opponent disconnected. Waiting 2 minutes...",
        "countdown": 120
    }

error:
    {
        "message": "Invalid move. Card doesn't match."
    }
```

---

## 7. Game Logic Implementation

### 7.1 Core Classes

```python
from enum import Enum
from typing import List, Optional
import random

class Suit(Enum):
    HEARTS = "hearts"
    DIAMONDS = "diamonds"
    CLUBS = "clubs"
    SPADES = "spades"

class Rank(Enum):
    TWO = "2"
    THREE = "3"
    FOUR = "4"
    FIVE = "5"
    SIX = "6"
    SEVEN = "7"
    EIGHT = "8"
    NINE = "9"
    TEN = "10"
    JACK = "J"
    QUEEN = "Q"
    KING = "K"
    ACE = "A"

class Card:
    def __init__(self, suit: Suit, rank: Rank):
        self.suit = suit
        self.rank = rank
    
    def __str__(self):
        return f"{self.rank.value}{self.suit.value[0].upper()}"
    
    def is_special(self) -> bool:
        return self.rank in [Rank.TWO, Rank.EIGHT, Rank.JACK, Rank.KING, Rank.ACE]
    
    def can_play_on(self, other: 'Card', current_suit: Suit) -> bool:
        # King can be played on anything
        if self.rank == Rank.KING:
            return True
        
        # Eight can be played on anything
        if self.rank == Rank.EIGHT:
            return True
        
        # Check suit or rank match
        return self.suit == current_suit or self.rank == other.rank

class Deck:
    def __init__(self):
        self.cards: List[Card] = []
        self._build_deck()
    
    def _build_deck(self):
        for suit in Suit:
            for rank in Rank:
                self.cards.append(Card(suit, rank))
    
    def shuffle(self):
        random.shuffle(self.cards)
    
    def draw(self) -> Optional[Card]:
        return self.cards.pop() if self.cards else None
    
    def remaining(self) -> int:
        return len(self.cards)

class Player:
    def __init__(self, player_id: str, phone_number: str):
        self.id = player_id
        self.phone_number = phone_number
        self.hand: List[Card] = []
    
    def add_card(self, card: Card):
        self.hand.append(card)
    
    def remove_card(self, card: Card) -> bool:
        if card in self.hand:
            self.hand.remove(card)
            return True
        return False
    
    def has_card(self, card: Card) -> bool:
        return card in self.hand
    
    def card_count(self) -> int:
        return len(self.hand)
    
    def has_playable_card(self, top_card: Card, current_suit: Suit) -> bool:
        return any(card.can_play_on(top_card, current_suit) for card in self.hand)

class GameState:
    def __init__(self, player1: Player, player2: Player):
        self.player1 = player1
        self.player2 = player2
        self.deck = Deck()
        self.discard_pile: List[Card] = []
        self.current_turn = player1.id
        self.current_suit: Optional[Suit] = None
        self.draw_stack = 0  # For stacking 2s
        self.winner: Optional[str] = None
        self.game_over = False
        
    def initialize(self):
        """Set up the game"""
        self.deck.shuffle()
        
        # Deal 5 cards to each player
        for _ in range(5):
            self.player1.add_card(self.deck.draw())
            self.player2.add_card(self.deck.draw())
        
        # Flip first card to discard pile
        first_card = self.deck.draw()
        self.discard_pile.append(first_card)
        self.current_suit = first_card.suit
        
        # If first card is special, handle it
        if first_card.rank == Rank.EIGHT:
            # Random suit for starting 8
            self.current_suit = random.choice(list(Suit))
    
    def get_top_card(self) -> Optional[Card]:
        return self.discard_pile[-1] if self.discard_pile else None
    
    def get_current_player(self) -> Player:
        return self.player1 if self.current_turn == self.player1.id else self.player2
    
    def get_opponent(self) -> Player:
        return self.player2 if self.current_turn == self.player1.id else self.player1
    
    def switch_turn(self):
        self.current_turn = self.player2.id if self.current_turn == self.player1.id else self.player1.id
    
    def can_play_card(self, player_id: str, card: Card) -> tuple[bool, str]:
        """Check if a card can be played"""
        if self.game_over:
            return False, "Game is over"
        
        if self.current_turn != player_id:
            return False, "Not your turn"
        
        player = self.get_current_player()
        if not player.has_card(card):
            return False, "You don't have that card"
        
        # If there's a draw stack (from 2s), player must play a 2 or draw
        if self.draw_stack > 0:
            if card.rank != Rank.TWO:
                return False, "Must play a 2 or draw cards"
        
        top_card = self.get_top_card()
        if not card.can_play_on(top_card, self.current_suit):
            return False, "Card doesn't match suit or rank"
        
        return True, "Valid move"
    
    def play_card(self, player_id: str, card: Card, declared_suit: Optional[Suit] = None) -> dict:
        """Execute a card play"""
        can_play, message = self.can_play_card(player_id, card)
        if not can_play:
            return {"success": False, "message": message}
        
        player = self.get_current_player()
        opponent = self.get_opponent()
        
        # Remove card from player's hand
        player.remove_card(card)
        
        # Add to discard pile
        self.discard_pile.append(card)
        
        # Update current suit
        if card.rank == Rank.EIGHT:
            if declared_suit:
                self.current_suit = declared_suit
            else:
                return {"success": False, "message": "Must declare suit for 8"}
        else:
            self.current_suit = card.suit
        
        # Check for win
        if player.card_count() == 0:
            self.game_over = True
            self.winner = player_id
            return {
                "success": True,
                "game_over": True,
                "winner": player_id,
                "effect": None
            }
        
        # Handle special cards
        effect = self._handle_special_card(card, opponent)
        
        # Switch turn unless effect says otherwise
        if effect.get("skip_opponent", False):
            pass  # Keep same turn
        else:
            self.switch_turn()
        
        return {
            "success": True,
            "game_over": False,
            "effect": effect
        }
    
    def _handle_special_card(self, card: Card, opponent: Player) -> dict:
        """Handle special card effects"""
        if card.rank == Rank.TWO:
            self.draw_stack += 2
            return {
                "type": "draw_stack",
                "amount": self.draw_stack,
                "message": f"Opponent must draw {self.draw_stack} cards or play a 2"
            }
        
        elif card.rank == Rank.JACK:
            # In 2-player, reverse = skip
            return {
                "type": "skip",
                "skip_opponent": True,
                "message": "Jack played! Opponent skipped!"
            }
        
        elif card.rank == Rank.ACE:
            return {
                "type": "skip",
                "skip_opponent": False,
                "message": "Ace played! Opponent skipped!"
            }
        
        elif card.rank == Rank.KING:
            return {
                "type": "wild_rank",
                "message": "King played! Suit stays the same"
            }
        
        elif card.rank == Rank.EIGHT:
            return {
                "type": "wild_suit",
                "message": f"8 played! Suit changed to {self.current_suit.value}"
            }
        
        return {}
    
    def draw_card(self, player_id: str) -> dict:
        """Player draws a card"""
        if self.game_over:
            return {"success": False, "message": "Game is over"}
        
        if self.current_turn != player_id:
            return {"success": False, "message": "Not your turn"}
        
        player = self.get_current_player()
        
        # If there's a draw stack, draw that many cards
        if self.draw_stack > 0:
            cards_drawn = []
            for _ in range(self.draw_stack):
                card = self._draw_from_deck()
                if card:
                    player.add_card(card)
                    cards_drawn.append(str(card))
            
            self.draw_stack = 0
            self.switch_turn()
            
            return {
                "success": True,
                "cards": cards_drawn,
                "count": len(cards_drawn),
                "message": f"Drew {len(cards_drawn)} cards due to 2s"
            }
        
        # Normal draw
        card = self._draw_from_deck()
        if not card:
            return {"success": False, "message": "No cards to draw"}
        
        player.add_card(card)
        
        # Check if drawn card is playable (optional auto-play)
        # For now, just draw and end turn
        self.switch_turn()
        
        return {
            "success": True,
            "card": str(card),
            "message": "Drew 1 card"
        }
    
    def _draw_from_deck(self) -> Optional[Card]:
        """Draw from deck, reshuffle discard if needed"""
        card = self.deck.draw()
        
        if not card and len(self.discard_pile) > 1:
            # Reshuffle discard pile (keep top card)
            top_card = self.discard_pile.pop()
            self.deck.cards = self.discard_pile
            self.deck.shuffle()
            self.discard_pile = [top_card]
            card = self.deck.draw()
        
        return card
```

### 7.2 Game Manager

```python
from typing import Dict, Optional
import redis
import json

class GameManager:
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.active_games: Dict[str, GameState] = {}
    
    def create_game(self, session_id: str, player1_phone: str, player2_phone: str) -> GameState:
        """Create a new game session"""
        player1 = Player(f"p1_{session_id}", player1_phone)
        player2 = Player(f"p2_{session_id}", player2_phone)
        
        game = GameState(player1, player2)
        game.initialize()
        
        self.active_games[session_id] = game
        self._save_game_state(session_id, game)
        
        return game
    
    def get_game(self, session_id: str) -> Optional[GameState]:
        """Retrieve game state"""
        if session_id in self.active_games:
            return self.active_games[session_id]
        
        # Load from Redis if not in memory
        game_data = self.redis.get(f"game:{session_id}:state")
        if game_data:
            game = self._deserialize_game(game_data)
            self.active_games[session_id] = game
            return game
        
        return None
    
    def _save_game_state(self, session_id: str, game: GameState):
        """Persist game state to Redis"""
        game_data = self._serialize_game(game)
        self.redis.setex(
            f"game:{session_id}:state",
            3600,  # 1 hour expiry
            game_data
        )
    
    def _serialize_game(self, game: GameState) -> str:
        """Convert game state to JSON"""
        return json.dumps({
            "player1_id": game.player1.id,
            "player1_phone": game.player1.phone_number,
            "player1_hand": [str(card) for card in game.player1.hand],
            "player2_id": game.player2.id,
            "player2_phone": game.player2.phone_number,
            "player2_hand": [str(card) for card in game.player2.hand],
            "deck": [str(card) for card in game.deck.cards],
            "discard_pile": [str(card) for card in game.discard_pile],
            "current_turn": game.current_turn,
            "current_suit": game.current_suit.value if game.current_suit else None,
            "draw_stack": game.draw_stack,
            "game_over": game.game_over,
            "winner": game.winner
        })
    
    def _deserialize_game(self, data: str) -> GameState:
        """Restore game state from JSON"""
        # Implementation would parse JSON and reconstruct GameState
        pass
```

---

## 8. Security Measures

### 8.1 Session Security

- **Token Generation:** `SHA256(session_id + phone_number + secret_salt + timestamp)`
- **Token Expiry:** 30 minutes from game creation
- **Rate Limiting:** 
  - Max 3 concurrent games per phone number
  - Max 10 game attempts per hour per phone number
  - Max 100 API calls per minute per IP

### 8.2 Anti-Cheating

- All game logic server-side
- Never send opponent's cards to client
- Validate every move server-side
- Log all moves with timestamps
- Flag suspicious patterns (e.g., instant moves)
- Disconnect detection and handling

### 8.3 Payment Security

- Use HTTPS only
- Validate Mobile Money callbacks with signatures
- Idempotent payment processing
- Double-entry accounting
- Transaction reconciliation jobs
- Escrow account balance monitoring

### 8.4 Data Protection

- Hash phone numbers in logs
- Encrypt sensitive data at rest
- Comply with data protection regulations
- Regular security audits
- PCI DSS compliance for payment handling

---

## 9. Error Handling & Edge Cases

### 9.1 Disconnection Scenarios

**Simple Rule:** 2-minute grace period, then forfeit. No exceptions.

```
Player disconnects
       │
       ▼
   Grace Period
   (2 minutes)
       │
       ├─── Reconnects? → Game continues exactly where it left off
       │
       └─── Doesn't reconnect? → FORFEIT (opponent wins)
```

| Scenario | Handling |
|----------|----------|
| Player disconnects before game starts | Cancel game, refund both stakes |
| Player disconnects during game | 2-minute grace period, then opponent wins by forfeit |
| Player reconnects within 2 minutes | Game continues, no penalty |
| Both players disconnect | Game paused. First to return waits for opponent (new 2-min timer). After 5 min total → game cancelled, both refunded. |
| Player never clicks SMS link | Game expires after 10 minutes. Clicker: full refund + priority re-queue. Non-clicker: refund minus 5% no-show fee. |
| Repeated disconnections (>20% of games) | Flag account, restrict stake amounts or block |

**What the opponent sees during disconnect:**
```
┌─────────────────────────────────┐
│                                 │
│   Opponent disconnected         │
│                                 │
│   ⏱️ 1:45 remaining             │
│                                 │
│   If they don't return,         │
│   you win automatically.        │
│                                 │
└─────────────────────────────────┘
```

### 9.2 Payment Failures

| Scenario | Handling |
|----------|----------|
| Initial stake payment fails | Player notified via USSD, not added to queue |
| Payout fails | Retry 3 times, then manual intervention + notification |
| Partial payment received | Hold in escrow, contact player for resolution |
| Double payment | Refund automatically, log for audit |
| Mobile Money timeout | Cancel transaction after 5 minutes, refund |

### 9.3 Game Edge Cases

| Scenario | Handling |
|----------|----------|
| Draw pile empty, can't play | Reshuffle discard pile (except top card) |
| Both draw and discard empty | Impossible with 52 cards & 2 players, but pass turn if occurs |
| Invalid card play attempt | Reject move, prompt player to try again |
| Player tries to play out of turn | Reject with "Not your turn" message |
| Game exceeds 30 minutes | Force draw, split pot 50/50 |
| Server crash during game | Restore from Redis, continue game |

### 9.4 Matchmaking Issues

| Scenario | Handling |
|----------|----------|
| No opponent found in 15 mins | Refund stake, notify player |
| Opponent found but link expires | Refund both, allow re-queue |
| Same player tries to match self | Prevent via phone number check |
| Stake amount mismatch | Keep in separate queues by amount |

---

## 10. Performance Requirements

### 10.1 Response Times

- **USSD Response:** < 2 seconds
- **API Endpoints:** < 200ms (p95)
- **WebSocket Latency:** < 100ms for card plays
- **Payment Processing:** < 30 seconds end-to-end
- **Game State Updates:** Real-time (< 50ms)

### 10.2 Scalability Targets

- **Concurrent Games:** 1,000 simultaneous games
- **Daily Active Users:** 10,000+
- **Peak TPS:** 500 transactions per second
- **Database:** Handle 1M+ game records
- **WebSocket Connections:** 2,000 concurrent

### 10.3 Availability

- **Uptime Target:** 99.5% (excludes scheduled maintenance)
- **Recovery Time:** < 15 minutes for critical failures
- **Data Backup:** Hourly incremental, daily full backup
- **Disaster Recovery:** 4-hour RTO, 1-hour RPO

---

## 11. Monitoring & Analytics

### 11.1 Key Metrics

**Business Metrics:**
- Daily/Monthly Active Users (DAU/MAU)
- Total stakes per day
- Average stake per game
- Win/loss distribution
- Commission revenue
- Player retention rate
- Average games per player
- Refund rate

**Technical Metrics:**
- API response times
- WebSocket connection success rate
- Payment success rate
- Game completion rate
- Error rates by endpoint
- Server CPU/Memory usage
- Database query performance
- Cache hit rates

**Game Metrics:**
- Average game duration
- Disconnection rate
- Cards played per game
- Special card usage frequency
- Turn response time

### 11.2 Alerting

**Critical Alerts (immediate):**
- Payment processing failures > 5%
- API downtime
- Database connection failures
- WebSocket server crash
- Escrow balance mismatch

**Warning Alerts (15 min delay):**
- Error rate > 1%
- Response time > 1 second
- Disconnection rate > 10%
- Matchmaking queue stuck
- Unusual betting patterns

### 11.3 Logging

```python
# Structured logging format
{
    "timestamp": "2025-01-15T10:30:00Z",
    "level": "INFO",
    "service": "game_engine",
    "session_id": "abc123",
    "player_id": "p1_abc123",
    "event": "card_played",
    "data": {
        "card": "7H",
        "valid": true,
        "turn_number": 5
    }
}
```

**Log Retention:**
- Application logs: 30 days
- Transaction logs: 7 years (compliance)
- Game audit trails: 1 year
- Error logs: 90 days

---

## 12. Deployment & DevOps

### 12.1 Infrastructure

```bash
# Direct deployment structure
# Backend: Compiled Go binary running as systemd service
# Database: PostgreSQL installed on server or managed service
# Cache: Redis installed on server or managed service
# Web server: Nginx serving static files + reverse proxy

/opt/playmatatu/
├── playmatatu              # Go binary
├── web/                    # Static files
├── configs/
└── logs/

# Services:
# - playmatatu.service (systemd)
# - postgresql.service
# - redis.service
# - nginx.service
```

**Nginx Configuration (Static + API Proxy):**
```nginx
server {
    listen 443 ssl;
    server_name playmatatu.ug;
    
    # Static files (cached)
    location / {
        root /var/www/playmatatu;
        try_files $uri $uri/ /index.html;
        expires 1d;
        add_header Cache-Control "public, immutable";
    }
    
    # API proxy (JSON only)
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 12.2 CI/CD Pipeline

```yaml
# GitHub Actions workflow
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run tests
        run: pytest tests/
  
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: |
          ssh deploy@server 'cd /opt/playmatatu && ./scripts/deploy.sh'
```

### 12.3 Rollback Plan

1. **Immediate rollback:** `systemctl stop playmatatu && cp /opt/playmatatu/backups/playmatatu.previous /opt/playmatatu/playmatatu && systemctl start playmatatu`
2. **Database rollback:** Run migration rollback scripts
3. **Monitoring:** Check error rates return to normal
4. **Communication:** Notify users if downtime occurred

---

## 13. Compliance & Legal

### 13.1 Gambling License Requirements

**Uganda Gaming Board:**
- Apply for online gaming license
- Pay licensing fees
- Regular compliance audits
- Age verification (18+)
- Responsible gambling measures
- Anti-money laundering (AML) procedures

### 13.2 Terms of Service

Key clauses:
- Minimum age: 18 years
- Geographic restrictions (Uganda only initially)
- Fair play policy
- Dispute resolution process
- Payout timelines
- Commission structure disclosure
- Account suspension/termination conditions

### 13.3 Privacy Policy

- Data collection transparency
- Phone number usage
- Transaction history storage
- Third-party sharing (Mobile Money providers)
- User rights (access, deletion)
- GDPR/Data Protection Act compliance

### 13.4 Responsible Gaming

- Self-exclusion option
- Stake limits (daily/weekly)
- Loss limits
- Time limits
- Cooling-off periods
- Problem gambling resources
- Age verification

---

## 14. Launch Plan

### 14.1 Phase 1: Beta Testing (2-4 weeks)

- Invite 100 beta testers
- Stakes: 500 UGX only
- Limited to Kampala region
- Intensive monitoring
- Daily feedback sessions
- Bug fixes and optimization

### 14.2 Phase 2: Soft Launch (1 month)

- Open to 1,000 users
- Add 1000 and 2000 UGX stake tiers
- Expand to Uganda nationwide
- Referral program
- Social media marketing
- Influencer partnerships

### 14.3 Phase 3: Full Launch

- Remove user caps
- Add all stake tiers (500, 1000, 2000, 5000, 10000 UGX)
- Tournament mode (future feature)
- Leaderboards
- Achievements/badges
- Mobile app development

### 14.4 Marketing Strategy

**Channels:**
- Radio ads (local stations)
- Social media (Facebook, Twitter, Instagram, TikTok)
- SMS campaigns
- Campus ambassadors
- Matatu/taxi advertising
- Influencer partnerships

**Messaging:**
- "Play Matatu, Win Real Money"
- "Challenge Your Friends, Win Cash"
- "The Digital Matatu Experience"

---

## 15. Future Enhancements

### 15.1 Planned Features

**Short-term (3-6 months):**
- Tournaments (8-16 player brackets)
- Practice mode (no stakes)
- Player profiles and stats
- Friend challenges
- Chat during gameplay
- Replay system

**Medium-term (6-12 months):**
- Native mobile apps (iOS/Android)
- Multiple stake tiers
- VIP tiers with bonuses
- Referral rewards
- Daily challenges
- Seasonal events

**Long-term (12+ months):**
- Multi-player games (3-4 players)
- Team tournaments
- Sponsored tournaments
- Cross-border play (Kenya, Tanzania)
- Cryptocurrency payments
- NFT cards/skins

### 15.2 Expansion Plans

- **Geographic:** Kenya, Tanzania, Rwanda
- **Game Variants:** Different regional Matatu rules
- **Additional Games:** Other card games (Rummy, Whot, etc.)
- **B2B:** White-label solution for other operators

---

## 16. Cost Estimates

### 16.1 Development Costs

| Item | Cost (USD) |
|------|-----------|
| Backend development | 5,000 - 8,000 |
| Frontend development | 3,000 - 5,000 |
| Mobile Money integration | 2,000 - 3,000 |
| USSD integration | 1,500 - 2,500 |
| Testing & QA | 2,000 - 3,000 |
| **Total Development** | **13,500 - 21,500** |

### 16.2 Operational Costs (Monthly)

| Item | Cost (USD) |
|------|-----------|
| Cloud hosting | 200 - 500 |
| Database | 100 - 200 |
| SMS costs (per 1000 messages) | 10 - 20 |
| Mobile Money transaction fees | Variable (1-2% of volume) |
| USSD shortcode rental | 200 - 500 |
| SSL certificates | 10 - 50 |
| Monitoring tools | 50 - 100 |
| **Total Monthly** | **570 - 1,370** |

### 16.3 Revenue Projections

**Assumptions:**
- Commission: 10% per game
- Average stake: 2,000 UGX (~$0.54)
- Daily active users: 500 (conservative)
- Games per user per day: 3

**Monthly Revenue:**
- Games per month: 500 users × 3 games × 30 days = 45,000 games
- Total stakes: 45,000 × 2,000 UGX = 90,000,000 UGX (~$24,300)
- Commission (10%): 9,000,000 UGX (~$2,430)

**Break-even:** ~6-9 months with moderate growth

---

## 17. Risk Assessment

### 17.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Server downtime | Medium | High | Load balancing, redundancy, monitoring |
| Payment failures | Medium | High | Retry logic, manual review process |
| Cheating/fraud | Medium | High | Server-side validation, audit trails |
| WebSocket issues | Low | Medium | Fallback to polling, connection recovery |
| Database corruption | Low | High | Regular backups, replication |

### 17.2 Business Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| License rejection | Medium | Critical | Hire legal consultant, ensure compliance |
| Low user adoption | Medium | High | Marketing campaign, beta testing |
| Negative cash flow | Medium | High | Start small, scale gradually |
| Competitor launch | Medium | Medium | Differentiate, build loyalty |
| Regulatory changes | Low | High | Stay informed, adapt quickly |

### 17.3 Legal Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Unlicensed operation | Low | Critical | Obtain license before launch |
| Minor access | Low | High | Age verification, KYC |
| Money laundering | Low | High | AML procedures, transaction monitoring |
| Data breach | Low | High | Encryption, security audits |
| Dispute litigation | Medium | Medium | Clear T&Cs, dispute resolution process |

---

## 18. Success Metrics

### 18.1 Launch Success (First 3 Months)

- 1,000+ registered users
- 500+ daily active users
- 10,000+ games played
- 95%+ game completion rate
- < 5% payment failure rate
- < 2% dispute rate

### 18.2 Growth Targets (6 Months)

- 5,000+ registered users
- 2,000+ daily active users
- 100,000+ games played
- $10,000+ monthly revenue
- 50%+ user retention (30-day)
- 4.0+ app store rating (if launched)

### 18.3 Long-term Vision (12+ Months)

- #1 online card game in Uganda
- 50,000+ registered users
- 10,000+ daily active users
- $50,000+ monthly revenue
- Expansion to 3+ countries
- Tournament ecosystem established

---

## 19. Support & Maintenance

### 19.1 Customer Support

**Channels:**
- WhatsApp support line
- Email: support@playmatatu.ug
- In-app help center
- FAQ page

**Response Times:**
- Critical issues: < 1 hour
- Payment issues: < 4 hours
- General queries: < 24 hours

### 19.2 Maintenance Windows

- Scheduled maintenance: Sunday 2-4 AM EAT
- Emergency maintenance: As needed with user notification
- Updates deployed during low-traffic periods

### 19.3 Issue Escalation

1. **Tier 1:** Basic queries (FAQ, account issues)
2. **Tier 2:** Technical issues (bugs, disconnections)
3. **Tier 3:** Payment disputes, fraud investigation
4. **Tier 4:** Legal, compliance, executive decisions

---

## Appendix A: Sample API Requests/Responses

### USSD Session Example

```
// Initial request
POST /api/ussd
sessionId=ATUid_12345&serviceCode=*123*1#&phoneNumber=256700123456&text=

Response:
CON Welcome to PlayMatatu
1. Play
2. Rules

// User selects Play (option 1)
POST /api/ussd
sessionId=ATUid_12345&serviceCode=*123*1#&phoneNumber=256700123456&text=1

Response:
CON Enter stake amount (UGX):
(Minimum: 1000 UGX)

// User enters stake amount
POST /api/ussd
sessionId=ATUid_12345&serviceCode=*123*1#&phoneNumber=256700123456&text=1*2000

Response:
CON Confirm payment of 2000 UGX to play Matatu?
Win up to 3600 UGX!
1. Yes
2. No

// User confirms
POST /api/ussd
sessionId=ATUid_12345&serviceCode=*123*1#&phoneNumber=256700123456&text=1*2000*1

Response:
END Payment request sent. You'll receive an SMS when matched with an opponent.

// If user selects Rules (option 2 from main menu)
POST /api/ussd
sessionId=ATUid_12345&serviceCode=*123*1#&phoneNumber=256700123456&text=2

Response:
END MATATU RULES: Match card by suit/rank. 8=Change suit, 2=Draw 2, J/A=Skip, K=Wild. First to finish wins!
```

### Game WebSocket Flow

```javascript
// Client connects
socket.emit('connect', {
  game_token: 'abc123',
  phone_number: '+256700123456'
});

// Server responds
socket.on('game_start', (data) => {
  console.log(data);
  // {
  //   your_hand: ['AS', '7H', 'KC', '3D', '9S'],
  //   opponent_card_count: 5,
  //   top_card: '5C',
  //   current_suit: 'clubs',
  //   your_turn: true
  // }
});

// Player plays card
socket.emit('play_card', { card: '7H' });

// Server broadcasts to both players
socket.on('card_played', (data) => {
  // Update UI with new game state
});
```

---

## Appendix B: Database Indexes

```sql
-- Performance optimization indexes
CREATE INDEX idx_players_phone ON players(phone_number);
CREATE INDEX idx_transactions_player ON transactions(player_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_game_sessions_status ON game_sessions(status);
CREATE INDEX idx_game_sessions_players ON game_sessions(player1_id, player2_id);
CREATE INDEX idx_matchmaking_queue_status ON matchmaking_queue(status, stake_amount);
CREATE INDEX idx_game_moves_session ON game_moves(session_id);
```

---

## Appendix C: Environment Variables

```bash
# Application
APP_ENV=production
APP_SECRET_KEY=your-secret-key-here
DEBUG=false

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/playmatatu
REDIS_URL=redis://localhost:6379/0

# Mobile Money
MOMO_API_KEY=your-momo-api-key
MOMO_API_SECRET=your-momo-secret
MOMO_COLLECTION_URL=https://api.momo.com/collection
MOMO_DISBURSEMENT_URL=https://api.momo.com/disbursement

# USSD (Internal Gateway)
USSD_SHORTCODE=*123*1#
USSD_GATEWAY_URL=https://ussd.internal.company.com
USSD_API_KEY=your-ussd-api-key
USSD_API_SECRET=your-ussd-api-secret

# SMS (Africa's Talking)
SMS_SENDER_ID=PlayMatatu
AFRICAS_TALKING_USERNAME=your-username
AFRICAS_TALKING_API_KEY=your-api-key

# Game Settings
GAME_EXPIRY_MINUTES=10
DISCONNECT_GRACE_PERIOD_SECONDS=120
NO_SHOW_FEE_PERCENTAGE=5
COMMISSION_PERCENTAGE=10

# Security
JWT_SECRET=your-jwt-secret
SESSION_TIMEOUT_MINUTES=30

# Monitoring
SENTRY_DSN=your-sentry-dsn
LOG_LEVEL=INFO
```

---

**End of Technical Specification**

*Version 1.1 | January 2026*

**Changelog v1.1:**
- Changed backend from Python/FastAPI to Go
- Added web entry point (in addition to USSD)
- Clarified virtual escrow model (DB ledger + single MM account)
- Updated disconnect handling: simple 2-minute grace period, then forfeit
- Added no-show fee (5%) for players who don't click game link
- Added player tracking fields (disconnect_count, no_show_count, is_blocked)
- Added escrow_ledger table for double-entry accounting
- Decoupled architecture: Static frontend (Vanilla HTML/CSS/JS) + Pure JSON API
- API designed to serve web, mobile apps, and future clients
- Removed testing section (manual testing only)
- Renamed to PlayMatatu


┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                              │
├─────────────────┬─────────────────┬─────────────────────────┤
│   USSD (Phone)  │   Web Browser   │   Future Mobile App     │
│                 │   (HTML/JS)     │   (React Native/Flutter)│
└────────┬────────┴────────┬────────┴────────────┬────────────┘
         │                 │                      │
         │      HTTP/WebSocket APIs               │
         └─────────────────┼──────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Go API    │
                    │   Server    │
                    │  (Backend)  │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
      ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
      │  Redis    │  │ PostgreSQL│  │ External  │
      │  (State)  │  │   (Data)  │  │   APIs    │
      └───────────┘  └───────────┘  └───────────┘