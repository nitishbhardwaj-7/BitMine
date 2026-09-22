import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Types } from "mongoose";
import { startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { makeSsvSigner } from "../test/ssv.js";
import { seedAll } from "../db/seed.js";
import { signAccessToken } from "../auth/tokens.js";
import { createApp } from "../app.js";

const SECRET = "test-secret-at-least-32-characters-long!!";
const ssv = makeSsvSigner();
let server: Server;
let base: string;
let userId: Types.ObjectId;
let token: string;

beforeAll(async () => {
  await startTestDb();
  await seedAll();
  // Uses the real clock: a run within ~10 minutes of UTC midnight could see the claim land on the next day.
  userId = await createUser("UTC");
  token = await signAccessToken(String(userId), SECRET);
  server = createApp({ corsOrigins: [], jwtAccessSecret: SECRET, ssv: ssv.verifier, store: { allowSandbox: false } }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  server?.close();
  await stopTestDb();
});

const api = (path: string, init: RequestInit & { auth?: string | null } = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.auth === null ? {} : { authorization: `Bearer ${init.auth ?? token}` }),
    },
  });

describe("claims over HTTP", () => {
  it("rejects requests without a valid token", async () => {
    expect((await api("/v1/mining/status", { auth: null })).status).toBe(401);
    expect((await api("/v1/mining/status", { auth: "not-a-jwt" })).status).toBe(401);
    const forged = await signAccessToken(String(userId), "some-other-secret-that-is-long-enough!!");
    expect((await api("/v1/mining/status", { auth: forged })).status).toBe(401);
  });

  it("start → claim → AdMob callback → status shows +5.5 GH/s", async () => {
    const start = await api("/v1/mining/start", { method: "POST" });
    expect(start.status).toBe(200);

    const intentRes = await api("/v1/claims", { method: "POST", body: JSON.stringify({ kind: "regular" }) });
    expect(intentRes.status).toBe(201);
    const intent = (await intentRes.json()) as { claimId: string; gh: number };
    expect(intent.gh).toBe(5.5);

    const cb = await fetch(`${base}/webhooks/admob-ssv?${ssv.signedQuery({ claimId: intent.claimId, userId: String(userId), transactionId: "http-tx-1" })}`);
    expect(cb.status).toBe(200);

    const claim = (await (await api(`/v1/claims/${intent.claimId}`)).json()) as { status: string };
    expect(claim.status).toBe("verified");

    const status = (await (await api("/v1/mining/status")).json()) as {
      gh: { total: number; claim: number };
      claims: { used: number; cap: number };
      msatPerSecond: number;
    };
    expect(status.gh).toMatchObject({ total: 5.5, claim: 5.5 });
    expect(status.claims).toMatchObject({ used: 1, cap: 60 });
    expect(status.msatPerSecond).toBeCloseTo((5.5 * 48) / 86_400, 12);
  });

  it("refuses a forged AdMob callback", async () => {
    const intent = (await (await api("/v1/claims", { method: "POST", body: JSON.stringify({ kind: "regular" }) })).json()) as { claimId: string };
    const forger = makeSsvSigner();
    const res = await fetch(`${base}/webhooks/admob-ssv?${forger.signedQuery({ claimId: intent.claimId, userId: String(userId), transactionId: "forged" })}`);
    expect(res.status).toBe(403);
    expect(((await (await api(`/v1/claims/${intent.claimId}`)).json()) as { status: string }).status).toBe("pending");
  });

  it("validates the request body and hides other users' claims", async () => {
    const bad = await api("/v1/claims", { method: "POST", body: JSON.stringify({ kind: "free_btc" }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_request");

    const other = await createUser("UTC");
    const otherToken = await signAccessToken(String(other), SECRET);
    await api("/v1/mining/start", { method: "POST", auth: otherToken });
    const theirs = (await (await api("/v1/claims", { method: "POST", auth: otherToken, body: JSON.stringify({ kind: "regular" }) })).json()) as { claimId: string };
    expect((await api(`/v1/claims/${theirs.claimId}`)).status).toBe(404);
  });

  it("AdMob's URL check (no parameters) gets 200", async () => {
    expect((await fetch(`${base}/webhooks/admob-ssv`)).status).toBe(200);
  });
});
