import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { createMailer } from "./mailer.js";
import { AppError } from "../lib/errors.js";

/** Minimal SMTP server: accepts one message per connection and records it. */
const received: { from: string; to: string[]; data: string }[] = [];
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((sock: Socket) => {
    let msg = { from: "", to: [] as string[], data: "" };
    let inData = false;
    let buf = "";
    sock.write("220 test ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push(msg);
            msg = { from: "", to: [], data: "" };
            sock.write("250 OK queued\r\n");
          } else msg.data += line + "\n";
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250 test\r\n");
        else if (cmd === "MAIL") (msg.from = line), sock.write("250 OK\r\n");
        else if (cmd === "RCPT") msg.to.push(line), sock.write("250 OK\r\n");
        else if (cmd === "DATA") (inData = true), sock.write("354 go\r\n");
        else if (cmd === "QUIT") sock.end("221 bye\r\n");
        else sock.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server?.close());

describe("email provider selection", () => {
  it("prefers Brevo, then SMTP, then log in development, disabled in production", () => {
    expect(createMailer({ NODE_ENV: "production", BREVO_API_KEY: "k", MAIL_FROM: "a@b.co", SMTP_HOST: "smtp" }).mode).toBe("brevo");
    expect(createMailer({ NODE_ENV: "production", MAIL_FROM: "a@b.co", SMTP_HOST: "smtp" }).mode).toBe("smtp");
    expect(createMailer({ NODE_ENV: "development" }).mode).toBe("log");
    expect(createMailer({ NODE_ENV: "production" }).mode).toBe("disabled");
    expect(createMailer({ NODE_ENV: "production", MAIL_LOG_ONLY: true }).mode).toBe("log");
    // SMTP without a sender address isn't usable.
    expect(createMailer({ NODE_ENV: "production", SMTP_HOST: "smtp" }).mode).toBe("disabled");
  });
});

describe("SMTP mailer", () => {
  it("delivers the code email over SMTP", async () => {
    const { mailer } = createMailer({ NODE_ENV: "production", SMTP_HOST: "127.0.0.1", SMTP_PORT: port, SMTP_SECURE: false, MAIL_FROM: "no-reply@bitmine.test" });
    await mailer.send({ to: "user@example.com", subject: "Your BitMine verification code", text: "Your code is 123456" });
    const m = received.at(-1)!;
    expect(m.from).toContain("no-reply@bitmine.test");
    expect(m.to.join()).toContain("user@example.com");
    expect(m.data).toContain("Subject: Your BitMine verification code");
    expect(m.data).toContain("Your code is 123456");
  });

  it("an unreachable SMTP server becomes a 503 the app can show", async () => {
    const { mailer } = createMailer({ NODE_ENV: "production", SMTP_HOST: "127.0.0.1", SMTP_PORT: 1, SMTP_SECURE: false, MAIL_FROM: "no-reply@bitmine.test" });
    await expect(mailer.send({ to: "user@example.com", subject: "x", text: "y" })).rejects.toSatisfy(
      (e) => e instanceof AppError && e.status === 503 && e.code === "email_unavailable",
    );
  });
});
