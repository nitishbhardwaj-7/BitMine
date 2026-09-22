import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Balance, Ledger } from "../models/index.js";
import { startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { makeSsvSigner } from "../test/ssv.js";
import { seedAll } from "../db/seed.js";
import { signAccessToken } from "../auth/tokens.js";
import { ensureBalance } from "../wallet/balances.js";
import { createApp } from "../app.js";

const SECRET = "test-secret-at-least-32-characters-long!!";
let server: Server;
let base: string;

beforeAll(async () => {
  await startTestDb();
  await seedAll();
  server = createApp({ corsOrigins: [], jwtAccessSecret: SECRET, ssv: makeSsvSigner().verifier, store: { allowSandbox: false } }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);
afterAll(async () => {
  server?.close();
  await stopTestDb();
});

describe("wallet over HTTP", () => {
  it("shows the balance, takes a withdrawal and lists it", async () => {
    const userId = await createUser();
    await ensureBalance(userId);
    await Balance.updateOne({ userId }, { $inc: { availableMsat: 4_000_500 } });
    await Ledger.create({ userId, type: "mining", bucket: "available", amountMsat: 4_000_500, idempotencyKey: `seed:${userId}` });
    const auth = { authorization: `Bearer ${await signAccessToken(String(userId), SECRET)}`, "content-type": "application/json" };

    const wallet = (await (await fetch(`${base}/v1/wallet`, { headers: auth })).json()) as Record<string, unknown>;
    expect(wallet).toMatchObject({ availableSats: 4000, minWithdrawalSats: 2500, canWithdraw: true, openWithdrawal: null });

    const bad = await fetch(`${base}/v1/withdrawals`, { method: "POST", headers: auth, body: JSON.stringify({ amountSats: 3000.5, destination: "a@speed.app" }) });
    expect(bad.status).toBe(400);

    const ok = await fetch(`${base}/v1/withdrawals`, { method: "POST", headers: auth, body: JSON.stringify({ amountSats: 3000, destination: "a@speed.app" }) });
    expect(ok.status).toBe(201);

    const again = await fetch(`${base}/v1/withdrawals`, { method: "POST", headers: auth, body: JSON.stringify({ amountSats: 1000, destination: "a@speed.app" }) });
    expect(again.status).toBe(400); // below minimum is checked first

    const after = (await (await fetch(`${base}/v1/wallet`, { headers: auth })).json()) as Record<string, unknown>;
    expect(after).toMatchObject({ availableSats: 1000, canWithdraw: false, openWithdrawal: { amountSats: 3000 } });

    const list = (await (await fetch(`${base}/v1/withdrawals`, { headers: auth })).json()) as { withdrawals: { status: string }[] };
    expect(list.withdrawals).toHaveLength(1);
    expect(list.withdrawals[0]!.status).toBe("pending");

    const ledger = (await (await fetch(`${base}/v1/wallet/ledger`, { headers: auth })).json()) as { entries: { label: string; amountMsat: number }[] };
    expect(ledger.entries.map((e) => [e.label, e.amountMsat])).toEqual([
      ["Withdrawal requested", -3_000_000],
      ["Mining", 4_000_500],
    ]);
  });
});
