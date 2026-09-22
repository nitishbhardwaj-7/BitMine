/**
 * Minimal BOLT11 (Lightning invoice) reader: network, amount, creation time
 * and expiry, with the bech32 checksum verified. We don't need the payment
 * hash or signature: Speed does the paying; we only check the invoice is a
 * mainnet invoice for exactly the requested amount and not already expired.
 * https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATORS[i]!;
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

/** Decodes bech32 (no length limit, as BOLT11 requires). Returns null on any error. */
export function bech32Decode(input: string): { hrp: string; words: number[] } | null {
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) return null;
  const s = input.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length) return null;
  const hrp = s.slice(0, sep);
  const words: number[] = [];
  for (const c of s.slice(sep + 1)) {
    const v = CHARSET.indexOf(c);
    if (v === -1) return null;
    words.push(v);
  }
  if (polymod([...hrpExpand(hrp), ...words]) !== 1) return null;
  return { hrp, words: words.slice(0, -6) };
}

/** Encodes bech32 (used by tests to build invoices). */
export function bech32Encode(hrp: string, words: number[]): string {
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...words, ...checksum].map((w) => CHARSET[w]).join("");
}

export interface DecodedInvoice {
  network: "mainnet" | "testnet" | "signet" | "regtest";
  /** null for "any amount" invoices. */
  amountMsat: bigint | null;
  timestamp: number; // seconds
  expirySeconds: number;
  expiresAt: number; // ms
}

const MULTIPLIER_MSAT: Record<string, bigint> = {
  "": 100_000_000_000n, // BTC
  m: 100_000_000n,
  u: 100_000n,
  n: 100n,
};

function wordsToNumber(words: number[]): number {
  let n = 0;
  for (const w of words) n = n * 32 + w;
  return n;
}

export function decodeBolt11(invoice: string): DecodedInvoice | null {
  const raw = invoice.trim().replace(/^lightning:/i, "");
  const dec = bech32Decode(raw);
  if (!dec) return null;

  const m = /^ln(bcrt|bc|tbs|tb)(\d*)([munp]?)$/.exec(dec.hrp);
  if (!m) return null;
  const network = ({ bc: "mainnet", tb: "testnet", tbs: "signet", bcrt: "regtest" } as const)[m[1] as "bc" | "tb" | "tbs" | "bcrt"];

  let amountMsat: bigint | null = null;
  if (m[2]) {
    const value = BigInt(m[2]);
    if (m[3] === "p") {
      // Pico-BTC: 1 p = 0.1 msat, so it must be a multiple of 10.
      if (value % 10n !== 0n) return null;
      amountMsat = value / 10n;
    } else {
      amountMsat = value * MULTIPLIER_MSAT[m[3]!]!;
    }
  } else if (m[3]) {
    return null;
  }

  const w = dec.words;
  const SIGNATURE_WORDS = 104; // 65-byte signature
  if (w.length < 7 + SIGNATURE_WORDS) return null;
  const timestamp = wordsToNumber(w.slice(0, 7));

  let expirySeconds = 3600; // BOLT11 default
  let i = 7;
  const end = w.length - SIGNATURE_WORDS;
  while (i + 3 <= end) {
    const type = w[i]!;
    const len = w[i + 1]! * 32 + w[i + 2]!;
    const data = w.slice(i + 3, i + 3 + len);
    if (i + 3 + len > end) return null;
    if (type === CHARSET.indexOf("x")) expirySeconds = wordsToNumber(data);
    i += 3 + len;
  }

  return { network, amountMsat, timestamp, expirySeconds, expiresAt: (timestamp + expirySeconds) * 1000 };
}
