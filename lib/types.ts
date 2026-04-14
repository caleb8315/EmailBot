export type DataSource =
  | 'adsb'
  | 'ais'
  | 'acled'
  | 'gdelt'
  | 'firms'
  | 'usgs'
  | 'ooni'
  | 'polymarket'
  | 'metaculus'
  | 'opensanctions'
  | 'sam_gov'
  | 'sentinel'
  | 'notam'
  | 'telegram'
  | 'rss'
  | 'cisa'
  | 'fishing_watch'
  | 'emsc'
  | 'gvp'
  | 'reliefweb'
  | 'nhc';

export type EventType =
  | 'military_flight'
  | 'military_flight_isr'
  | 'tanker_surge'
  | 'doomsday_plane'
  | 'vessel_dark'
  | 'vessel_anomaly'
  | 'vessel_transfer'
  | 'conflict'
  | 'protest'
  | 'airstrike'
  | 'fire'
  | 'earthquake'
  | 'internet_disruption'
  | 'internet_shutdown'
  | 'procurement_anomaly'
  | 'procurement_munitions'
  | 'procurement_medical'
  | 'procurement_interpreters'
  | 'prediction_market_spike'
  | 'sanctions_new'
  | 'narrative_cluster'
  | 'satellite_change'
  | 'notam_closure'
  | 'rf_anomaly'
  | 'hospital_ship_movement'
  | 'cyber_advisory'
  | 'news_signal';

export interface IntelEvent {
  id?: string;
  source: DataSource;
  type: EventType;
  severity: number;
  confidence: number;
  lat: number;
  lng: number;
  radius_km?: number;
  country_code: string;
  timestamp: string;
  expires_at?: string;
  title: string;
  summary: string;
  raw_data: Record<string, unknown>;
  tags: string[];
  related_event_ids?: string[];
  entity_ids?: string[];
  verification?: VerificationMeta;
}

export type AlertTier = 'FLASH' | 'PRIORITY' | 'DAILY' | 'WEEKLY';

export type VerificationStatus =
  | 'verified'
  | 'developing'
  | 'unverified'
  | 'quarantined'
  | 'blocked';

export interface CorroborationEvidence {
  source_count: number;
  credible_source_count: number;
  distinct_domains: string[];
  first_seen: string;
  last_corroborated: string;
  recheck_count: number;
}

export interface VerificationMeta {
  status: VerificationStatus;
  corroboration: CorroborationEvidence;
  quarantined_at?: string;
  promoted_at?: string;
  blocked_reason?: string;
  decision_log: string[];
}

export interface PatternMatch {
  pattern: Pattern;
  events: IntelEvent[];
  region: { lat: number; lng: number; name?: string };
  matched_at: string;
  composite_severity: number;
  relevantUserBeliefs?: Belief[];
}

export interface Pattern {
  name: string;
  description: string;
  signals: SignalRequirement[];
  timeWindowHours: number;
  radiusKm: number;
  historicalHitRate: number;
  historicalSampleSize: number;
  nextEventMedianHours: number;
  severity: number;
  alertTier: AlertTier;
  hypothesisTemplate: string;
}

export interface SignalRequirement {
  source?: DataSource;
  type?: EventType;
  minSeverity?: number;
  minCount?: number;
  baselineMultiplier?: number;
  required: boolean;
}

export interface Belief {
  id: string;
  statement: string;
  confidence: number;
  confidence_history: ConfidenceEntry[];
  formed_at: string;
  last_updated: string;
  last_challenged?: string;
  status: 'active' | 'confirmed' | 'falsified' | 'expired';
  resolved_at?: string;
  resolution_notes?: string;
  evidence_for: Evidence[];
  evidence_against: Evidence[];
  tags: string[];
  region?: string;
  entities: string[];
  jeff_stake?: 'HIGH' | 'MEDIUM' | 'LOW';
  user_agrees?: boolean | null;
  user_confidence?: number | null;
}

export interface Evidence {
  event_id: string;
  description: string;
  weight: number;
  timestamp: string;
}

export interface ConfidenceEntry {
  timestamp: string;
  confidence: number;
  reason: string;
  event_id?: string;
}

export interface UserBelief {
  id: string;
  statement: string;
  confidence: number;
  source: 'stated' | 'inferred_from_conversation' | 'inferred_from_prediction';
  conversation_context?: string;
  formed_at: string;
  last_updated: string;
  status: 'active' | 'confirmed' | 'falsified' | 'expired';
  jeff_belief_id?: string;
  agrees_with_jeff?: boolean;
  tags: string[];
}

export interface Prediction {
  id: string;
  predictor: 'jeff' | 'user';
  statement: string;
  confidence_at_prediction: number;
  made_at: string;
  resolve_by?: string;
  resolved_at?: string;
  outcome?: 'correct' | 'incorrect' | 'partial' | 'unresolvable';
  outcome_notes?: string;
  brier_score?: number;
  confidence_history: ConfidenceEntry[];
  tags: string[];
  region?: string;
  related_belief_id?: string;
}

export interface Hypothesis {
  id: string;
  title: string;
  confidence: number;
  prior_confidence: number;
  confidence_history: ConfidenceEntry[];
  competing_hypothesis_ids: string[];
  supporting_signals: string[];
  undermining_signals: string[];
  status: 'active' | 'confirmed' | 'rejected';
  trigger_event_id?: string;
  region?: string;
  tags: string[];
}

export interface NarrativeArc {
  id: string;
  title: string;
  current_act: number;
  total_acts?: number;
  act_descriptions: ArcAct[];
  pattern_matched?: string;
  historical_matches?: Record<string, unknown>[];
  historical_accuracy?: number;
  next_act_predicted?: string;
  next_act_median_hours?: number;
  actors?: Record<string, unknown>;
  event_ids: string[];
  region?: string;
  lat?: number;
  lng?: number;
  status: 'active' | 'resolved' | 'stalled';
  started_at: string;
  last_updated: string;
}

export interface ArcAct {
  act: number;
  title: string;
  description: string;
  started_at?: string;
  ended_at?: string;
}

export interface CountryRiskScore {
  country_code: string;
  score: number;
  score_delta_24h?: number;
  score_delta_7d?: number;
  components: Record<string, number>;
  instability_trend: 'rising_fast' | 'rising' | 'stable' | 'falling';
  snapshot_date: string;
}

export interface DreamtimeScenario {
  id?: string;
  generated_date: string;
  scenario_type: 'wildcard' | 'underrated' | 'fading_consensus';
  title: string;
  narrative: string;
  probability?: number;
  market_implied_probability?: number;
  jeff_probability?: number;
  signal_chain?: Record<string, unknown>[];
  impact_level: 'extreme' | 'high' | 'medium';
  user_read?: boolean;
  user_reaction?: string;
}

export interface Watch {
  id: string;
  name: string;
  watch_type: 'region' | 'entity' | 'topic' | 'tripwire';
  definition: Record<string, unknown>;
  tripwire_conditions?: TripwireCondition[];
  conditions_met: number;
  conditions_total?: number;
  status: 'active' | 'triggered' | 'paused';
  alert_tier: AlertTier;
  last_triggered?: string;
}

export interface TripwireCondition {
  source: DataSource;
  metric: string;
  operator: '>' | '<' | '==' | '>=' | '<=';
  threshold: number;
  met_at?: string;
}

export interface Anomaly {
  source: string;
  country_code: string;
  z_score: number;
  recent_count: number;
  baseline_mean: number;
  baseline_stddev: number;
  direction: 'surge' | 'silence';
  significance: number;
}

export interface FogZone {
  type: string;
  lat: number;
  lng: number;
  radius_km: number;
  description: string;
  last_normal_timestamp?: string;
  significance: number;
}

export interface UserProfile {
  id: string;
  regions_of_interest: string[];
  known_contacts: { name: string; location: string; last_contact: string; relevance: string }[];
  expertise_areas: string[];
  known_blindspots: string[];
  calibration_score: number;
  calibration_by_region: Record<string, number>;
  calibration_by_topic: Record<string, number>;
  total_predictions: number;
  correct_predictions: number;
}
