import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config. Contains NO node:crypto and NO real provider logic,
 * so it can run in middleware (Edge runtime). The Credentials provider — whose
 * `authorize` uses scrypt — is added on top of this in auth.ts, which only ever
 * runs in the Node runtime (route handler + server actions).
 *
 * Route access is decided by the `authorized` callback below: Home and the
 * sign-in page are public; everything else requires a session.
 */
const PUBLIC_PATHS = new Set(["/", "/sign-in"]);

export const authConfig = {
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt" },
  // Real providers are supplied in auth.ts (Node runtime only).
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      if (PUBLIC_PATHS.has(nextUrl.pathname)) return true;
      // Returning false redirects unauthenticated users to `pages.signIn`.
      return isLoggedIn;
    },
    jwt({ token, user }) {
      // On sign-in, stamp the username onto the token so the session carries it.
      if (user?.name) token.username = user.name;
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.username === "string") {
        session.user.name = token.username;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
