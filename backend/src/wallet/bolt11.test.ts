import { describe, expect, it } from "vitest";
import { bech32Decode, bech32Encode, decodeBolt11 } from "./bolt11.js";
import { makeInvoice } from "../test/invoice.js";

describe("bech32", () => {
  it("accepts the BIP-173 valid test vectors and rejects a corrupted one", () => {
    expect(bech32Decode("A12UEL5L")).not.toBeNull();
    expect(bech32Decode("abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw")).not.toBeNull();
    expect(bech32Decode("abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxx")).toBeNull();
  });

  it("round-trips", () => {
    expect(bech32Decode(bech32Encode("lnbc10u", [1, 2, 3, 4, 5, 6, 7]))).toEqual({ hrp: "lnbc10u", words: [1, 2, 3, 4, 5, 6, 7] });
  });
});

describe("decodeBolt11", () => {
  it("reads the BOLT11 spec example (2500u, 60 s expiry)", () => {
    const inv =
      "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh";
    const d = decodeBolt11(inv)!;
    expect(d).not.toBeNull();
    expect(d.network).toBe("mainnet");
    expect(d.amountMsat).toBe(250_000_000n); // 250,000 sats
    expect(d.timestamp).toBe(1496314658);
    expect(d.expirySeconds).toBe(60);
  });

  it("reads amounts in every unit", () => {
    expect(decodeBolt11(makeInvoice({ hrpAmount: "25u" }))!.amountMsat).toBe(2_500_000n); // 2,500 sats
    expect(decodeBolt11(makeInvoice({ hrpAmount: "3m" }))!.amountMsat).toBe(300_000_000n);
    expect(decodeBolt11(makeInvoice({ hrpAmount: "25000n" }))!.amountMsat).toBe(2_500_000n);
    expect(decodeBolt11(makeInvoice({ hrpAmount: "25000000p" }))!.amountMsat).toBe(2_500_000n);
    expect(decodeBolt11(makeInvoice({ hrpAmount: "" }))!.amountMsat).toBeNull();
  });

  it("uses the 1-hour default expiry when none is given", () => {
    const d = decodeBolt11(makeInvoice({ hrpAmount: "25u", timestamp: 1_800_000_000 }))!;
    expect(d.expirySeconds).toBe(3600);
    expect(d.expiresAt).toBe((1_800_000_000 + 3600) * 1000);
  });

  it("identifies testnet invoices and rejects junk", () => {
    expect(decodeBolt11(makeInvoice({ prefix: "lntb", hrpAmount: "25u" }))!.network).toBe("testnet");
    expect(decodeBolt11("lnbc1notaninvoice")).toBeNull();
    expect(decodeBolt11("hello@speed.app")).toBeNull();
    expect(decodeBolt11(makeInvoice({ hrpAmount: "25u" }).slice(0, -1) + "q")).toBeNull(); // checksum
  });
});
