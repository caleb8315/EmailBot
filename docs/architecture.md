# System Architecture

## Overview

The Selective Intelligence System is an autonomous news monitoring pipeline that fetches, filters, analyzes, and delivers high-signal intelligence. It is designed for extreme cost efficiency — AI calls are a scarce resource (max 5/day).

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    GITHUB ACTIONS (cron)                        │
│                                                                 │
│  pipeline.yml  → hourly — alerts only when high-importance      │
│  daily_email.yml → 7:00 UTC — morning digest (1× OpenAI insight)│
└───────┬─────────────────────────────────────┬───────────────────┘
        │                                     │
        ▼                                     ▼
┌───────────────┐                    ┌────────────────┐
│   index.ts    │                    │ send_email +   │
│  (pipeline)   │                    │ telegram_digest│
└───────┬───────┘                    └────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────┐
│              PIPELINE FLOW                         │
│                                                    │
│  1. fetch_sources.ts  ─── RSS feeds ──────────┐   │
│                                                │   │
│  2. prefilter.ts ──── keyword scoring ────┐    │   │
│     (NO AI — pure heuristics)             │    │   │
│                                           ▼    ▼   │
│  3. process_articles.ts ── AI analysis ──────────  │
│     (budget-gated via usage_limiter.ts)            │
│                                                    │
│  4. scoring.ts ── composite ranking ───────────    │
│                                                    │
│  5. send_telegram.ts ── alerts (if threshold met)  │
│                                                    │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
            ┌─────────────────┐
            │   SUPABASE      │
            │                 │
            │  usage_tracking │  ← AI budget enforcement
            │  user_prefs +   │  ← interests + briefing_overlay (bot)
            │  article_history│  ← dedup + history
            │  source_registry│  ← source quality
            └─────────────────┘


       TELEGRAM CHAT
       ┌──────────────────┐
       │  chat_handler.ts │ ← conversational interface
       │                  │   regex parsing → AI fallback
       │  /boost /mute    │
       │  /prefs /alert   │
       │  focus / ignore  │
       │  why / deeper    │
       └──────────────────┘
```

## Cost Model

| Component | AI Calls | Frequency |
|-----------|----------|-----------|
| Article analysis | 1 per article | 0-3 per pipeline run |
| Chat intent (AI fallback) | 1 per ambiguous message | Rare |
| Daily insight | 1 per digest | 0-1 per day |
| Deeper analysis | 1 per request | On-demand |
| **Budget** | **5 max/day** | **Target: 0-3 avg** |

## Key Design Decisions

1. **Fail closed on budget** — if Supabase is down, no AI calls are made
2. **Prefilter before AI** — heuristic scoring eliminates 80%+ of noise for free
3. **Try/catch everywhere** — no single failure stops the pipeline
4. **Daily digest** — Telegram briefing when configured; email only if SMTP is set
5. **Telegram cooldown** — max 1 alert per 2 hours to avoid notification fatigue
