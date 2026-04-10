# Setup Guide

Complete setup instructions for the Selective Intelligence System.

---

## Prerequisites

- **Node.js 20+** (check with `node --version`)
- **npm** (comes with Node.js)
- **Supabase project** (free tier works)
- **Telegram Bot** (via @BotFather)
- **Gemini API key** (Google AI Studio)
- **Gmail or SMTP provider** (optional — only if you want email in addition to Telegram)

---

## Step 1: Clone & Install

```bash
git clone <your-repo-url>
cd Jeff_Agent1
npm install
```

---

## Step 2: Create Supabase Database

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Navigate to **SQL Editor**
3. Paste the contents of `supabase/schema.sql` and run it  
   - If this database was created **before** the `briefing_overlay` column existed, also run `supabase/migrations/20260408120000_briefing_overlay.sql` once.
   - If this database was created before per-purpose budgets were added, run `supabase/migrations/20260410113000_usage_tracking_purpose_counters.sql` once.
4. Go to **Settings → API** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

**Important:** The `service_role` key bypasses RLS and is used by the pipeline. Never expose it client-side.

---

## Step 3: Create Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. Copy the bot token → `TELEGRAM_BOT_TOKEN`
4. Send a message to your bot, then visit:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
5. Find `"chat":{"id":123456789}` — that's your `TELEGRAM_CHAT_ID`

---

## Step 4: Get Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create a new key → `GEMINI_API_KEY`
3. Use Gemini via the OpenAI-compatible endpoint by setting:
   - `LLM_PROVIDER=gemini`
   - `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`

---

## Step 5: Configure Email (optional)

The **morning briefing** is sent to **Telegram** when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. SMTP is only needed if you also want the HTML email.

### Gmail example

1. Enable 2-factor auth on your Gmail account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Generate an App Password for "Mail"
4. Use these settings:
   ```
   EMAIL_SMTP_HOST=smtp.gmail.com
   EMAIL_SMTP_PORT=587
   EMAIL_SMTP_USER=your-email@gmail.com
   EMAIL_SMTP_PASS=<app-password>
   EMAIL_FROM=your-email@gmail.com
   EMAIL_TO=recipient@gmail.com
   ```

---

## Step 6: Create `.env` File

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

### All Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_PROVIDER` | No | `gemini` | LLM backend selection (`gemini`, `openai`, `groq`, `openrouter`) |
| `GEMINI_API_KEY` | Yes | — | Primary Gemini API key |
| `OPENAI_API_KEY` | Recommended | — | Backward-compatible alias (can mirror `GEMINI_API_KEY`) |
| `OPENAI_BASE_URL` | No | `https://generativelanguage.googleapis.com/v1beta/openai/` | OpenAI-compatible endpoint URL |
| `GEMINI_NATIVE_BASE_URL` | No | `https://generativelanguage.googleapis.com/v1beta` | Native Gemini endpoint for grounded web chat |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | — | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Supabase service role key |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Yes | — | Your Telegram chat ID (pipeline + digest target) |
| `TELEGRAM_ALLOWED_CHAT_IDS` | No | — | Comma-separated chat ids allowed to talk to the bot |
| `SEND_DIGEST_TELEGRAM` | No | on | Set `false` to skip Telegram morning text (email-only) |
| `EMAIL_FROM` | For email | — | Sender email address |
| `EMAIL_TO` | For email | — | Recipient email address |
| `EMAIL_SMTP_HOST` | For email | — | SMTP server hostname |
| `EMAIL_SMTP_PORT` | No | `587` | SMTP port |
| `EMAIL_SMTP_USER` | For email | — | SMTP username |
| `EMAIL_SMTP_PASS` | For email | — | SMTP password or app password |
| `FINNHUB_API_KEY` | No | — | Optional free key for economic calendar events in digests |
| `CHAT_MODEL` | No | `gemini-2.5-flash` | Fallback chat model when web-enabled call is unavailable |
| `CHAT_WEB_MODEL` | No | `gemini-2.5-flash` | Model used for chat with live web grounding |
| `PIPELINE_MODEL` | No | `gemini-2.5-flash-lite` | Model used for optional pipeline AI scoring |
| `GROQ_API_KEY` | Recommended | — | Free Groq API key used for digest generation (more reliable than Gemini free tier) |
| `GROQ_DIGEST_MODEL` | No | `qwen/qwen3-32b` | Model used for digest synthesis on Groq |
| `PYTHON_INTELLIGENCE_MODEL` | No | `gemini-2.5-flash` | Model used by optional Python intelligence modules |
| `DISABLE_CHAT_WEB_SEARCH` | No | `false` | Set `true` to disable live web search in chat |
| `MAX_DAILY_AI_CALLS` | No | `30` | Global hard ceiling for AI calls/day |
| `MAX_DAILY_CHAT_CALLS` | No | `20` | Chat-specific daily cap |
| `MAX_DAILY_PIPELINE_AI_CALLS` | No | `30` | Pipeline-specific daily cap |
| `MAX_DAILY_DIGEST_AI_CALLS` | No | `4` | Digest-specific daily cap |
| `PREFILTER_THRESHOLD` | No | `55` | Minimum score to pass prefilter |
| `ALERT_COOLDOWN_HOURS` | No | `4` | Hours between Telegram alerts |

---

## Step 7: Test Locally

```bash
# Run the full pipeline once
npm start

# Telegram bot (preferences, /help, etc.)
npm run bot

# Morning-style digest (Telegram + optional email)
npm run email

# Weekly recap digest
npm run email:weekly

# Start the Telegram chat listener
npm run chat

# Type-check without running
npm run typecheck
```

---

## Step 8: Deploy to GitHub Actions

1. Push your code to GitHub
2. Go to **Settings → Secrets and variables → Actions**
3. Add each environment variable as a **Repository secret**:
   - `GEMINI_API_KEY` (or keep `OPENAI_API_KEY` for backward compatibility)
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `EMAIL_FROM`
   - `EMAIL_TO`
   - `EMAIL_SMTP_HOST`
   - `EMAIL_SMTP_PORT`
   - `EMAIL_SMTP_USER`
   - `EMAIL_SMTP_PASS`
   - `FINNHUB_API_KEY` (optional, for economic calendar block)

4. The workflows will run automatically:
   - **Pipeline:** every hour
   - **Daily digest:** 7am UTC daily
   - **Weekly recap:** 2pm UTC Sundays

5. To trigger manually: go to **Actions → select workflow → Run workflow**

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "SUPABASE_URL required" | Check `.env` has both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` |
| "AI budget exhausted" | Normal — default global cap is 30/day with chat capped at 20/day. Resets at midnight UTC. |
| Email not sending | Verify SMTP credentials. For Gmail, use App Passwords, not your main password. |
| Telegram bot not responding | Ensure `TELEGRAM_BOT_TOKEN` is correct and you've messaged the bot at least once. |
| No articles fetched | Some RSS feeds may be down. Check `config/sources.json` for working feeds. |
| TypeScript errors | Run `npm run typecheck` and fix any reported issues. |
