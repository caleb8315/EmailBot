# Brain Lite v1 Checklist

## 0) Define mission (before building)
- [ ] Write 1-2 sentence mission: "Detect correlated movement patterns and forecast likely next moves."
- [ ] Pick top 3 use cases (example: aircraft + convoy directional alignment, rapid repositioning, route divergence).
- [ ] Define success metrics:
  - [ ] Precision (alert quality)
  - [ ] Recall (miss rate)
  - [ ] Average time-to-alert
  - [ ] Analyst usefulness rating

## 1) Data foundation
- [ ] Standardize all incoming events into one schema:
  - [ ] `entity_id`
  - [ ] `entity_type` (aircraft, convoy, etc.)
  - [ ] `timestamp`
  - [ ] `lat`, `lon`
  - [ ] `heading`, `speed` (if available)
  - [ ] `source`
  - [ ] `source_confidence`
- [ ] Add deduplication rules for repeated events.
- [ ] Store in Postgres (+ PostGIS if using geo queries).
- [ ] Keep raw payload for audit/debug.

## 2) Correlation engine (core "smart" layer)
- [ ] Implement temporal windows (example: 30 min, 2 hr, 4 hr).
- [ ] Implement geo proximity/corridor checks.
- [ ] Implement directional alignment checks.
- [ ] Emit "candidate pattern" records when conditions match.
- [ ] Log why each candidate matched (feature-level evidence).

## 3) Confidence scoring
- [ ] Create weighted scoring formula using:
  - [ ] Source reliability
  - [ ] Temporal proximity
  - [ ] Geospatial consistency
  - [ ] Heading/speed coherence
  - [ ] Historical similarity (optional v1.1)
- [ ] Define thresholds:
  - [ ] Low confidence (store only)
  - [ ] Medium confidence (watchlist)
  - [ ] High confidence (alert)
- [ ] Add calibration table so weights can be tuned without code changes.

## 4) Alert + explanation output
- [ ] Generate human-readable summary for every high-confidence event:
  - [ ] What happened
  - [ ] Why the system thinks this
  - [ ] Confidence score
  - [ ] What might happen next
- [ ] Include links to supporting events/timeline.
- [ ] Add suppression/cooldown to prevent alert spam.

## 5) Minimal forecasting (practical v1)
- [ ] Add simple next-step prediction:
  - [ ] Route continuation probability
  - [ ] Likely area-of-interest in next window
- [ ] Use a baseline model first (rules + short history), not heavy AI.
- [ ] Output multiple possibilities with probabilities (not a single absolute claim).

## 6) Analyst feedback loop
- [ ] Add feedback buttons/labels:
  - [ ] Correct
  - [ ] Partially correct
  - [ ] False positive
- [ ] Store feedback with event ID and reason.
- [ ] Weekly/periodic weight tuning based on outcomes.

## 7) Reliability + governance
- [ ] Add source trust registry (per-source reliability score).
- [ ] Add data freshness checks (stale source detection).
- [ ] Add hard guardrails for impossible outputs.
- [ ] Keep full decision trace for auditability.

## 8) Jetson Nano split (if used)
- [ ] On Nano: ingestion + local filtering + lightweight anomaly flags.
- [ ] On central node: correlation, confidence scoring, forecasting, reporting.
- [ ] Add store-and-forward queue for disconnected periods.

## 9) Testing checklist
- [ ] Unit tests for correlation logic and score calculation.
- [ ] Replay tests with historical scenarios.
- [ ] False-positive stress test with noisy data.
- [ ] Latency test for alert generation.
- [ ] Regression suite for top 3 use cases.

## 10) Done criteria for Brain Lite v1
- [ ] Top 3 use cases running end-to-end.
- [ ] Alerts include explanation + confidence + evidence.
- [ ] Measured improvement in alert quality vs current baseline.
- [ ] Feedback loop active and being used.
- [ ] Clear upgrade path documented for Brain v2.
