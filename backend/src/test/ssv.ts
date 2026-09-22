/** Test helper: an AdMob-style signer so SSV callbacks can be simulated end to end. */
import { generateKeyPairSync, sign } from "node:crypto";
import { SsvVerifier, type SsvKey } from "../claims/admobSsv.js";

export function makeSsvSigner(keyId = "1234567890") {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const keys: SsvKey[] = [{ keyId, pem: publicKey.export({ type: "spki", format: "pem" }).toString() }];

  /** Builds a signed query string in AdMob's parameter order. */
  function signedQuery(p: { claimId: string; userId: string; transactionId: string; adUnit?: string }) {
    const q = new URLSearchParams({
      ad_network: "5450213213286189855",
      ad_unit: p.adUnit ?? "1234567890",
      custom_data: p.claimId,
      reward_amount: "1",
      reward_item: "claim",
      timestamp: String(Date.now()),
      transaction_id: p.transactionId,
      user_id: p.userId,
    }).toString();
    const sig = sign("sha256", Buffer.from(q), privateKey).toString("base64url");
    return `${q}&signature=${sig}&key_id=${keyId}`;
  }

  const verifier = new SsvVerifier(async () => keys);
  return { keys, signedQuery, verifier };
}
