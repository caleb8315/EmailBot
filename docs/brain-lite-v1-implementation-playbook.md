# Brain Lite v1 Implementation Playbook

This playbook turns the Brain Lite checklist into a practical, execution-ordered plan you can run with immediately.

## Goal

Build a lightweight intelligence layer that correlates movement events, scores confidence, and produces explainable alerts without introducing heavy model complexity.

## Deliverables for v1

- Unified event schema and ingestion path
- Correlation engine with time/geo/direction logic
- Confidence scoring with configurable weights
- Explainable alert output with evidence links
- Baseline next-step forecasting
- Feedback capture loop for tuning
- Test harness for replay and regression

## Step-by-step execution order

## Step 1: Create the core data contract

Define one normalized event payload and use it everywhere.

```json
{
  "event_id": "uuid",
  "entity_id": "string",
  "entity_type": "aircraft|convoy|other",
  "timestamp": "ISO-8601",
  "lat": 0.0,
  "lon": 0.0,
  "heading": 0.0,
  "speed": 0.0,
  "source": "string",
  "source_confidence": 0.0,
  "raw_payload": {}
}
```

### Exit criteria
- All producers can map into this schema.
- Unknown fields are retained in `raw_payload`.

## Step 2: Implement ingestion + storage

Start simple with Postgres (plus PostGIS if available).

- Create `events` table for normalized events.
- Add dedupe key (`entity_id + timestamp + source` or source-native ID).
- Index for fast queries:
  - `(timestamp)`
  - `(entity_id, timestamp)`
  - geospatial index for `lat/lon` if using PostGIS

### Exit criteria
- New events are stored consistently.
- Duplicate events are prevented or marked.

## Step 3: Build a correlation worker

Run a worker on a short interval (or stream-triggered) to identify candidate patterns.

### Core checks
- Temporal proximity windows: 30m, 2h, 4h
- Geospatial corridor/proximity check
- Direction alignment threshold

### Output
Write candidate correlations to `pattern_candidates`:
- linked event IDs
- matched features
- intermediate score components

### Exit criteria
- Known scenarios produce candidate records.
- Each candidate contains explicit evidence fields.

## Step 4: Add confidence scoring

Use a transparent weighted formula first:

`confidence = w1*source_reliability + w2*time_score + w3*geo_score + w4*heading_score + w5*history_score`

- Keep weights in a database table (`scoring_config`) so tuning does not require deploys.
- Map confidence to bands:
  - Low: store only
  - Medium: watchlist
  - High: alert

### Exit criteria
- Every candidate receives a deterministic confidence score.
- Score breakdown is stored for auditability.

## Step 5: Generate explainable alerts

For high-confidence candidates, create readable summaries:

- What happened
- Why the system believes it (evidence list)
- Confidence value and band
- Possible near-term next move

Store these in `alerts` and include links to source events and timeline query IDs.

### Exit criteria
- Alert text is human-readable and evidence-backed.
- Alert spam is controlled via cooldown/suppression window.

## Step 6: Add minimal forecasting

Keep forecasting lightweight for v1:

- Route continuation likelihood
- Next likely area-of-interest in next time window
- Multiple outcomes with probabilities

Use heuristics + short history before any heavy ML.

### Exit criteria
- Alerts include at least one forward-looking estimate.
- Forecast output always includes uncertainty.

## Step 7: Add analyst feedback capture

Allow users to label alerts:
- Correct
- Partially correct
- False positive

Store labels in `alert_feedback` with notes and timestamp.

### Exit criteria
- Feedback can be attached to every alert.
- Feedback is queryable for tuning reports.

## Step 8: Add reliability and safety controls

- Source trust registry (`source_reliability`)
- Data freshness checks (stale source flags)
- Guardrails for impossible values/physics violations
- Full decision trace retention

### Exit criteria
- Low-trust/stale sources are reflected in confidence.
- Invalid inputs are rejected or quarantined.

## Step 9: Build test and replay harness

Create tests at three levels:

1. Unit tests
   - correlation logic
   - scoring math
2. Scenario replay tests
   - known historical sequences
3. Regression tests
   - top 3 use cases from mission scope

Track:
- precision
- recall
- false positive rate
- average time-to-alert

### Exit criteria
- Replay suite runs repeatably.
- Baseline metrics are recorded for future comparisons.

## Step 10: Launch and iterate

Start with a soft launch:

- Medium-confidence to watchlist
- High-confidence to alert channel
- Daily review of false positives/negatives
- Weekly score-weight calibration

### Exit criteria
- Top 3 use cases work end-to-end in production flow.
- Measurable alert quality improvement over current baseline.

## Suggested implementation sequence in repository

1. `docs/` - architecture note and schema reference
2. `src/ingestion/` - normalization + validation
3. `src/correlation/` - candidate generation worker
4. `src/scoring/` - confidence calculation + config loader
5. `src/alerts/` - summary renderer + suppression
6. `src/forecast/` - baseline next-step heuristics
7. `src/feedback/` - feedback API/storage
8. `tests/` - unit + replay + regression suites

## Upgrade path to Brain v2

Keep interfaces stable so you can swap internals later:

- Rules-only correlation -> hybrid rules + learned model
- Heuristic forecasting -> trained sequence model
- Relational links -> graph-backed relationship reasoning
- Template summaries -> optional LLM explanation layer

This keeps Brain Lite practical now while preserving a clean path to a more powerful layered system later.
