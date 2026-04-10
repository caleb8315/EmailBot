import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getPreferences, updatePreferences } from "../../../../../src/memory";
import { BRIEFING_SECTIONS, type UserPreferences } from "../../../../../src/types";
import { resolvePreferenceUserId } from "../../../../../src/user_identity";

const SectionEnum = z.enum(BRIEFING_SECTIONS);

const StringListSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(50)
  .transform((values) => dedupeStrings(values));

const SourceListSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(50)
  .transform((values) => dedupeStrings(values.map((v) => v.toLowerCase())));

const BriefingOverlaySchema = z
  .object({
    boost_categories: z.array(SectionEnum).max(8).optional(),
    ignore_categories: z.array(SectionEnum).max(8).optional(),
    category_weights: z.record(z.string(), z.number().min(1).max(10)).optional(),
    tier1_keywords: z
      .array(z.string().trim().min(1).max(60))
      .max(40)
      .optional()
      .transform((values) => values?.map((v) => v.toLowerCase()) ?? values),
    ignore_sources: z
      .array(z.string().trim().min(1).max(120))
      .max(40)
      .optional()
      .transform((values) => values?.map((v) => v.toLowerCase()) ?? values),
    last_briefing_feedback: z.string().max(500).optional(),
  })
  .strict();

const PreferencesPatchSchema = z
  .object({
    interests: StringListSchema.optional(),
    dislikes: StringListSchema.optional(),
    alert_sensitivity: z.number().int().min(1).max(10).optional(),
    trusted_sources: SourceListSchema.optional(),
    blocked_sources: SourceListSchema.optional(),
    briefing_overlay: BriefingOverlaySchema.nullable().optional(),
  })
  .strict();

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (auth) return auth;

  try {
    const userId = resolvePreferenceUserId();
    const preferences = await getPreferences(userId);
    return NextResponse.json({ userId, preferences });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const auth = requireAuth(req);
  if (auth) return auth;

  try {
    const body = (await req.json()) as unknown;
    const parsed = PreferencesPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid preferences payload",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const userId = resolvePreferenceUserId();
    await getPreferences(userId); // ensure row exists before update

    const patch = parsed.data as Partial<
      Pick<
        UserPreferences,
        | "interests"
        | "dislikes"
        | "alert_sensitivity"
        | "trusted_sources"
        | "blocked_sources"
        | "briefing_overlay"
      >
    >;

    if (Object.keys(patch).length > 0) {
      await updatePreferences(userId, patch);
    }

    const preferences = await getPreferences(userId);
    return NextResponse.json({ userId, preferences });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
