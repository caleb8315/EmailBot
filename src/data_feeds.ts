import { createLogger } from "./logger";

const logger = createLogger("data_feeds");

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      logger.warn("Feed request failed", {
        url,
        status: response.status,
      });
      return null;
    }
    return (await response.json()) as T;
  } catch (err) {
    logger.warn("Feed request error", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface WeatherData {
  temp: number;
  feelsLike: number;
  high: number;
  low: number;
  condition: string;
  emoji: string;
  wind: number;
  precipChance: number;
}

function weatherDescription(code: number): { text: string; emoji: string } {
  if (code === 0) return { text: "Clear sky", emoji: "☀️" };
  if (code <= 2) return { text: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { text: "Overcast", emoji: "☁️" };
  if (code <= 49) return { text: "Foggy", emoji: "🌫️" };
  if (code <= 59) return { text: "Drizzle", emoji: "🌦️" };
  if (code <= 69) return { text: "Rain", emoji: "🌧️" };
  if (code <= 79) return { text: "Snow", emoji: "❄️" };
  if (code <= 84) return { text: "Rain showers", emoji: "🌦️" };
  if (code <= 86) return { text: "Snow showers", emoji: "🌨️" };
  if (code <= 99) return { text: "Thunderstorm", emoji: "⛈️" };
  return { text: "Unknown", emoji: "🌡️" };
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
}

export async function fetchDenverWeather(): Promise<WeatherData | null> {
  const weatherUrl =
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=39.7392&longitude=-104.9903" +
    "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m" +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch" +
    "&forecast_days=1&timezone=America%2FDenver";

  const data = await fetchJsonWithTimeout<OpenMeteoResponse>(weatherUrl);
  if (!data?.current || !data.daily) return null;

  const weatherCode = Number(data.current.weather_code ?? 0);
  const { text, emoji } = weatherDescription(weatherCode);
  const temp = Number(data.current.temperature_2m);
  const feelsLike = Number(data.current.apparent_temperature);
  const high = Number(data.daily.temperature_2m_max?.[0]);
  const low = Number(data.daily.temperature_2m_min?.[0]);
  const wind = Number(data.current.wind_speed_10m);
  const precipChance = Number(data.daily.precipitation_probability_max?.[0] ?? 0);

  if (
    !Number.isFinite(temp) ||
    !Number.isFinite(feelsLike) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(wind) ||
    !Number.isFinite(precipChance)
  ) {
    return null;
  }

  return {
    temp: Math.round(temp),
    feelsLike: Math.round(feelsLike),
    high: Math.round(high),
    low: Math.round(low),
    condition: text,
    emoji,
    wind: Math.round(wind),
    precipChance: Math.round(precipChance),
  };
}

export interface MarketQuote {
  symbol: string;
  label: string;
  price: number;
  changePercent: number | null;
  currency: string | null;
}

const MARKET_SYMBOLS: Array<{ symbol: string; label: string }> = [
  { symbol: "SPY", label: "SPY" },
  { symbol: "BTC-USD", label: "BTC" },
  { symbol: "GLD", label: "GLD" },
  { symbol: "CL=F", label: "OIL" },
];

// Yahoo's older /v7/finance/quote endpoint now returns 401 unless the caller
// holds a valid cookie + crumb pair, which is fragile inside GitHub Actions.
// The chart endpoint is still public, returns the current price and previous
// close in `meta`, and lets us derive changePercent ourselves.
interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency?: string;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

async function fetchSingleChart(
  item: { symbol: string; label: string }
): Promise<MarketQuote | null> {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    `${encodeURIComponent(item.symbol)}?interval=1d&range=5d`;
  const data = await fetchJsonWithTimeout<YahooChartResponse>(url);
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const price = Number(meta.regularMarketPrice);
  if (!Number.isFinite(price)) return null;

  const previousClose = Number(
    meta.chartPreviousClose ?? meta.previousClose ?? NaN
  );
  let changePercent: number | null = null;
  if (Number.isFinite(previousClose) && previousClose > 0) {
    changePercent = Number((((price - previousClose) / previousClose) * 100).toFixed(2));
  }

  return {
    symbol: item.symbol,
    label: item.label,
    price,
    changePercent,
    currency: meta.currency ?? null,
  };
}

export async function fetchMarketSnapshot(): Promise<MarketQuote[]> {
  const results = await Promise.allSettled(MARKET_SYMBOLS.map(fetchSingleChart));
  const quotes: MarketQuote[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      quotes.push(result.value);
    }
  }
  return quotes;
}

export interface EconomicEvent {
  timeLabel: string;
  country: string;
  event: string;
  impact: "high" | "medium" | "low" | "unknown";
  actual: string | null;
  estimate: string | null;
  previous: string | null;
}

interface FinnhubEvent {
  date?: string;
  country?: string;
  event?: string;
  impact?: string;
  actual?: string | number;
  estimate?: string | number;
  prev?: string | number;
  previous?: string | number;
}

interface FinnhubCalendarResponse {
  economicCalendar?: FinnhubEvent[];
}

function normalizeImpact(impact: string | undefined): EconomicEvent["impact"] {
  const value = (impact ?? "").toLowerCase();
  if (value.includes("high")) return "high";
  if (value.includes("medium")) return "medium";
  if (value.includes("low")) return "low";
  return "unknown";
}

function impactRank(impact: EconomicEvent["impact"]): number {
  if (impact === "high") return 3;
  if (impact === "medium") return 2;
  if (impact === "low") return 1;
  return 0;
}

function buildDenverTimeLabel(isoTime: string | undefined): string {
  if (!isoTime) return "TBD";
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return "TBD";
  return (
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Denver",
    }) + " MT"
  );
}

export async function fetchEconomicCalendar(): Promise<EconomicEvent[]> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) return [];

  const today = new Date().toISOString().slice(0, 10);
  const url =
    "https://finnhub.io/api/v1/calendar/economic" +
    `?from=${today}&to=${today}&token=${encodeURIComponent(token)}`;

  const data = await fetchJsonWithTimeout<FinnhubCalendarResponse>(url);
  const rows = data?.economicCalendar ?? [];
  if (rows.length === 0) return [];

  const keyCountries = new Set(["US", "EU", "GB", "CN", "JP"]);

  const parsed = rows
    .filter((row) => typeof row.event === "string" && row.event.trim().length > 0)
    .map((row) => {
      const impact = normalizeImpact(row.impact);
      const country = (row.country ?? "").toUpperCase();
      const previous = row.previous ?? row.prev ?? null;
      return {
        rawDate: row.date ?? "",
        event: row.event!.trim(),
        country,
        impact,
        actual: row.actual != null ? String(row.actual) : null,
        estimate: row.estimate != null ? String(row.estimate) : null,
        previous: previous != null ? String(previous) : null,
      };
    })
    .filter(
      (row) =>
        row.impact === "high" ||
        row.impact === "medium" ||
        keyCountries.has(row.country)
    )
    .sort((a, b) => {
      const impactDiff = impactRank(b.impact) - impactRank(a.impact);
      if (impactDiff !== 0) return impactDiff;
      return a.rawDate.localeCompare(b.rawDate);
    })
    .slice(0, 8)
    .map((row) => ({
      timeLabel: buildDenverTimeLabel(row.rawDate),
      country: row.country || "GLOBAL",
      event: row.event,
      impact: row.impact,
      actual: row.actual,
      estimate: row.estimate,
      previous: row.previous,
    }));

  return parsed;
}

interface DailyFactResponse {
  text?: string;
}

export async function fetchDailyFact(): Promise<string | null> {
  const url =
    "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en";
  const data = await fetchJsonWithTimeout<DailyFactResponse>(url, 5000);
  const text = data?.text?.trim();
  if (!text) return null;
  return text.length > 260 ? `${text.slice(0, 257)}...` : text;
}
