# News Intelligence Skill

## Overview

This skill turns the host into a smart, frugal news intelligence assistant. It runs a full RSS-based news pipeline (fetch → cluster → verify → summarize) and delivers high-signal briefings via chat. It learns your preferences over time and only interrupts for genuinely breaking stories.

## Capabilities

### 1. Morning Briefing (daily, 07:00 local)
- Runs the full news pipeline: `main.py --output-json --no-email --preferences-file`
- Reads the structured JSON output
- Formats a concise chat briefing: top story headline + why it matters, then category bullets, sentiment trend
- Sends via the active chat channel (Telegram preferred)

### 2. Breaking News Check (up to 4x/day, only if justified)
- Runs `breaking_check.py` — a lightweight RSS scan of the last 2 hours
- Only messages the user if `has_breaking: true` AND at least one story has `credible_count >= 2`
- Uses the `🚨 BREAKING` format (see persona.md)
- If nothing breaking, goes back to sleep silently — no message sent

### 3. Preference Learning
- When the user replies to a briefing with feedback (e.g., "skip crypto", "more AI", "add source X"), parse the intent
- Update persistent memory keys (see memory_hooks.md)
- Run `preferences_updater.py --feedback "<user message>"` to sync into the pipeline
- Confirm: "Got it, adjusting your feed."

## Commands the User Can Send

| Command | Action |
|---------|--------|
| `briefing` / `news` / `update me` | Run morning briefing on demand |
| `breaking` / `check now` | Run a breaking-news check immediately |
| `skip <category>` | Add category to ignore list |
| `more <category>` | Boost category weight |
| `add keyword <word>` | Add a tier-1 breaking keyword |
| `show preferences` | Display current preference weights |
| `reset preferences` | Restore defaults |

## Execution

### Morning Briefing Script
```bash
#!/bin/bash
cd "$NEWS_INTEL_DIR"  # set via systemd EnvironmentFile or .env
source venv/bin/activate
python preferences_updater.py --from-openclaw data/user_preferences.json 2>/dev/null
python main.py --output-json --no-email --preferences-file data/user_preferences.json
```

### Breaking Check Script
```bash
#!/bin/bash
cd "$NEWS_INTEL_DIR"
source venv/bin/activate
python breaking_check.py --preferences-file data/user_preferences.json
```

## Schedule

See `heartbeat.json` for the full cron schedule. Summary:

| Time | Task | Behavior |
|------|------|----------|
| 07:00 | `morning_briefing` | Always runs, always sends a message |
| 10:00 | `breaking_check` | Only messages if breaking threshold met |
| 13:00 | `breaking_check` | Only messages if breaking threshold met |
| 16:00 | `breaking_check` | Only messages if breaking threshold met |
| 19:00 | `breaking_check` | Only messages if breaking threshold met |

Hard limit: **5 activations per day**. Enforced in `breaking_check.py` via `/tmp/news_intel_daily_activations.txt`.

## Resource Usage
- Morning briefing: 1 OpenAI API call (gpt-4o-mini batch), ~30–60s runtime
- Breaking check: 0 API calls unless breaking threshold met, ~15–25s runtime
- Memory: < 200MB RAM during execution
- No persistent daemon — process starts, does work, exits

## Dependencies
- Python 3.11+ with packages in `requirements.txt`
- Node.js 20+ (for OpenClaw runtime)
- Environment variables in `.env` (OPENAI_API_KEY minimum)

## Files
- `run_briefing.sh` — morning briefing entry point
- `check_breaking.sh` — breaking check entry point
- `persona.md` — chat personality and formatting rules
- `heartbeat.json` — wake/sleep schedule
- `memory_hooks.md` — persistent memory schema
