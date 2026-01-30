
## Raw manual commands (no script)

If you prefer not to use a script, here are the exact copy/paste commands for a manual, versioned dev release. Replace `your-vps`, `pascal`, and optionally `VERSION` with your values.

1) Build locally (Linux/amd64) and create the release name

```bash
# Build backend binary
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o bin/playmatatu ./cmd/server

# Build frontend
cd frontend && npm ci && npm run build && cd ..

# Pick version (manual) or auto from git
VERSION="v0.1.0-dev"   # or
VERSION=$(git describe --tags --abbrev=7 --always 2>/dev/null || echo "dev-$(git rev-parse --short HEAD)")
# sanitize
RELEASE=$(echo "$VERSION" | tr -c 'A-Za-z0-9._-' '-')
```

2) Upload (rsync recommended)

```bash
ssh pascal@18.236.225.135 "mkdir -p /home/pascal/projects/matatu/releases/$RELEASE/bin /home/pascal/projects/matatu/releases/$RELEASE/frontend/dist"
rsync -avz --progress bin/playmatatu pascal@18.236.225.135:/home/pascal/projects/matatu/releases/$RELEASE/bin/
rsync -avz --delete --progress frontend/dist/ pascal@18.236.225.135:/home/pascal/projects/matatu/releases/$RELEASE/frontend/dist/
```

3) Activate release on VPS

```bash
ssh pascal@your-vps
chmod +x /home/pascal/projects/matatu/releases/$RELEASE/bin/playmatatu
ln -nfs /home/pascal/projects/matatu/releases/$RELEASE /home/pascal/projects/matatu/current-dev
```

4) (Optional) Run DB migrations

```bash
cd /home/pascal/projects/matatu/current-dev
./scripts/migrate.sh
```

5) Restart dev backend (supervisor)

```bash
sudo supervisorctl restart playmatatu-dev
sudo supervisorctl status playmatatu-dev
```

6) Verify

```bash
# API health
curl -i https://api.playmatatu.com/api/v1/health
# Check logs
tail -F /home/pascal/projects/matatu/logs/playmatatu-dev.err.log
# Check frontend in browser: https://demo.playmatatu.com
```

7) Rollback (if needed)

```bash
# point to previous release and restart
ln -nfs /home/pascal/projects/matatu/releases/<previous> /home/pascal/projects/matatu/current-dev
sudo supervisorctl restart playmatatu-dev
```

---


