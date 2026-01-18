package game

import (
	"errors"
	"math/rand"
	"sync"
	"time"
)

// Errors
var (
	ErrInvalidCard = errors.New("invalid card format")
	ErrDeckEmpty   = errors.New("deck is empty")
)

// Suit represents a card suit
type Suit string

const (
	Hearts   Suit = "hearts"
	Diamonds Suit = "diamonds"
	Clubs    Suit = "clubs"
	Spades   Suit = "spades"
)

// Rank represents a card rank
type Rank string

const (
	Two   Rank = "2"
	Three Rank = "3"
	Four  Rank = "4"
	Five  Rank = "5"
	Six   Rank = "6"
	Seven Rank = "7"
	Eight Rank = "8"
	Nine  Rank = "9"
	Ten   Rank = "10"
	Jack  Rank = "J"
	Queen Rank = "Q"
	King  Rank = "K"
	Ace   Rank = "A"
)

// Card represents a playing card
type Card struct {
	Suit Suit `json:"suit"`
	Rank Rank `json:"rank"`
}

// String returns a string representation of the card (e.g., "AS" for Ace of Spades)
func (c Card) String() string {
	suitChar := map[Suit]string{
		Hearts:   "H",
		Diamonds: "D",
		Clubs:    "C",
		Spades:   "S",
	}
	return string(c.Rank) + suitChar[c.Suit]
}

// ImageCode returns the code used for card images (e.g., "AS" for Ace of Spades)
func (c Card) ImageCode() string {
	return c.String()
}

// IsSpecial returns true if the card has special effects
// In classic Ugandan Matatu, only Ace (wild suit) and 2 (penalty) are special
func (c Card) IsSpecial() bool {
	return c.Rank == Two || c.Rank == Ace
}

// PointValue returns the point value for the "cutting" rule scoring
func (c Card) PointValue() int {
	switch c.Rank {
	case Two:
		return 20
	case Ace:
		return 15
	case King:
		return 13
	case Queen:
		return 12
	case Jack:
		return 11
	case Ten:
		return 10
	case Nine:
		return 9
	case Eight:
		return 8
	case Seven:
		return 7
	case Six:
		return 6
	case Five:
		return 5
	case Four:
		return 4
	case Three:
		return 3
	default:
		return 0
	}
}

// CanPlayOn checks if this card can be played on the given card with the current suit
// Classic Ugandan Matatu rules:
// - Ace (wild suit) can be played on any card
// - Regular cards must match by suit or rank
func (c Card) CanPlayOn(other *Card, currentSuit Suit) bool {
	// If no top card (game just started), any card can be played
	if other == nil {
		return true
	}

	// Ace is wild suit - can be played on anything
	if c.Rank == Ace {
		return true
	}

	// Check suit or rank match
	return c.Suit == currentSuit || c.Rank == other.Rank
}

// Deck represents a deck of cards
type Deck struct {
	Cards []Card
	mu    sync.Mutex
}

// NewDeck creates a new shuffled deck of 52 cards
func NewDeck() *Deck {
	suits := []Suit{Hearts, Diamonds, Clubs, Spades}
	ranks := []Rank{Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Jack, Queen, King, Ace}

	cards := make([]Card, 0, 52)
	for _, suit := range suits {
		for _, rank := range ranks {
			cards = append(cards, Card{Suit: suit, Rank: rank})
		}
	}

	deck := &Deck{Cards: cards}
	deck.Shuffle()
	return deck
}

// Shuffle randomizes the deck
func (d *Deck) Shuffle() {
	d.mu.Lock()
	defer d.mu.Unlock()

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	r.Shuffle(len(d.Cards), func(i, j int) {
		d.Cards[i], d.Cards[j] = d.Cards[j], d.Cards[i]
	})
}

// Draw removes and returns the top card from the deck
func (d *Deck) Draw() (Card, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if len(d.Cards) == 0 {
		return Card{}, errors.New("deck is empty")
	}

	card := d.Cards[len(d.Cards)-1]
	d.Cards = d.Cards[:len(d.Cards)-1]
	return card, nil
}

// DrawMultiple draws multiple cards from the deck
func (d *Deck) DrawMultiple(count int) ([]Card, error) {
	cards := make([]Card, 0, count)
	for i := 0; i < count; i++ {
		card, err := d.Draw()
		if err != nil {
			return cards, err
		}
		cards = append(cards, card)
	}
	return cards, nil
}

// Remaining returns the number of cards left in the deck
func (d *Deck) Remaining() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.Cards)
}

// AddCards adds cards back to the bottom of the deck
func (d *Deck) AddCards(cards []Card) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Cards = append(cards, d.Cards...)
}

// ReshuffleFrom takes cards from discard pile (except top) and adds to deck
func (d *Deck) ReshuffleFrom(discardPile []Card) {
	if len(discardPile) <= 1 {
		return
	}

	// Take all but the top card
	cardsToAdd := discardPile[:len(discardPile)-1]
	d.AddCards(cardsToAdd)
	d.Shuffle()
}

// GetCards returns a copy of the deck's cards for serialization
func (d *Deck) GetCards() []Card {
	d.mu.Lock()
	defer d.mu.Unlock()
	cards := make([]Card, len(d.Cards))
	copy(cards, d.Cards)
	return cards
}

// SetCards sets the deck's cards from a slice (for deserialization)
func (d *Deck) SetCards(cards []Card) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Cards = make([]Card, len(cards))
	copy(d.Cards, cards)
}
