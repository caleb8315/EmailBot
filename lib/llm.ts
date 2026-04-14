/**
 * Unified LLM caller for the Jeff Intelligence system.
 * Routes to Gemini (long context) or Groq (speed) based on use case.
 * Budget-gated via the shared usage_limiter from src/.
 */

import { canMakeAICall, recordAICall, type AICallPurpose } from '../src/usage_limiter';

type UseCase = 'narrative' | 'dreamtime' | 'brief' | 'conversation' | 'extraction';

const USE_CASE_PURPOSE: Record<UseCase, AICallPurpose> = {
  narrative: 'ingest',
  dreamtime: 'ingest',
  brief: 'digest',
  conversation: 'chat',
  extraction: 'ingest',
};

const USE_CASE_CONFIG: Record<UseCase, {
  preferGroq: boolean;
  groqModel: string;
  geminiModel: string;
  temperature: number;
  maxTokens: number;
}> = {
  narrative: { preferGroq: true, groqModel: 'llama-3.3-70b-versatile', geminiModel: 'gemini-2.5-flash-lite', temperature: 0.3, maxTokens: 500 },
  dreamtime: { preferGroq: true, groqModel: 'llama-3.3-70b-versatile', geminiModel: 'gemini-2.5-flash-lite', temperature: 0.7, maxTokens: 1500 },
  brief: { preferGroq: false, groqModel: 'llama-3.3-70b-versatile', geminiModel: 'gemini-2.5-flash-lite', temperature: 0.4, maxTokens: 2000 },
  conversation: { preferGroq: true, groqModel: 'llama-3.3-70b-versatile', geminiModel: 'gemini-2.5-flash-lite', temperature: 0.5, maxTokens: 800 },
  extraction: { preferGroq: true, groqModel: 'llama-3.3-70b-versatile', geminiModel: 'gemini-2.5-flash-lite', temperature: 0.1, maxTokens: 1000 },
};

export async function callLLM(
  prompt: string,
  useCase: UseCase,
  opts?: { json?: boolean },
): Promise<string> {
  const purpose = USE_CASE_PURPOSE[useCase];
  const allowed = await canMakeAICall(purpose);
  if (!allowed) {
    console.warn(`[llm] Budget exceeded for purpose=${purpose} (useCase=${useCase}) — skipping`);
    return '';
  }

  const config = USE_CASE_CONFIG[useCase];
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const useGroq = config.preferGroq && groqKey;
  const apiKey = useGroq ? groqKey : geminiKey || groqKey;

  if (!apiKey) throw new Error('No LLM API key available');

  const baseUrl = useGroq
    ? 'https://api.groq.com/openai/v1'
    : 'https://generativelanguage.googleapis.com/v1beta/openai/';
  const model = useGroq ? config.groqModel : config.geminiModel;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: config.temperature,
    max_tokens: config.maxTokens,
  };

  if (opts?.json) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM call failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  await recordAICall(purpose);
  return data.choices[0]?.message?.content || '';
}
