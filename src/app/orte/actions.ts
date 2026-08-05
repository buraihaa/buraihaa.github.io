"use server";

/**
 * Orte writes. Every action derives the actor from the session (`requireUser`)
 * and never trusts a client-supplied value. Adding a pin is the one feed-worthy
 * action, so it pairs with `recordActivity(user, "pinned_ort")` (actions only —
 * the feed never sees the place label). Each write returns the fresh list so the
 * client can reconcile in one round-trip.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { recordActivity } from "@/db/queries";
import { orte } from "@/db/schema";

import { getOrte, requireUser, type OrtItem } from "./queries";

const MAX_LABEL = 200;
const MAX_NOTE = 2000;

export type NewOrtInput = {
  label: string;
  note: string;
  longitude: number;
  latitude: number;
};

/** Poll/refresh target: re-read all pins (auth-gated). */
export async function loadOrte(): Promise<OrtItem[]> {
  await requireUser();
  return getOrte();
}

/** Pin a new place as the signed-in user. Returns the updated list. */
export async function addOrt(input: NewOrtInput): Promise<OrtItem[]> {
  const user = await requireUser();
  const label = input.label.trim();
  if (!label) throw new Error("A place needs a name");
  const note = input.note.trim();
  await db.insert(orte).values({
    addedBy: user,
    label: label.slice(0, MAX_LABEL),
    note: note ? note.slice(0, MAX_NOTE) : null,
    longitude: input.longitude,
    latitude: input.latitude,
  });
  await recordActivity(user, "pinned_ort");
  return getOrte();
}

/** Flip a pin between "To See" and "Visited". Returns the updated list. */
export async function toggleVisited(id: number): Promise<OrtItem[]> {
  await requireUser();
  // `visited = NOT visited` in one statement, so the flip is atomic (no separate
  // read-then-write) and stays consistent if both people toggle at once.
  await db
    .update(orte)
    .set({ visited: sql`NOT ${orte.visited}` })
    .where(eq(orte.id, id));
  return getOrte();
}

/** Remove a pin. Auth-gated; no activity recorded. Returns the updated list. */
export async function removeOrt(id: number): Promise<OrtItem[]> {
  await requireUser();
  await db.delete(orte).where(eq(orte.id, id));
  return getOrte();
}
