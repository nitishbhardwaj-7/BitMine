/**
 * Blocks sign-ups from throwaway email providers (list carried over from
 * BitPlay-Auth, ~5,400 domains). Loaded once into a Set. A missing list
 * degrades to "allow", so a bad deploy can't lock everyone out.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";

let blocked: Set<string> | undefined;

function load(): Set<string> {
  if (blocked) return blocked;
  try {
    const path = fileURLToPath(new URL("../../data/disposable-email-domains.txt", import.meta.url));
    blocked = new Set(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l && !l.startsWith("#")),
    );
  } catch (err) {
    logger.error({ err }, "disposable email list missing; allowing all domains");
    blocked = new Set();
  }
  return blocked;
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  const list = load();
  // Match the domain and its parents (x.mailinator.com → mailinator.com).
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (list.has(parts.slice(i).join("."))) return true;
  }
  return false;
}
