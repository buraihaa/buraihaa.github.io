/**
 * Momente reads — feature-specific, so they live here (db/queries.ts is only
 * cross-cutting plumbing). Server-only: these import `db` and must never be
 * pulled into a client component. The client imports the TYPES below with
 * `import type`, which the compiler erases, so no db code leaks into the bundle.
 *
 * Everything is returned as plain JSON-safe objects (ISO strings, not `Date`) so
 * the same shapes cross the server-action boundary to the client untouched.
 */
import { asc, desc, inArray } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { getLiveStatuses } from "@/db/queries";
import { comments, postImages, posts, type UserNameValue } from "@/db/schema";

export type FeedImage = {
  id: number;
  url: string;
  width: number | null;
  height: number | null;
};

export type FeedComment = {
  id: number;
  author: UserNameValue;
  body: string;
  createdAt: string; // ISO
};

export type FeedPost = {
  id: number;
  author: UserNameValue;
  body: string;
  createdAt: string; // ISO
  images: FeedImage[];
  comments: FeedComment[];
};

// The per-person status once lived on Chat; it now rides along with the Momente
// feed (Momente is where the status box is shown). Expiry is computed on read.
export type LiveStatus = {
  user: UserNameValue;
  emoji: string | null;
  text: string;
  expiresAt: string | null; // ISO, or null for an indefinite status
};

export type Feed = {
  posts: FeedPost[];
  statuses: LiveStatus[];
};

// A two-person scrapbook stays small; cap the window so the feed never loads
// unbounded. Newest post first — that's the order the feed renders in.
const FEED_LIMIT = 100;

/**
 * The whole feed in a few round-trips: the newest posts, plus every image and
 * comment belonging to them, grouped back onto each post. Comments are returned
 * oldest-first (conversation order) even though posts are newest-first.
 */
export async function getFeed(): Promise<Feed> {
  // Statuses ride along with every feed read so the client's poll refreshes both
  // the posts and the status box in one round-trip (same shape Chat used).
  const [postRows, statuses] = await Promise.all([
    db.select().from(posts).orderBy(desc(posts.createdAt)).limit(FEED_LIMIT),
    getStatuses(),
  ]);

  if (postRows.length === 0) return { posts: [], statuses };

  const postIds = postRows.map((p) => p.id);

  // Fetch children for exactly the posts in view, then bucket them by postId.
  const [imageRows, commentRows] = await Promise.all([
    db.select().from(postImages).where(inArray(postImages.postId, postIds)),
    db
      .select()
      .from(comments)
      .where(inArray(comments.postId, postIds))
      .orderBy(asc(comments.createdAt)),
  ]);

  const imagesByPost = new Map<number, FeedImage[]>();
  for (const img of imageRows) {
    const list = imagesByPost.get(img.postId) ?? [];
    // The stored `img.url` is a PRIVATE blob pathname — never send it to the
    // client. The browser loads photos through the auth-gated proxy route,
    // which resolves the id back to the pathname server-side.
    list.push({
      id: img.id,
      url: `/api/momente/image/${img.id}`,
      width: img.width,
      height: img.height,
    });
    imagesByPost.set(img.postId, list);
  }

  const commentsByPost = new Map<number, FeedComment[]>();
  for (const c of commentRows) {
    const list = commentsByPost.get(c.postId) ?? [];
    list.push({
      id: c.id,
      author: c.author,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    });
    commentsByPost.set(c.postId, list);
  }

  return {
    posts: postRows.map((p) => ({
      id: p.id,
      author: p.author,
      body: p.body,
      createdAt: p.createdAt.toISOString(),
      images: imagesByPost.get(p.id) ?? [],
      comments: commentsByPost.get(p.id) ?? [],
    })),
    statuses,
  };
}

export async function getStatuses(): Promise<LiveStatus[]> {
  // getLiveStatuses already drops expired rows (expire-on-read, no cron).
  const rows = await getLiveStatuses();
  return rows.map((s) => ({
    user: s.user,
    emoji: s.emoji,
    text: s.text,
    expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
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
