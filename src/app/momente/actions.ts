"use server";

/**
 * Momente writes. Every action derives the actor from the session
 * (`requireUser`) and never trusts a client-supplied author, and every write
 * that should surface on the public Home feed is paired with `recordActivity`
 * (actions only — the feed never sees post or comment text).
 *
 * Writes return the fresh `Feed` so the client can reconcile in one round-trip
 * instead of firing a separate reload.
 *
 * Image uploads use a client-upload flow into a PRIVATE Blob store: the browser
 * uploads the original file straight to Vercel Blob (via the /api/momente/upload
 * token route), then calls `attachImage` here with the blob's pathname. We read
 * the original back with a private `get()`, normalize it with Sharp (EXIF strip,
 * HEIC → WebP, downscale), store the processed WebP (also private), delete the
 * original, and record a `postImages` row keyed by pathname. The feed serves
 * these through the auth-gated /api/momente/image/[id] proxy — never by URL.
 */
import { del, get, put } from "@vercel/blob";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/db";
import { recordActivity, setStatus } from "@/db/queries";
import { comments, postImages, posts, statuses } from "@/db/schema";

import { getFeed, requireUser, type Feed } from "./queries";

const MAX_BODY = 4000;
const MAX_COMMENT = 2000;
const MAX_STATUS = 140;
const MAX_EMOJI = 16; // a single emoji, but multi-codepoint ones (flags, ZWJ) run long

// Processed-image ceiling: downscale the longest edge to this before WebP. Plenty
// for a phone-screen scrapbook and keeps stored blobs small.
const MAX_IMAGE_EDGE = 1600;
const WEBP_QUALITY = 82;
// Guard against an unbounded gallery on a single post.
const MAX_IMAGES_PER_POST = 6;

/**
 * Write a new Moment as the signed-in user. Returns the new post id alongside
 * the fresh feed — the id is needed so the client can attach uploaded images to
 * this exact post before the next poll.
 */
export async function createPost(
  body: string,
): Promise<{ postId: number; feed: Feed }> {
  const user = await requireUser();
  // Body may be empty for a photo-only Moment — the client only calls this when
  // there's text or at least one image, so we don't guard emptiness here.
  const text = body.trim();
  const [row] = await db
    .insert(posts)
    .values({ author: user, body: text.slice(0, MAX_BODY) })
    .returning({ id: posts.id });
  await recordActivity(user, "posted");
  return { postId: row.id, feed: await getFeed() };
}

/**
 * Edit a Moment's text. Either account can edit any Moment on this shared board.
 * We don't touch `createdAt` (the post keeps its original time) and record no
 * activity — an edit isn't a feed verb. An empty body is only allowed if the
 * post still has at least one photo, so a text-only Moment can't be blanked out.
 */
export async function editPost(id: number, body: string): Promise<Feed> {
  await requireUser();
  const text = body.trim();
  if (!text) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postImages)
      .where(eq(postImages.postId, id));
    if (count === 0) throw new Error("A moment needs text or a photo");
  }
  await db
    .update(posts)
    .set({ body: text.slice(0, MAX_BODY) })
    .where(eq(posts.id, id));
  return getFeed();
}

/**
 * Normalize a client-uploaded original and attach it to a post. `pathname` is
 * the private blob pathname the browser got back from its direct upload. We read
 * it back with a private `get()`, strip EXIF (`rotate()` bakes in orientation
 * then drops metadata — phone photos carry GPS), downscale, convert to WebP,
 * store the processed file (private), delete the unprocessed original, and record
 * the row. We store the processed PATHNAME so the proxy route can `get()` it.
 */
export async function attachImage(
  postId: number,
  pathname: string,
): Promise<Feed> {
  await requireUser();
  if (typeof pathname !== "string" || !pathname) {
    throw new Error("Invalid upload reference");
  }

  // Don't let a post grow an unbounded gallery.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postImages)
    .where(eq(postImages.postId, postId));
  if (count >= MAX_IMAGES_PER_POST) {
    await del(pathname); // drop the just-uploaded original; it won't be used
    throw new Error("Too many images on this post");
  }

  // Read the original back out of the private store (a plain fetch of the URL
  // would 401 — private blobs are only reachable with the token via get()).
  const original = await get(pathname, { access: "private" });
  if (!original || original.statusCode !== 200) {
    throw new Error("Could not read the uploaded file");
  }
  const input = Buffer.from(await new Response(original.stream).arrayBuffer());

  // `.rotate()` with no args auto-orients from EXIF then discards metadata, so
  // GPS/orientation tags don't survive into the stored WebP.
  const { data, info } = await sharp(input)
    .rotate()
    .resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  const processed = await put(
    `momente/${postId}/${crypto.randomUUID()}.webp`,
    data,
    { access: "private", contentType: "image/webp" },
  );

  // The unprocessed original (with its EXIF) has served its purpose — remove it.
  await del(pathname);

  await db.insert(postImages).values({
    postId,
    url: processed.pathname, // private pathname; served via the proxy route
    width: info.width,
    height: info.height,
  });

  return getFeed();
}

/**
 * Delete a Moment. Either account can delete any Moment on this shared
 * two-person scrapbook (auth-gated to chris/jiamin). Its comment/image ROWS
 * cascade away via the schema's `onDelete: "cascade"`, but the blob objects
 * don't — so we delete those from the store first to avoid orphans. No activity
 * recorded — the feed has no "deleted" verb.
 */
export async function deletePost(id: number): Promise<Feed> {
  await requireUser();
  const imgs = await db
    .select({ url: postImages.url })
    .from(postImages)
    .where(eq(postImages.postId, id));
  if (imgs.length > 0) {
    // `del` takes a single pathname or an array; ignore if a blob is already gone.
    await del(imgs.map((i) => i.url)).catch(() => {});
  }
  await db.delete(posts).where(eq(posts.id, id));
  return getFeed();
}

/** Add a comment to a Moment as the signed-in user. Returns the updated feed. */
export async function addComment(
  postId: number,
  body: string,
): Promise<Feed | null> {
  const user = await requireUser();
  const text = body.trim();
  if (!text) return null;
  await db
    .insert(comments)
    .values({ postId, author: user, body: text.slice(0, MAX_COMMENT) });
  await recordActivity(user, "commented");
  return getFeed();
}

/** Delete a single comment. Auth-gated; no activity recorded. */
export async function deleteComment(id: number): Promise<Feed> {
  await requireUser();
  await db.delete(comments).where(eq(comments.id, id));
  return getFeed();
}

/** Poll target: re-read the whole feed (auth-gated). */
export async function loadFeed(): Promise<Feed> {
  await requireUser();
  return getFeed();
}

/**
 * Set the current user's status. `ttlMinutes` is null for an indefinite status
 * (the default) or a preset TTL. Returns the fresh feed (statuses ride along).
 * The status box lives on Momente now, but the underlying `set_status` activity
 * verb is unchanged, so Home still surfaces it.
 */
export async function setMyStatus(
  text: string,
  ttlMinutes: number | null,
  emoji?: string,
): Promise<Feed | null> {
  const user = await requireUser();
  const t = text.trim();
  if (!t) return null;
  await setStatus(
    user,
    t.slice(0, MAX_STATUS),
    ttlMinutes,
    emoji?.trim().slice(0, MAX_EMOJI) || undefined,
  );
  await recordActivity(user, "set_status");
  return getFeed();
}

/** Clear the current user's status immediately (don't wait for it to expire). */
export async function clearMyStatus(): Promise<Feed> {
  const user = await requireUser();
  await db.delete(statuses).where(eq(statuses.user, user));
  return getFeed();
}
