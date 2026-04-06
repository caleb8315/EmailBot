# OpenClaw Integration — Setup Guide

This guide walks you through deploying the news intelligence system as a living assistant powered by [OpenClaw](https://openclaw.ai) on Google Cloud Free Tier.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Google Cloud Free Tier (e2-micro, always-free)         │
│                                                         │
│  ┌──────────────┐    ┌─────────────────────────────┐    │
│  │   OpenClaw    │───▶│  news_intel skill            │    │
│  │  (scheduler)  │    │  • run_briefing.sh (07:00)  │    │
│  │  (chat bot)   │    │  • check_breaking.sh (4x)   │    │
│  │  (memory)     │    │  • preferences sync         │    │
│  └──────┬───────┘    └──────────┬──────────────────┘    │
│         │                       │                        │
│         │                       ▼                        │
│         │            ┌──────────────────────┐            │
│         │            │  Python Pipeline      │            │
│         │            │  main.py (--output-json)│           │
│         │            │  breaking_check.py     │           │
│         │            │  preferences_updater.py│           │
│         │            └──────────────────────┘            │
│         │                                                │
│         ▼                                                │
│  ┌──────────────┐                                        │
│  │  Telegram Bot │◀── sends briefings + breaking alerts  │
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- Google Cloud account (free tier)
- Telegram account + Bot token
- OpenAI API key
- SSH key pair

## Step 1: Create a Google Cloud Account

1. Go to [cloud.google.com/free](https://cloud.google.com/free)
2. Sign up — you need a credit card for verification but **you won't be charged** for always-free resources
3. You'll also get $300 free credit for 90 days, but the e2-micro VM remains free permanently

## Step 2: Create Your Telegram Bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`, follow prompts to name it (e.g., "Intel News Bot")
3. Copy the **bot token** (looks like `123456789:ABCdef...`)
4. Send a message to your new bot (any text)
5. Get your **chat ID**:
   ```bash
   curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
   ```
   Find `"chat":{"id":XXXXXXXX}` — that number is your chat ID

## Step 3: Create a GCP e2-micro VM

### Option A: Via Google Cloud Console (web UI)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Navigate to **Compute Engine** → **VM Instances** → **Create Instance**
3. Configure:
   - **Name**: `news-intel`
   - **Region**: Pick one of the always-free regions:
     - `us-west1` (Oregon)
     - `us-central1` (Iowa)
     - `us-east1` (South Carolina)
   - **Machine type**: `e2-micro` (2 vCPU, 1 GB RAM) — this is the always-free tier
   - **Boot disk**: Click **Change** →
     - **OS**: Debian 12 (or Ubuntu 22.04)
     - **Size**: 30 GB (always-free limit)
     - **Type**: Standard persistent disk
   - **Firewall**: Check "Allow HTTP traffic" (not strictly needed, but harmless)
4. Under **Advanced Options** → **Security** → **Manage Access**:
   - Add your SSH public key (from `cat ~/.ssh/id_rsa.pub`)
5. Click **Create**
6. Wait ~1 minute. **Copy the External IP** from the VM list.

### Option B: Via gcloud CLI

```bash
# Install gcloud CLI if you haven't: https://cloud.google.com/sdk/docs/install

gcloud compute instances create news-intel \
    --zone=us-central1-a \
    --machine-type=e2-micro \
    --image-family=debian-12 \
    --image-project=debian-cloud \
    --boot-disk-size=30GB \
    --boot-disk-type=pd-standard \
    --tags=news-intel

# Get the external IP
gcloud compute instances describe news-intel --zone=us-central1-a --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

### Verify SSH Access

```bash
ssh <your-username>@<EXTERNAL_IP>
# GCP uses the username from your SSH key or Google account
```

If SSH hangs, you may need to add a firewall rule in GCP Console:
**VPC Network** → **Firewall** → verify there's an `allow-ssh` rule for port 22.

## Step 4: Bootstrap the VM

From your Mac:

```bash
# Copy the setup script to the VM
scp infra/gcloud_setup.sh <your-username>@<VM_IP>:~/

# SSH in and run it
ssh <your-username>@<VM_IP> 'bash ~/gcloud_setup.sh'
```

This takes ~10-15 minutes. It installs Python 3.11, Node.js 20, OpenClaw, clones your repo, installs all dependencies, creates the systemd service, and configures the firewall.

## Step 5: Configure Environment

SSH into your VM and edit the `.env` file:

```bash
ssh <your-username>@<VM_IP>
nano ~/news-intel/.env
```

Fill in your real values:
```
OPENAI_API_KEY=sk-your-actual-key
TELEGRAM_BOT_TOKEN=your-actual-bot-token
TELEGRAM_CHAT_ID=your-actual-chat-id

# Email (optional backup)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
EMAIL_TO=your@gmail.com
```

Save and exit (`Ctrl+X`, `Y`, `Enter`).

## Step 6: Test the Pipeline

```bash
cd ~/news-intel
source venv/bin/activate

# Test RSS fetching (no AI, no email)
python main.py --dry-run --no-email

# Test JSON output (1 OpenAI API call)
python main.py --output-json --no-email

# Test breaking check
python breaking_check.py

# Test preference updates
python preferences_updater.py --show
python preferences_updater.py --feedback "less crypto, more AI"
python preferences_updater.py --show  # verify changes
```

## Step 7: Configure and Start OpenClaw

```bash
# Initialize OpenClaw
openclaw init

# Set Telegram as the chat interface
openclaw config set chat.provider telegram
openclaw config set chat.telegram.token "$TELEGRAM_BOT_TOKEN"
openclaw config set chat.telegram.chat_id "$TELEGRAM_CHAT_ID"

# Install the skill
cd ~/news-intel
openclaw skills install ./openclaw_skills/news_intel

# Start via systemd
sudo systemctl start openclaw
sudo systemctl status openclaw

# Check logs
journalctl -u openclaw -f
```

## Step 8: Verify It Works

1. Your Telegram bot should come alive
2. Send `briefing` to your bot — it should run the pipeline and send a summary
3. Send `check now` — it should run a breaking check
4. Wait until 7:00 AM for the first automatic briefing

## Deploying Updates

From your local Mac:

```bash
# Add to your .env (one time)
# VM_HOST=<your-username>@<VM_IP>

./infra/deploy.sh
```

This rsyncs your code, installs deps, reinstalls the skill, and restarts OpenClaw.

## File Structure

```
openclaw_skills/news_intel/
├── skill.md              # Skill definition (what it does, commands, schedule)
├── persona.md            # Chat personality and formatting rules
├── heartbeat.json        # Wake/sleep cron schedule
├── memory_hooks.md       # Persistent memory schema
├── run_briefing.sh       # Morning briefing entry point
└── check_breaking.sh     # Breaking check entry point

infra/
├── gcloud_setup.sh       # Full GCP VM bootstrap script
└── deploy.sh             # rsync + restart deployment

breaking_check.py         # Lightweight breaking news detector
preferences_updater.py    # OpenClaw memory → pipeline preference sync
```

## Cost Breakdown

| Resource | Cost |
|----------|------|
| GCP e2-micro VM (2 vCPU, 1 GB, us-west1/central1/east1) | $0/month (always-free) |
| GCP standard disk (30 GB) | $0/month (always-free) |
| GCP outbound network (1 GB/month to non-China/Australia) | $0/month (always-free) |
| OpenClaw | $0 (open source) |
| Telegram Bot API | $0 (free) |
| OpenAI API (gpt-4o-mini) | ~$0.10–0.30/month |
| **Total** | **~$0.10–0.30/month** |

## Troubleshooting

### Pipeline fails with "No articles fetched"
- Check internet connectivity: `curl -I https://feeds.bbci.co.uk/news/rss.xml`
- Some RSS feeds may be geo-blocked — this is normal, the pipeline handles partial failures

### OpenClaw doesn't send messages
- Verify Telegram bot token: `curl "https://api.telegram.org/bot<TOKEN>/getMe"`
- Check chat ID: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"`
- Check logs: `journalctl -u openclaw -f`

### SSH connection refused
- Check GCP firewall: VPC Network → Firewall → ensure port 22 is allowed
- Verify external IP hasn't changed (ephemeral IPs can change on restart; promote to static in GCP Console → VPC → IP Addresses)

### VM stopped unexpectedly
- e2-micro VMs can be preempted under extreme GCP load (rare). Check:
  ```bash
  gcloud compute instances describe news-intel --zone=us-central1-a --format='get(status)'
  ```
- Restart: `gcloud compute instances start news-intel --zone=us-central1-a`
- To avoid this, set the instance to **Standard** (not Spot/Preemptible) during creation — the always-free tier covers standard instances

### Breaking check always returns empty
- Expected behavior — it only fires for genuinely breaking news
- Test with a lower threshold: `python breaking_check.py --threshold 2`

### Preferences not syncing
- Verify the file exists: `cat data/user_preferences.json`
- Create a fresh template: `python preferences_updater.py --create-template data/user_preferences.json`

### Low memory warnings
- The e2-micro has 1 GB RAM. If you see OOM kills:
  - Add a swap file: `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
  - Make it permanent: `echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`
