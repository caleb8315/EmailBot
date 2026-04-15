import { spawnSync } from 'child_process';
import path from 'path';
import snapshot from '../tests/fixtures/cluster_parity_snapshot.json';
import sourcesConfig from '../config/sources.json';
import type { SourceConfig, SourcesConfig } from '../src/types';
import { clusterStories, type StoryCluster } from '../lib/briefing_story_cluster';

interface SnapshotArticle {
  id: string;
  uid?: string;
  title: string;
  source?: string;
  publisher?: string;
  summary?: string;
  category?: string;
  link?: string;
}

interface PythonCluster {
  headline: string;
  label: string;
  category: string;
  source_count: number;
  credible_count: number;
  story_ids: string[];
}

interface PythonPayload {
  clusters: PythonCluster[];
}

function normalizeLabel(label: string): string {
  return label.replace(/[^\w\s]/g, '').trim().toUpperCase();
}

function partitionKey(ids: string[]): string {
  return ids.slice().sort().join('|');
}

function loadSnapshot(argPath?: string): SnapshotArticle[] {
  if (!argPath) {
    return (snapshot as { articles: SnapshotArticle[] }).articles;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dynamicData = require(path.resolve(process.cwd(), argPath));
  return (dynamicData?.articles ?? []) as SnapshotArticle[];
}

function runTsClusters(rows: SnapshotArticle[]): StoryCluster[] {
  const sources = (sourcesConfig as SourcesConfig).sources as SourceConfig[];
  const records = rows.map((row) => ({
    id: row.uid ?? row.id,
    title: row.title,
    source: row.source ?? row.publisher ?? 'unknown',
    summary: row.summary ?? '',
    category: row.category ?? 'world',
    published_at: null,
  }));
  return clusterStories(records, sources);
}

function runPythonClusters(snapshotPath?: string): PythonCluster[] {
  const scriptPath = path.resolve(process.cwd(), 'scripts/python_verifier_snapshot.py');
  const targetSnapshot = snapshotPath
    ? path.resolve(process.cwd(), snapshotPath)
    : path.resolve(process.cwd(), 'tests/fixtures/cluster_parity_snapshot.json');
  const result = spawnSync('python3', [scriptPath, targetSnapshot], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONPATH: [process.cwd(), process.env.PYTHONPATH ?? '']
        .filter(Boolean)
        .join(path.delimiter),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `python verifier failed (exit ${result.status}): ${result.stderr || result.stdout}`
    );
  }
  const payload = JSON.parse(result.stdout) as PythonPayload;
  return payload.clusters ?? [];
}

function compare(tsClusters: StoryCluster[], pyClusters: PythonCluster[]): string[] {
  const issues: string[] = [];
  const tsByPartition = new Map<string, StoryCluster>();
  const pyByPartition = new Map<string, PythonCluster>();

  for (const cluster of tsClusters) {
    tsByPartition.set(partitionKey(cluster.story_ids), cluster);
  }
  for (const cluster of pyClusters) {
    pyByPartition.set(partitionKey(cluster.story_ids), cluster);
  }

  for (const key of tsByPartition.keys()) {
    if (!pyByPartition.has(key)) {
      issues.push(`TS-only cluster partition: ${key}`);
    }
  }
  for (const key of pyByPartition.keys()) {
    if (!tsByPartition.has(key)) {
      issues.push(`Python-only cluster partition: ${key}`);
    }
  }

  for (const [key, tsCluster] of tsByPartition.entries()) {
    const pyCluster = pyByPartition.get(key);
    if (!pyCluster) continue;
    const tsLabel = normalizeLabel(tsCluster.label);
    const pyLabel = normalizeLabel(pyCluster.label);
    if (tsLabel !== pyLabel) {
      issues.push(
        `Label mismatch for partition ${key}: TS=${tsCluster.label} PY=${pyCluster.label}`
      );
    }
    if (tsCluster.source_count !== pyCluster.source_count) {
      issues.push(
        `Source count mismatch for partition ${key}: TS=${tsCluster.source_count} PY=${pyCluster.source_count}`
      );
    }
  }

  return issues;
}

function main(): void {
  const strict = process.argv.includes('--strict') || process.env.CLUSTER_PARITY_STRICT === 'true';
  const args = process.argv.slice(2).filter((arg) => arg !== '--strict');
  const argPath = args[0];
  const rows = loadSnapshot(argPath);
  const tsClusters = runTsClusters(rows);
  const pyClusters = runPythonClusters(argPath);
  const issues = compare(tsClusters, pyClusters);

  // Concise diagnostic summary for CI and local runs.
  console.log(`TS clusters: ${tsClusters.length}`);
  console.log(`PY clusters: ${pyClusters.length}`);
  if (issues.length === 0) {
    console.log('Cluster parity PASS');
    return;
  }

  console.error('Cluster parity DIFF');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  if (strict) {
    process.exit(1);
  }
}

main();
