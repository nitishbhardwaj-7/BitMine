/**
 * Transactional email: Brevo's HTTP API or any SMTP server. In development
 * without either, messages are logged (so OTPs can be read from the console).
 * Production without either refuses to send, rather than silently dropping
 * codes (unless MAIL_LOG_ONLY is set for a private test phase).
 */
import nodemailer from "nodemailer";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors.js";

const unavailable = () => new AppError(503, "email_unavailable", "We couldn't send the email right now. Please try again in a few minutes.");

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
      if (!res.ok) {
        logger.error({ status: res.status, body: (await res.text()).slice(0, 300) }, "Brevo send failed");
        throw unavailable();
      }
    },
  };
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = TLS from the start (port 465); false = STARTTLS upgrade (587). Defaults from the port. */
  secure?: boolean;
  user?: string;
  pass?: string;
}

export function smtpMailer(cfg: SmtpConfig, from: string, fromName = "BitMine"): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    // Port 587 must upgrade to TLS; never send codes or the password in clear text.
    requireTLS: !(cfg.secure ?? cfg.port === 465) && cfg.port === 587,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(mail) {
      try {
        await transport.sendMail({
          from: { name: fromName, address: from },
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html ?? `<p>${mail.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`,
        });
      } catch (err) {
        logger.error({ err: { message: (err as Error).message, code: (err as { code?: string }).code } }, "SMTP send failed");
        throw unavailable();
      }
    },
  };
}

export type MailMode = "brevo" | "smtp" | "log" | "disabled";

/** Picks the mailer from the environment: Brevo, then SMTP, then log (dev / MAIL_LOG_ONLY) or disabled. */
export function createMailer(c: {
  NODE_ENV: string;
  BREVO_API_KEY?: string;
  MAIL_FROM?: string;
  MAIL_FROM_NAME?: string;
  MAIL_LOG_ONLY?: boolean;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
}): { mailer: Mailer; mode: MailMode } {
  const name = c.MAIL_FROM_NAME || "BitMine";
  if (c.BREVO_API_KEY && c.MAIL_FROM) return { mailer: brevoMailer(c.BREVO_API_KEY, c.MAIL_FROM, name), mode: "brevo" };
  if (c.SMTP_HOST && c.MAIL_FROM) {
    return {
      mailer: smtpMailer({ host: c.SMTP_HOST, port: c.SMTP_PORT ?? 587, secure: c.SMTP_SECURE, user: c.SMTP_USER, pass: c.SMTP_PASS }, c.MAIL_FROM, name),
      mode: "smtp",
    };
  }
  if (c.NODE_ENV === "production" && !c.MAIL_LOG_ONLY) return { mailer: disabledMailer(), mode: "disabled" };
  return { mailer: devLogMailer(), mode: "log" };
}

export function devLogMailer(): Mailer {
  return {
    async send(mail) {
      logger.warn({ to: mail.to, subject: mail.subject, text: mail.text }, "DEV EMAIL (not sent: no email provider configured)");
    },
  };
}

export function disabledMailer(): Mailer {
  return {
    async send() {
      logger.error("email requested but no email provider is configured (SMTP_HOST or BREVO_API_KEY, plus MAIL_FROM)");
      throw unavailable();
    },
  };
}
