/**
 * Transactional email. Brevo in production; in development without a key the
 * message is logged (so OTPs can be read from the console). Production without
 * a key refuses to send, rather than silently dropping codes.
 */
import { logger } from "../lib/logger.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function brevoMailer(apiKey: string, from: string, fromName = "BitMine"): Mailer {
  return {
    async send(mail) {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: from, name: fromName },
          to: [{ email: mail.to }],
          subject: mail.subject,
          textContent: mail.text,
          htmlContent: mail.html ?? `<p>${mail.text.replace(/\n/g, "<br>")}</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Brevo send failed: HTTP ${res.status}`);
    },
  };
}

export function devLogMailer(): Mailer {
  return {
    async send(mail) {
      logger.warn({ to: mail.to, subject: mail.subject, text: mail.text }, "DEV EMAIL (not sent: BREVO_API_KEY missing)");
    },
  };
}

export function disabledMailer(): Mailer {
  return {
    async send() {
      throw new Error("Email is not configured (BREVO_API_KEY / MAIL_FROM missing)");
    },
  };
}
