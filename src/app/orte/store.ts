"use client";

/**
 * Orte data layer — the ONLY place that knows how pinned places are stored.
 *
 * Backed by Neon via the `orte` server actions. The hook fetches the list on
 * mount and its mutators write through the actions optimistically, then replace
 * state with the fresh list each action returns. The return shape is unchanged
 * from the old localStorage version, so the map + checklist consume it as before.
 *
 * The DB id is a serial int; it's exposed here as a string so the client's
 * string-keyed marker map keeps working. Optimistic rows use a `temp-…` id until
 * the server's real list replaces them.
 */
import { useCallback, useEffect, useState } from "react";

import type { UserNameValue } from "@/db/schema";
import {
  addOrt,
  loadOrte,
  removeOrt,
  toggleVisited as toggleVisitedAction,
  type NewOrtInput,
} from "./actions";
import type { OrtItem } from "./queries";

export type { OrtItem, NewOrtInput };

export function useOrteStore(currentUser: UserNameValue) {
  const [places, setPlaces] = useState<OrtItem[]>([]);
  const [ready, setReady] = useState(false);

  // Load the list from the DB once on mount (same "empty then filled" flow the
  // page already had). setState runs in the async callback, not synchronously in
  // the effect body.
  useEffect(() => {
    let alive = true;
    loadOrte()
      .then((list) => {
        if (alive) setPlaces(list);
      })
      .catch(() => {
        // Transient failure — the list stays empty; a later write re-reads it.
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback(
    (input: NewOrtInput) => {
      // Show the pin immediately with a temp id, then reconcile with the server
      // list (which carries the real id + createdAt + records the activity).
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: OrtItem = {
        id: tempId,
        label: input.label.trim(),
        note: input.note.trim() ? input.note.trim() : null,
        longitude: input.longitude,
        latitude: input.latitude,
        visited: false,
        addedBy: currentUser,
        createdAt: new Date().toISOString(),
      };
      setPlaces((prev) => [optimistic, ...prev]);
      addOrt(input)
        .then((list) => setPlaces(list))
        .catch(() =>
          // Roll the optimistic pin back out if the write failed.
          setPlaces((prev) => prev.filter((p) => p.id !== tempId)),
        );
    },
    [currentUser],
  );

  const toggleVisited = useCallback((id: string) => {
    setPlaces((prev) =>
      prev.map((p) => (p.id === id ? { ...p, visited: !p.visited } : p)),
    );
    const numId = Number(id);
    // A temp (not-yet-saved) row has no numeric id; its state reconciles when the
    // add's server list lands, so skip the server call here.
    if (!Number.isInteger(numId)) return;
    toggleVisitedAction(numId)
      .then(setPlaces)
      .catch(() => loadOrte().then(setPlaces).catch(() => {}));
  }, []);

  const remove = useCallback((id: string) => {
    setPlaces((prev) => prev.filter((p) => p.id !== id));
    const numId = Number(id);
    if (!Number.isInteger(numId)) return;
    removeOrt(numId)
      .then(setPlaces)
      .catch(() => loadOrte().then(setPlaces).catch(() => {}));
  }, []);

  return { places, ready, add, toggleVisited, remove };
}
