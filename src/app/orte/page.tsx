import { redirect } from "next/navigation";

import { auth } from "@/auth";
import type { UserNameValue } from "@/db/schema";
import { OrteClient } from "./orte-client";

// Auth-gated (middleware already redirects), but we resolve the session here to
// stamp the current user onto pins they create. When Neon is live this is also
// where the initial `orte` rows get loaded and passed into the client.
export default async function OrtePage() {
  const session = await auth();
  const user = session?.user?.name as UserNameValue | undefined;
  if (!user) redirect("/sign-in?callbackUrl=/orte");

  return <OrteClient currentUser={user} />;
}
