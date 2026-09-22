/**
 * AdMob rewarded-ad server-side verification (SSV).
 *
 * When a user finishes a rewarded ad, Google calls our callback URL with the
 * reward details and an ECDSA (P-256, SHA-256) signature over the query
 * string. We verify that signature with Google's published public keys before
 * granting anything. This is what BitPlay never did (audit C3): it trusted the
 * app to say an ad was watched.
 *
 * Signed message = the raw query string up to (not including) "&signature=".
 * `signature` is web-safe base64 of a DER signature; `key_id` names the key.
 * https://developers.google.com/admob/android/ssv
 */
import { createPublicKey, verify, type KeyObject } from "node:crypto";

export interface SsvKey {
  keyId: string;
  pem: string;
}

export type SsvKeyFetcher = () => Promise<SsvKey[]>;

export interface SsvReward {
  adNetwork?: string;
  adUnit?: string;
  customData?: string;
  keyId: string;
  rewardAmount?: string;
  rewardItem?: string;
  timestamp?: string;
  transactionId?: string;
  userId?: string;
}

export function httpKeyFetcher(url: string): SsvKeyFetcher {
  return async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`AdMob SSV key fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: { keyId: number | string; pem: string }[] };
    return (body.keys ?? []).map((k) => ({ keyId: String(k.keyId), pem: k.pem }));
  };
}

const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_REFETCH_MS = 60 * 1000;

/** Verifies SSV callbacks, caching Google's keys and refreshing them daily or on an unknown key id. */
export class SsvVerifier {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;

  constructor(private readonly fetchKeys: SsvKeyFetcher) {}

  private async refresh(now: number) {
    const list = await this.fetchKeys();
    this.keys = new Map(list.map((k) => [k.keyId, createPublicKey(k.pem)]));
    this.fetchedAt = now;
  }

  private async keyFor(keyId: string, now: number): Promise<KeyObject | undefined> {
    if (now - this.fetchedAt > KEY_TTL_MS) await this.refresh(now);
    let k = this.keys.get(keyId);
    // Google rotates keys; an unknown id triggers one refresh, rate-limited.
    if (!k && now - this.fetchedAt > MIN_REFETCH_MS) {
      await this.refresh(now);
      k = this.keys.get(keyId);
    }
    return k;
  }

  /**
   * Returns the parsed reward if the signature is valid, otherwise null.
   * `rawQuery` must be the query string exactly as received (no decoding or re-encoding).
   */
  async verify(rawQuery: string, now = Date.now()): Promise<SsvReward | null> {
    const sigIdx = rawQuery.indexOf("&signature=");
    if (sigIdx <= 0) return null;
    const message = rawQuery.slice(0, sigIdx);

    const params = new URLSearchParams(rawQuery);
    const signature = params.get("signature");
    const keyId = params.get("key_id");
    if (!signature || !keyId) return null;

    const key = await this.keyFor(keyId, now);
    if (!key) return null;

    const sig = Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    let ok = false;
    try {
      ok = verify("sha256", Buffer.from(message, "utf8"), key, sig);
    } catch {
      ok = false;
    }
    if (!ok) return null;

    return {
      adNetwork: params.get("ad_network") ?? undefined,
      adUnit: params.get("ad_unit") ?? undefined,
      customData: params.get("custom_data") ?? undefined,
      keyId,
      rewardAmount: params.get("reward_amount") ?? undefined,
      rewardItem: params.get("reward_item") ?? undefined,
      timestamp: params.get("timestamp") ?? undefined,
      transactionId: params.get("transaction_id") ?? undefined,
      userId: params.get("user_id") ?? undefined,
    };
  }
}
