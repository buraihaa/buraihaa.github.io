import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "./auth.config";
import { isAllowedUser, storedHashFor, verifyPassword } from "@/lib/auth-helpers";

/**
 * The full Auth.js instance (Node runtime). Extends the edge-safe base config
 * with the Credentials provider, whose `authorize` runs scrypt to check a
 * password against the env-stored hash for one of the two allowed accounts.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const username = String(credentials?.username ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");

        if (!isAllowedUser(username)) return null;
        const ok = await verifyPassword(password, storedHashFor(username));
        if (!ok) return null;

        return { id: username, name: username };
      },
    }),
  ],
});
