import {
  ImagePlus,
  MapPin,
  MessageCircle,
  MessageSquare,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { getRecentActivity } from "@/db/queries";
import type { ActivityActionValue, UserNameValue } from "@/db/schema";

// Home is public, and it reads the live activity feed, so it must render on each
// request (the feed table changes as Chris + Jiamin use the site).
export const dynamic = "force-dynamic";

const NAMES: Record<UserNameValue, string> = { chris: "Chris", jiamin: "Jiamin" };

// Each activity verb, rendered ACTIONS-ONLY (never the content) because this
// feed is shown publicly. One entry per value of the `activityAction` enum.
const ACTION_META: Record<
  ActivityActionValue,
  { icon: LucideIcon; verb: string }
> = {
  posted: { icon: ImagePlus, verb: "posted a Moment" },
  commented: { icon: MessageSquare, verb: "commented on a Moment" },
  sent_message: { icon: MessageCircle, verb: "sent a message" },
  set_status: { icon: UserRound, verb: "updated their status" },
  pinned_ort: { icon: MapPin, verb: "pinned a place to visit" },
};

export default async function Home() {
  const activity = await getRecentActivity(30);

  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-5 py-12 md:grid-cols-[1.4fr_1fr] md:px-4 md:py-20">
      {/* Greeting */}
      <section className="flex flex-col justify-center">
        <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-ink-steel">
          welcome · 欢迎 · ようこそ · xin chào · willkommen · добро пожаловать
        </p>
        <h1 className="mt-3 text-hero font-semibold text-ink">
          A little corner in cyber space.
        </h1>
        <p className="mt-4 max-w-lg text-pretty text-[15px] leading-6 text-ink-slate">
          Our personal scratchbook for chats, moments, travels, and more!
        </p>
      </section>

      {/* Activity panel */}
      <section className="min-w-0">
        <div className="flex h-[26rem] flex-col rounded-2xl border border-hairline bg-canvas">
          <header className="flex items-center border-b border-hairline px-4 py-3">
            <h2 className="text-[15px] font-semibold text-ink">Activity</h2>
          </header>

          {activity.length === 0 ? (
            <div className="grid flex-1 place-items-center px-6 text-center">
              <p className="text-[14px] text-ink-steel">
                Nothing here yet{" "}
                <span className="text-ink-mute">(｡•́‿•̀｡)</span>
              </p>
            </div>
          ) : (
            <ul className="flex-1 space-y-1 overflow-y-auto p-2">
              {activity.map((item) => {
                const meta = ACTION_META[item.action];
                const Icon = meta.icon;
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 hover:bg-accent/40"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-brand">
                      <Icon className="size-4" />
                    </span>
                    <p className="min-w-0 flex-1 text-[13.1px] leading-snug text-ink-slate">
                      <span className="font-semibold text-ink">
                        {NAMES[item.actor]}
                      </span>{" "}
                      {meta.verb}
                    </p>
                    <time
                      dateTime={item.createdAt.toISOString()}
                      className="shrink-0 text-caption text-ink-mute"
                    >
                      {relativeTime(item.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

// Compact relative time for the feed. Rendered server-side on each request
// (Home is force-dynamic), so it's fresh on load without any client JS.
function relativeTime(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
