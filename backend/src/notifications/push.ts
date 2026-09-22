/**
 * Firebase Cloud Messaging (HTTP v1) with a service account, without the
 * firebase-admin SDK: sign a JWT, swap it for an OAuth access token, send.
 * https://firebase.google.com/docs/cloud-messaging/send-message
 */
import { SignJWT, importPKCS8 } from "jose";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** "ok", or "invalid_token" when the device token is dead and should be deleted. Throws on transient errors. */
export type PushResult = "ok" | "invalid_token";

export interface PushSender {
  send(token: string, msg: PushMessage): Promise<PushResult>;
}

export function fcmSender(projectId: string, clientEmail: string, privateKeyPem: string): PushSender {
  let cached: { token: string; exp: number } | undefined;

  async function accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.exp - 60 > now) return cached.token;
    const key = await importPKCS8(privateKeyPem, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(clientEmail)
      .setSubject(clientEmail)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`FCM auth failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, exp: now + body.expires_in };
    return cached.token;
  }

  return {
    async send(token, msg) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: msg.data ?? {},
            android: { priority: "high" },
            apns: { payload: { aps: { sound: "default" } } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return "ok";
      const text = await res.text();
      if (res.status === 404 || text.includes("UNREGISTERED") || (res.status === 400 && text.includes("registration token"))) {
        return "invalid_token";
      }
      throw new Error(`FCM send failed: HTTP ${res.status}`);
    },
  };
}
