import Parser from "rss-parser";
import { createLogger } from "./logger";
import type { RawArticle, SourcesConfig } from "./types";
import sourcesConfig from "../config/sources.json";

const logger = createLogger("fetch_sources");

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "JeffIntelligenceBot/1.0",
  },
});

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

async function fetchSingleFeed(
  name: string,
  url: string
): Promise<RawArticle[]> {
  try {
    const feed = await parser.parseURL(url);
    const articles: RawArticle[] = [];

    for (const item of feed.items ?? []) {
      if (!item.title || !item.link) continue;

      const content = stripHtml(
        item.contentSnippet ?? item.content ?? item.summary ?? ""
      );

      articles.push({
        title: item.title.trim(),
        url: item.link.trim(),
        source: name,
        content,
        publishedAt: item.isoDate ?? new Date().toISOString(),
        wordCount: countWords(content),
      });
    }

    logger.info("Feed fetched", { source: name, articles: articles.length });
    return articles;
  } catch (err) {
    logger.error("Feed fetch failed", {
      source: name,
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function fetchAllSources(): Promise<RawArticle[]> {
  const config = sourcesConfig as SourcesConfig;
  const allArticles: RawArticle[] = [];

  const feedPromises = config.sources
    .filter((s) => s.type === "rss")
    .map((s) => fetchSingleFeed(s.name, s.url));

  const results = await Promise.allSettled(feedPromises);

  for (const result of results) {
    if (result.status === "fulfilled") {
      allArticles.push(...result.value);
    }
  }

  logger.info("All sources fetched", {
    totalArticles: allArticles.length,
    sourcesAttempted: config.sources.length,
  });

  return allArticles;
}

export function getSourcesConfig(): SourcesConfig {
  return sourcesConfig as SourcesConfig;
}
