import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// `drizzle-kit` is a standalone CLI (not run through Next), so it can't rely on
// Next's automatic .env.local loading — pull env in from .env.local ourselves.
config({ path: ".env.local" });

// `generate` (diffing schema → SQL) never connects, so it works offline before
// Neon is provisioned. `push`/`migrate`/`studio` do connect and will fail
// loudly without a real DATABASE_URL — which is the correct behaviour.
const url = process.env.DATABASE_URL ?? "postgres://offline";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
