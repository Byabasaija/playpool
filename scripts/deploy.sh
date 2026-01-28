#!/bin/bash

# PlayMatatu Deployment Script
# This script handles deployment of the PlayMatatu backend service

set -e

# Configuration
APP_NAME="playmatatu"
APP_USER="playmatatu"
APP_DIR="/opt/playmatatu"
BINARY_NAME="playmatatu"
SERVICE_NAME="playmatatu.service"
NGINX_SITE="playmatatu"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   log_error "This script should not be run as root"
   exit 1
fi

# Function to build the application
build_app() {
    log_info "Building application..."
    go mod download
    go mod tidy
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o $BINARY_NAME ./cmd/server
    log_info "Build completed successfully"
}

# Function to create application user
create_app_user() {
    if ! id "$APP_USER" &>/dev/null; then
        log_info "Creating application user: $APP_USER"
        sudo useradd --system --home-dir $APP_DIR --shell /bin/false $APP_USER
    else
        log_info "User $APP_USER already exists"
    fi
}

# Function to setup application directory
setup_app_directory() {
    log_info "Setting up application directory: $APP_DIR"
    sudo mkdir -p $APP_DIR/{bin,web,configs,logs,backups}
    sudo chown -R $APP_USER:$APP_USER $APP_DIR
    sudo chmod 755 $APP_DIR
}

# Check Postgres version and warn if not 12
check_postgres_version() {
    if command -v psql >/dev/null 2>&1; then
        local pv
        pv=$(psql --version | awk '{print $3}')
        if [[ "$pv" != 12.* ]]; then
            log_warn "Detected Postgres version $pv. This environment expects Postgres 12; proceed with caution."
        else
            log_info "Postgres version 12 detected"
        fi
    else
        log_warn "psql not found on PATH; ensure Postgres 12 is available on the server"
    fi
}

# Function to backup current binary
backup_current() {
    if [[ -f "$APP_DIR/bin/$BINARY_NAME" ]]; then
        log_info "Backing up current binary..."
        sudo cp "$APP_DIR/bin/$BINARY_NAME" "$APP_DIR/backups/${BINARY_NAME}.$(date +%Y%m%d_%H%M%S)"
        sudo cp "$APP_DIR/bin/$BINARY_NAME" "$APP_DIR/backups/${BINARY_NAME}.previous"
    fi
}

# Function to deploy binary
deploy_binary() {
    log_info "Deploying new binary..."
    sudo cp $BINARY_NAME $APP_DIR/bin/
    sudo chown $APP_USER:$APP_USER $APP_DIR/bin/$BINARY_NAME
    sudo chmod 755 $APP_DIR/bin/$BINARY_NAME
}

# Function to deploy static files
deploy_static_files() {
    log_info "Deploying static files..."
    sudo cp -r web/* $APP_DIR/web/
    sudo chown -R $APP_USER:$APP_USER $APP_DIR/web/
    sudo chmod -R 644 $APP_DIR/web/
    sudo find $APP_DIR/web/ -type d -exec chmod 755 {} \;
}

# Function to deploy supervisor service
deploy_supervisor_service() {
    log_info "Deploying supervisor service..."

    # Install supervisor if missing
    if ! command -v supervisorctl >/dev/null 2>&1; then
        log_info "Supervisor not found, installing..."
        sudo apt-get update && sudo apt-get install -y supervisor
        sudo systemctl enable supervisor
        sudo systemctl start supervisor
    fi

    # Copy supervisor config
    if [[ -f "scripts/playmatatu.supervisor.conf" ]]; then
        log_info "Copying supervisor config"
        sudo cp scripts/playmatatu.supervisor.conf /etc/supervisor/conf.d/playmatatu.conf
        sudo chown root:root /etc/supervisor/conf.d/playmatatu.conf

        # Ensure logs directory exists and is writable by app user
        sudo mkdir -p $APP_DIR/logs
        sudo chown -R $APP_USER:$APP_USER $APP_DIR/logs

        # Reread and update supervisor
        sudo supervisorctl reread || true
        sudo supervisorctl update || true
        # Start the program if not started
        sudo supervisorctl start playmatatu || true
    else
        log_warn "Supervisor config not found in scripts/, skipping supervisor deployment"
    fi
}

# Function to deploy nginx configuration
deploy_nginx_config() {
    if [[ -f "scripts/nginx-$NGINX_SITE.conf" ]]; then
        log_info "Deploying nginx configuration..."
        sudo cp scripts/nginx-$NGINX_SITE.conf /etc/nginx/sites-available/$NGINX_SITE
        sudo ln -sf /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-enabled/
        
        # Test nginx configuration
        if sudo nginx -t; then
            log_info "Nginx configuration test passed"
            sudo systemctl reload nginx
        else
            log_error "Nginx configuration test failed"
            exit 1
        fi
    else
        log_warn "Nginx configuration file not found, skipping..."
    fi
}

# Function to run database migrations
run_migrations() {
    if [[ -d "migrations" ]]; then
        log_info "Running database migrations..."
        if [[ -x ./scripts/migrate.sh ]]; then
            ./scripts/migrate.sh up || { log_error "migrations failed"; exit 1; }
        else
            log_warn "Migration script not executable or found. Please run migrations manually or ensure ./scripts/migrate.sh is present."
        fi
    fi
}

# Function to restart service via supervisor
restart_service() {
    log_info "Restarting playmatatu via supervisor..."

    if ! command -v supervisorctl >/dev/null 2>&1; then
        log_error "supervisorctl not available"
        exit 1
    fi

    # Attempt restart
    sudo supervisorctl stop playmatatu || true
    sleep 2
    sudo supervisorctl start playmatatu || true

    # Wait and check status
    sleep 3

    local status
    status=$(sudo supervisorctl status playmatatu 2>/dev/null || true)
    if echo "$status" | grep -q "RUNNING"; then
        log_info "Service started successfully"
        echo "$status"
    else
        log_error "Failed to start service"
        echo "$status"
        exit 1
    fi
}

# Function to run health check
health_check() {
    log_info "Running health check..."
    local max_attempts=30
    local attempt=1

    while [[ $attempt -le $max_attempts ]]; do
        if curl -f -s http://localhost:8000/api/health > /dev/null; then
            log_info "Health check passed"
            return 0
        fi

        log_info "Health check attempt $attempt/$max_attempts failed, retrying in 2s..."
        sleep 2
        ((attempt++))
    done

    log_error "Health check failed after $max_attempts attempts"
    return 1
}

# Main deployment function
deploy() {
    log_info "Starting deployment of $APP_NAME..."
    
    # Build application
    build_app
    
    # Setup infrastructure
    create_app_user
    setup_app_directory

    # Check Postgres version (this environment expects Postgres 12)
    check_postgres_version
    
    # Backup and deploy
    backup_current
    deploy_binary
    deploy_static_files
    deploy_supervisor_service
    deploy_nginx_config
    
    # Database migrations
    run_migrations
    
    # Restart service
    restart_service
    
    # Health check
    if health_check; then
        log_info "Deployment completed successfully!"
    else
        log_error "Deployment completed but health check failed"
        exit 1
    fi
}

# Rollback function
rollback() {
    log_info "Rolling back to previous version..."
    
    if [[ -f "$APP_DIR/backups/${BINARY_NAME}.previous" ]]; then
        # Stop via supervisor if available, else try systemctl
        if command -v supervisorctl >/dev/null 2>&1; then
            sudo supervisorctl stop playmatatu || true
        else
            sudo systemctl stop $SERVICE_NAME || true
        fi

        sudo cp "$APP_DIR/backups/${BINARY_NAME}.previous" "$APP_DIR/bin/$BINARY_NAME"

        # Start via supervisor if available, else systemctl
        if command -v supervisorctl >/dev/null 2>&1; then
            sudo supervisorctl start playmatatu || true
        else
            sudo systemctl start $SERVICE_NAME || true
        fi

        if health_check; then
            log_info "Rollback completed successfully!"
        else
            log_error "Rollback failed"
            exit 1
        fi
    else
        log_error "No previous version found for rollback"
        exit 1
    fi
}

# Parse command line arguments
case "${1:-deploy}" in
    "deploy")
        deploy
        ;;
    "rollback")
        rollback
        ;;
    "restart")
        restart_service
        ;;
    "status")
        if command -v supervisorctl >/dev/null 2>&1; then
            sudo supervisorctl status playmatatu
        else
            echo "supervisorctl not available"
        fi
        ;;
    "logs")
        if command -v supervisorctl >/dev/null 2>&1; then
            sudo supervisorctl tail -f playmatatu stdout || sudo tail -n 200 -f /opt/playmatatu/logs/playmatatu.log
        else
            echo "supervisorctl not available; tailing logs from /opt/playmatatu/logs/"
            sudo tail -n 200 -f /opt/playmatatu/logs/playmatatu.log
        fi
        ;;
    "health")
        health_check
        ;;
    *)
        echo "Usage: $0 {deploy|rollback|restart|status|logs|health}"
        echo ""
        echo "Commands:"
        echo "  deploy   - Full deployment (default)"
        echo "  rollback - Rollback to previous version"
        echo "  restart  - Restart the service"
        echo "  status   - Show service status"
        echo "  logs     - Show service logs"
        echo "  health   - Run health check"
        exit 1
        ;;
esac