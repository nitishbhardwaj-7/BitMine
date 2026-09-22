/** Test helper: an in-memory stand-in for RevenueCat's REST API. */
import type { RevenueCatClient, StoreTransaction } from "../store/revenuecat.js";

export function fakeRevenueCat() {
  const byUser = new Map<string, StoreTransaction[]>();
  let n = 0;
  const client: RevenueCatClient & { calls: number } = {
    calls: 0,
    async listOneTimePurchases(appUserId) {
      client.calls++;
      return [...(byUser.get(appUserId) ?? [])];
    },
  };
  /** Simulates the user completing a store purchase. */
  function buy(userId: unknown, storeProductId: string, purchasedAt: number, opts: Partial<StoreTransaction> = {}) {
    const t: StoreTransaction = {
      storeTransactionId: `GPA.${++n}-${Math.random().toString(36).slice(2, 8)}`,
      productId: storeProductId,
      store: "play_store",
      purchasedAt,
      isSandbox: false,
      ...opts,
    };
    const list = byUser.get(String(userId)) ?? [];
    list.push(t);
    byUser.set(String(userId), list);
    return t;
  }
  return { client, buy };
}
