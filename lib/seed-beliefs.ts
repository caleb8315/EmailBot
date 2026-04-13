import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface SeedBelief {
  statement: string;
  confidence: number;
  tags: string[];
  region?: string;
  entities: string[];
  jeff_stake: 'HIGH' | 'MEDIUM' | 'LOW';
}

const INITIAL_BELIEFS: SeedBelief[] = [
  // Russia/Ukraine
  { statement: "Russia will not withdraw from occupied Ukrainian territory before 2027", confidence: 0.88, tags: ["geopolitical", "military"], region: "UA", entities: ["Russia", "Ukraine"], jeff_stake: "HIGH" },
  { statement: "The war in Ukraine will reach a frozen conflict state within 18 months", confidence: 0.42, tags: ["geopolitical", "military"], region: "UA", entities: ["Russia", "Ukraine", "NATO"], jeff_stake: "HIGH" },
  { statement: "Russia will attempt hybrid operations in Moldova within 12 months", confidence: 0.35, tags: ["geopolitical", "military"], region: "MD", entities: ["Russia", "Moldova", "Transnistria"], jeff_stake: "MEDIUM" },

  // China/Taiwan
  { statement: "China will not launch a military operation against Taiwan before 2028", confidence: 0.72, tags: ["geopolitical", "military"], region: "TW", entities: ["China", "Taiwan", "PLA"], jeff_stake: "HIGH" },
  { statement: "China will increase military flights in the Taiwan ADIZ by 30%+ in 2026", confidence: 0.60, tags: ["military"], region: "TW", entities: ["China", "Taiwan", "PLA Air Force"], jeff_stake: "MEDIUM" },
  { statement: "A naval confrontation in the South China Sea involving a US vessel will occur in 2026", confidence: 0.28, tags: ["military", "geopolitical"], region: "CN", entities: ["China", "US Navy", "Philippines"], jeff_stake: "HIGH" },

  // Middle East
  { statement: "Iran will not develop a nuclear weapon before 2028", confidence: 0.55, tags: ["geopolitical", "military"], region: "IR", entities: ["Iran", "IAEA", "Israel"], jeff_stake: "HIGH" },
  { statement: "Israel will conduct a military strike on Iranian nuclear facilities within 18 months", confidence: 0.25, tags: ["military"], region: "IR", entities: ["Israel", "Iran", "IDF"], jeff_stake: "HIGH" },
  { statement: "The Houthi Red Sea disruption campaign will continue through 2026", confidence: 0.78, tags: ["military", "economic"], region: "YE", entities: ["Houthis", "Yemen", "Red Sea"], jeff_stake: "MEDIUM" },
  { statement: "Saudi-Iran rapprochement will hold through 2026 without major breakdown", confidence: 0.58, tags: ["geopolitical"], region: "SA", entities: ["Saudi Arabia", "Iran", "China"], jeff_stake: "MEDIUM" },

  // North Korea
  { statement: "North Korea will conduct another nuclear test before end of 2027", confidence: 0.62, tags: ["military", "geopolitical"], region: "KP", entities: ["North Korea", "Kim Jong Un"], jeff_stake: "MEDIUM" },
  { statement: "North Korean troops will remain deployed in support of Russia through 2026", confidence: 0.75, tags: ["military"], region: "KP", entities: ["North Korea", "Russia"], jeff_stake: "MEDIUM" },

  // Africa
  { statement: "At least one more military coup will occur in West Africa before end of 2026", confidence: 0.65, tags: ["geopolitical", "military"], region: "XX", entities: ["ECOWAS", "Wagner Group"], jeff_stake: "MEDIUM" },
  { statement: "Sudan civil war will not reach a ceasefire before mid-2027", confidence: 0.70, tags: ["military"], region: "SD", entities: ["Sudan", "RSF", "SAF"], jeff_stake: "MEDIUM" },

  // Global economic
  { statement: "Global oil prices will exceed $100/barrel at some point in 2026", confidence: 0.35, tags: ["economic"], entities: ["OPEC", "Saudi Arabia"], jeff_stake: "LOW" },
  { statement: "De-dollarization efforts (BRICS) will not meaningfully reduce USD reserve status by 2028", confidence: 0.82, tags: ["economic", "geopolitical"], entities: ["BRICS", "China", "Russia"], jeff_stake: "MEDIUM" },

  // NATO/Europe
  { statement: "NATO will add at least one new member state by 2028", confidence: 0.30, tags: ["geopolitical"], entities: ["NATO", "Georgia", "Ukraine"], jeff_stake: "LOW" },
  { statement: "European defense spending will exceed 2.5% GDP average across NATO members by 2028", confidence: 0.55, tags: ["military", "economic"], entities: ["NATO", "EU"], jeff_stake: "LOW" },

  // Cyber/Tech
  { statement: "A major critical infrastructure cyberattack (power grid, water) will occur in a NATO country in 2026", confidence: 0.40, tags: ["cyber", "military"], entities: ["Russia", "China", "NATO"], jeff_stake: "MEDIUM" },
  { statement: "AI will be used in a significant military deception operation (deepfakes/IO) in an active conflict by end of 2026", confidence: 0.68, tags: ["cyber", "military", "ai"], entities: [], jeff_stake: "MEDIUM" },

  // Sanctions/Economic warfare
  { statement: "Russian sanctions evasion via dark fleet will continue to grow through 2026", confidence: 0.85, tags: ["economic", "military"], region: "RU", entities: ["Russia", "dark fleet"], jeff_stake: "MEDIUM" },
  { statement: "New sanctions will be imposed on Chinese entities supporting Russia's war effort in 2026", confidence: 0.60, tags: ["economic", "geopolitical"], entities: ["China", "Russia", "US"], jeff_stake: "MEDIUM" },

  // Latin America
  { statement: "Venezuela political crisis will escalate to significant unrest or intervention attempt by 2027", confidence: 0.32, tags: ["geopolitical"], region: "VE", entities: ["Venezuela", "Maduro"], jeff_stake: "LOW" },

  // Prediction markets
  { statement: "Prediction markets will prove more accurate than expert consensus on geopolitical events in 2026", confidence: 0.55, tags: ["meta"], entities: ["Polymarket", "Metaculus"], jeff_stake: "LOW" },
];

async function seed() {
  console.log(`Seeding ${INITIAL_BELIEFS.length} beliefs...`);

  for (const belief of INITIAL_BELIEFS) {
    const { error } = await sb.from('beliefs').insert({
      statement: belief.statement,
      confidence: belief.confidence,
      confidence_history: [{ timestamp: new Date().toISOString(), confidence: belief.confidence, reason: 'initial seed — Jeff baseline assessment' }],
      tags: belief.tags,
      region: belief.region || null,
      entities: belief.entities,
      jeff_stake: belief.jeff_stake,
      status: 'active',
      evidence_for: [],
      evidence_against: [],
    });

    if (error) {
      console.error(`Failed: ${belief.statement.slice(0, 50)}...`, error.message);
    } else {
      console.log(`OK: ${belief.statement.slice(0, 60)}...`);
    }
  }

  // Also create the user profile
  const { error: profileErr } = await sb.from('user_profile').upsert({
    regions_of_interest: ['UA', 'TW', 'IR', 'SD', 'YE', 'SY', 'KP', 'RU', 'CN'],
    expertise_areas: ['geopolitics', 'military', 'OSINT'],
    known_blindspots: ['African politics', 'Latin American economics'],
    calibration_score: null,
    calibration_by_region: {},
    calibration_by_topic: {},
    total_predictions: 0,
    correct_predictions: 0,
  });

  if (profileErr) console.error('Profile error:', profileErr.message);
  else console.log('User profile created');

  console.log('Done!');
}

seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
