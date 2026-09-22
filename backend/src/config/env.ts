import "dotenv/config";
import { z } from "zod";

// Only what the current code needs is required. Integration secrets
// (RevenueCat, Speed, Firebase...) are validated by their own modules when
// those modules are added, so a missing key fails loudly at boot there.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  // Store: optional so the API can run before RevenueCat is set up; the store
  // endpoints refuse to work (fail closed) until both are present.
  REVENUECAT_SECRET_KEY: z.string().optional().transform((v) => v || undefined),
  REVENUECAT_WEBHOOK_AUTH: z.string().optional().transform((v) => v || undefined),
  ALLOW_SANDBOX: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Payouts: optional so the API runs before Speed is set up; payouts pause until set.
  SPEED_API_KEY: z.string().optional().transform((v) => v || undefined),
  SPEED_API_BASE: z.string().url().default("https://api.tryspeed.com"),
  // Sign-in with Google / Apple: ID token audiences (public identifiers, not secrets).
  GOOGLE_CLIENT_IDS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean)),
  APPLE_BUNDLE_ID: z.string().optional().transform((v) => v || undefined),
  // Email (Brevo). Without a key, codes are logged in development and email fails in production.
  BREVO_API_KEY: z.string().optional().transform((v) => v || undefined),
  MAIL_FROM: z.string().optional().transform((v) => v || undefined),
  // Push notifications (FCM HTTP v1) via a Firebase service account.
  FIREBASE_PROJECT_ID: z.string().optional().transform((v) => v || undefined),
  FIREBASE_CLIENT_EMAIL: z.string().optional().transform((v) => v || undefined),
  FIREBASE_PRIVATE_KEY: z.string().optional().transform((v) => (v ? v.replace(/\\n/g, "\n") : undefined)),
  // Development only: lets the browser build finish claims and purchases without
  // AdMob/RevenueCat. Ignored (always off) when NODE_ENV=production.
  DEV_SHORTCUTS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  ADMOB_SSV_KEYS_URL: z.string().url().default("https://www.gstatic.com/admob/reward/verifier-keys.json"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment:\n${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}
