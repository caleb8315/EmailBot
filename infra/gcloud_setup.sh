#!/usr/bin/env bash
# Optional: bootstrap a small GCP VM to run the Telegram bot + Python briefing cron.
# No third-party assistant runtime — only Node, Python, and systemd.

set -euo pipefail

echo "=== Jeff Intelligence — VM bootstrap ==="

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo bash infra/gcloud_setup.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl build-essential

# Python 3.11+
apt-get install -y python3 python3-pip python3-venv

# Node.js 20 LTS
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "Node: $(node -v)  Python: $(python3 --version)"

REPO_DIR="${REPO_DIR:-/opt/jeff-intelligence}"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Clone your repo into $REPO_DIR (or set REPO_DIR) and re-run pip/npm install there."
fi

echo ""
echo "Next steps:"
echo "  1. cd $REPO_DIR && npm ci && pip3 install -r requirements.txt"
echo "  2. Copy .env with TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_*, OPENAI_API_KEY, SMTP_*"
echo "  3. Run the bot:  npm run bot"
echo "  4. Cron examples:"
echo "       0 7 * * * cd $REPO_DIR && python3 main.py --preferences-file data/user_preferences.json"
echo "       */5 * * * * cd $REPO_DIR && npx ts-node src/index.ts"
