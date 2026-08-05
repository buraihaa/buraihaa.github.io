/**
 * Password hashing/verification for the two-account allowlist.
 *
 * Uses node:crypto scrypt with a per-hash random salt, stored as "salt:hash"
 * (both hex) in env vars (AUTH_CHRIS_HASH / AUTH_JIAMIN_HASH). This module is
 * Node-runtime only (scrypt isn't available on the Edge) — it must never be
 * imported from middleware or Edge code. See auth.config.ts for the split.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export type AllowedUser = "chris" | "jiamin";
export const ALLOWED_USERS: readonly AllowedUser[] = ["chris", "jiamin"];

export function isAllowedUser(name: string): name is AllowedUser {
  return (ALLOWED_USERS as readonly string[]).includes(name);
}

/** Hash a password into a storable "salt:hash" string. Used by the hash CLI. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** Constant-time check of a password against a stored "salt:hash". */
export async function verifyPassword(
  password: string,
  stored: string | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const hashBuf = Buffer.from(hash, "hex");
  // timingSafeEqual throws on length mismatch — guard first.
  if (hashBuf.length !== derived.length) return false;
  return timingSafeEqual(hashBuf, derived);
}

/** The stored hash for a user, pulled from env at call time. */
export function storedHashFor(user: AllowedUser): string | undefined {
  return user === "chris"
    ? process.env.AUTH_CHRIS_HASH
    : process.env.AUTH_JIAMIN_HASH;
}
