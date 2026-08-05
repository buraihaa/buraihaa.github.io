import NextAuth from "next-auth";

import { authConfig } from "./auth.config";

// Next.js 16 "proxy" convention (formerly `middleware.ts`). Runs on every
// non-public route (see matcher) and applies the `authorized` callback from
// authConfig to gate them — verifying the JWT session and redirecting signed-
// out users to /sign-in. This is a redirect gate / defense-in-depth only; real
// enforcement is `requireUser()` in each server action + query.
//
// It still imports the *provider-less, node:crypto-free* authConfig (never
// auth.ts). Proxy runs on the Node runtime rather than the Edge, so that split
// is no longer strictly required to boot — but keeping authConfig lean here
// avoids pulling the scrypt/Credentials code (and its cost) into the gate.
export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except Next internals, the auth API, and static files
  // (anything with a dot in the last path segment).
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
