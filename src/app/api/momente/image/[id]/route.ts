/**
 * Auth-gated image proxy for Momente photos.
 *
 * The Blob store is PRIVATE, so processed images are never reachable by URL.
 * The feed renders `<img src="/api/momente/image/<id>">`; this handler resolves
 * that id to the blob's stored pathname, streams the bytes back via a private
 * `get()`, and gates the whole thing on the two-account session — so photos are
 * only ever served to a signed-in Chris/Jiamin, same as the rest of the site.
 *
 * Same-origin means the browser sends the session cookie automatically, and
 * there's no URL expiry to manage (unlike signed URLs).
 */
import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { postImages } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  const user = session?.user?.name;
  if (user !== "chris" && user !== "jiamin") {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const imageId = Number(id);
  if (!Number.isInteger(imageId)) {
    return new Response("Bad request", { status: 400 });
  }

  const [row] = await db
    .select()
    .from(postImages)
    .where(eq(postImages.id, imageId))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404 });

  // `row.url` holds the private blob PATHNAME (not a public URL) — see attachImage.
  const result = await get(row.url, { access: "private" });
  if (!result || result.statusCode !== 200) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(result.stream, {
    headers: {
      "content-type": result.blob.contentType ?? "image/webp",
      // Per-user cache only; never a shared/CDN cache, since this is private.
      "cache-control": "private, max-age=3600",
    },
  });
}
