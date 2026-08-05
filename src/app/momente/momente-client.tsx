"use client";

/**
 * Momente: a shared scrapbook feed for the two accounts. Each Moment is a short
 * post (optionally with photos) that either person can comment on.
 *
 * Layout: a single centered column that scrolls with the page — a compose card
 * pinned to the top, then post cards newest-first, each with its own comment
 * thread and inline comment box.
 *
 * Data flow mirrors Chat: the page seeds `initialFeed`; from there the client
 * owns one feed that every write action returns fresh, and a light poll keeps
 * the other person's posts + comments arriving. Text-only creates are optimistic
 * (`mergeFeed` preserves anything still in flight). Posts *with photos* aren't
 * optimistic — they need the real post id first: create the post, then upload
 * each original straight to Blob and call `attachImage`, which normalizes it
 * server-side (EXIF strip, HEIC → WebP, downscale) and returns the fresh feed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Send,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";

import type { UserNameValue } from "@/db/schema";
import { cn } from "@/lib/utils";
import {
  addComment,
  attachImage,
  clearMyStatus,
  createPost,
  deleteComment,
  deletePost,
  editPost,
  loadFeed,
  setMyStatus,
} from "./actions";
import type { Feed, FeedComment, FeedPost, LiveStatus } from "./queries";

const NAMES: Record<UserNameValue, string> = { chris: "Chris", jiamin: "Jiamin" };
const OTHER: Record<UserNameValue, UserNameValue> = {
  chris: "jiamin",
  jiamin: "chris",
};

// Status durations, ordered for the editor's slider: shortest on the left,
// Indefinite (`null` = no expiry) on the right. Indefinite is the default, so
// the slider starts at the last index — a status only fades if you drag left.
const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 360 },
  { label: "12 hours", minutes: 720 },
  { label: "1 day", minutes: 1440 },
  { label: "Indefinite", minutes: null },
];
const DEFAULT_DURATION_IDX = DURATIONS.length - 1; // Indefinite (rightmost)

const POLL_MS = 8000;

// Client-side upload limits (mirrored/enforced again on the token route + server).
const MAX_IMAGES = 6;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function MomenteClient({
  currentUser,
  initialFeed,
}: {
  currentUser: UserNameValue;
  initialFeed: Feed;
}) {
  const partner = OTHER[currentUser];

  const [posts, setPosts] = useState<FeedPost[]>(initialFeed.posts);
  const [statuses, setStatuses] = useState<LiveStatus[]>(initialFeed.statuses);
  const [draft, setDraft] = useState("");
  // Selected-but-not-yet-uploaded photos. We keep the object URL alongside each
  // File and create/revoke it in the add/remove handlers (not a render/effect),
  // which is both Strict-Mode safe and avoids setState-in-effect.
  const [selected, setSelected] = useState<{ file: File; url: string }[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The photo currently open in the full-screen viewer (its proxy URL), or null.
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Newest temp id for optimistic rows; decremented so ids stay unique+negative.
  const tempIdRef = useRef(-1);

  const myStatus = statuses.find((s) => s.user === currentUser) ?? null;
  const partnerStatus = statuses.find((s) => s.user === partner) ?? null;

  // Status writes return the whole feed; take the fresh statuses (a status
  // change doesn't touch posts, so those don't need re-merging here).
  const applyStatuses = useCallback(
    (f: Feed) => setStatuses(f.statuses),
    [],
  );

  // Revoke any outstanding preview URLs if the user navigates away mid-compose.
  // The ref is synced in a commit effect (writing a ref during render is
  // disallowed), and only the unmount cleanup reads it.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });
  useEffect(
    () => () => selectedRef.current.forEach((s) => URL.revokeObjectURL(s.url)),
    [],
  );

  // ── Poll for the other person's posts + comments ─────────────────────────
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const f = await loadFeed();
        if (!alive) return;
        setPosts((prev) => mergeFeed(f.posts, prev));
        setStatuses(f.statuses);
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

  const addFiles = useCallback((picked: FileList | null) => {
    if (!picked) return;
    setError(null);
    const images = Array.from(picked).filter((f) => f.type.startsWith("image/"));
    if (images.some((f) => f.size > MAX_FILE_BYTES)) {
      setError("Each photo must be under 15 MB.");
    }
    const ok = images.filter((f) => f.size <= MAX_FILE_BYTES);
    setSelected((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (ok.length > room) setError(`Up to ${MAX_IMAGES} photos per moment.`);
      const added = ok
        .slice(0, Math.max(0, room))
        .map((file) => ({ file, url: URL.createObjectURL(file) }));
      return [...prev, ...added];
    });
  }, []);

  const removeFile = useCallback((idx: number) => {
    setSelected((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // Upload each original to the private Blob store, then attach it to `postId`
  // (server normalizes + records). Used both for new posts with photos and for
  // adding photos while editing an existing post. Reconciles the feed as each
  // image lands; lets the caller handle any error.
  const uploadPhotos = useCallback(async (postId: number, files: File[]) => {
    for (const file of files) {
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/momente/upload",
        contentType: file.type || undefined,
      });
      const feed = await attachImage(postId, blob.pathname);
      setPosts((prev) => mergeFeed(feed.posts, prev));
    }
  }, []);

  const handlePost = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if ((!text && selected.length === 0) || posting) return;

      // ── Text only: optimistic, exactly like before ──────────────────────
      if (selected.length === 0) {
        const tempId = tempIdRef.current--;
        const optimistic: FeedPost = {
          id: tempId,
          author: currentUser,
          body: text,
          createdAt: new Date().toISOString(),
          images: [],
          comments: [],
        };
        setPosts((prev) => [optimistic, ...prev]);
        setDraft("");
        setPosting(true);
        try {
          const r = await createPost(text);
          setPosts((prev) => mergeFeed(r.feed.posts, prev));
        } catch {
          setPosts((prev) => prev.filter((p) => p.id !== tempId));
          setDraft(text);
          setError("Couldn't post that — try again.");
        } finally {
          setPosting(false);
        }
        return;
      }

      // ── With photos: create the post, then upload + attach each file ─────
      const localFiles = selected.map((s) => s.file);
      selected.forEach((s) => URL.revokeObjectURL(s.url));
      setDraft("");
      setSelected([]);
      setPosting(true);
      setError(null);
      try {
        const created = await createPost(text);
        setPosts((prev) => mergeFeed(created.feed.posts, prev));
        await uploadPhotos(created.postId, localFiles);
      } catch {
        setError("Something went wrong adding a photo.");
        // Reconcile against the server so the post + any images that did land show.
        try {
          const f = await loadFeed();
          setPosts((prev) => mergeFeed(f.posts, prev));
        } catch {
          // Next poll will reconcile.
        }
      } finally {
        setPosting(false);
      }
    },
    [draft, selected, posting, currentUser, uploadPhotos],
  );

  const handleDeletePost = useCallback(async (id: number) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    try {
      const f = await deletePost(id);
      setPosts((prev) => mergeFeed(f.posts, prev));
    } catch {
      try {
        const f = await loadFeed();
        setPosts((prev) => mergeFeed(f.posts, prev));
      } catch {
        // Leave the optimistic state; the next poll will reconcile.
      }
    }
  }, []);

  const handleEditPost = useCallback(async (id: number, body: string) => {
    const text = body.trim();
    // Optimistically show the new text, then reconcile with the server.
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, body: text } : p)));
    try {
      const f = await editPost(id, text);
      setPosts((prev) => mergeFeed(f.posts, prev));
    } catch {
      // Restore on failure (e.g. blanking a text-only post) by re-reading.
      try {
        const f = await loadFeed();
        setPosts((prev) => mergeFeed(f.posts, prev));
      } catch {
        // Next poll will reconcile.
      }
    }
  }, []);

  const handleAddComment = useCallback(
    async (postId: number, body: string) => {
      const text = body.trim();
      if (!text) return;
      const tempId = tempIdRef.current--;
      const optimistic: FeedComment = {
        id: tempId,
        author: currentUser,
        body: text,
        createdAt: new Date().toISOString(),
      };
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, comments: [...p.comments, optimistic] }
            : p,
        ),
      );
      try {
        const f = await addComment(postId, text);
        if (f) setPosts((prev) => mergeFeed(f.posts, prev));
      } catch {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? { ...p, comments: p.comments.filter((c) => c.id !== tempId) }
              : p,
          ),
        );
      }
    },
    [currentUser],
  );

  const handleDeleteComment = useCallback(async (id: number) => {
    setPosts((prev) =>
      prev.map((p) => ({
        ...p,
        comments: p.comments.filter((c) => c.id !== id),
      })),
    );
    try {
      const f = await deleteComment(id);
      setPosts((prev) => mergeFeed(f.posts, prev));
    } catch {
      try {
        const f = await loadFeed();
        setPosts((prev) => mergeFeed(f.posts, prev));
      } catch {
        // Leave the optimistic state; the next poll will reconcile.
      }
    }
  }, []);

  return (
    <main className="min-h-[calc(100dvh-3.5rem)] bg-page">
      {/* Centered 3-column grid: [left gutter · feed · right gutter]. The two
          gutters are equal (1fr) so the feed column stays at true screen center,
          unchanged. The status card lives in the left gutter, aligned to its
          right edge so it sits right beside the feed rather than in the far
          corner. Below 1200px there isn't room for a side card, so it collapses
          to a top banner (flex-col). */}
      <div className="flex flex-col min-[1200px]:grid min-[1200px]:grid-cols-[1fr_minmax(0,42rem)_1fr]">
        <StatusPanel
          currentUser={currentUser}
          partner={partner}
          myStatus={myStatus}
          partnerStatus={partnerStatus}
          onChange={applyStatuses}
        />

        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          <header className="mb-5">
            <h1 className="text-display font-semibold text-ink">Momente</h1>
            <p className="mt-1 text-[14px] text-ink-steel">
              Unvergessliche Momente (๑˃ᴗ˂)ﻭ
            </p>
          </header>

          <Composer
            draft={draft}
            setDraft={setDraft}
            selected={selected}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            posting={posting}
            error={error}
            onSubmit={handlePost}
          />

          <div className="mt-6 flex flex-col gap-4">
            {posts.length === 0 ? (
              <div className="rounded-2xl border border-hairline bg-canvas px-6 py-12 text-center">
                <p className="text-[14px] text-ink-steel">
                  No moments yet. Post the first one{" "}
                  <span className="text-ink-mute">(◕‿◕)</span>
                </p>
              </div>
            ) : (
              posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={currentUser}
                  onEditPost={handleEditPost}
                  onAddPhotos={uploadPhotos}
                  onDeletePost={handleDeletePost}
                  onAddComment={handleAddComment}
                  onDeleteComment={handleDeleteComment}
                  onOpenImage={setLightbox}
                />
              ))
            )}
          </div>
        </div>

        {/* Right gutter — the empty 1fr that balances the left one. */}
        <div aria-hidden className="hidden min-[1200px]:block" />
      </div>

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </main>
  );
}

// Reconcile a fresh server feed with optimistic (negative-id) rows the user just
// created but that the server snapshot may predate. Keep temp posts whose body
// isn't already at the head of the server list, and within each surviving post
// keep temp comments whose body isn't already present server-side.
function mergeFeed(server: FeedPost[], prev: FeedPost[]): FeedPost[] {
  const prevById = new Map(prev.map((p) => [p.id, p]));

  // Carry forward temp comments that haven't shown up in the server post yet.
  const merged = server.map((sp) => {
    const pp = prevById.get(sp.id);
    if (!pp) return sp;
    const serverBodies = new Set(sp.comments.map((c) => c.body));
    const pendingComments = pp.comments.filter(
      (c) => c.id < 0 && !serverBodies.has(c.body),
    );
    return pendingComments.length
      ? { ...sp, comments: [...sp.comments, ...pendingComments] }
      : sp;
  });

  // Keep optimistic posts the server hasn't caught up to yet.
  const temps = prev.filter((p) => p.id < 0);
  if (temps.length === 0) return merged;
  const serverHeadBodies = new Set(server.slice(0, 10).map((p) => p.body));
  const stillPending = temps.filter((t) => !serverHeadBodies.has(t.body));
  return [...stillPending, ...merged];
}

function Composer({
  draft,
  setDraft,
  selected,
  onAddFiles,
  onRemoveFile,
  posting,
  error,
  onSubmit,
}: {
  draft: string;
  setDraft: (v: string) => void;
  selected: { file: File; url: string }[];
  onAddFiles: (picked: FileList | null) => void;
  onRemoveFile: (idx: number) => void;
  posting: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSubmit = (draft.trim().length > 0 || selected.length > 0) && !posting;

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-hairline bg-canvas p-3 shadow-sm"
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter posts; plain Enter keeps a newline (posts are prose).
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit(e);
          }
        }}
        rows={1}
        placeholder="Share a moment…"
        aria-label="New moment"
        className="min-h-[24px] w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-mute"
      />

      {selected.length > 0 && (
        <PreviewStrip selected={selected} onRemove={onRemoveFile} />
      )}

      {error && <p className="mt-2 px-2 text-caption text-destructive">{error}</p>}

      <div className="mt-1 flex items-center justify-between">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            onAddFiles(e.target.files);
            // Reset so re-picking the same file still fires onChange.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={posting || selected.length >= MAX_IMAGES}
          aria-label="Add photos"
          className="grid size-10 place-items-center rounded-full text-ink-steel transition-colors hover:bg-accent/60 hover:text-ink-slate disabled:opacity-40"
        >
          <ImagePlus className="size-5" />
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2 text-caption font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {posting ? <Loader2 className="size-4 animate-spin" /> : null}
          {posting && selected.length > 0 ? "Posting photos…" : "Post"}
        </button>
      </div>
    </form>
  );
}

// Thumbnails of the not-yet-uploaded photos, each removable before posting. The
// object URLs are owned by the parent (created/revoked in its add/remove
// handlers), so this is a pure render.
function PreviewStrip({
  selected,
  onRemove,
}: {
  selected: { file: File; url: string }[];
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 px-2">
      {selected.map(({ url }, i) => (
        <div key={url} className="relative size-20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="size-20 rounded-lg border border-hairline object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(i)}
            aria-label="Remove photo"
            className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-ink text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function PostCard({
  post,
  currentUser,
  onEditPost,
  onAddPhotos,
  onDeletePost,
  onAddComment,
  onDeleteComment,
  onOpenImage,
}: {
  post: FeedPost;
  currentUser: UserNameValue;
  onEditPost: (id: number, body: string) => void;
  onAddPhotos: (postId: number, files: File[]) => Promise<void>;
  onDeletePost: (id: number) => void;
  onAddComment: (postId: number, body: string) => void;
  onDeleteComment: (id: number) => void;
  onOpenImage: (url: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.body);
  // Newly-picked photos to add on save (with preview URLs, like the composer).
  const [editFiles, setEditFiles] = useState<{ file: File; url: string }[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const pending = post.id < 0; // optimistic post not yet confirmed by the server
  // How many more photos this post can take (existing + newly picked ≤ MAX).
  const photoRoom = MAX_IMAGES - post.images.length - editFiles.length;
  // Save is allowed as long as the Moment won't end up empty (no text, no photos).
  const canSaveEdit =
    editText.trim().length > 0 ||
    post.images.length > 0 ||
    editFiles.length > 0;

  function startEdit() {
    setEditText(post.body);
    setEditFiles([]);
    setEditError(null);
    setEditing(true);
    setMenuOpen(false);
  }

  function cancelEdit() {
    editFiles.forEach((f) => URL.revokeObjectURL(f.url));
    setEditFiles([]);
    setEditError(null);
    setEditing(false);
  }

  function addEditFiles(picked: FileList | null) {
    if (!picked) return;
    setEditError(null);
    const images = Array.from(picked).filter((f) => f.type.startsWith("image/"));
    if (images.some((f) => f.size > MAX_FILE_BYTES)) {
      setEditError("Each photo must be under 15 MB.");
    }
    const ok = images.filter((f) => f.size <= MAX_FILE_BYTES);
    setEditFiles((prev) => {
      const room = MAX_IMAGES - post.images.length - prev.length;
      if (ok.length > room) setEditError(`Up to ${MAX_IMAGES} photos per moment.`);
      const added = ok
        .slice(0, Math.max(0, room))
        .map((file) => ({ file, url: URL.createObjectURL(file) }));
      return [...prev, ...added];
    });
  }

  function removeEditFile(idx: number) {
    setEditFiles((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function saveEdit() {
    if (!canSaveEdit || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      if (editText.trim() !== post.body) onEditPost(post.id, editText);
      if (editFiles.length > 0) {
        await onAddPhotos(
          post.id,
          editFiles.map((f) => f.file),
        );
        editFiles.forEach((f) => URL.revokeObjectURL(f.url));
        setEditFiles([]);
      }
      setEditing(false);
    } catch {
      setEditError("Something went wrong adding a photo.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Close the kebab menu on Escape or an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <article className="rounded-2xl border border-hairline bg-canvas p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <Avatar user={post.author} mine={post.author === currentUser} />
        <div className="min-w-0 flex-1">
          {/* Name on the first line, the full posted date + time beneath it. */}
          <span className="block text-[14px] font-semibold text-ink">
            {NAMES[post.author]}
          </span>
          <span className="block text-caption text-ink-mute">
            {postedAt(post.createdAt)}
          </span>
        </div>

        {/* Kebab → edit / delete. Either account can edit or delete any Moment. */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={pending}
            aria-label="Moment options"
            className="-mr-1 -mt-1 grid size-9 place-items-center rounded-full text-ink-mute transition-colors hover:bg-accent/60 hover:text-ink-slate disabled:opacity-30"
          >
            <MoreHorizontal className="size-5" />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-1 min-w-44 overflow-hidden rounded-xl border border-hairline bg-canvas shadow-md">
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] font-medium text-ink-slate transition-colors hover:bg-accent/60"
                >
                  <Pencil className="size-4" />
                  Edit moment
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeletePost(post.id);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                  Delete moment
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveEdit();
              }
              if (e.key === "Escape") cancelEdit();
            }}
            rows={3}
            autoFocus
            aria-label="Edit moment"
            className="min-h-16 w-full resize-none rounded-xl border border-hairline bg-page px-3 py-2 text-[15px] leading-relaxed text-ink outline-none focus:border-brand"
          />

          {editFiles.length > 0 && (
            <PreviewStrip selected={editFiles} onRemove={removeEditFile} />
          )}

          {editError && (
            <p className="mt-2 text-caption text-destructive">{editError}</p>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            {/* Add photos to this existing Moment (respects the 6-photo cap). */}
            <input
              ref={editFileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addEditFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => editFileInputRef.current?.click()}
              disabled={savingEdit || photoRoom <= 0}
              aria-label="Add photos"
              title={photoRoom <= 0 ? `Up to ${MAX_IMAGES} photos` : "Add photos"}
              className="grid size-9 place-items-center rounded-full text-ink-steel transition-colors hover:bg-accent/60 hover:text-ink-slate disabled:opacity-40"
            >
              <ImagePlus className="size-5" />
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={savingEdit}
                className="rounded-full px-3 py-1.5 text-caption font-medium text-ink-slate transition-colors hover:bg-accent/60 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!canSaveEdit || savingEdit}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-caption font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {savingEdit && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        post.body && (
          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">
            {post.body}
          </p>
        )
      )}

      {post.images.length > 0 && (
        <div
          className={cn(
            "mt-3 grid gap-2",
            post.images.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {post.images.map((img) => (
            // Click to open the full-screen viewer. The button carries the grid
            // sizing; the img fills it.
            <button
              key={img.id}
              type="button"
              onClick={() => onOpenImage(img.url)}
              aria-label="View photo"
              className={cn(
                "block cursor-pointer overflow-hidden rounded-xl border border-hairline bg-page transition-opacity hover:opacity-90",
                post.images.length === 1 ? "w-full" : "aspect-square",
              )}
            >
              {/* Pre-optimized WebP straight from Blob — a plain <img> keeps it
                  off Vercel's image-optimization path. width/height reserve
                  space (no CLS). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                width={img.width ?? undefined}
                height={img.height ?? undefined}
                loading="lazy"
                decoding="async"
                className={cn(
                  "w-full",
                  post.images.length === 1
                    ? "max-h-[70vh] object-contain"
                    : "h-full object-cover",
                )}
              />
            </button>
          ))}
        </div>
      )}

      {/* Comments */}
      <div className="mt-3 border-t border-hairline pt-3">
        {post.comments.length > 0 && (
          <ul className="mb-2 flex flex-col gap-2.5">
            {post.comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                currentUser={currentUser}
                onDelete={onDeleteComment}
              />
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            onAddComment(post.id, comment);
            setComment("");
          }}
          className="flex items-center gap-2"
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={pending}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="h-10 min-w-0 flex-1 rounded-full border border-hairline bg-page px-4 text-[14px] text-ink outline-none placeholder:text-ink-mute focus:border-brand disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!comment.trim() || pending}
            aria-label="Send comment"
            className="grid size-10 shrink-0 place-items-center rounded-full text-brand transition-colors hover:bg-brand/10 disabled:opacity-30"
          >
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </article>
  );
}

function CommentRow({
  comment,
  currentUser,
  onDelete,
}: {
  comment: FeedComment;
  currentUser: UserNameValue;
  onDelete: (id: number) => void;
}) {
  const pending = comment.id < 0;
  return (
    <li className="group flex items-start gap-2">
      <Avatar
        user={comment.author}
        mine={comment.author === currentUser}
        small
      />
      <div className="min-w-0 flex-1 rounded-2xl bg-page px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-caption font-semibold text-ink">
            {NAMES[comment.author]}
          </span>
          <span
            className="text-micro text-ink-mute"
            title={fullTime(comment.createdAt)}
          >
            {relativeTime(comment.createdAt)}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-ink-slate">
          {comment.body}
        </p>
      </div>
      {/* Delete stays faint until hover/focus (always reachable on touch). */}
      <button
        type="button"
        onClick={() => onDelete(comment.id)}
        disabled={pending}
        aria-label="Delete comment"
        className="mt-1 grid size-7 shrink-0 place-items-center rounded-full text-ink-mute opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30 max-md:opacity-60"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

function Avatar({
  user,
  mine,
  small,
}: {
  user: UserNameValue;
  mine: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        small ? "size-6 text-micro" : "size-9 text-caption",
        // Viewer-relative tint, same convention as Chat's status chips.
        mine ? "bg-brand/10 text-brand" : "bg-accent text-ink-steel",
      )}
    >
      {NAMES[user][0]}
    </span>
  );
}

// Full-screen photo viewer. Opens when a post image is clicked; closes on the
// backdrop, the X, or Escape. The image src is the same auth-gated proxy URL the
// feed uses, so it loads with the session cookie (no extra work).
function Lightbox({
  src,
  onClose,
}: {
  src: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Lock background scroll while the viewer is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X className="size-5" />
      </button>
      {/* Clicking the image itself shouldn't close the viewer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
      />
    </div>
  );
}

// The per-person status box. A top banner below 1200px; a small confined card
// in the left gutter (right-aligned, hugging the feed) at 1200px+. Both chips
// sit together; only the signed-in user's chip is editable.
function StatusPanel({
  currentUser,
  partner,
  myStatus,
  partnerStatus,
  onChange,
}: {
  currentUser: UserNameValue;
  partner: UserNameValue;
  myStatus: LiveStatus | null;
  partnerStatus: LiveStatus | null;
  onChange: (f: Feed) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    // Pinned as the feed scrolls so it stays in view — the top banner below
    // 1200px, the left-gutter card above it. The mobile banner sits flush at
    // top-14 (the navbar height) so no page background peeks under the navbar;
    // the desktop card pins at top-20 (56px navbar + 24px) to keep the same
    // `mt-6` gap below the navbar it has before sticking. z-30 keeps it under
    // the navbar (z-50) but over the feed.
    <div className="sticky top-14 z-30 shrink-0 border-b border-hairline bg-canvas min-[1200px]:m-3 min-[1200px]:mt-6 min-[1200px]:h-fit min-[1200px]:w-60 min-[1200px]:self-start min-[1200px]:top-20 min-[1200px]:justify-self-end min-[1200px]:overflow-hidden min-[1200px]:rounded-2xl min-[1200px]:border">
      <div className="flex items-center gap-3 px-4 py-2.5 min-[1200px]:flex-col min-[1200px]:items-stretch min-[1200px]:gap-2.5 min-[1200px]:p-4">
        <span className="hidden text-caption font-semibold uppercase tracking-wide text-ink-steel min-[1200px]:block">
          Status
        </span>
        {/* Both chips sit together, left-aligned (no spacer between them). Only
            the signed-in user's chip is editable — it carries the pencil. */}
        <StatusChip name={NAMES[partner]} status={partnerStatus} />
        <StatusChip
          name={NAMES[currentUser]}
          status={myStatus}
          muted
          onEdit={() => setEditing((v) => !v)}
        />
      </div>

      {editing && (
        <StatusEditor
          initial={myStatus}
          onDone={() => setEditing(false)}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function StatusChip({
  name,
  status,
  muted,
  onEdit,
}: {
  name: string;
  status: LiveStatus | null;
  muted?: boolean;
  onEdit?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-caption font-semibold",
          muted ? "bg-accent text-ink-steel" : "bg-brand/10 text-brand",
        )}
      >
        {name[0]}
      </span>
      {status ? (
        <span className="flex min-w-0 items-center gap-1 text-[13px] text-ink-slate">
          {status.emoji && <span className="shrink-0">{status.emoji}</span>}
          <span className="truncate">{status.text}</span>
          {status.expiresAt && (
            <span className="shrink-0 text-ink-mute">
              · {fadesIn(status.expiresAt)}
            </span>
          )}
        </span>
      ) : (
        <span className="text-[13px] text-ink-mute">no status</span>
      )}
      {/* Only the signed-in user's own chip gets this — a muted pencil at the
          right end, signalling they can edit (or set) their status. */}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${name}'s status`}
          className="-my-1 ml-auto grid size-8 shrink-0 place-items-center rounded-full text-ink-mute transition-colors hover:bg-accent/60 hover:text-ink-slate"
        >
          <SquarePen className="size-4" />
        </button>
      )}
    </div>
  );
}

function StatusEditor({
  initial,
  onDone,
  onChange,
}: {
  initial: LiveStatus | null;
  onDone: () => void;
  onChange: (f: Feed) => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [durationIdx, setDurationIdx] = useState(DEFAULT_DURATION_IDX);
  const [busy, setBusy] = useState(false);

  const duration = DURATIONS[durationIdx];

  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      // One field: the status text carries any emoji the user typed inline.
      const f = await setMyStatus(text, duration.minutes);
      if (f) onChange(f);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      const f = await clearMyStatus();
      onChange(f);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-hairline bg-page px-4 py-3">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        maxLength={140}
        autoFocus
        placeholder="Your status..."
        className="h-10 w-full rounded-full border border-hairline bg-canvas px-4 text-[14px] text-ink outline-none placeholder:text-ink-mute focus:border-brand"
      />

      {/* Duration slider: shortest (left) → Indefinite (right, the default). */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-caption text-ink-steel">Duration</span>
          <span className="text-caption font-semibold text-ink-slate">
            {duration.label}
          </span>
        </div>
        {/* Thin track with a dot at each unit. The dots (6px, 4px side inset)
            and the thumb (14px, 7px radius) share the same centers, so a dot
            sits exactly under every stop. Every dot is muted; the current one is
            marked by the brand thumb (drawn on top via z-10) sitting over it. */}
        <div className="relative py-2">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-ink-mute/20" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-1">
            {DURATIONS.map((d, i) => (
              <span
                key={d.label}
                className={cn(
                  "size-1.5 rounded-full",
                  i === durationIdx ? "bg-brand" : "bg-ink-mute/40",
                )}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={DURATIONS.length - 1}
            step={1}
            value={durationIdx}
            onChange={(e) => setDurationIdx(Number(e.target.value))}
            aria-label="Status duration"
            aria-valuetext={duration.label}
            className={cn(
              "relative z-10 block h-3.5 w-full cursor-pointer appearance-none bg-transparent",
              "[&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:bg-transparent",
              "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow",
              "[&::-moz-range-track]:h-0.5 [&::-moz-range-track]:bg-transparent",
              "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-brand",
            )}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {initial && (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="rounded-full px-3 py-1.5 text-caption font-medium text-ink-mute hover:text-destructive disabled:opacity-40"
          >
            Remove
          </button>
        )}
        {/* Cancel backs out of the editor without saving any change. */}
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="ml-auto rounded-full px-3 py-1.5 text-caption font-medium text-ink-slate transition-colors hover:bg-accent/60 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!text.trim() || busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-caption font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

// Absolute posted date + time for a post header, e.g. "Aug 1, 2026 · 5:38 PM".
function postedAt(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(iso);
  const now = new Date();
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// How long until a status with an expiry fades, e.g. "45m", "3h", "2d".
function fadesIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
