/**
 * Chat reads — feature-specific, so they live here (db/queries.ts is
 * only cross-cutting plumbing). Server-only: these import `db` and must never be
 * pulled into a client component. The client imports the TYPES below with
 * `import type`, which the compiler erases, so no db code leaks into the bundle.
 *
 * Everything is returned as plain JSON-safe objects (ISO strings, not `Date`) so
 * the same shapes cross the server-action boundary to the client untouched.
 */
import { desc } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { messages, type UserNameValue } from "@/db/schema";

export type ThreadMessage = {
  id: number;
  sender: UserNameValue;
  body: string;
  createdAt: string; // ISO
  readAt: string | null; // ISO or null
};

export type Thread = {
  messages: ThreadMessage[];
};

// A two-person chat stays small; cap the window so an old thread never loads
// unbounded. Newest-first from the DB, then reversed to chat order (oldest top).
const THREAD_LIMIT = 200;

export async function getMessages(): Promise<ThreadMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .orderBy(desc(messages.createdAt))
    .limit(THREAD_LIMIT);
  return rows.reverse().map((m) => ({
    id: m.id,
    sender: m.sender,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt ? m.readAt.toISOString() : null,
  }));
}

/** The whole board in one round-trip. (Statuses moved to Momente.) */
export async function getThread(): Promise<Thread> {
  return { messages: await getMessages() };
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
