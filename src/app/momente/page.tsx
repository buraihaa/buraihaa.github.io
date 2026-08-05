import { redirect } from "next/navigation";

import { auth } from "@/auth";
import type { UserNameValue } from "@/db/schema";
import { MomenteClient } from "./momente-client";
import { getFeed } from "./queries";

// Auth-gated (middleware redirects too), but we resolve the session here to
// stamp the current user and to seed the feed server-side so the first paint
// already shows history. The client then polls for updates.
export const dynamic = "force-dynamic";

export default async function MomentePage() {
  const session = await auth();
  const user = session?.user?.name as UserNameValue | undefined;
  if (!user) redirect("/sign-in?callbackUrl=/momente");

  const feed = await getFeed();

  return <MomenteClient currentUser={user} initialFeed={feed} />;
}
