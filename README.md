# Jeff Intelligence System

Personal news intelligence: a **Telegram bot** you chat with to tune preferences, a **scheduled pipeline** that scans many RSS feeds (news, markets, tech, Reddit, Google News, etc.), **high-importance Telegram alerts**, and a **morning briefing** on Telegram (and optionally email).

There is **no separate assistant runtime** — only this repo, Supabase, Gemini/Groq, and Telegram.

## What you get

| Piece | What it does |
|--------|----------------|
| `npm run bot` | Long-polling Telegram bot: `/prefs`, `/boost`, `/mute`, `/alert`, `/keyword`, `/weather`, `/markets`, plus natural phrases like “less crypto, more AI”. |
| GitHub Action **Intelligence Pipeline** (hourly) | Fetches feeds, dedupes, scores with AI; **Telegram (and optional email)** only for **high-importance** items. |
| GitHub Action **Morning Intelligence Digest** (07:00 UTC) | One run: balanced world+interest shortlist, then a 2-step Groq briefing (triage + deep synthesis), with optional Telegram mirror. |
| GitHub Action **Weekly Intelligence Recap** (Sunday 14:00 UTC) | 7-day recap digest with trend shifts, key risks, and what to watch next week. |
| `python main.py` (optional, local) | Deeper **Python** briefing to `output/` — not scheduled in GitHub Actions by default. |
| **`dashboard/` on Vercel** | Web UI: past digests, errors/events, article list, **Run workflow** buttons, assistant chat, and a mobile-friendly **Preferences** tab. See `dashboard/README.md`. RSS jobs stay on **GitHub Actions**. |

### Coverage expectations

RSS and public feeds can go surprisingly wide (wires, blogs, Reddit, Google News), but **no honest bot can read “all social media” or the whole web** without official APIs (X, TikTok, Instagram, etc.), contracts, and rate limits. This stack casts a **broad net within RSS and open feeds** and ranks what matters to you.

## Your setup checklist

1. **Supabase**  
   - Create a project and run `supabase/schema.sql` in the SQL editor.  
   - If the project already existed before `briefing_overlay`, run `supabase/migrations/20260408120000_briefing_overlay.sql` once.  
   - For the dashboard archive, run `supabase/migrations/20260409100000_dashboard_tables.sql` if you did not re-run the full schema after it was added.
   - For dedicated chat/pipeline/digest usage counters, run `supabase/migrations/20260410113000_usage_tracking_purpose_counters.sql` on existing projects.

2. **Environment**  
   - Copy `.env.example` → `.env` and fill in values (never commit `.env`).  
   - `TELEGRAM_CHAT_ID` should be **your** numeric chat id (same id the bot messages for alerts and digest).
   - Optional: set `PREFERENCE_USER_ID` if you want one canonical profile id shared by dashboard, digest, and pipeline preference reads/writes.

3. **Telegram bot**  
   - Create a bot with [@BotFather](https://t.me/BotFather), set `TELEGRAM_BOT_TOKEN`.  
   - For a single user, set `TELEGRAM_CHAT_ID` and optionally leave `TELEGRAM_ALLOWED_CHAT_IDS` unset (only that chat is accepted).  
   - For multiple chats, set `TELEGRAM_ALLOWED_CHAT_IDS=id1,id2`.

4. **GitHub Actions**  
   - Add repository secrets: `GEMINI_API_KEY` (or `OPENAI_API_KEY` for backward compatibility), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and optionally SMTP secrets for email.  
   - Optional: add `FINNHUB_API_KEY` to enable the "What to watch today" economic calendar block in digests.  
   - Optional: `SEND_DIGEST_TELEGRAM=false` if you want **email-only** morning digest (no Telegram message).  
   - Optional: set secret `ALERT_EMAIL_IMPORTANT` to `true` and configure SMTP secrets so **high-importance pipeline alerts** are emailed as well as sent on Telegram.

5. **Run the bot (always-on process)**  
   - On a laptop, VPS, or PM2/systemd: `npm ci && npm run bot`  
   - The Actions workflows **do not** run the interactive bot; they run the pipeline and digest only.

6. **Optional Python briefing**  
   - `pip install -r requirements.txt`  
   - `python main.py` (uses `GEMINI_API_KEY` + Gemini-compatible endpoint settings from `.env`).  
   - Category weights merge from `data/preferences.json`, local `data/user_preferences.json`, and **Supabase `briefing_overlay`** (same JSON the Telegram bot updates).

## Scripts

```bash
npm run build       # compile TypeScript
npm run bot         # Telegram bot (same as npm run chat)
npm start           # one-shot intelligence pipeline (ts-node src/index.ts)
npm run email       # daily digest: email (if SMTP) + Telegram briefing
npm run email:weekly # weekly recap digest
```

## Repo layout (short)

- `src/` — TypeScript pipeline, Telegram send, email digest, bot.  
- `config/sources.json` — Node/RSS sources for the 5-minute pipeline.  
- `lib/` — Reasoning brain: ingestion, belief engine, hypothesis board, narrative arcs, forecast engine, deliberation loop, reflection. See [`docs/BRAIN.md`](docs/BRAIN.md).
- `news_intel/` — Python briefing engine and breaking checker.  
- `preferences_updater.py` — CLI to merge `user_preferences.json` into `data/preferences.json`.  
- `infra/` — optional VM bootstrap / rsync deploy.  
- `dashboard/` — Next.js control panel (Vercel); root directory must be `dashboard` when deploying.

## How smart is the brain?

The reasoning stack is documented in [`docs/BRAIN.md`](docs/BRAIN.md). Highlights:

- **Deliberation loop** (`lib/reasoning.ts`): every important LLM call runs draft → red-team critique → revise, with optional self-consistency samples and a judge pass. Outputs are calibrated against a historical reliability curve before being trusted.
- **Forecast engine** (`lib/forecast-engine.ts`): every pattern match writes a real, scorable `predictions` row — Beta-prior from history, severity- and source-diversity-adjusted, with mechanism + falsifier.
- **Auto-hypotheses** (`lib/hypothesis-board.ts`): primary + null hypothesis pairs, source-diversity (Shannon), log-odds posterior.
- **Real calibration tracking**: per-bin reliability table updated streamingly on every resolution, plus log-loss alongside Brier.
- **Reflection** (`lib/reflection.ts`): nightly self-review — critiques low-diversity hypotheses, flags stale beliefs, auto-resolves overdue predictions when the falsifier is met.

Run the full brain test suite with `npm run test:brain`.

## License / safety

Use your own API keys; review alerts critically. Reddit and aggregate feeds are **noisy** — the scoring layer and your `/mute` / `ignore` preferences exist to filter that.
