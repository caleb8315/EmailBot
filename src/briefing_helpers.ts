import type { BriefingSection } from "./types";
import { BRIEFING_SECTIONS } from "./types";

export { BRIEFING_SECTIONS };

const TOPIC_ALIASES: Record<string, BriefingSection> = {
  crypto: "Crypto",
  bitcoin: "Crypto",
  ai: "AI & Technology",
  tech: "AI & Technology",
  technology: "AI & Technology",
  stocks: "Stocks",
  stock: "Stocks",
  markets: "Economy & Markets",
  economy: "Economy & Markets",
  econ: "Economy & Markets",
  world: "World & Geopolitics",
  geopolitics: "World & Geopolitics",
  war: "Wars & Conflicts",
  wars: "Wars & Conflicts",
  conflicts: "Wars & Conflicts",
  power: "Power & Elite Activity",
  politics: "Power & Elite Activity",
  elite: "Power & Elite Activity",
  conspiracy: "Conspiracy / Unverified Signals",
  alt: "Conspiracy / Unverified Signals",
  unverified: "Conspiracy / Unverified Signals",
};

export function matchBriefingSection(q: string): BriefingSection | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  if (TOPIC_ALIASES[t]) return TOPIC_ALIASES[t];
  for (const s of BRIEFING_SECTIONS) {
    if (s.toLowerCase() === t) return s;
  }
  for (const s of BRIEFING_SECTIONS) {
    const words = s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
    if (words.some((w) => w === t || w.startsWith(t) || t.startsWith(w))) {
      return s;
    }
  }
  return null;
}
