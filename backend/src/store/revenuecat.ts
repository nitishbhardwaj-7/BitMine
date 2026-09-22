/**
 * RevenueCat REST client. RevenueCat is the only party that knows whether a
 * store purchase really happened, so every grant is based on what its API
 * returns for the user, never on what the app says it bought.
 *
 * Paid miners and Super Miner tiers are non-renewing (iOS) / consumable
 * (Android) products; RevenueCat reports both under `non_subscriptions`.
 * https://www.revenuecat.com/docs/api-v1#tag/customers
 */

export type StoreName = "app_store" | "play_store";

export interface StoreTransaction {
  storeTransactionId: string;
  /** The store's product id, e.g. "bitmine_miner_titan". */
  productId: string;
  store: StoreName;
  purchasedAt: number;
  isSandbox: boolean;
}

export interface RevenueCatClient {
  /** One-time purchases (non-renewing and consumables) for a RevenueCat app user id. */
  listOneTimePurchases(appUserId: string): Promise<StoreTransaction[]>;
}

interface RcNonSubscription {
  id?: string;
  store?: string;
  store_transaction_id?: string;
  purchase_date?: string;
  is_sandbox?: boolean;
}

export function httpRevenueCatClient(secretKey: string, baseUrl = "https://api.revenuecat.com"): RevenueCatClient {
  return {
    async listOneTimePurchases(appUserId) {
      const res = await fetch(`${baseUrl}/v1/subscribers/${encodeURIComponent(appUserId)}`, {
        headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`RevenueCat subscriber fetch failed: HTTP ${res.status}`);
      const body = (await res.json()) as { subscriber?: { non_subscriptions?: Record<string, RcNonSubscription[]> } };

      const out: StoreTransaction[] = [];
      for (const [productId, list] of Object.entries(body.subscriber?.non_subscriptions ?? {})) {
        for (const t of list ?? []) {
          // Only real store purchases; "promotional" grants and other stores are not ours to honour here.
          if (t.store !== "app_store" && t.store !== "play_store") continue;
          if (!t.store_transaction_id || !t.purchase_date) continue;
          out.push({
            storeTransactionId: t.store_transaction_id,
            productId,
            store: t.store,
            purchasedAt: Date.parse(t.purchase_date),
            isSandbox: Boolean(t.is_sandbox),
          });
        }
      }
      return out;
    },
  };
}
