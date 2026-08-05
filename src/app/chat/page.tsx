import { redirect } from "next/navigation";

import { auth } from "@/auth";
import type { UserNameValue } from "@/db/schema";
import { ChatClient } from "./chat-client";
import { getMessages } from "./queries";

// Auth-gated (middleware redirects too), but we resolve the session here to
// stamp the current user and to seed the thread server-side so the first paint
// already shows history. The client then polls for updates.
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await auth();
  const user = session?.user?.name as UserNameValue | undefined;
  if (!user) redirect("/sign-in?callbackUrl=/chat");

  const messages = await getMessages();

  return <ChatClient currentUser={user} initialMessages={messages} />;
}
