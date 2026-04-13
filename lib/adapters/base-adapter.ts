import type { DataSource, IntelEvent } from '../types';

export interface IngestionAdapter {
  source: DataSource;
  fetchIntervalMinutes: number;
  fetch(): Promise<IntelEvent[]>;
}

export abstract class BaseAdapter implements IngestionAdapter {
  abstract source: DataSource;
  abstract fetchIntervalMinutes: number;

  abstract fetch(): Promise<IntelEvent[]>;

  protected log(msg: string, meta?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const detail = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${ts}] [${this.source}] ${msg}${detail}`);
  }

  protected warn(msg: string, meta?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const detail = meta ? ` ${JSON.stringify(meta)}` : '';
    console.warn(`[${ts}] [${this.source}] WARN: ${msg}${detail}`);
  }

  protected error(msg: string, err?: unknown): void {
    const ts = new Date().toISOString();
    const detail = err instanceof Error ? err.message : String(err ?? '');
    console.error(`[${ts}] [${this.source}] ERROR: ${msg} ${detail}`);
  }

  protected safeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
}
