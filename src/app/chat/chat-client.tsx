"use client";

/**
 * The Chat: a 1:1 iMessage-style thread between the two accounts. (The
 * per-person status box that used to sit alongside the thread now lives on
 * Momente.)
 *
 * Layout: a single centered column. The composer floats as a rounded, elevated
 * card above the bottom edge.
 *
 * Data flow: the page seeds `initialMessages`; from there the client owns a
 * single thread that every write action returns fresh, and a light poll keeps
 * the other person's messages arriving. Sends are optimistic — the bubble
 * appears immediately with a temp id, then the server's canonical thread
 * replaces it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Trash2 } from "lucide-react";

import type { UserNameValue } from "@/db/schema";
import { cn } from "@/lib/utils";
import {
  deleteMessage,
  loadThread,
  markThreadRead,
  sendMessage,
} from "./actions";
import type { Thread, ThreadMessage } from "./queries";

const POLL_MS = 4000;

export function ChatClient({
  currentUser,
  initialMessages,
}: {
  currentUser: UserNameValue;
  initialMessages: ThreadMessage[];
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const mainRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Keep the newest optimistic temp-id so the poll doesn't clobber an in-flight
  // send with an older server snapshot.
  const tempIdRef = useRef(-1);

  const applyThread = useCallback((t: Thread) => {
    setMessages(t.messages);
  }, []);

  // ── Poll for the other person's messages ─────────────────────────────────
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const t = await loadThread();
        if (!alive) return;
        setMessages((prev) => mergeOptimistic(t.messages, prev));
      } catch {
        // Transient network/auth hiccup — the next tick retries.
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ── Mark the partner's messages read on mount ────────────────────────────
  useEffect(() => {
    markThreadRead().catch(() => {});
  }, []);

  // ── Keep pinned to the newest message ────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // ── Keep the fixed chat pane above the on-screen keyboard ─────────────────
  // The `interactive-widget=resizes-content` viewport hint fixes Android
  // (Gecko/Blink), but iOS WebKit — which every iOS browser is, incl. Firefox
  // and Chrome for iOS — ignores it. On iOS the layout viewport stays full
  // height when the keyboard opens, and WebKit *scrolls the whole document* to
  // pull the focused composer into view, dragging our `position: fixed` pane up
  // off the top and stranding the thread above the screen with a gap below.
  //
  // Fixing this takes two moves, not one: (1) size the pane to the *visual*
  // viewport (the real visible area above the keyboard) so the composer lands
  // right above the keys, and (2) actively defeat WebKit's document scroll —
  // hold the root scroller at 0 and lock its overflow — because sizing alone
  // doesn't stop WebKit from pushing the fixed layer. We detect the keyboard via
  // the layout viewport (`documentElement.clientHeight`, which stays full on iOS)
  // minus the shrinking visual-viewport height. Everything reverts on close, so
  // the `top-14 bottom-0` classes resume. Only runs where `visualViewport`
  // exists (mobile WebKit + modern Android); desktop is untouched.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = mainRef.current;
    if (!vv || !el) return;

    const docEl = document.documentElement;
    let locked = false;

    const pinTop = () => {
      // Snap the root scroller back to the top so the fixed pane can't ride up.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    const sync = () => {
      // Layout viewport (stable on iOS) minus visible height ≈ keyboard inset.
      const keyboardOpen = docEl.clientHeight - vv.height > 100;
      if (keyboardOpen) {
        pinTop();
        el.style.top = "0px";
        el.style.height = `${vv.height}px`;
        if (!locked) {
          docEl.style.overflow = "hidden";
          locked = true;
          // Keep the newest message visible now that the pane is shorter.
          bottomRef.current?.scrollIntoView({ block: "end" });
        }
      } else if (locked || el.style.height) {
        el.style.top = "";
        el.style.height = "";
        docEl.style.overflow = "";
        locked = false;
      }
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    // WebKit fires window scroll as it chases the input — snap straight back.
    window.addEventListener("scroll", pinTop);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("scroll", pinTop);
      el.style.top = "";
      el.style.height = "";
      docEl.style.overflow = "";
    };
  }, []);

  const handleSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text || sending) return;

      const tempId = tempIdRef.current--;
      const optimistic: ThreadMessage = {
        id: tempId,
        sender: currentUser,
        body: text,
        createdAt: new Date().toISOString(),
        readAt: null,
      };
      setMessages((prev) => [...prev, optimistic]);
      setDraft("");
      setSending(true);
      try {
        const t = await sendMessage(text);
        if (t) applyThread(t);
      } catch {
        // Roll the optimistic bubble back out if the send failed.
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDraft(text);
      } finally {
        setSending(false);
      }
    },
    [draft, sending, currentUser, applyThread],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      // Optimistically drop the bubble, then reconcile with the server thread.
      setMessages((prev) => prev.filter((m) => m.id !== id));
      try {
        applyThread(await deleteMessage(id));
      } catch {
        // Restore on failure by re-reading.
        try {
          applyThread(await loadThread());
        } catch {
          // Leave the optimistic state; the next poll will reconcile.
        }
      }
    },
    [applyThread],
  );

  return (
    <main ref={mainRef} className="fixed inset-x-0 top-14 bottom-0 bg-page">
      <div className="flex h-full w-full flex-col">
        {/* Chat column — its inner max-w-2xl stays centered at every width. */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
          <div className="flex min-h-0 w-full max-w-2xl flex-1 flex-col">
            <div
              ref={scrollerRef}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
            >
            {messages.length === 0 ? (
              <div className="grid h-full place-items-center px-6 text-center">
                <p className="text-[14px] text-ink-steel">
                  No messages yet. Say something{" "}
                  <span className="text-ink-mute">(◕‿◕)</span>
                </p>
              </div>
            ) : (
              <MessageList
                messages={messages}
                currentUser={currentUser}
                onDelete={handleDelete}
              />
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer — an elevated, rounded card floating above the bottom */}
          <div className="shrink-0 px-3 pt-2 pb-8 md:px-4">
            <form
              onSubmit={handleSend}
              className="flex items-end gap-2 rounded-3xl border border-hairline bg-canvas p-1.5 shadow-sm"
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter inserts a newline.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e);
                  }
                }}
                rows={1}
                placeholder="Message…"
                aria-label="Message"
                className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] leading-snug text-ink outline-none placeholder:text-ink-mute"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label="Send"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </form>
          </div>
          </div>
        </section>
      </div>
    </main>
  );
}

// Reconcile a fresh server thread with any optimistic (negative-id) bubbles the
// user just sent but that the poll snapshot predates: keep temp bubbles whose
// text isn't already present at the tail of the server list.
function mergeOptimistic(
  server: ThreadMessage[],
  prev: ThreadMessage[],
): ThreadMessage[] {
  const temps = prev.filter((m) => m.id < 0);
  if (temps.length === 0) return server;
  const serverTailBodies = new Set(server.slice(-10).map((m) => m.body));
  const stillPending = temps.filter((t) => !serverTailBodies.has(t.body));
  return [...server, ...stillPending];
}

const LONG_PRESS_MS = 450;

function MessageList({
  messages,
  currentUser,
  onDelete,
}: {
  messages: ThreadMessage[];
  currentUser: UserNameValue;
  onDelete: (id: number) => void;
}) {
  // Index of the last message I sent — the one that carries the read receipt.
  const lastMineIdx = messages.reduce(
    (acc, m, i) => (m.sender === currentUser ? i : acc),
    -1,
  );

  // Right-click (desktop) or long-press (mobile) opens a small menu at the
  // pointer to delete that message. `menu` holds the target id + clamped coords.
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(
    null,
  );
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const openMenu = useCallback((id: number, x: number, y: number) => {
    const MENU_W = 176;
    const MENU_H = 44;
    setMenu({
      id,
      x: Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8)),
    });
  }, []);

  const cancelPress = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  // Close the menu on Escape.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <div className="flex flex-col gap-1">
      {messages.map((m, i) => {
        const mine = m.sender === currentUser;
        const day = dayLabel(m.createdAt);
        // A day separator shows when this message falls on a different day than
        // the one before it (computed from the neighbor, not a running mutable).
        const prevDay = i > 0 ? dayLabel(messages[i - 1].createdAt) : null;
        const showDay = day !== prevDay;
        return (
          <div key={m.id}>
            {showDay && (
              <div className="my-3 text-center text-micro font-medium uppercase tracking-wide text-ink-mute">
                {day}
              </div>
            )}
            <div
              className={cn(
                "flex w-full",
                mine ? "justify-end" : "justify-start",
              )}
            >
              {/* items-end/start (not the default stretch) so the bubble wraps
                  its own text instead of widening to match the timestamp row
                  (which is longer on the latest message: "… · Delivered"). */}
              <div
                className={cn(
                  "flex max-w-[78%] flex-col",
                  mine ? "items-end" : "items-start",
                )}
              >
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(m.id, e.clientX, e.clientY);
                  }}
                  onTouchStart={(e) => {
                    const { clientX, clientY } = e.touches[0];
                    pressStart.current = { x: clientX, y: clientY };
                    cancelPress();
                    pressTimer.current = setTimeout(
                      () => openMenu(m.id, clientX, clientY),
                      LONG_PRESS_MS,
                    );
                  }}
                  onTouchMove={(e) => {
                    // A finger that moves is a scroll, not a press — cancel it.
                    const { clientX, clientY } = e.touches[0];
                    if (
                      pressStart.current &&
                      Math.hypot(
                        clientX - pressStart.current.x,
                        clientY - pressStart.current.y,
                      ) > 10
                    ) {
                      cancelPress();
                    }
                  }}
                  onTouchEnd={cancelPress}
                  onTouchCancel={cancelPress}
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-3xl px-4 py-2 text-[15px] leading-snug [-webkit-touch-callout:none]",
                    mine
                      ? "rounded-br-md bg-brand text-white"
                      : "rounded-bl-md bg-canvas text-ink",
                  )}
                >
                  {m.body}
                </div>
                <span
                  className={cn(
                    "mt-0.5 px-1 text-[12px] text-ink-mute",
                    mine ? "text-right" : "text-left",
                  )}
                >
                  {timeLabel(m.createdAt)}
                  {mine &&
                    i === lastMineIdx &&
                    m.id > 0 &&
                    (m.readAt ? " · Read" : " · Delivered")}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {menu && (
        <>
          {/* Full-screen backdrop: any outside click/right-click closes it. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-hairline bg-canvas shadow-md"
            style={{ top: menu.y, left: menu.x }}
          >
            <button
              type="button"
              onClick={() => {
                onDelete(menu.id);
                setMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="size-4" />
              Delete message
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
