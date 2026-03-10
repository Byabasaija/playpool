## Raw manual commands (no script)

Single-binary deployment — the frontend **and SQL migrations** are both compiled
into the Go binary with `-tags embed`, so only **one file** needs to be uploaded
to the server. No `frontend/dist/` or `migrations/` directory is needed at runtime.
Replace `pascal@18.236.225.135` and path values with your own.

---

### 1) Build locally (Linux/amd64)

```bash
# 1a. Build frontend — outputs to ui/dist (gets embedded into the binary)
cd frontend && npm ci && npm run build && cd ..

# 1b. Build self-contained Go binary (frontend + SQL migrations baked in via go:embed)
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -tags embed -ldflags="-s -w" -o bin/playpool ./cmd/server

# 1c. Pick a release name
VERSION=$(git describe --tags --abbrev=7 --always 2>/dev/null || echo "dev-$(git rev-parse --short HEAD)")
RELEASE=$(echo "$VERSION" | tr -c 'A-Za-z0-9._-' '-')
echo "Release: $RELEASE"
```

---

### 2) Upload — binary only

```bash
VPS="pascal@18.236.225.135"
REMOTE="/home/pascal/projects/playpool"

ssh $VPS "mkdir -p $REMOTE/releases/$RELEASE/bin"

# Binary is the only artifact — frontend assets AND migrations are embedded inside it
rsync -avz --progress bin/playpool $VPS:$REMOTE/releases/$RELEASE/bin/
```

---

### 3) Activate release on VPS

```bash
ssh $VPS "
  chmod +x $REMOTE/releases/$RELEASE/bin/playpool
  ln -nfs $REMOTE/releases/$RELEASE $REMOTE/current
"
```

---

### 4) Run DB migrations

Set `MIGRATE_ON_START=true` in `.env` on the server. The binary applies any
pending migrations at startup before accepting connections — nothing else needed.

> **Note:** `scripts/migrate.sh` uses the `migrate` CLI with `-path ./migrations`
> and is only useful for **local development** (where the `migrations/` folder is
> present on disk). It will not work on the server because the folder is not
> uploaded — all SQL files are embedded inside the binary.

---

### 5) Restart service (supervisor)

```bash
ssh $VPS "sudo supervisorctl restart playpool && sudo supervisorctl status playpool"
```

---

### 6) Verify

```bash
# API health
curl -i https://your-domain.com/api/v1/health

# Frontend (served by the same binary — no nginx needed for static files)
curl -i https://your-domain.com/

# Logs
ssh $VPS "tail -F $REMOTE/logs/playpool.err.log"
```

---

### 7) Rollback

```bash
ssh $VPS "
  ln -nfs $REMOTE/releases/<previous-release> $REMOTE/current
  sudo supervisorctl restart playpool
"
```

---

### Notes

- `SERVE_STATIC_FILES` and `STATIC_FILES_DIR` env vars are **no longer needed**
  in single-binary mode — the binary detects the embedded FS automatically.
- The `frontend/dist/`, `ui/dist/`, and `migrations/` directories are **not
  committed** to git and **not uploaded** to the server; they are either
  generated at build time (frontend) or embedded directly (SQL files).
- If you ever need disk-based frontend serving (e.g. to hot-swap assets without
  rebuilding), build without `-tags embed` and set `SERVE_STATIC_FILES=true`
  plus `STATIC_FILES_DIR=/path/to/dist` — the old behaviour is preserved.
- Migrations always run from the embedded copy regardless of build tag;
  `MIGRATE_ON_START=true` is the only supported path in production.
