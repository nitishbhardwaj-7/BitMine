/** Test helper: a scriptable stand-in for Speed's instant-send API. */
import { SpeedError, type SpeedClient, type SpeedSend } from "../wallet/speed.js";

export type SendBehaviour =
  | "paid"
  | "unpaid"
  | "failed"
  | "refused" // 4xx: nothing sent
  | "insufficient" // our balance too low: nothing sent
  | "timeout_sent" // went through, but our call timed out
  | "timeout_lost"; // never reached Speed

export function fakeSpeed() {
  const sends = new Map<string, SpeedSend & { amountSats: number; destination: string }>();
  const queue: SendBehaviour[] = [];
  let n = 0;

  const client: SpeedClient & { sendCalls: number } = {
    sendCalls: 0,
    async send({ amountSats, destination, note }) {
      client.sendCalls++;
      const b = queue.shift() ?? "paid";
      if (b === "refused") throw new SpeedError("Speed refused the request (400)", "definite");
      if (b === "insufficient") throw new SpeedError("Speed: insufficient funds", "insufficient_funds");
      if (b === "timeout_lost") throw new SpeedError("Speed request failed: timeout", "unknown");
      const id = `is_${++n}`;
      const status = b === "timeout_sent" ? "unpaid" : b;
      sends.set(id, { id, status, note, feesSats: 1, amountSats, destination });
      if (b === "timeout_sent") throw new SpeedError("Speed request failed: timeout", "unknown");
      return { ...sends.get(id)! };
    },
    async get(id) {
      const s = sends.get(id);
      if (!s) throw new SpeedError("Speed refused the request (404)", "definite");
      return { ...s };
    },
    async listRecent() {
      return [...sends.values()].reverse().map((s) => ({ ...s }));
    },
  };

  return {
    client,
    sends,
    /** Behaviour of the next send calls, in order (default "paid"). */
    next: (...b: SendBehaviour[]) => queue.push(...b),
    /** Simulates Speed settling a send later. */
    settle: (id: string, status: "paid" | "failed") => {
      const s = sends.get(id);
      if (s) s.status = status;
    },
  };
}
