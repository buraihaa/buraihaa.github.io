"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { signOutAction } from "@/app/sign-in/actions";
import { cn } from "@/lib/utils";

function titleCase(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const TABS = [
  { href: "/", label: "Home" },
  { href: "/chat", label: "Chat" },
  { href: "/momente", label: "Momente" },
  { href: "/orte", label: "Orte" },
  { href: "/how-it-started", label: "How It Started" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Navbar({ currentUser }: { currentUser: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on navigation. Done during render (React's
  // recommended "reset state when a value changes" pattern) rather than in an
  // effect, so there's no cascading re-render.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Close the mobile menu on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-canvas/80 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <Link
          href="/"
          className="shrink-0 text-display font-bold tracking-tight text-brand"
        >
          mochidonut
        </Link>

        {/* Desktop tabs */}
        <ul className="hidden min-w-0 flex-1 items-center gap-1 md:flex">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <li key={tab.href} className="shrink-0">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3 text-[0.8rem] font-medium transition-colors",
                    active
                      ? "bg-accent text-ink"
                      : "text-ink-slate hover:bg-accent/60 hover:text-ink",
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Desktop auth control */}
        {currentUser ? (
          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <span className="text-[0.8rem] font-medium text-ink-slate">
              {titleCase(currentUser)}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-medium text-ink-slate transition-colors hover:bg-accent/60 hover:text-ink"
              >
                <LogOut className="size-3.5" />
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/sign-in"
            className={cn(
              buttonVariants(),
              "hidden h-8 shrink-0 rounded-full px-4 md:inline-flex",
            )}
          >
            Sign in
          </Link>
        )}

        {/* Mobile toggle — pushes to the right, 44px touch target */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto grid size-11 place-items-center rounded-full text-ink-slate hover:bg-accent/60 md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-14 z-40 bg-black/20 md:hidden"
          />
          <div
            id="mobile-menu"
            className="relative z-50 border-t border-hairline bg-canvas px-4 py-3 md:hidden"
          >
            <ul className="flex flex-col gap-1">
              {TABS.map((tab) => {
                const active = isActive(pathname, tab.href);
                return (
                  <li key={tab.href}>
                    <Link
                      href={tab.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-11 items-center rounded-xl px-3 text-[15px] font-medium transition-colors",
                        active
                          ? "bg-accent text-ink"
                          : "text-ink-slate hover:bg-accent/60 hover:text-ink",
                      )}
                    >
                      {tab.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {currentUser ? (
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-hairline pt-3">
                <span className="text-[15px] font-medium text-ink-slate">
                  Signed in as {titleCase(currentUser)}
                </span>
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-ink-slate transition-colors hover:bg-accent/60 hover:text-ink"
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <Link
                href="/sign-in"
                className={cn(
                  buttonVariants(),
                  "mt-2 h-11 w-full rounded-full text-[15px]",
                )}
              >
                Sign in
              </Link>
            )}
          </div>
        </>
      )}
    </header>
  );
}
