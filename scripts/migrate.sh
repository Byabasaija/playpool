#!/usr/bin/env bash
set -euo pipefail

CMD=${1:-up}

# Prefer DATABASE_URL env var, fall back to dev default
DBURL=${DATABASE_URL:-"postgres://postgres:password1@localhost:5432/playmatatu_dev?sslmode=disable"}

if command -v migrate >/dev/null 2>&1; then
    echo "[migrate] Using local migrate binary"
    migrate -path file://migrations -database "$DBURL" -verbose "$CMD"
else
    echo "[migrate] Local migrate binary not found, using dockerized migrate"
    docker run --rm -v "$(pwd)/migrations:/migrations" -e DATABASE_URL="$DBURL" migrate/migrate -path=/migrations -database "$DBURL" -verbose "$CMD"
fi
