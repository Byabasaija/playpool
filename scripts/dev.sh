#!/bin/bash

# Development environment setup script for PlayMatatu

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check if PostgreSQL is running
check_postgres() {
    log_step "Checking PostgreSQL..."
    # Use full path to pg_isready and correct credentials
    export PGPASSWORD="password1"
    if /opt/homebrew/opt/postgresql@12/bin/pg_isready -q -h localhost -U postgres; then
        log_info "PostgreSQL is running"
        unset PGPASSWORD
        return 0
    else
        log_error "PostgreSQL is not running or cannot connect"
        log_info "Start PostgreSQL with: brew services start postgresql@12"
        log_info "Or check connection: psql -h localhost -U postgres"
        unset PGPASSWORD
        return 1
    fi
}

# Check if Redis is running
check_redis() {
    log_step "Checking Redis..."
    if redis-cli ping > /dev/null 2>&1; then
        log_info "Redis is running"
        return 0
    else
        log_warn "Redis is not running"
        log_info "Starting Redis..."
        brew services start redis
        sleep 2
        if redis-cli ping > /dev/null 2>&1; then
            log_info "Redis started successfully"
            return 0
        else
            log_error "Failed to start Redis"
            return 1
        fi
    fi
}

# Create database if it doesn't exist
setup_database() {
    log_step "Setting up database..."
    
    # Use full path to PostgreSQL tools and correct credentials
    export PGPASSWORD="password1"
    
    if /opt/homebrew/opt/postgresql@12/bin/psql -h localhost -U postgres -lqt | cut -d \| -f 1 | grep -qw playmatatu_dev; then
        log_info "Database 'playmatatu_dev' already exists"
    else
        log_info "Creating database 'playmatatu_dev'..."
        /opt/homebrew/opt/postgresql@12/bin/createdb -h localhost -U postgres playmatatu_dev
    fi
    
    log_info "Running migrations (applying all SQL files in migrations/)..."

    # Ensure a table exists to track applied migrations
    /opt/homebrew/opt/postgresql@12/bin/psql -h localhost -U postgres -d playmatatu_dev -c "CREATE TABLE IF NOT EXISTS applied_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());"

    # Apply each migration file in sorted order, skip already-applied ones
    for f in $(ls -1 migrations/*.sql 2>/dev/null | sort); do
        fname=$(basename "$f")
        applied=$(/opt/homebrew/opt/postgresql@12/bin/psql -h localhost -U postgres -d playmatatu_dev -tAc "SELECT 1 FROM applied_migrations WHERE filename='$fname'")
        if [ "$applied" = "1" ]; then
            log_info "Skipping already applied migration: $fname"
            continue
        fi

        log_info "Applying migration: $fname"
        if /opt/homebrew/opt/postgresql@12/bin/psql -h localhost -U postgres -d playmatatu_dev -v ON_ERROR_STOP=1 -f "$f"; then
            /opt/homebrew/opt/postgresql@12/bin/psql -h localhost -U postgres -d playmatatu_dev -c "INSERT INTO applied_migrations (filename) VALUES ('$fname')"
            log_info "Applied migration: $fname"
        else
            log_error "Failed to apply migration: $fname"
            unset PGPASSWORD
            exit 1
        fi
    done

    unset PGPASSWORD
    log_info "Database setup complete"
}

# Install Go dependencies
install_dependencies() {
    log_step "Installing Go dependencies..."
    go mod download
    go mod tidy
    log_info "Dependencies installed"
}

# Check if Air is installed
check_air() {
    if command -v air >/dev/null 2>&1; then
        log_info "Air (live reload) is installed"
        return 0
    else
        log_warn "Air is not installed"
        log_info "Installing Air..."
        go install github.com/air-verse/air@latest
        return 0
    fi
}

# Check for migrate CLI and show guidance
check_migrate() {
    if command -v migrate >/dev/null 2>&1; then
        log_info "migrate CLI found"
    else
        log_warn "migrate CLI not found. You can install it via 'brew install golang-migrate' or use 'scripts/migrate.sh' which falls back to Docker"
    fi
}

# Main setup function
setup() {
    log_info "Setting up PlayMatatu development environment..."
    echo
    
    # Check prerequisites
    check_air
    
    # Install dependencies
    install_dependencies
    
    # Check services
    if ! check_postgres; then
        exit 1
    fi
    
    check_redis
    
    # Setup database
    setup_database
    
    echo
    log_info "✅ Development environment setup complete!"
    echo
    log_info "To start development:"
    echo -e "  ${BLUE}air${NC}                 # Start with live reload"
    echo -e "  ${BLUE}go run cmd/server/main.go${NC}  # Start without live reload"
    echo
    log_info "To serve static files (optional):"
    echo -e "  ${BLUE}cd web && python3 -m http.server 3000${NC}"
    echo
    log_info "Endpoints:"
    echo -e "  API:     ${BLUE}http://localhost:8000${NC}"
    echo -e "  Health:  ${BLUE}http://localhost:8000/api/health${NC}"
    echo -e "  Static:  ${BLUE}http://localhost:3000${NC} (if serving separately)"
}

# Help function
help() {
    echo "PlayMatatu Development Setup"
    echo ""
    echo "Commands:"
    echo "  setup    - Set up development environment"
    echo "  start    - Start development servers"
    echo "  stop     - Stop development servers" 
    echo "  reset    - Reset database"
    echo "  logs     - Show application logs"
    echo "  help     - Show this help"
}

# Start development servers
start() {
    log_info "Starting development servers..."
    
    # Start Redis if not running
    if ! redis-cli ping > /dev/null 2>&1; then
        brew services start redis
    fi
    
    # Start the application with Air (use full path)
    log_info "Starting PlayMatatu with live reload..."
    ~/go/bin/air
}

# Stop development servers
stop() {
    log_info "Stopping development servers..."
    brew services stop redis
    pkill -f "air" || true
    log_info "Servers stopped"
}

# Reset database
reset() {
    log_info "Resetting database..."
    export PGPASSWORD="password1"
    /opt/homebrew/opt/postgresql@12/bin/dropdb -h localhost -U postgres playmatatu_dev || true
    /opt/homebrew/opt/postgresql@12/bin/createdb -h localhost -U postgres playmatatu_dev
    /opt/homebrew/opt/postgresql@12/bin/psql -h localhost -U postgres playmatatu_dev < migrations/001_initial_schema.sql
    unset PGPASSWORD
    log_info "Database reset complete"
}

# Parse command line arguments
case "${1:-setup}" in
    "setup")
        setup
        ;;
    "start")
        start
        ;;
    "stop")
        stop
        ;;
    "reset")
        reset
        ;;
    "logs")
        tail -f tmp/build-errors.log 2>/dev/null || echo "No logs found. Run 'air' first."
        ;;
    "help")
        help
        ;;
    *)
        echo "Unknown command: $1"
        echo ""
        help
        exit 1
        ;;
esac

# Notes: Migrations in this repo are SQL files placed under the 'migrations/' directory.
# Currently they are managed manually (add a new .sql file and commit it).
# If you want versioned up/down migrations and a CLI tool, consider using:
#  - golang-migrate (https://github.com/golang-migrate/migrate)
#  - pressly/goose         (https://github.com/pressly/goose)
# These tools support incremental migrations, rollbacks, and version tracking.
# Example with golang-migrate:
#   migrate -path ./migrations -database "postgres://postgres:password1@localhost:5432/playmatatu_dev?sslmode=disable" up