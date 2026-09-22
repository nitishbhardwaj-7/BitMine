import { describe, expect, it } from "vitest";
import { SsvVerifier } from "./admobSsv.js";
import { makeSsvSigner } from "../test/ssv.js";

const base = { claimId: "65f000000000000000000001", userId: "65f0000000000000000000aa", transactionId: "tx-1" };

describe("SsvVerifier", () => {
  it("accepts a correctly signed callback and parses the reward", async () => {
    const { signedQuery, verifier } = makeSsvSigner();
    const r = await verifier.verify(signedQuery(base));
    expect(r).toMatchObject({ customData: base.claimId, userId: base.userId, transactionId: "tx-1" });
  });

  it("rejects a callback whose parameters were changed after signing", async () => {
    const { signedQuery, verifier } = makeSsvSigner();
    const tampered = signedQuery(base).replace(`user_id=${base.userId}`, "user_id=65f0000000000000000000bb");
    expect(await verifier.verify(tampered)).toBeNull();
  });

  it("rejects a signature from a different key", async () => {
    const google = makeSsvSigner("111");
    const attacker = makeSsvSigner("111");
    expect(await google.verifier.verify(attacker.signedQuery(base))).toBeNull();
  });

  it("rejects missing signature or unknown key id", async () => {
    const { signedQuery, verifier } = makeSsvSigner("222");
    const q = signedQuery(base);
    expect(await verifier.verify(q.slice(0, q.indexOf("&signature=")))).toBeNull();
    expect(await verifier.verify(q.replace("key_id=222", "key_id=999"))).toBeNull();
  });

  it("refetches keys when Google rotates to a new key id", async () => {
    const oldKey = makeSsvSigner("old");
    const newKey = makeSsvSigner("new");
    let calls = 0;
    const v = new SsvVerifier(async () => (++calls === 1 ? oldKey.keys : newKey.keys));
    const t = Date.now();
    expect(await v.verify(oldKey.signedQuery(base), t)).not.toBeNull();
    // Unknown key id right away: refetch is rate-limited, so it's rejected...
    expect(await v.verify(newKey.signedQuery(base), t + 1000)).toBeNull();
    // ...and accepted once the rate limit allows a refetch.
    expect(await v.verify(newKey.signedQuery(base), t + 2 * 60_000)).not.toBeNull();
    expect(calls).toBe(2);
  });
});
