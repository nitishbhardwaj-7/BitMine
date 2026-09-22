/**
 * Access tokens: short-lived HS256 JWTs whose `sub` is the user id. The user
 * a request acts as always comes from here, never from a URL or body field
 * (BitPlay audit C4). Refresh tokens and login flows live in the auth module.
 */
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "bitmine";
const AUDIENCE = "bitmine-app";
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const keyCache = new Map<string, Uint8Array>();
function key(secret: string): Uint8Array {
  let k = keyCache.get(secret);
  if (!k) {
    k = new TextEncoder().encode(secret);
    keyCache.set(secret, k);
  }
  return k;
}

export async function signAccessToken(userId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ACCESS_TOKEN_TTL_SECONDS)
    .sign(key(secret));
}

/** Returns the user id, or null for any invalid, expired or tampered token. */
export async function verifyAccessToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" && /^[0-9a-f]{24}$/i.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}
