/**
 * Speed "instant send" client (https://apidocs.tryspeed.com):
 *   POST /send      { amount, currency: "SATS", target_currency: "SATS",
 *                     withdraw_method: "lightning", withdraw_request, note }
 *   GET  /send/{id} → status: "unpaid" | "paid" | "failed"
 *   GET  /send      → recent sends (used to find a send whose create call timed out)
 * Auth: HTTP Basic with the secret key as username.
 *
 * Speed has no idempotency key, so a create call must never be retried
 * blindly: if we don't know whether it went through, the caller parks the
 * withdrawal for reconciliation instead (see payoutJob.ts).
 */

export type SpeedStatus = "unpaid" | "paid" | "failed";

export interface SpeedSend {
  id: string;
  status: SpeedStatus;
  note?: string;
  feesSats?: number;
  failureReason?: string;
}

/**
 * definite: Speed clearly refused (4xx) — nothing was sent.
 * insufficient_funds: our Speed balance is too low — nothing was sent, retry later.
 * unknown: timeout, network error or 5xx — it may or may not have been sent.
 */
export class SpeedError extends Error {
  constructor(
    message: string,
    public readonly kind: "definite" | "insufficient_funds" | "unknown",
  ) {
    super(message);
  }
}

export interface SpeedClient {
  send(p: { amountSats: number; destination: string; note: string }): Promise<SpeedSend>;
  get(id: string): Promise<SpeedSend>;
  /** Most recent sends, newest first. */
  listRecent(): Promise<SpeedSend[]>;
  /** Account balances as Speed returns them (shown in the admin panel). */
  balances?(): Promise<unknown>;
}

interface RawSend {
  id: string;
  status: string;
  note?: string;
  fees?: number;
  failure_reason?: string;
}

function toSend(r: RawSend): SpeedSend {
  const status = (["unpaid", "paid", "failed"] as const).find((s) => s === r.status) ?? "unpaid";
  return { id: r.id, status, note: r.note, feesSats: r.fees, failureReason: r.failure_reason };
}

export function httpSpeedClient(apiKey: string, baseUrl = "https://api.tryspeed.com"): SpeedClient {
  const auth = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new SpeedError(`Speed request failed: ${(err as Error).message}`, "unknown");
    }
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    const lower = text.toLowerCase();
    if (lower.includes("insufficient")) throw new SpeedError(`Speed: insufficient funds (${res.status})`, "insufficient_funds");
    if (res.status >= 400 && res.status < 500) throw new SpeedError(`Speed refused the request (${res.status}): ${text.slice(0, 300)}`, "definite");
    throw new SpeedError(`Speed error ${res.status}`, "unknown");
  }

  return {
    async send({ amountSats, destination, note }) {
      const r = (await call("POST", "/send", {
        amount: amountSats,
        currency: "SATS",
        target_currency: "SATS",
        withdraw_method: "lightning",
        withdraw_request: destination,
        note,
      })) as RawSend;
      return toSend(r);
    },
    async get(id) {
      return toSend((await call("GET", `/send/${encodeURIComponent(id)}`)) as RawSend);
    },
    async listRecent() {
      const r = (await call("GET", "/send")) as { data?: RawSend[] };
      return (r.data ?? []).map(toSend);
    },
    async balances() {
      return call("GET", "/balances");
    },
  };
}
