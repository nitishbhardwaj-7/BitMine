/**
 * Live coin prices for the Market screen and USD conversions, from
 * CoinGecko's free API. Cached for a minute and shared by all users; if
 * CoinGecko is down, the last good prices are served (marked stale).
 */

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change24h: number;
  sparkline: number[];
  image?: string;
}

export interface MarketSnapshot {
  updatedAt: string;
  stale: boolean;
  btcUsd: number;
  coins: Coin[];
}

export type MarketFetcher = () => Promise<Coin[]>;

const IDS = ["bitcoin", "ethereum", "solana", "tether", "binancecoin", "ripple", "cardano", "dogecoin", "tron"];

interface GeckoRow {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price: number;
  price_change_percentage_24h: number | null;
  sparkline_in_7d?: { price?: number[] };
}

export function coinGeckoFetcher(baseUrl = "https://api.coingecko.com/api/v3"): MarketFetcher {
  return async () => {
    const url = `${baseUrl}/coins/markets?vs_currency=usd&ids=${IDS.join(",")}&sparkline=true&price_change_percentage=24h`;
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const rows = (await res.json()) as GeckoRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return IDS.flatMap((id) => {
      const r = byId.get(id);
      if (!r) return [];
      const spark = r.sparkline_in_7d?.price ?? [];
      // Last ~24 h of the 7-day hourly series, thinned to 24 points for small charts.
      const last = spark.slice(-24);
      return [{
        id: r.id,
        symbol: r.symbol.toUpperCase(),
        name: r.name,
        priceUsd: r.current_price,
        change24h: r.price_change_percentage_24h ?? 0,
        sparkline: last,
        image: r.image,
      }];
    });
  };
}

const TTL_MS = 60_000;

export class MarketCache {
  private snapshot: MarketSnapshot | undefined;
  private fetchedAt = 0;
  private inflight: Promise<MarketSnapshot> | undefined;

  constructor(private readonly fetcher: MarketFetcher) {}

  async get(now = Date.now()): Promise<MarketSnapshot> {
    if (this.snapshot && now - this.fetchedAt < TTL_MS) return this.snapshot;
    this.inflight ??= this.refresh(now).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async refresh(now: number): Promise<MarketSnapshot> {
    try {
      const coins = await this.fetcher();
      const btc = coins.find((c) => c.id === "bitcoin");
      if (!btc) throw new Error("no BTC price");
      this.snapshot = { updatedAt: new Date(now).toISOString(), stale: false, btcUsd: btc.priceUsd, coins };
      this.fetchedAt = now;
      return this.snapshot;
    } catch (err) {
      if (this.snapshot) return { ...this.snapshot, stale: true };
      throw err;
    }
  }
}
