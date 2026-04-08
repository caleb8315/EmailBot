# Jeff Intelligence System

Personal news intelligence: a **Telegram bot** you chat with to tune preferences, a **scheduled pipeline** that scans many RSS feeds (news, markets, tech, Reddit, Google News, etc.), **high-importance Telegram alerts**, and a **morning briefing** on Telegram (and optionally email).

There is **no separate assistant runtime** — only this repo, Supabase, OpenAI, and Telegram.

## What you get

| Piece | What it does |
|--------|----------------|
| `npm run bot` | Long-polling Telegram bot: `/prefs`, `/boost`, `/mute`, `/alert`, `/keyword`, plus natural phrases like “less crypto, more AI”. |
| GitHub Action **Intelligence Pipeline** (every 5 min) | Fetches feeds, dedupes, scores with AI, sends **Telegram alerts** for very high importance + credibility. |
| GitHub Action **Daily Intelligence Digest** (07:00 UTC) | Builds the digest: **Telegram morning briefing** always (if bot token + chat id are set); **email** if SMTP is configured. |
| `python main.py` (optional) | Deeper multi-source **Python briefing** (HTML/text in `output/`) using `news_intel/` — large internal source list + clustering. |
| **`dashboard/` on Vercel** | Web UI: past digests, errors/events, article list, **Run workflow** buttons, assistant chat. See `dashboard/README.md`. RSS jobs stay on **GitHub Actions**. |

### Coverage expectations

RSS and public feeds can go surprisingly wide (wires, blogs, Reddit, Google News), but **no honest bot can read “all social media” or the whole web** without official APIs (X, TikTok, Instagram, etc.), contracts, and rate limits. This stack casts a **broad net within RSS and open feeds** and ranks what matters to you.

## Your setup checklist

1. **Supabase**  
   - Create a project and run `supabase/schema.sql` in the SQL editor.  
   - If the project already existed before `briefing_overlay`, run `supabase/migrations/20260408120000_briefing_overlay.sql` once.  
   - For the dashboard archive, run `supabase/migrations/20260409100000_dashboard_tables.sql` if you did not re-run the full schema after it was added.

2. **Environment**  
   - Copy `.env.example` → `.env` and fill in values (never commit `.env`).  
   - `TELEGRAM_CHAT_ID` should be **your** numeric chat id (same id the bot messages for alerts and digest).

3. **Telegram bot**  
   - Create a bot with [@BotFather](https://t.me/BotFather), set `TELEGRAM_BOT_TOKEN`.  
   - For a single user, set `TELEGRAM_CHAT_ID` and optionally leave `TELEGRAM_ALLOWED_CHAT_IDS` unset (only that chat is accepted).  
   - For multiple chats, set `TELEGRAM_ALLOWED_CHAT_IDS=id1,id2`.

4. **GitHub Actions**  
   - Add repository secrets: `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and optionally SMTP secrets for email.  
   - Optional: `SEND_DIGEST_TELEGRAM=false` if you want **email-only** morning digest (no Telegram message).  
   - Optional: set secret `ALERT_EMAIL_IMPORTANT` to `true` and configure SMTP secrets so **high-importance pipeline alerts** are emailed as well as sent on Telegram.

5. **Run the bot (always-on process)**  
   - On a laptop, VPS, or PM2/systemd: `npm ci && npm run bot`  
   - The Actions workflows **do not** run the interactive bot; they run the pipeline and digest only.

6. **Optional Python briefing**  
   - `pip install -r requirements.txt`  
   - `python main.py` (uses `OPENAI_API_KEY` from `.env`).  
   - Category weights merge from `data/preferences.json`, local `data/user_preferences.json`, and **Supabase `briefing_overlay`** (same JSON the Telegram bot updates).

## Scripts

```bash
npm run build       # compile TypeScript
npm run bot         # Telegram bot (same as npm run chat)
npm start           # one-shot intelligence pipeline (ts-node src/index.ts)
npm run email       # daily digest: email (if SMTP) + Telegram briefing
```

## Repo layout (short)

- `src/` — TypeScript pipeline, Telegram send, email digest, bot.  
- `config/sources.json` — Node/RSS sources for the 5-minute pipeline.  
- `news_intel/` — Python briefing engine and breaking checker.  
- `preferences_updater.py` — CLI to merge `user_preferences.json` into `data/preferences.json`.  
- `infra/` — optional VM bootstrap / rsync deploy.  
- `dashboard/` — Next.js control panel (Vercel); root directory must be `dashboard` when deploying.

## License / safety

Use your own API keys; review alerts critically. Reddit and aggregate feeds are **noisy** — the scoring layer and your `/mute` / `ignore` preferences exist to filter that.
