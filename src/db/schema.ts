/**
 * Drizzle schema — the whole data layer for mochidonut.
 *
 * This is a two-person site (chris + jiamin, the auth allowlist), so there is
 * no `users` table. Instead a `userName` enum is the author/actor everywhere,
 * which keeps foreign keys trivial and matches the sign-in allowlist exactly.
 *
 * Design notes that the rest of the app depends on:
 * - Every feature writes an `activity` row (Home aggregates these). Activity
 *   records the ACTION ONLY — never the content — because Home is public.
 * - Statuses store `expiresAt`; expiry is computed on read, so there's no cron.
 * - Post images live in their own `postImages` table (a post can have several).
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** The two accounts. Mirrors the Auth.js credentials allowlist. */
export const userName = pgEnum("user_name", ["chris", "jiamin"]);

/**
 * Every action that should surface on the public Home feed. Deliberately a
 * closed set of verbs with no content attached — "Chris pinned a new location",
 * never which location. Add a verb here when a new feature can produce activity.
 */
export const activityAction = pgEnum("activity_action", [
  "posted", // wrote a Moment
  "commented", // commented on a Moment
  "sent_message", // sent a Chat message
  "set_status", // changed their status
  "pinned_ort", // pinned an Ort to visit
]);

// ---------------------------------------------------------------------------
// Home — public activity feed (actions only, no content)
// ---------------------------------------------------------------------------

export const activity = pgTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    actor: userName("actor").notNull(),
    action: activityAction("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("activity_created_at_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Chat — 1:1 chat + per-user expiring status
// ---------------------------------------------------------------------------

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    sender: userName("sender").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("messages_created_at_idx").on(t.createdAt)],
);

/**
 * One row per user (the user name is the primary key). A status with an
 * `expiresAt` is only "live" while `now() < expiresAt`; past that the app treats
 * it as empty (expire on read, no cron). A NULL `expiresAt` means the status is
 * indefinite — it never fades and is the default when setting one.
 */
export const statuses = pgTable("statuses", {
  user: userName("user").primaryKey(),
  emoji: text("emoji"),
  text: text("text").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Momente — posts + image uploads + comments
// ---------------------------------------------------------------------------

export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    author: userName("author").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("posts_created_at_idx").on(t.createdAt)],
);

/**
 * Images attached to a post. Populated after the client uploads to Vercel Blob
 * and the server has normalized the file (EXIF stripped, HEIC → WebP via Sharp),
 * so `url` points at the processed WebP.
 */
export const postImages = pgTable(
  "post_images",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("post_images_post_id_idx").on(t.postId)],
);

export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    author: userName("author").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("comments_post_id_idx").on(t.postId)],
);

// ---------------------------------------------------------------------------
// Orte — pinned locations for the "places to see" panel
// ---------------------------------------------------------------------------

export const orte = pgTable(
  "orte",
  {
    id: serial("id").primaryKey(),
    addedBy: userName("added_by").notNull(),
    label: text("label").notNull(),
    note: text("note"),
    // Map pin coordinates. lng/lat as doubles is plenty of precision for pins.
    longitude: doublePrecision("longitude").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    visited: boolean("visited").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("orte_created_at_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Inferred types — import these instead of re-deriving row shapes.
// ---------------------------------------------------------------------------

export type UserNameValue = (typeof userName.enumValues)[number];
export type ActivityActionValue = (typeof activityAction.enumValues)[number];

export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Status = typeof statuses.$inferSelect;
export type NewStatus = typeof statuses.$inferInsert;

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

export type PostImage = typeof postImages.$inferSelect;
export type NewPostImage = typeof postImages.$inferInsert;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

export type Ort = typeof orte.$inferSelect;
export type NewOrt = typeof orte.$inferInsert;
