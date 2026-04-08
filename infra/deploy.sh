#!/usr/bin/env bash
# Rsync project to a VM and restart long-running processes you manage (pm2/systemd).
# Set VM_HOST before running:  export VM_HOST=user@your-vm-ip

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_HOST="${VM_HOST:-}"

if [[ -z "$VM_HOST" ]]; then
  echo "Set VM_HOST, e.g. export VM_HOST=ubuntu@203.0.113.10"
  exit 1
fi

REMOTE_DIR="${REMOTE_DIR:-/opt/jeff-intelligence}"

rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude output \
  --exclude data/intelligence_cache \
  --exclude .env \
  "$ROOT/" "$VM_HOST:$REMOTE_DIR/"

ssh "$VM_HOST" "cd $REMOTE_DIR && npm ci && pip3 install -r requirements.txt"

echo "Deploy sync complete. On the VM, restart your bot (e.g. systemctl restart jeff-bot or pm2 restart jeff-bot)."
