import type { LucideIcon } from "lucide-react";
import { Bomb, ExternalLink, HelpCircle, Heart } from "lucide-react";

type Capsule = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  description: string;
  href: string;
};

// The three original pages, preserved verbatim under /public/archive and opened
// in a new tab (they keep their own full-page styling and have no nav back).
const CAPSULES: Capsule[] = [
  {
    icon: HelpCircle,
    title: "Ask Jiamin",
    subtitle: "Hardest Test Ever",
    description:
      "Chris asking Jiamin for first date. Scary!!",
    href: "/archive/html/ask-jiamin.html",
  },
  {
    icon: Heart,
    title: "First Date",
    subtitle: "3/31/24",
    description:
      "Verve Coffee, shooting film, Little Tokyo, and Ramen!",
    href: "/archive/html/first-date.html",
  },
  {
    icon: Bomb,
    title: "ゲーム",
    subtitle: "マインスイーパー",
    description:
      "For you to play when you're bored!",
    href: "/archive/html/game.html",
  },
];

export default function HowItStartedPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12 md:py-16">
      <header className="max-w-2xl">
        <h1 className="mt-3 text-hero font-semibold text-ink">How It Started</h1>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPSULES.map((capsule) => {
          const Icon = capsule.icon;
          return (
            <a
              key={capsule.href}
              href={capsule.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col rounded-2xl border border-hairline bg-canvas p-5 transition-colors hover:border-brand/40 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between">
                <span className="grid size-11 place-items-center rounded-full bg-accent text-brand">
                  <Icon className="size-5" />
                </span>
                <ExternalLink className="size-4 text-ink-mute transition-colors group-hover:text-brand" />
              </div>
              <h2 className="mt-4 text-subhead font-semibold text-ink">
                {capsule.title}
              </h2>
              <p className="text-caption text-ink-steel">{capsule.subtitle}</p>
              <p className="mt-2 text-[14px] leading-6 text-ink-slate">
                {capsule.description}
              </p>
            </a>
          );
        })}
      </div>
    </main>
  );
}
