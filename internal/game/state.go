package game

// GameStatus represents the current state of the game
type GameStatus string

const (
	StatusWaiting    GameStatus = "WAITING"
	StatusInProgress GameStatus = "IN_PROGRESS"
	StatusCompleted  GameStatus = "COMPLETED"
	StatusCancelled  GameStatus = "CANCELLED"
)
