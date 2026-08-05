"use client";

/**
 * The interactive Orte page: a draggable MapLibre map on the left, a To See /
 * Visited checklist on the right. Search a place or tap the map to drop a pin,
 * name it, and it lands in "To See" (green pin). Check it off and it moves to
 * "Visited" — its pin stays on the map but turns muted gray. Each pin layer
 * (To See / Visited) has its own show/hide toggle.
 *
 * MapLibre GL (an open, token-free fork of Mapbox GL) touches `window` at import
 * time, so it is imported dynamically inside the init effect (never during SSR
 * of this client component). Only the stylesheet and the types are static. The
 * basemap is CARTO Positron — a free, keyless, minimal light style.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Map as MlMap,
  Marker as MlMarker,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Check,
  Eye,
  EyeOff,
  List,
  Loader2,
  LocateFixed,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import type { UserNameValue } from "@/db/schema";
import { cn } from "@/lib/utils";
import { useOrteStore, type OrtItem } from "./store";

// MapLibre exposes named exports (no default), so the module namespace itself
// is what carries Map/Marker/Popup/NavigationControl.
type MaplibreModule = typeof import("maplibre-gl");

// Free, keyless basemap: CARTO Positron as RASTER tiles (light/minimal, fits
// DESIGN.md). We deliberately avoid the vector style.json here — vector tiles
// need MapLibre's web worker to decode them, and that worker doesn't initialize
// under Next's Turbopack bundler (the style silently never finishes loading and
// no tiles are ever requested). Raster tiles are plain images decoded on the
// main thread, so they render with no worker dependency. Swap `light_all` for
// `dark_all` / `voyager` to change the look.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

// Marker colors: green = still to see, muted light pink-red = visited, amber =
// the unsaved pin being placed.
const COLOR_TO_SEE = "#16a34a"; // green
const COLOR_VISITED = "#a3cde6"; // visited (done) — used for the marker + toggle dot
const COLOR_PENDING = "#f59e0b"; // amber

// Marks the SAVED place markers, so the map's click handler can tell them from
// every other marker on the map (the provisional pin, the you-are-here dot).
// Positively identifying the one kind that matters beats excluding the others
// one by one — a new marker type can't silently start discarding pins.
const PLACE_MARKER_CLASS = "orte-place-marker";

// Default view: Los Angeles (where the story starts).
const DEFAULT_CENTER: [number, number] = [-118.2437, 34.0522];
const DEFAULT_ZOOM = 9;

type Pending = { lng: number; lat: number };
type SearchResult = {
  lng: number;
  lat: number;
  name: string;
  detail: string;
  countryCode?: string;
};

// Mobile bottom-sheet detents, as a fraction of the area below the navbar.
// The collapsed one is derived from a pixel budget rather than fixed, because
// it has one job: show the grab handle and the search field and nothing else,
// which costs the same number of pixels on every screen size. The other two are
// proportional. Dragging is free between collapsed and SHEET_MAX; releasing
// settles on the nearest detent. Desktop ignores all of this — there the panel
// is a fixed-width side column.
const SHEET_COLLAPSED_PX = 116; // 44px handle + the search row
const SHEET_MID = 0.62;
const SHEET_MAX = 0.92;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Great-circle distance in km. Only used to bucket results into proximity
// tiers, so the spherical approximation is far more precision than we need.
function distanceKm(a: Pending, b: Pending) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nominatim ranks by global "importance", so a query like "Springfield" surfaces
// the most famous one on earth rather than the one down the road. These bands
// re-sort its answers into the order actually wanted: vicinity, then county,
// then state/region, then same country, then everywhere else. Sorting is stable,
// so within a band Nominatim's own relevance ordering is preserved untouched.
const PROXIMITY_BANDS_KM = [50, 300, 1200];

function proximityTier(km: number, cc: string | undefined, userCc: string | null) {
  for (let i = 0; i < PROXIMITY_BANDS_KM.length; i++) {
    if (km <= PROXIMITY_BANDS_KM[i]) return i;
  }
  // Same country but far (big countries: another coast) still beats abroad.
  if (userCc && cc === userCc) return PROXIMITY_BANDS_KM.length;
  return PROXIMITY_BANDS_KM.length + 1;
}

const nearestSnap = (frac: number, snaps: number[]) =>
  snaps.reduce((best, s) =>
    Math.abs(s - frac) < Math.abs(best - frac) ? s : best,
  );

export function OrteClient({ currentUser }: { currentUser: UserNameValue }) {
  const { places, ready, add, toggleVisited, remove } = useOrteStore(currentUser);

  const mainRef = useRef<HTMLElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<MaplibreModule | null>(null);
  const markersRef = useRef<Map<string, MlMarker>>(new Map());
  const pendingMarkerRef = useRef<MlMarker | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [showToSee, setShowToSee] = useState(true);
  const [showVisited, setShowVisited] = useState(true);
  // Panel visibility is two independent things, one per breakpoint, because a
  // single flag cannot mean both. DESKTOP: the side column is shown or hidden
  // outright (Google Maps' collapsible sidebar), and starts shown so search is
  // there on load. MOBILE: the sheet is never dismissed — search lives in it —
  // so its state is purely `sheetFrac` below, resting at the collapsed detent.
  const [columnOpen, setColumnOpen] = useState(true);
  // Mobile only: how much of the page the sheet covers, as a fraction. Lives
  // here rather than in PlacesPanel because the provisional-pin buttons have to
  // ride above the sheet, so they need its height too.
  const [sheetFrac, setSheetFrac] = useState(0.18);
  const [boxH, setBoxH] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  // The provisional pin and its details form are two separate steps: `pending`
  // is a pin sitting on the map, `formOpen` is the modal that names it.
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  // Place search (Nominatim — keyless, CORS-enabled OSM geocoder; resolves
  // POIs and specific street addresses).
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Where the user is, once they ask. Doubles as the reference point that
  // search results are ranked around, which is why it is kept after the flyTo.
  const [userLoc, setUserLoc] = useState<Pending | null>(null);
  const [userCountry, setUserCountry] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // ── Initialize the map once ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let map: MlMap | undefined;
    let disposed = false;

    (async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        if (disposed || !mapContainerRef.current) return;
        mlRef.current = maplibregl;

        map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: MAP_STYLE,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
        });
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "bottom-right",
        );
        // Surface tile/style/WebGL failures in the UI instead of failing
        // silently to a blank map.
        map.on("error", (e) => {
          console.error("[orte map]", e.error ?? e);
          setMapError(e.error?.message ?? "Unknown map error");
        });
        // Tap EMPTY map → drop a provisional pin there. It stays unnamed and
        // unsaved until "Add" opens the details dialog, so tapping around to
        // compare spots costs nothing and disturbs no other panel.
        //
        // Markers are DOM siblings of the canvas inside the map container, and
        // MapLibre delegates its click handling from that container — so a tap
        // on an existing pin arrives here too. Selecting a pin is not placing
        // one, so filter those out; the marker's own handler opens its popup.
        map.on("click", (e) => {
          const target = e.originalEvent.target;
          const marker =
            target instanceof Element
              ? target.closest(".maplibregl-marker")
              : null;
          if (marker) {
            // A tap has one focus. Selecting a SAVED pin therefore throws away
            // an unsaved provisional pin instead of leaving both on the map.
            // Tapping the provisional pin, or the you-are-here dot, is just
            // selecting that thing and leaves the provisional pin alone.
            if (marker.classList.contains(PLACE_MARKER_CLASS)) {
              setPending(null);
              setFormOpen(false);
              setLabel("");
              setNote("");
            }
            return;
          }
          setPending({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        });
        map.on("load", () => {
          if (disposed) return;
          mapRef.current = map!;
          map!.resize(); // guard against a 0-size container at init
          setMapReady(true);
        });
      } catch (err) {
        console.error("[orte map] init failed", err);
        setMapError(err instanceof Error ? err.message : String(err));
      }
    })();

    // Keep the map canvas in sync with its container. The ResizeObserver also
    // covers the case where the container gets its height slightly after the
    // map initializes (layout race).
    const onResize = () => map?.resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => map?.resize());
    if (mapContainerRef.current) ro.observe(mapContainerRef.current);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      map?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // ── Render one marker per place (rebuild on any change) ──────────────────
  useEffect(() => {
    const maplibregl = mlRef.current;
    const map = mapRef.current;
    if (!mapReady || !map || !maplibregl) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    for (const p of places) {
      // Honor each layer's visibility toggle.
      if (p.visited && !showVisited) continue;
      if (!p.visited && !showToSee) continue;

      const marker = new maplibregl.Marker({
        color: p.visited ? COLOR_VISITED : COLOR_TO_SEE,
        className: PLACE_MARKER_CLASS,
      }).setLngLat([p.longitude, p.latitude]);

      // Build popup content as DOM (never innerHTML) so user text can't inject.
      const el = document.createElement("div");
      el.style.maxWidth = "180px";
      const title = document.createElement("div");
      title.textContent = p.label;
      title.style.cssText = "font-weight:600;font-size:13px;color:#0f172a";
      el.appendChild(title);
      if (p.note) {
        const noteEl = document.createElement("div");
        noteEl.textContent = p.note;
        noteEl.style.cssText = "font-size:12px;color:#667b99;margin-top:2px";
        el.appendChild(noteEl);
      }
      const popup = new maplibregl.Popup({
        offset: 24,
        closeButton: false,
      }).setDOMContent(el);
      marker.setPopup(popup);

      // Selecting a saved pin should read as picking *that* pin, so grow it for
      // as long as its name is showing. Tying the scale to the popup's own
      // open/close events keeps the two in sync for free — including when the
      // popup is opened from the list via flyTo(), or closed by clicking
      // elsewhere. Scale the inner <svg>, never the marker root: MapLibre owns
      // the root's `transform` for positioning and would fight us for it.
      const svg = marker.getElement().querySelector("svg");
      if (svg instanceof SVGElement) {
        svg.style.transformOrigin = "center bottom";
        svg.style.transition = "transform 120ms ease-out";
        popup.on("open", () => (svg.style.transform = "scale(1.25)"));
        popup.on("close", () => (svg.style.transform = ""));
      }

      marker.addTo(map);
      markersRef.current.set(p.id, marker);
    }
  }, [places, showToSee, showVisited, mapReady]);

  // ── The unsaved, draggable "pending" pin ─────────────────────────────────
  useEffect(() => {
    const maplibregl = mlRef.current;
    const map = mapRef.current;
    if (!mapReady || !map || !maplibregl) return;

    if (!pending) {
      pendingMarkerRef.current?.remove();
      pendingMarkerRef.current = null;
      return;
    }
    if (!pendingMarkerRef.current) {
      const marker = new maplibregl.Marker({
        color: COLOR_PENDING,
        draggable: true,
      })
        .setLngLat([pending.lng, pending.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        setPending({ lng: ll.lng, lat: ll.lat });
      });
      pendingMarkerRef.current = marker;
    } else {
      pendingMarkerRef.current.setLngLat([pending.lng, pending.lat]);
    }
  }, [pending, mapReady]);

  // Measure the box below the navbar — the sheet's snap points are fractions of
  // it, and dragging converts pointer travel into a fraction using this height.
  // ResizeObserver fires once on observe, so that doubles as the first measure
  // (and it re-measures when a mobile browser's URL bar shows/hides).
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── "You are here" dot ───────────────────────────────────────────────────
  // A custom element, not a default pin: this is not a place, it's the viewer.
  useEffect(() => {
    const maplibregl = mlRef.current;
    const map = mapRef.current;
    if (!mapReady || !map || !maplibregl || !userLoc) return;

    const el = document.createElement("div");
    el.style.cssText =
      "width:16px;height:16px;border-radius:9999px;background:#006aff;" +
      "border:3px solid #fff;box-shadow:0 0 0 1px rgba(15,23,42,.2)";
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([userLoc.lng, userLoc.lat])
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [userLoc, mapReady]);

  function locateMe() {
    if (!("geolocation" in navigator)) {
      setLocateError("This browser can't share a location.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude: lng, latitude: lat } = pos.coords;
        setLocating(false);
        setUserLoc({ lng, lat });
        mapRef.current?.flyTo({ center: [lng, lat], zoom: 13, duration: 900 });
        collapseSheet(); // don't fly somewhere the sheet is covering
        void lookupUserCountry(lng, lat);
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : "Couldn't get your location.",
        );
      },
      // A cached fix up to a minute old is fine for centering a map, and beats
      // making the user wait for a fresh GPS lock.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  // One reverse lookup per locate, so search ranking can tell "same country" from
  // "far away". Best-effort: without it, ranking just falls back to distance.
  async function lookupUserCountry(lng: number, lat: number) {
    try {
      const res = await fetch(
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2" +
          `&zoom=3&addressdetails=1&lat=${lat}&lon=${lng}`,
      );
      const data = await res.json();
      const cc = data?.address?.country_code;
      if (typeof cc === "string") setUserCountry(cc.toLowerCase());
    } catch {
      // Non-fatal — distance tiers still work.
    }
  }

  const flyTo = useCallback((p: OrtItem) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [p.longitude, p.latitude],
      zoom: Math.max(map.getZoom(), 13),
      duration: 800,
    });
    const marker = markersRef.current.get(p.id);
    const popup = marker?.getPopup();
    if (marker && popup && !popup.isOpen()) marker.togglePopup();
  }, []);

  // ── Debounced place search (Nominatim geocoder) ──────────────────────────
  // Nominatim is OpenStreetMap's official geocoder — unlike Photon it resolves
  // specific street addresses (house-number level), not just POI/place names.
  // Keyless + CORS. Debounced 500ms (one request per typing pause, not per
  // keystroke) to respect the public instance's usage policy. All state writes
  // live inside the timer so a short query clears results on the same beat.
  useEffect(() => {
    const q = searchQuery.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (q.length < 3) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        // Bias the geocoder toward what you're looking at. `viewbox` alone is a
        // soft preference and `bounded=0` keeps it that way — a place outside
        // the box is still returned, just ranked lower, so searching for
        // somewhere far away still works. Ask for more rows than we show,
        // because the re-rank below needs a pool to reorder.
        const map = mapRef.current;
        const b = map?.getBounds();
        const viewbox = b
          ? `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=0`
          : "";

        const res = await fetch(
          "https://nominatim.openstreetmap.org/search?format=jsonv2" +
            `&addressdetails=1&limit=12&accept-language=en${viewbox}` +
            `&q=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        type NominatimItem = {
          lat: string;
          lon: string;
          display_name: string;
          name?: string;
          address?: Record<string, string | undefined>;
        };
        const results: SearchResult[] = (
          Array.isArray(data) ? (data as NominatimItem[]) : []
        ).map((r) => {
          const a = r.address ?? {};
          const street = [a.house_number, a.road].filter(Boolean).join(" ");
          const locality =
            a.city || a.town || a.village || a.hamlet || a.suburb || a.county;
          // POIs carry a `name`; bare addresses don't, so fall back to street.
          const name = r.name || street || r.display_name.split(", ")[0];
          const detail =
            [locality, a.state, a.country].filter(Boolean).join(", ") ||
            r.display_name;
          return {
            lng: parseFloat(r.lon),
            lat: parseFloat(r.lat),
            name,
            detail,
            countryCode: a.country_code?.toLowerCase(),
          };
        });

        // Re-rank around a reference point: the located user if they've shared
        // it, otherwise wherever the map is pointed — which is at least
        // somewhere they chose. Stable sort, so Nominatim's own ordering
        // survives inside each proximity band.
        const ref =
          userLoc ??
          (map ? { lng: map.getCenter().lng, lat: map.getCenter().lat } : null);
        const ranked = ref
          ? [...results].sort(
              (x, y) =>
                proximityTier(distanceKm(ref, x), x.countryCode, userCountry) -
                proximityTier(distanceKm(ref, y), y.countryCode, userCountry),
            )
          : results;

        setSearchResults(ranked);
      } catch {
        // Aborted request or network error — leave the current results be.
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // Re-running when the reference point changes is the point, not a leak:
    // sharing a location should immediately re-rank whatever is on screen.
  }, [searchQuery, userLoc, userCountry]);

  // Pick a search result → fly there and drop the provisional pin. Same as a
  // map tap: the name is prefilled, but "Add" is what opens the dialog.
  function selectSearchResult(r: SearchResult) {
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 14, duration: 800 });
    setPending({ lng: r.lng, lat: r.lat });
    setLabel(r.name);
    setSearchQuery("");
    setSearchResults([]);
    // Drop the sheet so the pin you just chose is actually on screen.
    collapseSheet();
  }

  function clearSearch() {
    setSearchQuery("");
    setSearchResults([]);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!pending || !label.trim()) return;
    add({ label, note, longitude: pending.lng, latitude: pending.lat });
    discardPending();
  }

  // Drops the provisional pin and everything typed about it. useCallback because
  // the dialog subscribes to it in an effect (Escape-to-close).
  const discardPending = useCallback(() => {
    setPending(null);
    setFormOpen(false);
    setLabel("");
    setNote("");
  }, []);

  // Backing out of the dialog keeps the pin — only the form closes, so the
  // "Add" button comes back rather than making you re-place the pin.
  const closeForm = useCallback(() => setFormOpen(false), []);

  const toSee = places.filter((p) => !p.visited);
  const visited = places.filter((p) => p.visited);

  // The collapsed detent is a pixel budget expressed as a fraction, so it needs
  // the measured box. Clamping `sheetFrac` to it here means the initial guess
  // self-corrects on the first measurement — no setState-in-an-effect needed.
  const collapsedFrac = boxH
    ? clamp(SHEET_COLLAPSED_PX / boxH, 0.1, 0.5)
    : 0.18;
  const snaps = [collapsedFrac, SHEET_MID, SHEET_MAX];
  const frac = clamp(sheetFrac, collapsedFrac, SHEET_MAX);
  const sheetH = Math.round(boxH * frac);

  const sheetExpanded = frac > collapsedFrac + 0.005;

  // The map's List button drives both breakpoints at once: each call is a no-op
  // on the breakpoint it doesn't apply to (desktop ignores the sheet height,
  // mobile never hides the panel), so no media query is needed to decide.
  function toggleList() {
    setColumnOpen((v) => !v);
    setSheetFrac(sheetExpanded ? collapsedFrac : SHEET_MID);
  }

  // Sending focus to the map means dropping the sheet out of the way. Touches
  // only the mobile height, never the desktop column — clicking a list row must
  // not make the sidebar vanish.
  function collapseSheet() {
    setSheetFrac(collapsedFrac);
  }

  // Mobile: lift the provisional-pin buttons clear of the sheet so placing a pin
  // never requires moving the sheet first. The sheet is always on screen now, so
  // this is unconditional. Capped so a near-full sheet can't push them off the
  // top of the map.
  const pinActionsBottom = Math.min(sheetH + 24, Math.max(boxH - 64, 24));

  return (
    <main
      // A viewport-anchored box below the h-14 (3.5rem) navbar. position:fixed
      // with explicit top/bottom insets gives a GUARANTEED definite height that
      // doesn't depend on the ancestor height chain or on `dvh` resolving —
      // both of which kept collapsing the map container to zero height. The
      // whole layout hangs off this, so it must be rock-solid.
      ref={mainRef}
      className="fixed inset-x-0 top-14 bottom-0"
    >
      {/* The page heading lives here rather than in the panel: the panel's title
          row is now conditional (search replaces it, and desktop can hide the
          column), and the page must always expose exactly one h1. */}
      <h1 className="sr-only">Orte</h1>

      <div className="flex h-full flex-col md:flex-row">
        {/* ── Map ───────────────────────────────────────────────────────── */}
        {/* On mobile the map always fills the box and the list sheet floats over
            it (the usual maps pattern) — that is what lets the sheet be dragged
            to any height without resizing the map on every frame. On desktop the
            two share the row and the panel takes a fixed-width column. */}
        <div className="relative h-full w-full md:flex-1">
          {/* Size the container by filling the (sized) wrapper. NOT `absolute
              inset-0`: MapLibre injects `.maplibregl-map { position: relative }`
              onto this node, which cancels absolute positioning and collapses it
              to 0 height. h-full/w-full sizes it regardless of position. */}
          <div ref={mapContainerRef} className="h-full w-full" />

          {/* Search used to float here at top-left; it now lives in the panel,
              which is what makes the collapsed sheet useful on load. */}

          {/* Surfaced map error (tiles/style/WebGL) */}
          {mapError && (
            <div className="absolute inset-x-3 top-3 z-20 rounded-xl border border-destructive/30 bg-canvas/95 px-3 py-2 text-caption text-ink-slate backdrop-blur">
              <span className="font-semibold text-destructive">Map error:</span>{" "}
              {mapError}
            </div>
          )}

          {/* Map controls (top-right): the checklist toggle, then the per-layer
              show/hide toggles — each of those appears only once that layer
              actually has pins. */}
          <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              {/* Centre the map on the viewer. Also records the position, which
                  is what search ranking uses as its reference point. */}
              <button
                type="button"
                onClick={locateMe}
                disabled={locating}
                aria-label="Show my location"
                className="grid size-11 place-items-center rounded-full border border-hairline bg-canvas/95 text-ink-slate backdrop-blur transition-colors hover:text-ink disabled:opacity-60"
              >
                {locating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LocateFixed className={cn("size-4", userLoc && "text-brand")} />
                )}
              </button>

              {/* Desktop: shows/hides the side column. Mobile: raises the sheet
                  to its middle detent, or drops it back to search-only. */}
              <button
                type="button"
                onClick={toggleList}
                aria-pressed={columnOpen}
                aria-controls="orte-list"
                className={cn(
                  "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium backdrop-blur transition-colors",
                  columnOpen
                    ? "border-brand bg-canvas text-brand"
                    : "border-hairline bg-canvas/95 text-ink-slate hover:text-ink",
                )}
              >
                <List className="size-4" />
                List
              </button>
            </div>

            {locateError && (
              <p className="max-w-[15rem] rounded-xl border border-destructive/30 bg-canvas/95 px-3 py-1.5 text-right text-caption text-ink-slate backdrop-blur">
                {locateError}
              </p>
            )}

            {toSee.length > 0 && (
              <LayerToggle
                label="To See"
                color={COLOR_TO_SEE}
                on={showToSee}
                onClick={() => setShowToSee((v) => !v)}
              />
            )}
            {visited.length > 0 && (
              <LayerToggle
                label="Visited"
                color={COLOR_VISITED}
                on={showVisited}
                onClick={() => setShowVisited((v) => !v)}
              />
            )}
          </div>

          {/* Provisional-pin actions. The pin is on the map but not saved yet;
              "Add" is what opens the details dialog, and the X discards it.
              Bottom-center is the one free corner — search is top-left, layer
              toggles top-right, MapLibre's zoom control bottom-right.
              The row spans the map so the buttons center on it, so it must be
              click-through — otherwise it would eat map taps in this band. */}
          {pending && !formOpen && (
            <div
              style={
                { "--pin-actions-bottom": `${pinActionsBottom}px` } as React.CSSProperties
              }
              className="pointer-events-none absolute inset-x-0 bottom-[var(--pin-actions-bottom)] z-20 flex items-center justify-center gap-2 px-4 md:bottom-6"
            >
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="pointer-events-auto inline-flex h-11 items-center gap-1.5 rounded-full bg-brand px-5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Plus className="size-4" />
                Add
              </button>
              <button
                type="button"
                onClick={discardPending}
                aria-label="Discard pin"
                className="pointer-events-auto grid size-11 place-items-center rounded-full border border-hairline bg-canvas/95 text-ink-mute backdrop-blur transition-colors hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          {/* First-run hint — top-left now that search has vacated it, and
              because the sheet permanently occupies the bottom on mobile. */}
          {ready && places.length === 0 && !pending && (
            <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full border border-hairline bg-canvas/95 px-3 py-1.5 text-caption font-medium text-ink-steel backdrop-blur">
              Tap the map to drop a pin
            </div>
          )}
        </div>

        <PlacesPanel
          open={columnOpen}
          ready={ready}
          toSee={toSee}
          visited={visited}
          heightPx={sheetH}
          boxH={boxH}
          frac={frac}
          snaps={snaps}
          onFracChange={setSheetFrac}
          onClose={() => setColumnOpen(false)}
          search={{
            query: searchQuery,
            results: searchResults,
            searching,
            onChange: setSearchQuery,
            onClear: clearSearch,
            // Reaching for search means you want to see results: raise the
            // sheet so they aren't typed into a 116px-tall slot.
            onFocus: () => setSheetFrac(SHEET_MID),
            onSelect: selectSearchResult,
          }}
          onToggleVisited={toggleVisited}
          // Flying to a place is "show me this on the map", so get the sheet out
          // of the way — otherwise the pin lands behind it.
          onFly={(p) => {
            flyTo(p);
            collapseSheet();
          }}
          onRemove={remove}
        />
      </div>

      {/* Details for the provisional pin. Rendered outside the map/panel row so
          it overlays the whole page rather than living in either column. */}
      {formOpen && pending && (
        <NewPinDialog
          pending={pending}
          label={label}
          note={note}
          onLabelChange={setLabel}
          onNoteChange={setNote}
          onSubmit={handleSave}
          onClose={closeForm}
        />
      )}
    </main>
  );
}

type SearchProps = {
  query: string;
  results: SearchResult[];
  searching: boolean;
  onChange: (v: string) => void;
  onClear: () => void;
  onFocus: () => void;
  onSelect: (r: SearchResult) => void;
};

/**
 * Search + the To See / Visited checklist. It owns no part of pin creation:
 * that lives in NewPinDialog, so browsing and adding never fight over the same
 * surface.
 *
 * Two shapes in one component. On MOBILE it is a bottom sheet floating over the
 * map, dragged by the grab handle to any height between the collapsed detent and
 * SHEET_MAX and settling on the nearest detent when released. It is never
 * dismissed, because search lives inside it — at the collapsed detent the search
 * field is exactly what shows, which is the Apple/Google Maps resting state.
 * On DESKTOP it is a fixed-width side column that the List button can hide
 * outright, and none of the drag machinery applies — the height comes from an
 * inline CSS variable that `md:h-full` overrides at that breakpoint, which is
 * why the sheet size never has to be branched on in JS.
 */
function PlacesPanel({
  open,
  ready,
  toSee,
  visited,
  heightPx,
  boxH,
  frac,
  snaps,
  onFracChange,
  onClose,
  search,
  onToggleVisited,
  onFly,
  onRemove,
}: {
  open: boolean;
  ready: boolean;
  toSee: OrtItem[];
  visited: OrtItem[];
  heightPx: number;
  boxH: number;
  frac: number;
  snaps: number[];
  onFracChange: (f: number) => void;
  onClose: () => void;
  search: SearchProps;
  onToggleVisited: (id: string) => void;
  onFly: (p: OrtItem) => void;
  onRemove: (id: string) => void;
}) {
  const [tab, setTab] = useState<"to-see" | "visited">("to-see");
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startFrac: number } | null>(null);

  const collapsed = snaps[0];
  // Typing takes over the body: results replace the tabs until the box is
  // cleared, so the sheet is only ever showing one thing at a time.
  const searchActive = search.query.trim().length > 0;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Pointer capture keeps move/up events coming to the handle even once the
    // finger has travelled off it, which it always does on a real drag.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startFrac: frac };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || !boxH) return;
    // Dragging up (a decreasing clientY) grows the sheet.
    onFracChange(
      clamp(d.startFrac + (d.startY - e.clientY) / boxH, collapsed, SHEET_MAX),
    );
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
    onFracChange(nearestSnap(frac, snaps));
  }

  // Keyboard equivalent of the drag: step through the detents.
  function onHandleKeyDown(e: React.KeyboardEvent) {
    const i = snaps.indexOf(nearestSnap(frac, snaps));
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onFracChange(snaps[Math.min(i + 1, snaps.length - 1)]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onFracChange(snaps[Math.max(i - 1, 0)]);
    }
  }

  return (
    <aside
      id="orte-list"
      style={{ "--sheet-h": `${heightPx}px` } as React.CSSProperties}
      className={cn(
        "absolute inset-x-0 bottom-0 z-30 flex h-[var(--sheet-h)] flex-col overflow-hidden rounded-t-[21px] border-t border-hairline bg-canvas",
        // Desktop: back to an in-flow, full-height, fixed-width column.
        "md:static md:z-auto md:h-full md:w-[340px] md:flex-none md:rounded-none md:border-t-0 md:border-l",
        // Snap smoothly on release, but track the finger 1:1 while dragging.
        !dragging && "transition-[height] duration-200 ease-out",
        // Only the desktop column can be hidden. On mobile the sheet always
        // stays on screen — collapsing it is what "hidden" means there, and
        // dismissing it would take the search field with it.
        !open && "md:hidden",
      )}
    >
      {/* Grab handle — mobile only; the desktop column isn't resizable. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Resize list"
        aria-valuemin={Math.round(collapsed * 100)}
        aria-valuemax={Math.round(SHEET_MAX * 100)}
        aria-valuenow={Math.round(frac * 100)}
        aria-controls="orte-list"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onHandleKeyDown}
        // py-5 makes the grab area a full 44px tall (the standing touch-target
        // minimum) rather than hugging the 4px pill — the pill is the affordance,
        // the padding is what you actually hit. touch-none stops the browser
        // from scroll-gesturing the drag away.
        className="grid shrink-0 cursor-grab touch-none place-items-center py-5 active:cursor-grabbing md:hidden"
      >
        <span className="h-1 w-12 rounded-full bg-ink-mute/40" />
      </div>

      {/* Search. Sized and ordered so that it — and only it — is what the
          collapsed detent reveals; SHEET_COLLAPSED_PX is budgeted for exactly
          this row plus the handle above it. */}
      <div className="shrink-0 px-3 pb-3 md:px-4 md:pt-4">
        <div className="flex items-center gap-2 rounded-full border border-hairline bg-page pl-3 pr-2 focus-within:border-brand">
          <Search className="size-4 shrink-0 text-ink-mute" />
          <input
            value={search.query}
            onChange={(e) => search.onChange(e.target.value)}
            onFocus={search.onFocus}
            placeholder="Search a place…"
            aria-label="Search for a place"
            className="h-11 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-mute"
          />
          {search.searching && (
            <Loader2 className="size-4 shrink-0 animate-spin text-ink-mute" />
          )}
          {!search.searching && search.query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={search.onClear}
              className="grid size-8 shrink-0 place-items-center rounded-full text-ink-mute hover:text-ink"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {searchActive ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {search.results.length > 0 ? (
            <ul>
              {search.results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button
                    type="button"
                    onClick={() => search.onSelect(r)}
                    className="flex min-h-[44px] w-full flex-col items-start justify-center rounded-xl px-3 py-2 text-left hover:bg-accent/40"
                  >
                    <span className="max-w-full truncate text-[14px] font-medium text-ink">
                      {r.name}
                    </span>
                    {r.detail && (
                      <span className="max-w-full truncate text-caption text-ink-steel">
                        {r.detail}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-8 text-center text-[14px] text-ink-steel">
              {search.searching
                ? "Searching…"
                : search.query.trim().length < 3
                  ? "Keep typing…"
                  : "No matches."}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 px-4 pb-2">
            <MapPin className="size-4 shrink-0 text-brand" />
            <p className="truncate text-[14px] text-ink-steel">
              <span className="font-semibold text-ink">Orte</span> &middot; die
              Welt
            </p>
            {/* Mobile has no "hide" — you drag it down instead. */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide places"
              className="-mr-1.5 ml-auto hidden size-9 shrink-0 place-items-center rounded-full text-ink-mute transition-colors hover:bg-accent/60 hover:text-ink md:grid"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Nothing saved at all: the tabs would just read "0 / 0", so skip
              straight to the empty state. */}
          {ready && toSee.length === 0 && visited.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[14px] text-ink-steel">No places yet.</p>
              <p className="mt-1 text-caption text-ink-mute">
                Tap anywhere on the map to add the first one.
              </p>
            </div>
          ) : (
            <>
              <div
                role="tablist"
                aria-label="Places"
                className="flex shrink-0 border-b border-hairline"
              >
                <Tab
                  id="orte-tab-to-see"
                  panelId="orte-panel-to-see"
                  label="To See"
                  count={toSee.length}
                  active={tab === "to-see"}
                  onClick={() => setTab("to-see")}
                />
                <Tab
                  id="orte-tab-visited"
                  panelId="orte-panel-visited"
                  label="Visited"
                  count={visited.length}
                  active={tab === "visited"}
                  onClick={() => setTab("visited")}
                />
              </div>

              {/* Both panels stay mounted — `hidden` on the inactive one — so
                  each tab keeps its own scroll position as you switch. */}
              <TabPanel
                id="orte-panel-to-see"
                tabId="orte-tab-to-see"
                active={tab === "to-see"}
                empty={toSee.length === 0}
                emptyText="Nothing on the list yet."
              >
                {toSee.map((p) => (
                  <PlaceRow
                    key={p.id}
                    place={p}
                    onToggle={() => onToggleVisited(p.id)}
                    onFly={() => onFly(p)}
                    onRemove={() => onRemove(p.id)}
                  />
                ))}
              </TabPanel>

              <TabPanel
                id="orte-panel-visited"
                tabId="orte-tab-visited"
                active={tab === "visited"}
                empty={visited.length === 0}
                emptyText="Nowhere visited yet."
              >
                {visited.map((p) => (
                  <PlaceRow
                    key={p.id}
                    place={p}
                    onToggle={() => onToggleVisited(p.id)}
                    onFly={() => onFly(p)}
                    onRemove={() => onRemove(p.id)}
                  />
                ))}
              </TabPanel>
            </>
          )}
        </>
      )}
    </aside>
  );
}

// One of the two list tabs. The count rides next to the label, muted so the
// label stays the thing you read first.
function Tab({
  id,
  panelId,
  label,
  count,
  active,
  onClick,
}: {
  id: string;
  panelId: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      className={cn(
        // -mb-px pulls the active underline over the tablist's bottom hairline
        // so the two read as one line rather than stacking into 3px.
        "-mb-px flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 text-[14px] transition-colors",
        active
          ? "border-brand font-semibold text-ink"
          : "border-transparent font-medium text-ink-steel hover:text-ink",
      )}
    >
      {label}
      <span className="text-ink-mute">{count}</span>
    </button>
  );
}

function TabPanel({
  id,
  tabId,
  active,
  empty,
  emptyText,
  children,
}: {
  id: string;
  tabId: string;
  active: boolean;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={tabId}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-2 py-2",
        !active && "hidden",
      )}
    >
      {empty ? (
        <p className="px-2 py-10 text-center text-[14px] text-ink-steel">
          {emptyText}
        </p>
      ) : (
        <ul>{children}</ul>
      )}
    </div>
  );
}

/**
 * Names the provisional pin. A modal rather than a slot in the checklist: it is
 * a short, focused task, and keeping it off the panel means dropping a pin no
 * longer forces the list open. Closing it keeps the pin — only `discardPending`
 * throws the pin away — so backing out costs you nothing but the dialog.
 *
 * Dismissal follows Momente's Lightbox: backdrop click, the X, or Escape.
 */
function NewPinDialog({
  pending,
  label,
  note,
  onLabelChange,
  onNoteChange,
  onSubmit,
  onClose,
}: {
  pending: Pending;
  label: string;
  note: string;
  onLabelChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const field =
    "mt-1 h-11 w-full rounded-full border border-hairline bg-canvas px-4 text-[14px] text-ink outline-none placeholder:text-ink-mute focus:border-brand";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-pin-title"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
    >
      {/* Clicks inside the card must not reach the backdrop's close handler. */}
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[21px] border border-hairline bg-canvas p-5"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <h2 id="new-pin-title" className="text-[17px] font-semibold text-ink">
              Add a place
            </h2>
            <p className="mt-0.5 text-caption text-ink-steel">
              {pending.lat.toFixed(4)}, {pending.lng.toFixed(4)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 ml-auto grid size-9 shrink-0 place-items-center rounded-full text-ink-mute transition-colors hover:bg-accent/60 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4">
          <label
            htmlFor="new-pin-name"
            className="text-caption font-medium text-ink-slate"
          >
            Name
          </label>
          <input
            id="new-pin-name"
            autoFocus
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            className={field}
          />
        </div>

        <div className="mt-3">
          <label
            htmlFor="new-pin-notes"
            className="text-caption font-medium text-ink-slate"
          >
            Notes
          </label>
          <input
            id="new-pin-notes"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            className={field}
          />
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            disabled={!label.trim()}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-brand px-4 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center justify-center rounded-full border border-hairline px-4 text-[14px] font-medium text-ink-slate hover:bg-accent/60"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function LayerToggle({
  label,
  color,
  on,
  onClick,
}: {
  label: string;
  color: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-hairline bg-canvas/95 px-3 py-2 text-[13px] font-medium backdrop-blur transition-colors",
        on ? "text-ink-slate hover:text-ink" : "text-ink-mute",
      )}
    >
      {on ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      <span
        className="size-2 rounded-full"
        style={{ background: color, opacity: on ? 1 : 0.4 }}
      />
      {label}
    </button>
  );
}

function PlaceRow({
  place,
  onToggle,
  onFly,
  onRemove,
}: {
  place: OrtItem;
  onToggle: () => void;
  onFly: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex min-h-[44px] items-center gap-1 rounded-xl px-1 hover:bg-accent/40">
      {/* Checkbox — 44px touch target around a 20px box */}
      <button
        type="button"
        role="checkbox"
        aria-checked={place.visited}
        aria-label={place.visited ? "Mark as to see" : "Mark as visited"}
        onClick={onToggle}
        className="grid size-11 shrink-0 place-items-center rounded-full"
      >
        <span
          className={cn(
            "grid size-5 place-items-center rounded-md border transition-colors",
            place.visited
              ? "border-transparent bg-brand text-white"
              : "border-hairline bg-canvas",
          )}
        >
          {place.visited && <Check className="size-3.5" />}
        </span>
      </button>

      {/* Label — click flies the map to the pin */}
      <button
        type="button"
        onClick={onFly}
        className="flex min-w-0 flex-1 flex-col items-start py-1.5 text-left"
      >
        <span
          className={cn(
            "max-w-full truncate text-[14px] font-medium",
            place.visited ? "text-ink-mute line-through" : "text-ink",
          )}
        >
          {place.label}
        </span>
        {place.note && (
          <span className="max-w-full truncate text-caption text-ink-steel">
            {place.note}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove place"
        className="grid size-9 shrink-0 place-items-center rounded-full text-ink-mute transition-colors hover:bg-canvas hover:text-ink"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
