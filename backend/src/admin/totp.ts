/**
 * TOTP (RFC 6238) for admin sign-in: 6 digits, 30-second steps, SHA-1, which
 * is what Google Authenticator, 1Password, Authy etc. expect.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const v = B32.indexOf(c);
    if (v === -1) throw new Error("invalid base32");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, atMs = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(atMs / 1000 / 30) + stepOffset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Accepts the current code and one step either side (clock drift). Returns the matched step. */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (const off of [0, -1, 1]) {
    const expected = totpCode(secret, atMs, off);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return Math.floor(atMs / 30_000) + off;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = "BitMine Admin"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
