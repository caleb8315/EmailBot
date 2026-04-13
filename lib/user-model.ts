import { createClient } from '@supabase/supabase-js';
import type { UserBelief } from './types';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

interface ExtractedBelief {
  statement: string;
  confidence: number;
  type: 'belief' | 'prediction';
  resolve_by?: string;
  verbatim_quote: string;
}

/**
 * Extract user beliefs and predictions from a conversation via LLM.
 * Called after significant Telegram or dashboard conversations.
 */
export async function extractUserBeliefsFromConversation(
  messages: { role: string; content: string }[],
): Promise<ExtractedBelief[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) return [];

  const isGroq = !process.env.GEMINI_API_KEY && !!process.env.GROQ_API_KEY;
  const baseUrl = isGroq
    ? 'https://api.groq.com/openai/v1'
    : 'https://generativelanguage.googleapis.com/v1beta/openai/';
  const model = isGroq ? 'llama-3.1-8b-instant' : 'gemini-2.5-flash-lite';

  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: `Analyze this conversation and extract any beliefs, predictions, or positions the USER has stated (not Jeff/assistant).

Conversation:
${conversationText}

Return a JSON object with a "beliefs" array. Each element:
{
  "statement": "the belief as a clear statement",
  "confidence": 0.0-1.0,
  "type": "belief" or "prediction",
  "resolve_by": "ISO date if prediction with deadline, else null",
  "verbatim_quote": "exact words that revealed this"
}

Only include explicit statements. Return {"beliefs": []} if none found.`,
        }],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) return [];
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0]?.message?.content || '{}');
    return parsed.beliefs || [];
  } catch {
    return [];
  }
}

/**
 * Store extracted user beliefs into the database.
 */
export async function storeExtractedBeliefs(
  beliefs: ExtractedBelief[],
  conversationContext?: string,
): Promise<void> {
  const sb = getSupabase();

  for (const belief of beliefs) {
    if (belief.type === 'belief') {
      await sb.from('user_beliefs').insert({
        statement: belief.statement,
        confidence: belief.confidence,
        source: 'inferred_from_conversation',
        conversation_context: conversationContext || belief.verbatim_quote,
        status: 'active',
        tags: [],
      });
    } else if (belief.type === 'prediction') {
      await sb.from('predictions').insert({
        predictor: 'user',
        statement: belief.statement,
        confidence_at_prediction: belief.confidence,
        resolve_by: belief.resolve_by || null,
        tags: [],
        confidence_history: [{
          timestamp: new Date().toISOString(),
          confidence: belief.confidence,
          reason: 'extracted from conversation',
        }],
      });
    }
  }
}

/**
 * Filter any Jeff output through the user's personal lens.
 * Adds personal relevance annotations.
 */
export async function personalizeAnalysis(
  analysis: string,
  relevantEntities: string[],
): Promise<string> {
  const sb = getSupabase();

  const { data: profile } = await sb
    .from('user_profile')
    .select('known_contacts, regions_of_interest, known_blindspots')
    .limit(1)
    .single();

  if (!profile) return analysis;

  const connections: string[] = [];

  // Check if any entities match user's known contacts
  const contacts = (profile.known_contacts || []) as { name: string; location: string }[];
  for (const entity of relevantEntities) {
    const match = contacts.find(c =>
      c.name.toLowerCase().includes(entity.toLowerCase()) ||
      entity.toLowerCase().includes(c.name.toLowerCase()),
    );
    if (match) {
      connections.push(`${match.name} (your contact in ${match.location}) may be affected`);
    }
  }

  // Check if event is in a region of interest
  const regions = profile.regions_of_interest || [];
  for (const entity of relevantEntities) {
    if (regions.some((r: string) => r.toLowerCase().includes(entity.toLowerCase()))) {
      connections.push(`This is in your tracked region: ${entity}`);
    }
  }

  // Check blindspots
  const blindspots = profile.known_blindspots || [];
  for (const bs of blindspots) {
    if (relevantEntities.some(e => e.toLowerCase().includes((bs as string).toLowerCase()))) {
      connections.push(`Note: ${bs} is a known blindspot for you — consider extra scrutiny`);
    }
  }

  if (connections.length > 0) {
    return analysis + '\n\nPERSONAL RELEVANCE:\n' + connections.map(c => `- ${c}`).join('\n');
  }

  return analysis;
}
