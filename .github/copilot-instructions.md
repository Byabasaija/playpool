# PlayPool AI Coding Instructions

## Project Overview
PlayPool is a real-money pool game platform built with Go backend and dual frontend (vanilla HTML/JS + React/TypeScript). Phone numbers serve as unique user identities with Mobile Money integration for payments.

## Architecture Patterns

### Backend Structure (`/internal`)
- **Clean Architecture**: `api/` (handlers), `game/` (domain logic), `models/` (data), `config/` (settings), `database/` (persistence), `redis/` (caching)
- **Dependency Injection**: Pass `db *sqlx.DB`, `rdb *redis.Client`, `cfg *config.Config` to handlers
- **Error Handling**: Return JSON errors with `c.JSON(status, gin.H{"error": msg})`
- **Phone Identity**: Use phone numbers as primary keys, validate with `+256XXXXXXXXX` format

### Game Logic (`/internal/game`)
- **State Management**: Games stored in Redis during play, archived to PostgreSQL after completion
- **Real-time**: WebSocket connections for gameplay, long-polling fallback
- **Disconnect Handling**: 2-minute grace period, then forfeit (configurable via `DISCONNECT_GRACE_PERIOD_SECONDS`)
- **Matchmaking**: FIFO queue by stake amount, separate pools per stake tier

### Payment System
- **Virtual Escrow**: Single MM account holds all funds, DB ledger tracks per-game balances
- **Double-entry**: `escrow_ledger` table records all money movements with `entry_type` ('STAKE_IN', 'PAYOUT', 'COMMISSION', 'REFUND')
- **Commission**: 10% platform fee deducted from pot before payout

### Frontend Integration
- **Dual Setup**: Legacy vanilla HTML/JS in `/web`, modern React/TypeScript in `/web/frontend`
- **API Calls**: Use `fetch()` for REST, native WebSocket for real-time gameplay
- **CORS**: Enabled in development, configure via `FRONTEND_URL` env var

## Development Workflow

### Environment Setup
```bash
# Run dev environment setup
./scripts/dev.sh

# Start backend
go run cmd/server/main.go

# Start React frontend (if using modern UI)
cd web/frontend && npm run dev
```

### Database Operations
- **Migrations**: Run SQL files in `/migrations/` order
- **Connection**: Use `sqlx` with named queries (`:param` syntax)
- **Transactions**: Wrap multi-table operations in `tx, err := db.Beginx()`

### Testing
- **Mock Mode**: Set `MOCK_MODE=true` in `.env` for development (simulates MM/USSD responses)
- **Game Logic**: Test card interactions, win conditions, special effects
- **API**: Test endpoints return expected JSON structure

## Code Patterns

### Handler Functions
```go
func HandlerName(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Extract params
        phone := c.GetHeader("X-Phone-Number")
        
        // Business logic
        result, err := someService(db, phone)
        if err != nil {
            c.JSON(400, gin.H{"error": err.Error()})
            return
        }
        
        // Return JSON
        c.JSON(200, result)
    }
}
```

### Game State Operations
```go
// Load from Redis
gameJSON, err := rdb.Get(ctx, "game:"+gameID+":state").Result()
if err == redis.Nil {
    return nil, errors.New("game not found")
}

// Save to Redis with TTL
gameJSON, _ := json.Marshal(gameState)
rdb.Set(ctx, "game:"+gameID+":state", gameJSON, time.Hour)
```

### Database Queries
```go
// Named queries with sqlx
query := `SELECT * FROM players WHERE phone_number = :phone`
stmt, err := db.PrepareNamed(query)
err = stmt.Get(&player, map[string]interface{}{"phone": phone})
```

## Key Files & Directories

- **`cmd/server/main.go`**: Entry point, initializes all components
- **`internal/config/config.go`**: Environment variable loading with defaults
- **`internal/game/manager.go`**: Game lifecycle and matchmaking logic
- **`internal/game/state.go`**: Core game state and player management
- **`internal/models/models.go`**: Database table structs with sqlx tags
- **`migrations/001_initial_schema.sql`**: Database schema with indexes
- **`scripts/dev.sh`**: Development environment setup and checks
- **`.env`**: Environment configuration (copy from `.env.example`)

## Common Gotchas

- **Phone Validation**: Always validate `+256XXXXXXXXX` format before database operations
- **Redis Keys**: Use structured keys like `game:{id}:state`, `player:{phone}:session`
- **WebSocket Headers**: Include `X-Phone-Number` header for authentication
- **Game Tokens**: Generate secure tokens with `crypto/rand`, validate expiry
- **Escrow Balance**: Always check virtual balances before payouts
- **Disconnect Timer**: Start 2-minute countdown on WebSocket disconnect, not HTTP disconnect

## Testing Priorities

1. **Game Logic**: Card play validation, win conditions, special effects
2. **Payment Flow**: Stake → escrow → payout sequence
3. **Matchmaking**: Queue management, token generation, expiry handling
4. **WebSocket**: Connection lifecycle, message broadcasting, disconnect handling
5. **API**: Request/response formats, error handling, authentication

## Deployment Notes

- **Single Binary**: `go build` produces self-contained executable
- **Systemd**: Use `scripts/playpool.service` for production deployment
- **Nginx**: Reverse proxy with static file serving from `/web`
- **SSL**: Required for production, configure certificates
- **Environment**: Separate `.env` files for dev/staging/prod
