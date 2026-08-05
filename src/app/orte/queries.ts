/**
 * Orte reads — feature-specific, so they live here (db/queries.ts is only
 * cross-cutting plumbing). Server-only: these import `db` and must never be
 * pulled into a client component. The client store imports the TYPES below with
 * `import type`, which the compiler erases, so no db code leaks into the bundle.
 *
 * Everything is returned as plain JSON-safe objects (ISO strings, and the serial
 * int id exposed as a string) so the same shape crosses the server-action
 * boundary and keeps the client's string-keyed marker map unchanged.
 */
import { desc } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { orte, type UserNameValue } from "@/db/schema";

export type OrtItem = {
  id: string; // the DB serial int, stringified for use as a stable React key
  label: string;
  note: string | null;
  longitude: number;
  latitude: number;
  visited: boolean;
  addedBy: UserNameValue;
  createdAt: string; // ISO
};

/** Every pinned place, newest first. */
export async function getOrte(): Promise<OrtItem[]> {
  const rows = await db.select().from(orte).orderBy(desc(orte.createdAt));
  return rows.map((r) => ({
    id: String(r.id),
    label: r.label,
    note: r.note,
    longitude: r.longitude,
    latitude: r.latitude,
    visited: r.visited,
    addedBy: r.addedBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Resolve the signed-in user, narrowed to the two-account enum. Every write
 * action derives the actor from here — the client never gets to say who it is.
 */
export async function requireUser(): Promise<UserNameValue> {
  const session = await auth();
  const user = session?.user?.name;
  if (user !== "chris" && user !== "jiamin") {
    throw new Error("Not authenticated");
  }
  return user;
}
