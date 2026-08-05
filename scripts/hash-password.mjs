// Generate a scrypt "salt:hash" for an account password.
//
//   pnpm auth:hash "your-password"
//
// Paste the printed value into .env.local as AUTH_CHRIS_HASH / AUTH_JIAMIN_HASH.
// Must stay in sync with src/lib/auth-helpers.ts (KEY_LENGTH = 64).
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

const password = process.argv[2];
if (!password) {
  console.error('Usage: pnpm auth:hash "your-password"');
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const derived = await scryptAsync(password, salt, KEY_LENGTH);
console.log(`${salt}:${derived.toString("hex")}`);
