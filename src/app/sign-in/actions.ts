"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";

/**
 * Server action for the sign-in form. Returns an error string on failure;
 * on success, `signIn` throws a redirect (to `/`) which must propagate.
 */
export async function authenticate(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "That username and password don't match.";
    }
    // Redirects surface as thrown errors here — let them through.
    throw error;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
