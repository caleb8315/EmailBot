import OpenAI from "openai";
import { createLogger } from "./logger";

const logger = createLogger("llm_client");

const DEFAULT_PROVIDER = "gemini";
const DEFAULT_GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_GEMINI_NATIVE_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_SNIPPETS = [
  "timed out",
  "timeout",
  "socket hang up",
  "econnreset",
  "ehostunreach",
  "etimedout",
  "temporary issue",
  "connection",
  "network",
];

export type LLMProvider = "gemini" | "openai" | "groq" | "openrouter";
export type LLMWorkload = "chat" | "chat_web" | "pipeline" | "digest" | "python_intel";

interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface LLMRuntimeConfig {
  provider: LLMProvider;
  apiKey: string | null;
  openAIBaseURL: string | null;
  geminiNativeBaseURL: string;
}

function cleanEnv(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function firstEnv(keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanEnv(process.env[key]);
    if (value) return value;
  }
  return null;
}

function normalizeProvider(raw: string | null): LLMProvider {
  const provider = (raw ?? DEFAULT_PROVIDER).toLowerCase();
  if (provider === "openai") return "openai";
  if (provider === "groq") return "groq";
  if (provider === "openrouter") return "openrouter";
  return "gemini";
}

function defaultOpenAIBaseURL(provider: LLMProvider): string {
  switch (provider) {
    case "gemini":
      return DEFAULT_GEMINI_OPENAI_BASE_URL;
    case "groq":
      return DEFAULT_GROQ_BASE_URL;
    case "openrouter":
      return DEFAULT_OPENROUTER_BASE_URL;
    case "openai":
    default:
      return DEFAULT_OPENAI_BASE_URL;
  }
}

function resolveApiKey(provider: LLMProvider): string | null {
  if (provider === "gemini") {
    return firstEnv(["GEMINI_API_KEY", "OPENAI_API_KEY"]);
  }
  if (provider === "groq") {
    return firstEnv(["GROQ_API_KEY", "OPENAI_API_KEY"]);
  }
  if (provider === "openrouter") {
    return firstEnv(["OPENROUTER_API_KEY", "OPENAI_API_KEY"]);
  }
  return firstEnv(["OPENAI_API_KEY"]);
}

export function getLLMRuntimeConfig(): LLMRuntimeConfig {
  const provider = normalizeProvider(cleanEnv(process.env.LLM_PROVIDER));
  const apiKey = resolveApiKey(provider);
  const openAIBaseURL =
    cleanEnv(process.env.OPENAI_BASE_URL) ?? defaultOpenAIBaseURL(provider);
  const geminiNativeBaseURL =
    cleanEnv(process.env.GEMINI_NATIVE_BASE_URL) ?? DEFAULT_GEMINI_NATIVE_BASE_URL;

  return { provider, apiKey, openAIBaseURL, geminiNativeBaseURL };
}

export function hasLLMCredentials(): boolean {
  const { apiKey } = getLLMRuntimeConfig();
  return Boolean(apiKey);
}

export function getModelForWorkload(workload: LLMWorkload): string {
  const chatModel =
    firstEnv(["CHAT_MODEL", "LLM_CHAT_MODEL", "GEMINI_CHAT_MODEL"]) ??
    "gemini-2.5-flash";
  const chatWebModel =
    firstEnv(["CHAT_WEB_MODEL", "LLM_CHAT_WEB_MODEL", "GEMINI_CHAT_WEB_MODEL"]) ??
    chatModel;
  const pipelineModel =
    firstEnv(["PIPELINE_MODEL", "LLM_PIPELINE_MODEL", "GEMINI_PIPELINE_MODEL"]) ??
    "gemini-2.5-flash-lite";
  const digestModel =
    firstEnv(["DIGEST_MODEL", "LLM_DIGEST_MODEL", "GEMINI_DIGEST_MODEL"]) ??
    "gemini-2.5-flash";
  const pythonIntelModel =
    firstEnv([
      "PYTHON_INTELLIGENCE_MODEL",
      "INTELLIGENCE_MODEL",
      "LLM_PYTHON_INTEL_MODEL",
    ]) ?? "gemini-2.5-flash";

  switch (workload) {
    case "chat":
      return chatModel;
    case "chat_web":
      return chatWebModel;
    case "pipeline":
      return pipelineModel;
    case "digest":
      return digestModel;
    case "python_intel":
      return pythonIntelModel;
    default:
      return chatModel;
  }
}

export function createOpenAICompatibleClient(): OpenAI | null {
  const { apiKey, openAIBaseURL, provider } = getLLMRuntimeConfig();
  if (!apiKey) {
    logger.warn("No LLM API key configured");
    return null;
  }

  const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (openAIBaseURL) {
    opts.baseURL = openAIBaseURL;
  }
  if (provider === "openrouter") {
    opts.defaultHeaders = {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://localhost",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "Jeff Intelligence System",
    };
  }
  return new OpenAI(opts);
}

export function createGroqClient(): OpenAI | null {
  const groqKey = cleanEnv(process.env.GROQ_API_KEY);
  if (!groqKey) {
    logger.warn("No GROQ_API_KEY configured — Groq digest unavailable");
    return null;
  }
  return new OpenAI({
    apiKey: groqKey,
    baseURL: DEFAULT_GROQ_BASE_URL,
  });
}

export function getGroqDigestModel(): string {
  return cleanEnv(process.env.GROQ_DIGEST_MODEL) ?? "qwen/qwen3-32b";
}

function getErrorStatus(error: unknown): number | null {
  const e = error as {
    status?: number;
    response?: { status?: number };
    cause?: { status?: number };
  };
  return e?.status ?? e?.response?.status ?? e?.cause?.status ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status != null) {
    return RETRYABLE_STATUS_CODES.has(status);
  }
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return RETRYABLE_ERROR_SNIPPETS.some((snippet) => msg.includes(snippet));
}

function retryDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(250, exponential));
  return exponential + jitter;
}

export async function withLLMRetry<T>(
  operationName: string,
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const defaultAttempts =
    Number.parseInt(process.env.LLM_RETRY_ATTEMPTS ?? "3", 10) || 3;
  const defaultBaseDelayMs =
    Number.parseInt(process.env.LLM_RETRY_BASE_MS ?? "500", 10) || 500;
  const defaultMaxDelayMs =
    Number.parseInt(process.env.LLM_RETRY_MAX_MS ?? "5000", 10) || 5000;

  const attempts = Math.max(
    1,
    options.attempts ?? defaultAttempts
  );
  const baseDelayMs = Math.max(
    100,
    options.baseDelayMs ?? defaultBaseDelayMs
  );
  const maxDelayMs = Math.max(
    baseDelayMs,
    options.maxDelayMs ?? defaultMaxDelayMs
  );

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isRetryableError(err)) {
        throw err;
      }
      const delay = retryDelayMs(attempt, baseDelayMs, maxDelayMs);
      logger.warn("LLM request failed; retrying", {
        operation: operationName,
        attempt,
        attempts,
        delayMs: delay,
        status: getErrorStatus(err),
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function shouldUseGeminiGrounding(): boolean {
  const cfg = getLLMRuntimeConfig();
  if (cfg.provider !== "gemini") return false;
  if (!cfg.apiKey) return false;
  const disabled =
    process.env.DISABLE_CHAT_WEB_SEARCH === "true" ||
    process.env.DISABLE_CHAT_WEB_SEARCH === "1";
  return !disabled;
}

export interface GeminiGroundedRequest {
  model: string;
  systemInstruction: string;
  userMessage: string;
  temperature?: number;
  maxOutputTokens?: number;
}

function extractGeminiText(data: unknown): string {
  const payload = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  const blockReason = payload?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked prompt: ${blockReason}`);
  }
  const candidate = payload?.candidates?.[0];
  const text =
    candidate?.content?.parts
      ?.map((p) => p?.text ?? "")
      .find((part) => part.trim().length > 0) ?? "";
  if (!text.trim()) {
    const finish = candidate?.finishReason ? ` (${candidate.finishReason})` : "";
    throw new Error(`Gemini returned empty grounded response${finish}`);
  }
  return text.trim();
}

export async function requestGeminiGroundedJson(
  req: GeminiGroundedRequest
): Promise<string> {
  const cfg = getLLMRuntimeConfig();
  if (cfg.provider !== "gemini") {
    throw new Error("Gemini grounding requested while provider is not gemini");
  }
  if (!cfg.apiKey) {
    throw new Error("Gemini API key not configured");
  }

  const model = req.model || getModelForWorkload("chat_web");
  const base = cfg.geminiNativeBaseURL.replace(/\/+$/, "");
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    system_instruction: { parts: [{ text: req.systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: req.userMessage }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: req.temperature ?? 0.35,
      maxOutputTokens: req.maxOutputTokens ?? 1000,
      responseMimeType: "application/json",
    },
  };

  return withLLMRetry("gemini_grounded_generate_content", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cfg.apiKey ?? "",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `Gemini grounded request failed: ${res.status} ${res.statusText} ${text}`.trim()
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return extractGeminiText(data);
  });
}
