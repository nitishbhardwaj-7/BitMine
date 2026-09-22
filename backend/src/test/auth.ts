/**
 * Test helpers for auth: a mailer that keeps messages in memory, and a social
 * verifier using the real verification code against locally generated
 * "Google" and "Apple" signing keys.
 */
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import type { Mail, Mailer } from "../auth/mailer.js";
import { socialVerifier } from "../auth/social.js";

export const GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
export const APPLE_BUNDLE_ID = "com.bitmine.app";

export function memoryMailer() {
  const sent: Mail[] = [];
  const mailer: Mailer = {
    async send(mail) {
      sent.push(mail);
    },
  };
  /** The 6-digit code from the newest email to `to`. */
  function lastCode(to: string): string {
    const mail = [...sent].reverse().find((m) => m.to === to.toLowerCase());
    const m = mail?.text.match(/\b(\d{6})\b/);
    if (!m) throw new Error(`no code emailed to ${to}`);
    return m[1]!;
  }
  return { mailer, sent, lastCode };
}

async function signer(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

export async function fakeSocial() {
  const google = await signer("g1");
  const apple = await signer("a1");

  const sign = (key: CryptoKey, iss: string, aud: string, claims: JWTPayload & { sub: string }) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: key === google.privateKey ? "g1" : "a1" })
      .setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime("10m").sign(key);

  return {
    verifier: socialVerifier({
      googleClientIds: [GOOGLE_CLIENT_ID],
      appleAudiences: [APPLE_BUNDLE_ID],
      googleKeys: google.jwks,
      appleKeys: apple.jwks,
    }),
    googleToken: (claims: JWTPayload & { sub: string }, aud = GOOGLE_CLIENT_ID) => sign(google.privateKey, "https://accounts.google.com", aud, claims),
    appleToken: (claims: JWTPayload & { sub: string }) => sign(apple.privateKey, "https://appleid.apple.com", APPLE_BUNDLE_ID, claims),
    /** A token signed by a key Google never published. */
    forgedGoogleToken: async (claims: JWTPayload & { sub: string }) => {
      const other = await signer("g1");
      return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "g1" })
        .setIssuer("https://accounts.google.com").setAudience(GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime("10m").sign(other.privateKey);
    },
  };
}

/** AppOptions fields every HTTP test needs besides its own. */
export async function baseAuthOptions() {
  const mail = memoryMailer();
  const social = await fakeSocial();
  return { mail, social, options: { mailer: mail.mailer, social: social.verifier } };
}
