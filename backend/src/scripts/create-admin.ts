/**
 * Creates the admin account (default email admin@bitmine.com) and prints its
 * password ONCE. Run it yourself and store the password in a password manager.
 *
 *   npm run admin:create                          → admin@bitmine.com
 *   npm run admin:create -- you@example.com       → another email
 *   npm run admin:create -- admin@bitmine.com --reset-password   → new password, signs that admin out
 *
 * Production: docker exec bitmine-api node dist/scripts/create-admin.js [email] [--reset-password]
 */
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { connectDb, disconnectDb } from "../db/connect.js";
import { AdminUser } from "../models/index.js";
import { createAdmin, setAdminPassword } from "../admin/auth.js";

const args = process.argv.slice(2);
const reset = args.includes("--reset-password");
const email = (args.find((a) => !a.startsWith("--")) ?? "admin@bitmine.com").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: npm run admin:create -- [email] [--reset-password]");
  process.exit(1);
}

await connectDb(env().MONGODB_URI);
const password = randomBytes(18).toString("base64url");
const exists = await AdminUser.exists({ email });
if (exists && !reset) {
  console.error(`An admin with ${email} already exists. Add --reset-password to set a new password.`);
  await disconnectDb();
  process.exit(1);
}
if (exists) await setAdminPassword(email, password);
else await createAdmin(email, password);
await disconnectDb();

console.log(`
Admin ${exists ? "password reset" : "account created"}. These details are shown only once:

  Sign in at:  /admin/login
  Email:       ${email}
  Password:    ${password}

Store the password in a password manager. The sign-in is limited to 10 attempts per 15 minutes.
`);
