/**
 * Crypto news for the News screen: headlines from public RSS feeds, refreshed
 * every 30 minutes by the worker. We store and show only the headline, a
 * short plain-text summary (≤ 200 characters), the image and the source link;
 * tapping an article opens the publisher's page.
 */
import { NewsArticle } from "../models/index.js";
import { logger } from "../lib/logger.js";

export interface FeedSource {
  source: string;
  url: string;
}

export const DEFAULT_FEEDS: FeedSource[] = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
  { source: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/.rss/full/" },
];

export type NewsCategory = "BITCOIN" | "MINING" | "MARKET" | "WEB3";

export interface ParsedItem {
  title: string;
  url: string;
  summary: string;
  imageUrl?: string;
  publishedAt: Date;
  categories: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
}
const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? decode(m[1]!).trim() : undefined;
}

export function summarize(html: string, max = 200): string {
  const text = stripTags(decode(html));
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") > 120 ? cut.lastIndexOf(" ") : max).trimEnd() + "…";
}

/** A small, forgiving RSS 2.0 reader (the feeds we use are all RSS 2.0). */
export function parseRss(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const title = tag(it, "title");
    const link = tag(it, "link") ?? tag(it, "guid");
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    const description = tag(it, "description") ?? tag(it, "content:encoded") ?? "";
    const pub = Date.parse(tag(it, "pubDate") ?? tag(it, "dc:date") ?? "");
    const image =
      /<media:content[^>]*url="([^"]+)"/i.exec(it)?.[1] ??
      /<media:thumbnail[^>]*url="([^"]+)"/i.exec(it)?.[1] ??
      /<enclosure[^>]*url="([^"]+)"[^>]*type="image/i.exec(it)?.[1] ??
      /<img[^>]*src="([^"]+)"/i.exec(decode(description))?.[1];
    const categories = [...it.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => decode(c[1]!).trim().toLowerCase());
    items.push({
      title: stripTags(title),
      url: link.trim(),
      summary: summarize(description),
      imageUrl: image && /^https:\/\//.test(image) ? decode(image) : undefined,
      publishedAt: Number.isFinite(pub) ? new Date(pub) : new Date(),
      categories,
    });
  }
  return items;
}

export function categorize(item: Pick<ParsedItem, "title" | "categories">): NewsCategory {
  const text = `${item.title} ${item.categories.join(" ")}`.toLowerCase();
  if (/\bmin(ing|ers?)\b|hashrate|hash rate|asic|difficulty/.test(text)) return "MINING";
  if (/web3|nft|defi|dao|metaverse|ethereum|solana/.test(text)) return "WEB3";
  if (/bitcoin|\bbtc\b|lightning|satoshi/.test(text)) return "BITCOIN";
  return "MARKET";
}

export type FeedFetcher = (url: string) => Promise<string>;

export const httpFeedFetcher: FeedFetcher = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": "BitMineNews/1.0 (+https://bitmine.app)", accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

/** Fetches all feeds and upserts new articles. Returns how many were added. */
export async function refreshNews(fetchFeed: FeedFetcher = httpFeedFetcher, feeds = DEFAULT_FEEDS) {
  let added = 0;
  for (const f of feeds) {
    try {
      const items = parseRss(await fetchFeed(f.url)).slice(0, 30);
      for (const it of items) {
        const r = await NewsArticle.updateOne(
          { url: it.url },
          {
            $setOnInsert: {
              url: it.url,
              source: f.source,
              title: it.title.slice(0, 300),
              summary: it.summary,
              imageUrl: it.imageUrl,
              category: categorize(it),
              publishedAt: it.publishedAt,
            },
          },
          { upsert: true },
        );
        if (r.upsertedCount) added++;
      }
    } catch (err) {
      logger.warn({ err, feed: f.source }, "news feed failed");
    }
  }
  // Keep the collection small: 30 days is plenty for a news tab.
  await NewsArticle.deleteMany({ publishedAt: { $lt: new Date(Date.now() - 30 * 86_400_000) } });
  return added;
}

export async function listNews(category?: string, limit = 30) {
  const cat = (["BITCOIN", "MINING", "MARKET", "WEB3"] as const).find((c) => c === category);
  const filter = cat ? { category: cat } : {};
  const rows = await NewsArticle.find(filter).sort({ publishedAt: -1 }).limit(Math.min(limit, 50)).lean();
  return rows.map((a) => ({
    id: String(a._id),
    title: a.title,
    summary: a.summary,
    url: a.url,
    imageUrl: a.imageUrl ?? null,
    source: a.source,
    category: a.category,
    publishedAt: a.publishedAt.toISOString(),
    readMinutes: Math.max(2, Math.round(a.summary.split(" ").length / 40) + 2),
  }));
}
