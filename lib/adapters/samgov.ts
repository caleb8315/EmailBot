import { BaseAdapter } from './base-adapter';
import type { DataSource, IntelEvent } from '../types';

interface SignificanceCategory {
  keywords: string[];
  significance_multiplier: number;
  note?: string;
}

const HIGH_SIGNIFICANCE_CATEGORIES: Record<string, SignificanceCategory> = {
  munitions: {
    keywords: ['ammunition', 'missiles', 'ordnance', 'warhead', 'bomb', 'artillery', 'jassm', 'himars', 'javelin', 'stinger'],
    significance_multiplier: 1.5,
  },
  medical_field: {
    keywords: ['body bag', 'field hospital', 'trauma kit', 'blood products', 'surgical', 'mass casualty', 'mortuary'],
    significance_multiplier: 2.0,
    note: 'Direct operational signal — pre-conflict indicator',
  },
  interpreters: {
    keywords: ['interpreter', 'linguist', 'translator', 'language services'],
    significance_multiplier: 1.8,
    note: 'Language requested reveals operational theater',
  },
  logistics_forward: {
    keywords: ['forward operating', 'pre-positioned', 'rapid deployment', 'expeditionary', 'contingency'],
    significance_multiplier: 1.6,
  },
  fuel_bulk: {
    keywords: ['jp-8', 'aviation fuel', 'bulk fuel', 'petroleum', 'jet fuel'],
    significance_multiplier: 1.2,
  },
};

export class SAMGovAdapter extends BaseAdapter {
  source: DataSource = 'sam_gov';
  fetchIntervalMinutes = 240; // every 4 hours

  async fetch(): Promise<IntelEvent[]> {
    const key = process.env.SAM_GOV_API_KEY;
    if (!key) {
      this.warn('SAM_GOV_API_KEY not set — skipping');
      return [];
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
      const url =
        `https://api.sam.gov/opportunities/v2/search?api_key=${key}` +
        `&postedFrom=${yesterday}&postedTo=${today}&limit=100`;

      const res = await this.safeFetch(url);
      if (!res.ok) {
        this.warn(`SAM.gov returned ${res.status}`);
        return [];
      }

      const body = await res.json() as { opportunitiesData?: SAMContract[] };
      if (!body.opportunitiesData) return [];

      const events: IntelEvent[] = body.opportunitiesData
        .map(c => this.scoreContract(c))
        .filter(c => c.significance_score > 40)
        .map(c => ({
          source: 'sam_gov' as DataSource,
          type: c.type,
          severity: Math.round(c.significance_score),
          confidence: 0.95,
          lat: 38.9072, // Washington DC
          lng: -77.0369,
          country_code: 'US',
          timestamp: new Date(c.postedDate || Date.now()).toISOString(),
          title: `SAM.gov: ${(c.title || '').slice(0, 200)}`,
          summary: `${c.department || 'Unknown agency'} | $${formatUSD(c.awardAmount)} | ${c.significance_reason}`,
          tags: ['sam_gov', 'procurement', ...c.matched_categories],
          raw_data: {
            contract_id: c.noticeId,
            title: c.title,
            agency: c.department,
            value: c.awardAmount,
            categories: c.matched_categories,
          },
        }));

      this.log(`Found ${events.length} significant procurement signals`);
      return events;
    } catch (err) {
      this.error('SAM.gov fetch failed', err);
      return [];
    }
  }

  private scoreContract(contract: SAMContract): ScoredContract {
    let significance = 0;
    const matched_categories: string[] = [];
    const reasons: string[] = [];
    let resultType: IntelEvent['type'] = 'procurement_anomaly';

    const combined = `${contract.title || ''} ${contract.description || ''}`.toLowerCase();

    for (const [category, config] of Object.entries(HIGH_SIGNIFICANCE_CATEGORIES)) {
      const matches = config.keywords.filter(kw => combined.includes(kw));
      if (matches.length > 0) {
        significance += 30 * config.significance_multiplier;
        matched_categories.push(category);
        reasons.push(`${category}: ${matches.join(', ')}`);
        if (config.note) reasons.push(config.note);

        if (category === 'munitions') resultType = 'procurement_munitions';
        if (category === 'medical_field') resultType = 'procurement_medical';
        if (category === 'interpreters') resultType = 'procurement_interpreters';
      }
    }

    if (combined.includes('urgent') || combined.includes('emergency acquisition')) {
      significance *= 1.8;
      reasons.push('URGENT/EMERGENCY classification');
    }

    return {
      ...contract,
      type: resultType,
      significance_score: Math.min(100, significance),
      significance_reason: reasons.join(' | '),
      matched_categories,
    };
  }
}

function formatUSD(amount?: number): string {
  if (!amount) return '?';
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toFixed(0);
}

interface SAMContract {
  noticeId?: string;
  title?: string;
  description?: string;
  department?: string;
  awardAmount?: number;
  postedDate?: string;
}

interface ScoredContract extends SAMContract {
  type: IntelEvent['type'];
  significance_score: number;
  significance_reason: string;
  matched_categories: string[];
}
