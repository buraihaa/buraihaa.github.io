/**
 * The database client. Uses Neon's serverless HTTP driver, which works in both
 * the Node and Edge runtimes on Vercel (no TCP connection pool to manage).
 *
 * Import the query builder as `db` and the tables from "@/db/schema":
 *
 *   import { db } from "@/db";
 *   import { posts } from "@/db/schema";
 *   const rows = await db.select().from(posts);
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add your Neon connection string to .env.local " +
      "(see .env.example).",
  );
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });

export { schema };
