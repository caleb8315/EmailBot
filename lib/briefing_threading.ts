import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

interface ThreadAppearance {
  date: string;
  headline: string;
  label: string;
  source_count: number;
  category: string;
}

interface ThreadRecord {
  headline: string;
  category: string;
  appearances: ThreadAppearance[];
}

interface ThreadStore {
  [threadId: string]: ThreadRecord;
}

export interface ThreadableCluster {
  headline: string;
  label?: string;
  verification_label?: string;
  category: string;
  source_count: number;
  thread_days?: number;
  thread_trajectory?: string;
  thread_label?: string;
}

const TITLE_MATCH_THRESHOLD = 50;
const MAX_THREAD_AGE_DAYS = 14;
const MAX_THREADS = 500;
const THREADS_PATH = path.resolve(process.cwd(), 'data/threads_ts.json');

function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function tokenOverlapScore(a: string, b: string): number {
  const left = new Set(normalizeTokens(a));
  const right = new Set(normalizeTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  const denominator = Math.max(left.size, right.size);
  return Math.round((overlap / denominator) * 100);
}

function makeThreadId(headline: string): string {
  const normalized = normalizeTokens(headline).slice(0, 8).join(' ');
  return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 12);
}

async function loadThreads(): Promise<ThreadStore> {
  try {
    const raw = await fs.readFile(THREADS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as ThreadStore : {};
  } catch {
    return {};
  }
}

async function saveThreads(threads: ThreadStore): Promise<void> {
  const cutoffDate = new Date(Date.now() - MAX_THREAD_AGE_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const pruned: ThreadStore = {};
  for (const [threadId, thread] of Object.entries(threads)) {
    const appearances = thread.appearances.filter((entry) => entry.date >= cutoffDate);
    if (appearances.length > 0) {
      pruned[threadId] = { ...thread, appearances };
    }
  }

  const sorted = Object.entries(pruned).sort((a, b) => {
    const aDate = a[1].appearances[a[1].appearances.length - 1]?.date ?? '';
    const bDate = b[1].appearances[b[1].appearances.length - 1]?.date ?? '';
    return bDate.localeCompare(aDate);
  });
  const capped = Object.fromEntries(sorted.slice(0, MAX_THREADS));

  await fs.mkdir(path.dirname(THREADS_PATH), { recursive: true });
  await fs.writeFile(THREADS_PATH, `${JSON.stringify(capped, null, 2)}\n`, 'utf8');
}

function findMatchingThread(cluster: ThreadableCluster, threads: ThreadStore): string | null {
  for (const [threadId, thread] of Object.entries(threads)) {
    if (tokenOverlapScore(cluster.headline, thread.headline) >= TITLE_MATCH_THRESHOLD) {
      return threadId;
    }
    const recentAppearances = thread.appearances.slice(-3);
    if (
      recentAppearances.some(
        (appearance) =>
          tokenOverlapScore(cluster.headline, appearance.headline) >= TITLE_MATCH_THRESHOLD
      )
    ) {
      return threadId;
    }
  }
  return null;
}

function computeTrajectory(appearances: ThreadAppearance[]): string {
  if (appearances.length < 2) return 'NEW';
  const recent = appearances.slice(-3).map((item) => item.source_count || 1);
  if (recent.length >= 2) {
    const trend = recent[recent.length - 1] - recent[0];
    if (trend > 1) return 'Escalating';
    if (trend < -1) return 'De-escalating';
  }
  return 'Ongoing';
}

export async function annotateClusterThreads<T extends ThreadableCluster>(
  clusters: T[]
): Promise<T[]> {
  const threads = await loadThreads();
  const today = new Date().toISOString().slice(0, 10);

  for (const cluster of clusters) {
    const existingId = findMatchingThread(cluster, threads);
    if (existingId) {
      const thread = threads[existingId];
      const alreadyToday = thread.appearances.some((entry) => entry.date === today);
      if (!alreadyToday) {
        const clusterLabel = cluster.label ?? cluster.verification_label ?? 'DEVELOPING';
        thread.appearances.push({
          date: today,
          headline: cluster.headline,
          label: clusterLabel,
          source_count: cluster.source_count,
          category: cluster.category,
        });
      }
      thread.headline = cluster.headline;
      const days = new Set(thread.appearances.map((entry) => entry.date)).size;
      const trajectory = computeTrajectory(thread.appearances);
      cluster.thread_days = days;
      cluster.thread_trajectory = trajectory;
      cluster.thread_label = `Day ${days} · ${trajectory}`;
      continue;
    }

    const newId = makeThreadId(cluster.headline);
    const clusterLabel = cluster.label ?? cluster.verification_label ?? 'DEVELOPING';
    threads[newId] = {
      headline: cluster.headline,
      category: cluster.category,
      appearances: [
        {
          date: today,
          headline: cluster.headline,
          label: clusterLabel,
          source_count: cluster.source_count,
          category: cluster.category,
        },
      ],
    };
    cluster.thread_days = 1;
    cluster.thread_trajectory = 'NEW';
    cluster.thread_label = 'NEW';
  }

  await saveThreads(threads);
  return clusters;
}
