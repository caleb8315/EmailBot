#!/bin/bash
# Deploy script — syncs local project to GCP VM and restarts OpenClaw.
#
# Usage:
#   ./infra/deploy.sh                          # uses VM_HOST from .env
#   VM_HOST=caleb@1.2.3.4 ./infra/deploy.sh   # explicit host
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load VM_HOST from .env if not set
if [ -z "${VM_HOST:-}" ]; then
    if [ -f "$PROJECT_DIR/.env" ]; then
        VM_HOST=$(grep -E '^VM_HOST=' "$PROJECT_DIR/.env" | cut -d= -f2- || true)
    fi
fi

if [ -z "${VM_HOST:-}" ]; then
    echo "Error: VM_HOST not set. Either:"
    echo "  1. Set VM_HOST=<user>@<ip> in your .env"
    echo "  2. Run: VM_HOST=<user>@<ip> ./infra/deploy.sh"
    exit 1
fi

# Extract the remote user to find the correct home dir
REMOTE_USER=$(echo "$VM_HOST" | cut -d@ -f1)
REMOTE_DIR="/home/${REMOTE_USER}/news-intel"

echo "=== Deploying to ${VM_HOST}:${REMOTE_DIR} ==="

# ── 1. Sync project files ─────────────────────────────────────────────
echo ">>> Syncing files..."
rsync -avz --delete \
    --exclude '.env' \
    --exclude 'node_modules/' \
    --exclude 'venv/' \
    --exclude '__pycache__/' \
    --exclude '.git/' \
    --exclude 'output/' \
    --exclude 'data/intelligence_cache/' \
    --exclude 'dist/' \
    --exclude '.DS_Store' \
    "$PROJECT_DIR/" "${VM_HOST}:${REMOTE_DIR}/"

# ── 2. Install dependencies on remote ─────────────────────────────────
echo ">>> Installing dependencies on remote..."
ssh "$VM_HOST" << REMOTE
cd ${REMOTE_DIR}
source venv/bin/activate
pip install -r requirements.txt --quiet
npm install --quiet 2>/dev/null || true
chmod +x openclaw_skills/news_intel/run_briefing.sh
chmod +x openclaw_skills/news_intel/check_breaking.sh
REMOTE

# ── 3. Reinstall OpenClaw skill ───────────────────────────────────────
echo ">>> Reinstalling OpenClaw skill..."
ssh "$VM_HOST" << REMOTE
cd ${REMOTE_DIR}
openclaw skills install ./openclaw_skills/news_intel 2>/dev/null || echo "Skill reinstall noted"
REMOTE

# ── 4. Restart OpenClaw service ───────────────────────────────────────
echo ">>> Restarting OpenClaw service..."
ssh "$VM_HOST" "sudo systemctl restart openclaw"

# ── 5. Verify ─────────────────────────────────────────────────────────
echo ">>> Checking service status..."
ssh "$VM_HOST" "sudo systemctl status openclaw --no-pager | head -15"

echo ""
echo "=== Deploy complete ==="
echo "View logs: ssh $VM_HOST 'journalctl -u openclaw -f'"
