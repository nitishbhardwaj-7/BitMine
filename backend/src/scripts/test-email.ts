/**
 * Sends one test email with the configured provider (SMTP or Brevo).
 *   npm run email:test -- you@example.com
 *   production: docker exec bitmine-api node dist/scripts/test-email.js you@example.com
 */
import { env } from "../config/env.js";
import { createMailer } from "../auth/mailer.js";

const to = (process.argv[2] ?? "").trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error("Usage: npm run email:test -- you@example.com");
  process.exit(1);
}
const config = env();
const { mailer, mode } = createMailer(config);
console.log(`provider: ${mode}${mode === "smtp" ? ` (${config.SMTP_HOST}:${config.SMTP_PORT})` : ""}, from: ${config.MAIL_FROM ?? "-"}`);
try {
  await mailer.send({
    to,
    subject: "BitMine test email",
    text: "This is a test from your BitMine server. If you can read this, email codes will reach your users.\n\nYour code is 123456 (example only).",
  });
  console.log(mode === "log" ? "logged (not sent): no email provider configured" : `sent to ${to}`);
} catch (err) {
  console.error("FAILED:", (err as Error).message, "— check the server log for the SMTP error.");
  process.exit(1);
}
