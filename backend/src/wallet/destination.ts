import { AppError } from "../lib/errors.js";
import { decodeBolt11 } from "./bolt11.js";

export type Destination =
  | { type: "speed_address"; value: string }
  | { type: "bolt11"; value: string; expiresAt: number };

/** Speed Lightning addresses only (decision 2026-09-22); other wallets can use an invoice. */
const SPEED_ADDRESS = /^[a-z0-9][a-z0-9._-]{0,63}@speed\.app$/i;

/** Invoices must stay valid long enough for review and payout. */
export const MIN_INVOICE_REMAINING_MS = 10 * 60 * 1000;

export function parseDestination(input: string, amountSats: number, now = Date.now()): Destination {
  const raw = input.trim();

  if (raw.includes("@")) {
    if (!SPEED_ADDRESS.test(raw)) {
      throw new AppError(400, "invalid_destination", "Use a Speed address (name@speed.app) or a Lightning invoice from any wallet.");
    }
    return { type: "speed_address", value: raw.toLowerCase() };
  }

  const inv = decodeBolt11(raw);
  if (!inv) throw new AppError(400, "invalid_destination", "That isn't a valid Speed address or Lightning invoice.");
  if (inv.network !== "mainnet") throw new AppError(400, "invalid_destination", "That invoice is for a test network. Use a mainnet Lightning invoice.");
  if (inv.amountMsat === null) {
    throw new AppError(400, "invoice_amount_missing", `Create an invoice for exactly ${amountSats.toLocaleString("en-US")} sats.`);
  }
  if (inv.amountMsat !== BigInt(amountSats) * 1000n) {
    throw new AppError(400, "invoice_amount_mismatch", `The invoice amount must be exactly ${amountSats.toLocaleString("en-US")} sats.`);
  }
  if (inv.expiresAt - now < MIN_INVOICE_REMAINING_MS) {
    throw new AppError(400, "invoice_expiring", "That invoice expires too soon. Create a new one that's valid for at least an hour.");
  }
  return { type: "bolt11", value: raw.replace(/^lightning:/i, "").toLowerCase(), expiresAt: inv.expiresAt };
}
