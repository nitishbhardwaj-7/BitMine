/** Test helper: builds structurally valid BOLT11 invoices (fake signature, real checksum). */
import { bech32Encode } from "../wallet/bolt11.js";

function numberToWords(n: number, len: number): number[] {
  const out: number[] = [];
  for (let i = len - 1; i >= 0; i--) out.push(Math.floor(n / 32 ** i) % 32);
  return out;
}

export function makeInvoice(opts: { prefix?: string; hrpAmount: string; timestamp?: number; expirySeconds?: number }) {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const words = [...numberToWords(timestamp, 7)];
  // payment hash tag 'p' (type 1), 52 words
  words.push(1, 1, 20, ...Array.from({ length: 52 }, (_, i) => i % 32));
  if (opts.expirySeconds != null) {
    const data = numberToWords(opts.expirySeconds, 4);
    words.push(6, 0, data.length, ...data);
  }
  words.push(...Array.from({ length: 104 }, () => 0)); // signature
  return bech32Encode(`${opts.prefix ?? "lnbc"}${opts.hrpAmount}`, words);
}

/** A mainnet invoice for exactly `sats`, valid for `expirySeconds` from `nowMs`. */
export function invoiceForSats(sats: number, nowMs = Date.now(), expirySeconds = 3600) {
  return makeInvoice({ hrpAmount: `${sats * 10}n`, timestamp: Math.floor(nowMs / 1000), expirySeconds });
}
