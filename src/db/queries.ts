/**
 * Cross-cutting query helpers — the pieces more than one feature needs, or that
 * carry non-obvious logic. Feature-specific CRUD (posts, comments, messages,
 * orte) lives with each feature; this file is only the shared plumbing:
 *
 *   - recordActivity: every feature calls this so Home's feed stays complete.
 *   - getRecentActivity: what Home reads.
 *   - getLiveStatuses / getLiveStatus: status with expiry computed on read.
 *   - setStatus: upsert a status with a TTL.
 */
import { and, desc, gt, isNull, or, sql } from "drizzle-orm";

import { db } from "./index";
import {
  activity,
  statuses,
  type ActivityActionValue,
  type Status,
  type UserNameValue,
} from "./schema";

// ---------------------------------------------------------------------------
// Activity feed (Home)
// ---------------------------------------------------------------------------

/**
 * Log an action to the public feed. Content is intentionally NOT passed in —
 * the feed shows "Chris posted a Moment", never the text. Call this from the same
 * server action that performs the underlying write.
 */
export async function recordActivity(
  actor: UserNameValue,
  action: ActivityActionValue,
) {
  await db.insert(activity).values({ actor, action });
}

export async function getRecentActivity(limit = 30) {
  return db
    .select()
    .from(activity)
    .orderBy(desc(activity.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Statuses (Momente) — expire on read, no cron
// ---------------------------------------------------------------------------

// A status counts as live if it has no expiry (indefinite) or its expiry is
// still in the future. This same predicate drives both reads below.
const liveStatus = or(
  isNull(statuses.expiresAt),
  gt(statuses.expiresAt, sql`now()`),
);

/** Statuses that are still live (indefinite or not yet expired), newest first. */
export async function getLiveStatuses(): Promise<Status[]> {
  return db
    .select()
    .from(statuses)
    .where(liveStatus)
    .orderBy(desc(statuses.updatedAt));
}

/** A single user's status, or null if it's unset or already expired. */
export async function getLiveStatus(
  user: UserNameValue,
): Promise<Status | null> {
  const rows = await db
    .select()
    .from(statuses)
    .where(and(sql`${statuses.user} = ${user}`, liveStatus))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Set (or replace) a user's status. `ttlMinutes` is one of the presets the UI
 * offers, or `null` for an indefinite status (no expiry). When a TTL is given,
 * expiry is stored and enforced on read above.
 */
export async function setStatus(
  user: UserNameValue,
  text: string,
  ttlMinutes: number | null,
  emoji?: string,
) {
  const expiresAt =
    ttlMinutes == null ? null : new Date(Date.now() + ttlMinutes * 60_000);
  await db
    .insert(statuses)
    .values({ user, text, emoji, expiresAt })
    .onConflictDoUpdate({
      target: statuses.user,
      set: { text, emoji, expiresAt, updatedAt: sql`now()` },
    });
}
