"use server";

/**
 * Chat writes. Every action derives the actor from the session
 * (`requireUser`) and never trusts a client-supplied sender, and every write
 * that should surface on the public Home feed is paired with `recordActivity`
 * (actions only — the feed never sees message text or status text).
 *
 * Writes return the fresh `Thread` so the client can reconcile in one round-trip
 * instead of firing a separate reload.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { recordActivity } from "@/db/queries";
import { messages } from "@/db/schema";

import { getThread, requireUser, type Thread } from "./queries";

const MAX_BODY = 4000;

/** Send a message as the signed-in user. Returns the updated thread. */
export async function sendMessage(body: string): Promise<Thread | null> {
  const user = await requireUser();
  const text = body.trim();
  if (!text) return null;
  await db.insert(messages).values({ sender: user, body: text.slice(0, MAX_BODY) });
  await recordActivity(user, "sent_message");
  return getThread();
}

/** Poll target: re-read the whole board (auth-gated). */
export async function loadThread(): Promise<Thread> {
  await requireUser();
  return getThread();
}

/**
 * Delete a single message. Either account can delete any message on this shared
 * two-person board (auth-gated to chris/jiamin). No activity is recorded — the
 * feed has no "deleted" verb, and a removal isn't feed-worthy.
 */
export async function deleteMessage(id: number): Promise<Thread> {
  await requireUser();
  await db.delete(messages).where(eq(messages.id, id));
  return getThread();
}

/**
 * Mark every message from the OTHER person as read. Called when the current
 * user opens/refreshes the thread, which drives the "Read" receipt on their
 * partner's side.
 */
export async function markThreadRead(): Promise<void> {
  const user = await requireUser();
  await db
    .update(messages)
    .set({ readAt: sql`now()` })
    .where(and(ne(messages.sender, user), isNull(messages.readAt)));
}
