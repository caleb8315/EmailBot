# System Architecture

## Overview

The Selective Intelligence System is an autonomous news monitoring pipeline that fetches, filters, analyzes, and delivers high-signal intelligence. It is designed for extreme cost efficiency — AI calls are a scarce resource (max 5/day).

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    GITHUB ACTIONS (cron)                        │
│                                                                 │
│  pipeline.yml  → every 5 hours                                  │
│  daily_email.yml → 7am UTC daily                                │
└───────┬─────────────────────────────────────┬───────────────────┘
        │                                     │
        ▼                                     ▼
┌───────────────┐                    ┌────────────────┐
│   index.ts    │                    │ send_email.ts  │
│  (pipeline)   │                    │ (daily digest) │
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
            │  user_prefs     │  ← personalization
            │  article_history│  ← dedup + history
            │  source_registry│  ← source quality
            └─────────────────┘


       TELEGRAM CHAT
       ┌──────────────────┐
       │  chat_handler.ts │ ← conversational interface
       │                  │   regex parsing → AI fallback
       │  Commands:       │
       │  • focus on X    │
       │  • ignore Y      │
       │  • why / deeper  │
       │  • status / help │
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
4. **Daily email always sends** — even with 0 AI data, the digest goes out
5. **Telegram cooldown** — max 1 alert per 2 hours to avoid notification fatigue
