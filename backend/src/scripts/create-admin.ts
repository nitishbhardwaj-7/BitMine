/**
 * Creates an admin account and prints its sign-in details ONCE.
 *   npm run admin:create -- you@example.com
 * Add the printed secret to an authenticator app (Google Authenticator,
 * 1Password, Authy...): "enter a setup key", time-based.
 */
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../db/connect.js";
import { AdminUser } from "../models/index.js";
import { createAdmin } from "../admin/auth.js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: npm run admin:create -- you@example.com");
  process.exit(1);
}

await connectDb(env().MONGODB_URI);
if (await AdminUser.exists({ email })) {
  console.error(`An admin with ${email} already exists.`);
  await disconnectDb();
  process.exit(1);
}
const password = randomBytes(18).toString("base64url");
const { secret, url } = await createAdmin(email, password);
await disconnectDb();

console.log(`
Admin account created. These details are shown only once:

  Sign in at:      /admin/login
  Email:           ${email}
  Password:        ${password}

  Authenticator setup key (time-based, 6 digits):
                   ${secret}
  or open this link on your phone:
                   ${url}

Store the password in a password manager.
`);
