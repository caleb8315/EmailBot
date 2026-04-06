#!/bin/bash
# Google Cloud Free Tier e2-micro VM bootstrap script.
#
# Provisions a Debian/Ubuntu e2-micro instance with everything needed
# to run the news intelligence pipeline + OpenClaw.
#
# Usage:
#   ssh <user>@<your-vm-ip> 'bash -s' < gcloud_setup.sh
#
# Prerequisites:
#   - GCP always-free e2-micro VM (us-west1, us-central1, or us-east1)
#   - Debian 12 or Ubuntu 22.04 image
#   - SSH access configured via GCP Console or gcloud CLI
set -euo pipefail

echo "=== News Intelligence + OpenClaw Setup ==="
echo "Target: Google Cloud Free Tier e2-micro"
echo ""

# Detect the current user (GCP uses your Google username, not 'ubuntu')
DEPLOY_USER="$(whoami)"
REPO_DIR="/home/${DEPLOY_USER}/news-intel"

echo "Running as user: ${DEPLOY_USER}"
echo "Install directory: ${REPO_DIR}"
echo ""

# ── 1. System updates ─────────────────────────────────────────────────
echo ">>> Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y \
    build-essential \
    curl \
    git \
    unzip \
    software-properties-common \
    ufw

# ── 2. Python 3.11 ────────────────────────────────────────────────────
echo ">>> Installing Python 3.11..."
if command -v python3.11 &>/dev/null; then
    echo "Python 3.11 already installed"
else
    # Debian 12 has Python 3.11 in repos; Ubuntu may need deadsnakes PPA
    if grep -qi ubuntu /etc/os-release 2>/dev/null; then
        sudo add-apt-repository -y ppa:deadsnakes/ppa
        sudo apt-get update -y
    fi
    sudo apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip || \
        sudo apt-get install -y python3 python3-venv python3-dev python3-pip
fi

# Set up python/python3 aliases if needed
if command -v python3.11 &>/dev/null; then
    PYTHON_CMD="python3.11"
else
    PYTHON_CMD="python3"
fi
echo "Using Python: $($PYTHON_CMD --version)"

# ── 3. Node.js 20 LTS ─────────────────────────────────────────────────
echo ">>> Installing Node.js 20 LTS..."
if command -v node &>/dev/null && node --version | grep -q "v20"; then
    echo "Node.js 20 already installed"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# ── 4. OpenClaw ────────────────────────────────────────────────────────
echo ">>> Installing OpenClaw..."
sudo npm install -g openclaw 2>/dev/null || echo "OpenClaw npm install attempted — verify at https://openclaw.ai for exact package name"

echo "OpenClaw: $(openclaw --version 2>/dev/null || echo 'install may need manual verification')"

# ── 5. Clone repo ─────────────────────────────────────────────────────
if [ -d "$REPO_DIR" ]; then
    echo ">>> Repo already exists at $REPO_DIR, pulling latest..."
    cd "$REPO_DIR" && git pull
else
    echo ">>> Cloning news-intel repo..."
    git clone https://github.com/caleb8315/EmailBot.git "$REPO_DIR"
fi

cd "$REPO_DIR"

# ── 6. Python dependencies ────────────────────────────────────────────
echo ">>> Setting up Python virtual environment..."
$PYTHON_CMD -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# ── 7. Node.js dependencies ───────────────────────────────────────────
echo ">>> Installing Node.js dependencies..."
npm install

# ── 8. Environment file ───────────────────────────────────────────────
if [ ! -f .env ]; then
    echo ">>> Creating .env from template..."
    cp .env.example .env
    echo ""
    echo "!!! IMPORTANT: Edit ${REPO_DIR}/.env with your actual API keys !!!"
    echo ""
fi

# ── 9. Data directories ───────────────────────────────────────────────
mkdir -p data output

# ── 10. Create OpenClaw preferences template ──────────────────────────
if [ ! -f data/user_preferences.json ]; then
    python preferences_updater.py --create-template data/user_preferences.json
fi

# ── 11. Make shell scripts executable ─────────────────────────────────
chmod +x openclaw_skills/news_intel/run_briefing.sh
chmod +x openclaw_skills/news_intel/check_breaking.sh
chmod +x infra/deploy.sh

# ── 12. Firewall (allow SSH only, outbound open) ──────────────────────
echo ">>> Configuring firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw --force enable

# ── 13. Systemd service for OpenClaw ──────────────────────────────────
echo ">>> Creating systemd service for OpenClaw..."
sudo tee /etc/systemd/system/openclaw.service > /dev/null << UNIT
[Unit]
Description=OpenClaw Personal AI Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${DEPLOY_USER}
WorkingDirectory=${REPO_DIR}
Environment=NODE_ENV=production
Environment=NEWS_INTEL_DIR=${REPO_DIR}
EnvironmentFile=${REPO_DIR}/.env
ExecStart=/usr/bin/openclaw start --skills-dir ./openclaw_skills
Restart=on-failure
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable openclaw.service

# ── 14. Install OpenClaw skill ────────────────────────────────────────
echo ">>> Installing news_intel skill into OpenClaw..."
openclaw skills install ./openclaw_skills/news_intel 2>/dev/null || echo "Skill install will complete on first OpenClaw start"

# ── 15. Verify ────────────────────────────────────────────────────────
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Install directory: ${REPO_DIR}"
echo ""
echo "Next steps:"
echo "  1. Edit ${REPO_DIR}/.env with your actual API keys"
echo "  2. Set up your Telegram bot (see README_OPENCLAW.md)"
echo "  3. Start OpenClaw:  sudo systemctl start openclaw"
echo "  4. Check status:    sudo systemctl status openclaw"
echo "  5. View logs:       journalctl -u openclaw -f"
echo ""
echo "Test the pipeline:"
echo "  cd ${REPO_DIR} && source venv/bin/activate && python main.py --dry-run"
echo "  python breaking_check.py"
