#!/usr/bin/env bash
set -euo pipefail

CMD=${1:-up}

# Prefer DATABASE_URL env var, fall back to dev default
DBURL=${DATABASE_URL:-"postgres://postgres:password1@localhost:5432/playmatatu_dev?sslmode=disable"}

if command -v migrate >/dev/null 2>&1; then
    echo "[migrate] Using local migrate binary"
    migrate -path ./migrations -database "$DBURL" -verbose "$CMD"
else
    echo "[migrate] migrate CLI not found. Please install it locally and ensure it's on your PATH."
    echo "On macOS:   brew install golang-migrate"
    echo "Or with Go: go install github.com/golang-migrate/migrate/v4/cmd/migrate@latest"
    echo "After installation ensure 'migrate -version' runs and retry."
    exit 1
fi
