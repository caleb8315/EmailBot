import { z } from "zod";

// ── Raw article from RSS/API fetch ──
export interface RawArticle {
  title: string;
  url: string;
  source: string;
  content: string;
  publishedAt: string;
  wordCount: number;
  sourceTrustScore?: number;
}

// ── After prefilter scoring ──
export interface FilteredArticle extends RawArticle {
  prefilterScore: number;
  passedPrefilter: boolean;
  heuristicImportance: number;
  heuristicCredibility: number;
  corroborationCount: number;
}

// ── AI analysis response (validated via Zod) ──
export const ArticleAnalysisSchema = z.object({
  summary: z.string().max(280),
  importance_score: z.number().min(1).max(10),
  relevance_score: z.number().min(1).max(10),
  credibility_score: z.number().min(1).max(10),
  why_it_matters: z.string().max(200),
  is_major_event: z.boolean(),
  topics: z.array(z.string()).max(5),
  sentiment: z.enum(["positive", "neutral", "negative"]),
});

export type ArticleAnalysis = z.infer<typeof ArticleAnalysisSchema>;

// ── Database row types ──
export interface UsageTracking {
  id: string;
  date: string;
  api_calls_used: number;
  chat_calls_used: number;
  pipeline_calls_used: number;
  digest_calls_used: number;
  other_calls_used: number;
  last_reset_at: string;
  created_at: string;
}

/** Synced to Supabase; drives Python briefing + breaking keywords when present */
export interface BriefingOverlay {
  boost_categories?: string[];
  ignore_categories?: string[];
  category_weights?: Record<string, number>;
  tier1_keywords?: string[];
  ignore_sources?: string[];
  last_briefing_feedback?: string;
  updated_at?: string;
}

export const BRIEFING_SECTIONS = [
  "World & Geopolitics",
  "Wars & Conflicts",
  "Economy & Markets",
  "Stocks",
  "Crypto",
  "AI & Technology",
  "Power & Elite Activity",
  "Conspiracy / Unverified Signals",
] as const;

export type BriefingSection = (typeof BRIEFING_SECTIONS)[number];

export interface UserPreferences {
  id: string;
  user_id: string;
  interests: string[];
  dislikes: string[];
  alert_sensitivity: number;
  trusted_sources: string[];
  blocked_sources: string[];
  briefing_overlay: BriefingOverlay | null;
  updated_at: string;
}

export interface ArticleHistory {
  id: string;
  url: string;
  title: string;
  source: string;
  summary: string | null;
  importance_score: number | null;
  credibility_score: number | null;
  relevance_score: number | null;
  ai_processed: boolean;
  user_feedback: string | null;
  alerted: boolean;
  emailed: boolean;
  fetched_at: string;
  processed_at: string | null;
}

export interface SourceRegistry {
  id: string;
  url: string;
  name: string;
  trust_score: number;
  bias_score: number;
  last_validated_at: string | null;
  active: boolean;
}

export interface UsageReport {
  date: string;
  callsUsed: number;
  callsRemaining: number;
  maxCalls: number;
  chatCallsUsed: number;
  chatCallsRemaining: number;
  maxChatCalls: number;
  pipelineCallsUsed: number;
  digestCallsUsed: number;
}

// ── Chat handler types ──
export type ChatIntent =
  | "focus"
  | "ignore"
  | "why"
  | "deeper"
  | "status"
  | "help"
  | "unknown";

export interface ParsedIntent {
  intent: ChatIntent;
  topic: string;
  confidence: number;
}

export const ParsedIntentSchema = z.object({
  intent: z.enum([
    "focus",
    "ignore",
    "why",
    "deeper",
    "status",
    "help",
    "unknown",
  ]),
  topic: z.string(),
  confidence: z.number().min(0).max(1),
});

// ── Source config types ──
export interface SourceConfig {
  name: string;
  url: string;
  type: "rss" | "api";
  category: string;
  trust_score: number;
}

export interface SourcesConfig {
  sources: SourceConfig[];
  trusted_domains: string[];
  blocked_domains: string[];
}
