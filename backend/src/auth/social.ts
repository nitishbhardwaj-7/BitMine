/**
 * Google and Apple sign-in: the app sends the provider's ID token, and we
 * verify its signature against the provider's published keys, plus issuer,
 * audience (our app's client ids) and expiry. The email we use is the one the
 * provider vouches for, never one from the request body (BitPlay's original
 * social login trusted the body's email; see its verifySocialToken.js).
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { AppError } from "../lib/errors.js";

export type SocialProvider = "google" | "apple";

export interface SocialIdentity {
  provider: SocialProvider;
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

export interface SocialVerifier {
  verify(provider: SocialProvider, idToken: string): Promise<SocialIdentity>;
}

export interface SocialConfig {
  googleClientIds: string[];
  appleAudiences: string[];
  /** Overridable for tests. */
  googleKeys?: JWTVerifyGetKey;
  appleKeys?: JWTVerifyGetKey;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_ISSUER = "https://appleid.apple.com";

const truthy = (v: unknown) => v === true || v === "true";

export function socialVerifier(cfg: SocialConfig): SocialVerifier {
  const googleKeys = cfg.googleKeys ?? createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  const appleKeys = cfg.appleKeys ?? createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

  return {
    async verify(provider, idToken) {
      const audiences = provider === "google" ? cfg.googleClientIds : cfg.appleAudiences;
      if (audiences.length === 0) {
        throw new AppError(503, "provider_unavailable", `${provider === "google" ? "Google" : "Apple"} sign-in isn't available yet.`);
      }
      try {
        const { payload } = await jwtVerify(idToken, provider === "google" ? googleKeys : appleKeys, {
          issuer: provider === "google" ? GOOGLE_ISSUERS : APPLE_ISSUER,
          audience: audiences,
          algorithms: ["RS256"],
          clockTolerance: 120,
        });
        if (typeof payload.sub !== "string" || !payload.sub) throw new Error("no sub");
        return {
          provider,
          sub: payload.sub,
          email: typeof payload.email === "string" ? payload.email.toLowerCase() : undefined,
          emailVerified: truthy(payload.email_verified),
          name: typeof payload.name === "string" ? payload.name : undefined,
        };
      } catch {
        throw new AppError(401, "social_token_invalid", "Sign-in couldn't be verified. Please try again.");
      }
    },
  };
}
