# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A private, two-person personal site — a scrapbook/gift site for Chris and Jiamin, served at `www.mochidonut.net`. This repo is a **from-scratch rewrite** of an older vanilla static site into a dynamic React app. Everything below describes the rewrite; the old static site is not here — it is archived on the `ver-jul-29-2026` branch (see **Git & deployment**).

The whole site is gated behind a fixed two-account login (`chris`, `jiamin`) except the public Home page. There is no signup and no third user — the two names are baked into both the auth allowlist and the database as an enum, on purpose.

## Stack

- **Next.js 16** (App Router) + **React 19**, **TypeScript**, **pnpm**
- **Tailwind CSS v4** + **shadcn/ui** — note: the installed style is **base-nova on `@base-ui/react`**, not the classic Radix build. The `Button` primitive takes a `render` prop, **not** `asChild`. For a link styled as a button, apply `buttonVariants({ ... })` to the `<Link>`'s `className` rather than wrapping.
- **Neon Postgres** (serverless HTTP driver) + **Drizzle ORM** — this is what makes the site dynamic
- **Auth.js v5** (`next-auth@5.0.0-beta.32`), Credentials provider, JWT sessions
- **next/font** (Inter, self-hosted) + Google Fonts `<link>` for Noto Sans JP/SC
- **MapLibre GL JS** for the Orte map — an open, token-free Mapbox-GL fork, using a free keyless **CARTO raster** basemap (no account, no API key). Raster (not vector) on purpose: MapLibre's vector-tile web worker does not initialize under Next's Turbopack bundler, so vector styles silently never load; raster tiles are main-thread images and just work. Orte's place **search** uses **Nominatim** (OpenStreetMap's official geocoder — keyless + CORS), which resolves both POIs and specific street addresses; debounced to respect its ~1 req/sec policy.
- Planned but not yet wired: **Vercel Blob** (client upload) + **Sharp** (EXIF strip, HEIC→WebP) for Momente image uploads; **Upstash** rate limiting on login. Env keys for these are stubbed in `.env.example`.

## Commands

```sh
pnpm dev            # dev server → http://localhost:3000
pnpm build          # production build
pnpm start          # serve the production build
pnpm lint           # eslint

pnpm db:generate    # generate a migration from schema.ts
pnpm db:migrate     # apply migrations to DATABASE_URL
pnpm db:push        # push schema directly (dev convenience)
pnpm db:studio      # drizzle studio

pnpm auth:hash "somepassword"   # print a scrypt hash for an AUTH_*_HASH env var
```

There **is** a build step and a package manager now (unlike the old static site). There is still no test suite and no CI — do not add one without being asked.

`sharp`, `unrs-resolver`, and `esbuild` are listed under `allowBuilds` in `pnpm-workspace.yaml` (pnpm blocks build scripts by default; these need them — sharp for image processing, esbuild for drizzle-kit).

## Environment

Local secrets live in `.env.local` (gitignored). `.env.example` is committed (via a `!.env.example` negation in `.gitignore`) and lists every variable: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_CHRIS_HASH`, `AUTH_JIAMIN_HASH`, `BLOB_READ_WRITE_TOKEN` (the Vercel Blob SDK's default name), and the Upstash pair. (The Orte map needs no key — MapLibre + CARTO raster tiles are keyless.) The **Vercel Blob store is provisioned and set to PRIVATE access** — Momente's photo code depends on that (private `put`/`get`; a public `put` throws "Cannot use public access on a private store"). Don't switch the code to `access: "public"` without also switching the store.

**Dev auth is seeded:** both accounts' password is currently `mochi` (scrypt hashes already in `.env.local`). These are placeholders — regenerate real hashes with `pnpm auth:hash` before any deploy.

## Architecture

Standard Next.js App Router under `src/`, with the `@/*` path alias mapping to `src/`.

```
src/
  app/
    layout.tsx                    root layout — awaits auth(), fonts, Navbar
    globals.css                   Tailwind v4 @theme + DESIGN.md tokens
    page.tsx                      Home (public)
    sign-in/{page,sign-in-form,actions}.tsx
    chat/{page,chat-client,actions,queries}.tsx   Chat — 1:1 thread (built)
    momente/{page,momente-client,actions,queries}.tsx   Momente — posts + comments + private photo uploads + status box (built)
    orte/{page,orte-client,store,actions,queries}.tsx   Orte — MapLibre map + checklist (built, on Neon)
    how-it-started/page.tsx       real page — cards linking to archived pages
    api/auth/[...nextauth]/route.ts
    api/momente/upload/route.ts   Blob client-upload token (auth-gated)
    api/momente/image/[id]/route.ts   auth-gated proxy that streams a private blob
  auth.config.ts                  Edge-safe Auth.js config (no node:crypto)
  auth.ts                         adds Credentials provider (Node runtime only)
  proxy.ts                        route gating via authConfig (Next 16 proxy convention, formerly middleware.ts)
  lib/auth-helpers.ts             scrypt hash/verify (node:crypto)
  lib/utils.ts                    cn()
  components/navbar.tsx           5-tab responsive sticky nav
  components/ui/button.tsx        shadcn button (base-ui)
  db/
    schema.ts                     all tables + enums + inferred types
    index.ts                      db client (throws if DATABASE_URL unset)
    queries.ts                    cross-cutting query helpers only
  types/next-auth.d.ts            augments session/JWT with username
drizzle/                          generated migrations + meta
public/archive/                   the 3 preserved old pages (see below)
```

### Auth is split (auth.config.ts vs auth.ts)

This is the single most important structural rule. Auth is deliberately split into a lean, provider-less base and a Node-only extension:

- **`auth.config.ts`** — the lean base: Pages, `session.strategy: "jwt"`, the `authorized` route-gate callback, and the jwt/session username plumbing. `providers: []`, no `node:crypto`. This is what `proxy.ts` imports.
- **`auth.ts`** — imports `authConfig` and adds the **Credentials** provider, whose `authorize` calls scrypt in `lib/auth-helpers.ts`. Node runtime only (route handler + server actions). Exports `auth`, `handlers`, `signIn`, `signOut`.

Do **not** import `auth.ts` (or anything pulling in `node:crypto` / the Credentials provider) from `proxy.ts` — keep the gate lean. Historically this split was *required* because the old `middleware.ts` ran on the **Edge runtime** (no `node:crypto`). Under Next 16 the route gate is **`proxy.ts`, which runs on the Node runtime**, so Edge-safety no longer forces the split — but we keep it so the gate doesn't drag scrypt/Credentials into every request. (`proxy.ts` = the Next 16 rename of `middleware.ts`; same default-export Auth.js handler + `config.matcher`.)

**Route access model:** `PUBLIC_PATHS` in `auth.config.ts` = `/` and `/sign-in`. Every other route redirects unauthenticated users to `/sign-in`. The proxy `matcher` excludes `api/auth`, `_next`, and any path with a dot in the last segment — which means **files under `public/` (including the archived pages) are publicly reachable by direct URL**; that's accepted.

### Database layer

- **No `users` table.** A `userName` pgEnum `['chris','jiamin']` is the author/actor column on every table, mirroring the auth allowlist. Keep it that way — the two-person assumption is load-bearing.
- **`db/index.ts` throws if `DATABASE_URL` is unset**, so only import `db` from code that runs on a request (dynamic routes / server actions), never at module top-level of a statically-prerendered page.
- **`db/queries.ts` holds only cross-cutting helpers** (activity feed, status expiry). Feature-specific CRUD (posts, comments, messages, orte) should live with each feature, not be dumped here.
- Uses the Neon **HTTP** driver (`neon-http`), which works in both Node and Edge with no connection pool.

Tables: `activity`, `messages`, `statuses`, `posts`, `postImages`, `comments`, `orte`. Two design rules encoded in the schema:

- **`activity` records the action only, never the content** ("Chris posted a Moment", not the text) — because the Home feed is public. Every feature that produces activity calls `recordActivity(actor, action)` from the same server action that does the write.
- **`statuses` expire on read, not by cron.** Store `expiresAt`; `getLiveStatus`/`getLiveStatuses` filter on `gt(expiresAt, now())`. Don't add a scheduled job.

Import row types (`Post`, `NewPost`, etc.) from `db/schema.ts` rather than re-deriving shapes.

### The 5-tab site

Nav lives in `components/navbar.tsx` (one component, not duplicated). Tabs:

- **Home** (`/`) — **public**. **Built.** Greeting + a live **activity feed** (`page.tsx` is a `force-dynamic` server component reading `getRecentActivity(30)` from Neon), newest-first, **actions only / no content** (public-safe) — each row maps its `activityAction` to an icon + verb ("posted a Moment", "sent a message", "pinned a place to visit", etc.), bold actor, server-computed relative time, empty state.
- **Chat** (`/chat`) — auth. **Built.** 1:1 iMessage-style thread. Optimistic send, 4s polling, Read/Delivered receipts, right-click / long-press to delete a message. Files under `src/app/chat/` (page/chat-client/actions/queries). Table: `messages`. (Renamed from "Message Board" — display + route + code; DB tables stay generic. The per-user **status box moved to Momente** — see below; Chat is a plain centered column now.)
- **Momente** (`/momente`) — auth. **Built.** A shared scrapbook feed: compose a Moment (text and/or photos), feed of post cards newest-first (each showing the author + absolute posted date/time), per-post comment threads with inline comment box. Optimistic create/edit/delete + 8s polling (same pattern as Chat); kebab menu (the `···`) to **edit** (inline textarea + a photo picker to **add more photos** to the existing Moment via the same private-Blob `attachImage` flow, respecting the 6-photo cap; Save/Cancel, keeps original `createdAt`) or **delete** a Moment, faint per-comment trash. Files under `src/app/momente/` (page/momente-client/actions/queries). Every content write pairs with `recordActivity(user, "posted"|"commented")`. Tables: `posts`, `postImages`, `comments`, `statuses`. **Per-user status box (moved here from Chat).** A **pinned** status card (`sticky top-14`, `z-30`) beside the feed — a left-gutter card at **≥1200px** (`min-[1200px]:` grid `[1fr | minmax(0,42rem) | 1fr]`, so the feed column stays at true screen center), collapsing to a **full-width top banner** below that; both stay visible as the feed scrolls. Each person's status either **fades on its own** (expiry computed server-side on read) or stays **indefinite**; only the signed-in user's chip is editable (pencil → one text field with inline emoji + a **duration slider** 30m→Indefinite, plus Remove/Cancel/Save). Statuses **ride along in the `Feed`** (fetched in `getFeed`, refreshed by the 8s poll, seeded server-side); `setMyStatus`/`clearMyStatus` return the fresh feed and `setMyStatus` pairs with `recordActivity(user, "set_status")`. **Photo uploads use a PRIVATE Vercel Blob store** (`@vercel/blob` + `sharp`): the browser client-uploads the original to Blob via an auth-gated token route (`api/momente/upload`), then `attachImage` reads it back with a private `get()`, normalizes with Sharp (**EXIF/GPS stripped** via `.rotate()`, **HEIC→WebP**, downscaled to 1600px, quality 82), stores the processed WebP (private), **deletes the original**, and records a `postImages` row keyed by the blob **pathname**. Because the store is private, images are **never reachable by URL** — the feed renders `<img src="/api/momente/image/<id>">`, an auth-gated proxy route that streams the blob via private `get()` (no signed-URL expiry to manage). Clicking a photo opens a **full-screen lightbox** (dimmed backdrop, closes on X / Escape / backdrop click). `getFeed` emits those proxy paths, never the blob pathname. `deletePost` deletes the blobs before the rows (cascade only removes rows, not blobs). Max 6 photos/post, 15 MB each.
- **Orte** (`/orte`) — auth. **Built.** Interactive MapLibre map (keyless CARTO raster basemap). Add a place by **searching** (Nominatim — POIs + street addresses; pick a result → map flies there and the new-pin form opens pre-filled) or by tapping the map. Places land in a **To See** checklist; check one off → it moves to **Visited**. Pins are colored per state (To See = green, Visited = a muted tone; both in the `COLOR_*` constants) and **each layer has its own show/hide toggle**, shown only when that layer has pins; clicking a row flies the map to it. **Persists to Neon:** `orte/store.ts`'s `useOrteStore` fetches on mount and its add/toggle/remove call the `orte` server actions (`actions.ts` + `queries.ts`) — optimistic, then reconcile with the fresh list each action returns. Adding a pin records `recordActivity(user, "pinned_ort")` (surfaces on Home). The hook's return shape is unchanged so `orte-client.tsx` + `page.tsx` were untouched; the serial int id is exposed as a string for the marker map. No live polling (the map rebuilds markers on list change, so pins refresh on page open, not real-time). Table: `orte`.
- **How It Started** (`/how-it-started`) — auth. Cards linking out to the three preserved old pages.

Momente, Chat, and Orte are all built (see above), including Momente's private photo uploads.

### Preserved old pages (`public/archive/`)

The three original interactive pages are kept **verbatim as time capsules** — Ask Jiamin, First Date, and ゲーム (Minesweeper). They keep their original Bootstrap/jQuery/GIF/neon HTML/CSS/JS and their own full-page styling. Recovered from `ver-jul-29-2026` into `public/archive/` with original relative paths intact (pages at `public/archive/html/<name>.html` so their `../css`, `../js`, `../img`, `../gifs`, etc. resolve). Their old navbars were stripped (they linked to dead pages); nothing else was changed.

`how-it-started/page.tsx` links to them with plain `<a target="_blank">` — they open in a new tab and have no nav back, by design. **Do not refactor these pages into React.** If you need to touch one, edit the static file in place and preserve its tone/encoding (mixed EN/JP/ZH/RU, kaomoji, Japanese titles).

## Design system

The whole site follows `/DESIGN.md` — a Bluesky-derived, full-restraint aesthetic. Read it before doing UI work. Key rules, already wired into `globals.css`:

- **Ink ladder on white:** `text-ink` (#0f172a, softened near-black) → `text-ink-slate` (#405168) → `text-ink-steel` (#667b99) → `text-ink-mute` (#8798b0), on `bg-page` (#f9fafb) / `bg-canvas` (#fff).
- **One saturated color:** `brand` / `--primary` = Bluesky Blue `#006aff`, used sparingly (primary CTA, focus ring, links). `sky-tint` (#c0dcf0) is wordmark/soft-accent only — never a button fill. Don't introduce a second saturated color.
- **Rounded, not square:** `--radius` 0.875rem (14px); cards ~12–14px, modals ~21px; interactive buttons go to full pill. No drop shadows on modals (depth comes from surface/scrim contrast).
- **Type scale** exposed as Tailwind utilities: `text-hero` (30px), `text-display` (24px), `text-subhead` (~20.6px), plus `text-caption`/`text-micro`. One typeface family, weight does the register work.
- **Fonts:** Inter (Latin + Cyrillic, self-hosted via next/font) chained with **Noto Sans JP + SC** (CJK + kaomoji, loaded via a `<link>` in `layout.tsx`). This multilingual chain is the hard typography constraint — copy mixes EN/JP/ZH/RU + kaomoji and no single font covers all of it. The `<link>` triggers a `@next/next/no-page-custom-font` lint **warning** that is deliberate; leave it.
- **Light mode only.** A `.dark` block exists in `globals.css` but is inert — nothing sets the `.dark` class. Don't build dark-mode UI.

## Conventions

- **Mobile-first is a standing requirement.** Every page and component must work on a phone: stack cleanly below `md`, touch targets ≥44px, no horizontal page scroll. The navbar is the reference pattern — full 5-tab row on `md+`, hamburger + full-width menu below. Apply the same to every feature you build.
- **Two deliberate mobile-viewport mechanisms — don't remove them:** (1) `globals.css` forces `input/textarea/select` to `16px` on `@media (pointer: coarse)` (with `!important`, overriding per-field `text-[15px]`/`[14px]`). This is what stops iOS Safari/WebKit from auto-zooming on focus — keep every mobile form control ≥16px. (2) `layout.tsx` exports `viewport.interactiveWidget = "resizes-content"` (Android keyboard). iOS WebKit ignores that hint, so Chat's fixed composer additionally uses a `window.visualViewport` handler in `chat-client.tsx` that sizes the fixed pane to the visible area **and locks document scroll** (`scrollTo(0,0)` + `documentElement` overflow hidden) so the keyboard can't shove the pane off the top. If you touch Chat's `fixed` layout, preserve that handler. iOS keyboard behavior can't be reproduced in desktop browsers — it needs on-device testing.
- Preserve the multilingual tone/encoding of existing copy (EN/JP/ZH/RU + kaomoji + emoji) rather than normalizing to English.
- Server actions live next to their route (e.g. `sign-in/actions.ts`), marked `"use server"`, and are the write path; pair every feature write with a `recordActivity` call.
- Comments here are explanatory and describe *why* (see `schema.ts`, `auth.config.ts`); match that register.

## Git & deployment

- **`main`** is the rewrite (orphan branch, **no shared history** with the old site). As of the 2026-08-01 cutover it is **pushed and IS `origin/main`** — the rewrite is the live remote codebase.
- **`ver-jul-29-2026`** archives the full old static site (all history + media) and is now **pushed to the remote too** (`origin/ver-jul-29-2026`) as the backup taken before the cutover. Recover old assets with `git checkout ver-jul-29-2026 -- <path>`.
- **Pushing to this repo requires the `buraihaa` GitHub account.** Two accounts are authed in `gh`: `christopherbui` (the git `user.name`, but only *pull* access → push is denied 403) and **`buraihaa`** (the repo owner, admin/push). Run **`gh auth switch --user buraihaa`** before any push (git uses gh's credential helper, keyed to the active account).
- **Hosting is Vercel** — linked as project `mochidonut` (scope `base-1762`), live at **`mochidonut.vercel.app`**. Deploy with `vercel --prod` (the CLI uploads the local working tree; a git push is *not* what deploys). `vercel` isn't on the default shell PATH — it's the pnpm global install at `~/Library/pnpm/bin`.
- **GitHub Pages can't be disabled** here (a `<username>.github.io` *user* Pages repo; the API returns 422). The cutover removed the old `CNAME`, so Pages no longer holds `www.mochidonut.net` (detached — no conflict for the DNS move). `buraihaa.github.io` now serves broken/empty Next source; left as-is on purpose.
- **NOTE:** GitHub Pages does NOT serve this app — it's a dynamic Next.js SSR app with a database and can only run on Vercel. The old "force-push to publish via Pages" idea is obsolete.

## Current status / not yet done

- **Fully shipped & live on the custom domain (2026-08-01).** The rewrite is `origin/main`, deploys to Vercel (project `mochidonut`, scope `base-1762`), and serves **`www.mochidonut.net`** (canonical, HTTP 200) with the **`mochidonut.net`** apex `308 → www`. Every feature verified in production against live Neon + Blob. Real password hashes are set locally + on Vercel. The custom domain is no longer dark — the DNS cutover is done.
- **Upstash login rate-limit still not wired** (env keys stubbed; no code reads them — safe to leave empty; optional hardening) — the only optional leftover.
- **Neon** provisioned (Vercel Marketplace) + migrated; **Vercel Blob** provisioned + wired (private store; Momente uploads + Sharp normalization).
- **Sharp on Vercel:** loading sharp on the linux-x64 runtime needs both `supportedArchitectures` (linux/x64) in `pnpm-workspace.yaml` (so the lockfile carries the Linux binaries) **and** `serverExternalPackages:["sharp"]` + `outputFileTracingIncludes` pointing at each `@img/sharp-*-linux-x64` package's `lib/**` in `next.config.ts` (Next's tracer misses the separate libvips optional dep under pnpm; include only `lib/`, never the whole dir — that pulls symlinks Vercel rejects).

Done and verified: scaffold, design tokens, fonts, responsive navbar, full auth (end-to-end), full Drizzle schema + cross-cutting queries + migrations, the live Home activity feed, Chat, Orte (on Neon), Momente (posts + comments + private photo uploads), and the How It Started page + archived pages. Every feature UI is built and verified in production; the DNS move is complete and the site is live on `www.mochidonut.net`. Only the optional Upstash rate-limit remains.
