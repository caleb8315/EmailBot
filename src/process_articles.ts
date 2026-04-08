import OpenAI from "openai";
import { createLogger } from "./logger";
import { canMakeAICall, recordAICall } from "./usage_limiter";
import { saveArticle } from "./memory";
import { ArticleAnalysisSchema } from "./types";
import type {
  FilteredArticle,
  ArticleAnalysis,
  ArticleHistory,
  UserPreferences,
} from "./types";

const logger = createLogger("process_articles");

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error("OPENAI_API_KEY not set");
    return null;
  }
  return new OpenAI({ apiKey });
}

function buildAnalysisPrompt(
  article: FilteredArticle,
  prefs: UserPreferences
): { system: string; user: string } {
  const schema = JSON.stringify({
    summary: "string (max 280 chars)",
    importance_score: "number 1-10",
    relevance_score: "number 1-10",
    credibility_score: "number 1-10",
    why_it_matters: "string (max 200 chars)",
    is_major_event: "boolean",
    topics: "string[] (max 5)",
    sentiment: "positive | neutral | negative",
  });

  return {
    system: `You are an intelligence analyst. Analyze the article and return ONLY a valid JSON object matching this schema: ${schema}. No markdown, no explanation, no preamble.`,
    user: `Article title: ${article.title}\nSource: ${article.source}\nContent: ${article.content.slice(0, 2000)}\n\nUser interests: ${prefs.interests.join(", ") || "general news"}\nUser dislikes: ${prefs.dislikes.join(", ") || "none"}`,
  };
}

async function analyzeWithAI(
  article: FilteredArticle,
  prefs: UserPreferences
): Promise<ArticleAnalysis | null> {
  const openai = getOpenAI();
  if (!openai) return null;

  const prompt = buildAnalysisPrompt(article, prefs);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) {
      logger.error("Empty AI response", { title: article.title });
      return null;
    }

    const parsed = JSON.parse(raw);
    const validated = ArticleAnalysisSchema.parse(parsed);

    logger.info("AI analysis complete", {
      title: article.title.slice(0, 60),
      importance: validated.importance_score,
    });

    return validated;
  } catch (err) {
    logger.error("AI analysis failed", {
      title: article.title,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function buildArticleHistoryRow(
  article: FilteredArticle,
  analysis: ArticleAnalysis | null
): Omit<ArticleHistory, "id"> {
  return {
    url: article.url,
    title: article.title,
    source: article.source,
    summary: analysis?.summary ?? null,
    importance_score: analysis?.importance_score ?? null,
    credibility_score: analysis?.credibility_score ?? null,
    relevance_score: analysis?.relevance_score ?? null,
    ai_processed: analysis !== null,
    user_feedback: null,
    alerted: false,
    emailed: false,
    fetched_at: new Date().toISOString(),
    processed_at: analysis ? new Date().toISOString() : null,
  };
}

export interface ProcessingResult {
  processed: ArticleHistory[];
  skippedBudget: number;
  skippedError: number;
  aiCallsMade: number;
}

export async function processArticles(
  articles: FilteredArticle[],
  prefs: UserPreferences
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    processed: [],
    skippedBudget: 0,
    skippedError: 0,
    aiCallsMade: 0,
  };

  const candidates = articles
    .filter((a) => a.passedPrefilter)
    .sort((a, b) => b.prefilterScore - a.prefilterScore);

  const topPercent = Math.max(1, Math.ceil(candidates.length * 0.2));
  const toProcess = candidates.slice(0, topPercent);

  logger.info("Processing candidates", {
    total: articles.length,
    passed: candidates.length,
    toProcess: toProcess.length,
  });

  const useAI =
    process.env.PIPELINE_AI_SCORING === "true" ||
    process.env.PIPELINE_AI_SCORING === "1";

  for (const article of toProcess) {
    try {
      let analysis: ArticleAnalysis | null = null;

      if (useAI) {
        const budgetAvailable = await canMakeAICall();
        if (!budgetAvailable) {
          logger.info("AI budget exhausted — storing without analysis", {
            title: article.title.slice(0, 60),
          });
          result.skippedBudget++;
        } else {
          analysis = await analyzeWithAI(article, prefs);
          if (analysis) {
            await recordAICall();
            result.aiCallsMade++;
          } else {
            result.skippedError++;
          }
        }
      }

      const row = buildArticleHistoryRow(article, analysis);
      await saveArticle(row);
      result.processed.push({ ...row, id: "" });
    } catch (err) {
      logger.error("Failed to process article", {
        title: article.title,
        error: err instanceof Error ? err.message : String(err),
      });
      result.skippedError++;
    }
  }

  const unprocessed = articles.filter(
    (a) => !a.passedPrefilter || !toProcess.includes(a)
  );
  for (const article of unprocessed) {
    try {
      const row = buildArticleHistoryRow(article, null);
      await saveArticle(row);
    } catch (err) {
      logger.error("Failed to save unprocessed article", {
        title: article.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Processing complete", {
    aiCalls: result.aiCallsMade,
    budgetSkipped: result.skippedBudget,
    errors: result.skippedError,
  });

  return result;
}
