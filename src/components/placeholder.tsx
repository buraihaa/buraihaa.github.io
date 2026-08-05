import type { LucideIcon } from "lucide-react";

export function Placeholder({
  icon: Icon,
  title,
  blurb,
}: {
  icon: LucideIcon;
  title: string;
  blurb: string;
}) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col items-center px-4 py-24 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent text-brand">
        <Icon className="size-7" />
      </span>
      <h1 className="mt-5 text-hero font-semibold text-ink">{title}</h1>
      <p className="mt-3 max-w-md text-[15px] leading-6 text-ink-slate">{blurb}</p>
      <span className="mt-6 rounded-full border border-hairline px-3 py-1 text-caption font-medium text-ink-steel">
        coming soon
      </span>
    </main>
  );
}
