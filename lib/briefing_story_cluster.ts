import type { SourceConfig } from '../src/types';

export type StoryVerificationLabel =
  | 'VERIFIED'
  | 'DEVELOPING'
  | 'UNVERIFIED'
  | 'QUARANTINED'
  | 'BLOCKED';

export interface StoryRecord {
  id: string;
  title: string;
  source: string;
  summary?: string | null;
  category?: string | null;
  published_at?: string | null;
}

export interface StoryCluster {
  cluster_id: number;
  headline: string;
  category: string;
  label: StoryVerificationLabel;
  story_ids: string[];
  stories: StoryRecord[];
  source_count: number;
  credible_count: number;
}

const TITLE_SIMILARITY_THRESHOLD = 55;
const ENTITY_OVERLAP_THRESHOLD = 0.3;
const VERIFIED_MIN_CREDIBLE = 2;
const DEVELOPING_MIN_SOURCES = 2;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'by',
  'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'this', 'that',
  'it', 'its', 'after', 'before', 'amid', 'over', 'under', 'about', 'into',
]);

function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function tokenFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

function cosineSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const fa = tokenFrequency(a);
  const fb = tokenFrequency(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of fa.values()) normA += value * value;
  for (const value of fb.values()) normB += value * value;
  for (const [token, valueA] of fa) {
    const valueB = fb.get(token);
    if (valueB) dot += valueA * valueB;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set([...a].filter((token) => b.has(token)));
  const unionSize = new Set([...a, ...b]).size;
  return unionSize === 0 ? 0 : intersection.size / unionSize;
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeTokens(text));
}

function titleSimilarity(a: StoryRecord, b: StoryRecord): number {
  const left = normalizeTokens(a.title).sort();
  const right = normalizeTokens(b.title).sort();
  return Math.round(cosineSimilarity(left, right) * 100);
}

function entitySimilarity(a: StoryRecord, b: StoryRecord): number {
  const left = tokenSet(`${a.title} ${a.summary ?? ''}`);
  const right = tokenSet(`${b.title} ${b.summary ?? ''}`);
  return jaccardSimilarity(left, right);
}

function shouldCluster(a: StoryRecord, b: StoryRecord): boolean {
  const titleSim = titleSimilarity(a, b);
  if (titleSim >= TITLE_SIMILARITY_THRESHOLD) return true;
  const entitySim = entitySimilarity(a, b);
  return titleSim >= 40 && entitySim >= ENTITY_OVERLAP_THRESHOLD;
}

function canonicalSource(value: string): string {
  return value.trim().toLowerCase();
}

function buildSourceTierIndex(sources: SourceConfig[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const source of sources) {
    const key = canonicalSource(source.name);
    const tier = typeof source.tier === 'number' ? source.tier : 3;
    index.set(key, tier);
  }
  return index;
}

function sourceTier(sourceName: string, index: Map<string, number>): number {
  return index.get(canonicalSource(sourceName)) ?? 3;
}

function assignLabel(
  stories: StoryRecord[],
  category: string,
  index: Map<string, number>
): StoryVerificationLabel {
  const uniqueSources = new Map<string, number>();
  for (const story of stories) {
    const key = canonicalSource(story.source);
    uniqueSources.set(key, sourceTier(story.source, index));
  }

  const credibleCount = [...uniqueSources.values()].filter((tier) => tier <= 2).length;
  const sourceCount = uniqueSources.size;
  const isAltCategory = category.toLowerCase().includes('conspiracy') || category === 'alt';

  if (isAltCategory) {
    return credibleCount >= VERIFIED_MIN_CREDIBLE ? 'DEVELOPING' : 'QUARANTINED';
  }
  if (credibleCount >= VERIFIED_MIN_CREDIBLE) return 'VERIFIED';
  if (sourceCount >= DEVELOPING_MIN_SOURCES) return 'DEVELOPING';
  if (sourceCount === 1) return 'QUARANTINED';
  return 'UNVERIFIED';
}

export function clusterStories(
  stories: StoryRecord[],
  sources: SourceConfig[]
): StoryCluster[] {
  const tierIndex = buildSourceTierIndex(sources);
  const assigned = new Set<string>();
  const clusters: StoryCluster[] = [];
  let clusterId = 0;

  const byCategory = new Map<string, StoryRecord[]>();
  for (const story of stories) {
    const category = story.category ?? 'news';
    const group = byCategory.get(category) ?? [];
    group.push(story);
    byCategory.set(category, group);
  }

  for (const [category, items] of byCategory.entries()) {
    for (const story of items) {
      if (assigned.has(story.id)) continue;
      const group: StoryRecord[] = [story];
      assigned.add(story.id);

      for (const candidate of items) {
        if (assigned.has(candidate.id)) continue;
        if (group.some((member) => shouldCluster(candidate, member))) {
          group.push(candidate);
          assigned.add(candidate.id);
        }
      }

      const sorted = group
        .slice()
        .sort((a, b) => sourceTier(a.source, tierIndex) - sourceTier(b.source, tierIndex));
      const headline = sorted[0]?.title ?? story.title;
      const sourceNames = new Set(group.map((item) => canonicalSource(item.source)));
      const credibleCount = [...sourceNames]
        .map((sourceName) => tierIndex.get(sourceName) ?? 3)
        .filter((tier) => tier <= 2).length;

      const label = assignLabel(group, category, tierIndex);
      clusters.push({
        cluster_id: clusterId++,
        headline,
        category,
        label,
        story_ids: group.map((item) => item.id),
        stories: group,
        source_count: sourceNames.size,
        credible_count: credibleCount,
      });
    }
  }

  return clusters;
}
