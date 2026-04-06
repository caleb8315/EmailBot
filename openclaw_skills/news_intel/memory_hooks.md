# Memory Hooks — News Intelligence Skill

## Persistent Memory Schema

These keys are stored in OpenClaw's persistent memory and survive across sessions. They are read before each pipeline run and updated when the user provides feedback.

### User Preference Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `user.news.ignore_categories` | `string[]` | `[]` | Categories to suppress (weight → 1). E.g., `["Crypto"]` |
| `user.news.boost_categories` | `string[]` | `[]` | Categories to boost (weight += 2). E.g., `["AI & Technology"]` |
| `user.news.ignore_sources` | `string[]` | `[]` | Specific publishers to exclude from results |
| `user.news.tier1_keywords` | `string[]` | `[]` | User-added keywords that trigger breaking alerts |
| `user.news.category_weights` | `object` | `{}` | Direct weight overrides, e.g., `{"Stocks": 10, "Crypto": 2}` |
| `user.news.last_briefing_feedback` | `string` | `""` | Raw text of user's last feedback message |
| `user.news.last_briefing_date` | `string` | `""` | ISO date of last briefing sent |
| `user.news.breaking_sent_today` | `string[]` | `[]` | Headlines of breaking alerts sent today (dedup) |

### Valid Category Names

These must match exactly when writing to memory:

- `World & Geopolitics`
- `Wars & Conflicts`
- `Economy & Markets`
- `Stocks`
- `Crypto`
- `AI & Technology`
- `Power & Elite Activity`
- `Conspiracy / Unverified Signals`

## Memory → Pipeline Sync

Before each morning briefing, OpenClaw should:

1. Export relevant memory keys to a JSON file:
```json
{
  "ignore_categories": ["Crypto"],
  "boost_categories": ["AI & Technology", "Wars & Conflicts"],
  "ignore_sources": [],
  "tier1_keywords": ["fed", "tariff"],
  "category_weights": {},
  "last_briefing_feedback": ""
}
```

2. Write this to `data/user_preferences.json`

3. The pipeline reads it via `--preferences-file data/user_preferences.json`

## Feedback Parsing

When the user replies to a briefing, OpenClaw should:

1. Store the raw feedback in `user.news.last_briefing_feedback`
2. Parse for preference signals using these patterns:

| Pattern | Memory Update |
|---------|---------------|
| "skip X" / "less X" / "remove X" / "no more X" | Add X to `ignore_categories` |
| "more X" / "boost X" / "I care about X" | Add X to `boost_categories` |
| "add keyword X" / "alert me about X" | Add X to `tier1_keywords` |
| "ignore source X" / "remove source X" | Add X to `ignore_sources` |
| "reset" / "reset preferences" | Clear all override lists |
| "show preferences" / "my settings" | Read and display current memory state |

3. Run the preferences updater to sync changes:
```bash
cd "$NEWS_INTEL_DIR"
source venv/bin/activate
python preferences_updater.py --feedback "<raw user message>"
```

4. Confirm with a single short sentence (see persona.md for format).

## Deduplication

Before sending a breaking alert, check `user.news.breaking_sent_today`:
- If the headline (fuzzy match) is already in the list, do NOT send
- After sending, append the headline to the list
- Reset the list at midnight (or on first morning briefing)

## Memory Cleanup

On each morning briefing:
- Reset `user.news.breaking_sent_today` to `[]`
- Update `user.news.last_briefing_date` to today's date
- Keep all other keys persistent
