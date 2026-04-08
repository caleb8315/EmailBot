import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    const missing = [
      !url && "SUPABASE_URL",
      !key && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean).join(", ");
    throw new Error(
      `Missing Vercel env var(s): ${missing}. Add them in Vercel → Project → Settings → Environment Variables (Production). Then redeploy WITHOUT build cache.`
    );
  }
  _client = createClient(url, key);
  return _client;
}
