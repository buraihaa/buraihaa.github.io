/**
 * Client-upload token endpoint for Momente photos.
 *
 * The browser uploads the original file straight to Vercel Blob (which bypasses
 * the 4.5 MB serverless body cap that phone photos routinely exceed). Before
 * handing out an upload token this route auth-gates the request and constrains
 * what may be uploaded (content types + max size). The uploaded original is then
 * normalized server-side by the `attachImage` action (EXIF strip, HEIC → WebP,
 * downscale) — see momente/actions.ts. We deliberately do NOT set an
 * `onUploadCompleted` handler: it would make the client `upload()` wait on a
 * completion callback, which can't be reached on a localhost dev server (and
 * we don't need it — `attachImage` does the post-processing explicitly).
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "@/auth";

// iPhones shoot HEIC; browsers can also hand us JPEG/PNG/WebP. Everything is
// converted to WebP after upload, so this list is only the accepted *inputs*.
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

// Cap the *original* upload generously — HEIC/large JPEGs off a phone can be
// several MB before we downscale them to WebP.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Auth-gate the token itself — never trust the client. Only the two
        // accounts may upload, and the caps below are enforced by Blob.
        const session = await auth();
        const user = session?.user?.name;
        if (user !== "chris" && user !== "jiamin") {
          throw new Error("Not authenticated");
        }
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ user }),
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
