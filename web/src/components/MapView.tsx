import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSONSource, LngLatBounds, Map as MLMap, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import { autoBadges, badgeId, ensureBadgeIds } from "../mapBadges.ts";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Home } from "lucide-react";
import { type Category, type Spot } from "../api.ts";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // shipped by the vite plugin in vite.config.ts

// Free OpenStreetMap vector tiles from OpenFreeMap: no API key, no account.
export type MapStyle = "detailed" | "light" | "night";
const STYLE_URL: Record<MapStyle, string> = {
  detailed: "https://tiles.openfreemap.org/styles/liberty", // full detail: shops, cafés, transit, buildings
  light: "https://tiles.openfreemap.org/styles/positron",
  night: "https://tiles.openfreemap.org/styles/liberty", // same detail, recolored dark below
};

// ---- "Night": the detailed style with its colors flipped to dark (keeps every label and POI) ----
function parseColor(c: string): { h: number; s: number; l: number; a: number } | null {
  let r: number, g: number, b: number, a = 1;
  const hex = c.match(/^#([0-9a-f]{3,8})$/i);
  const fn = c.match(/^(rgba?|hsla?)\(([^)]+)\)$/i);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split("").map((x) => x + x).join("");
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else if (fn) {
    const parts = fn[2].split(/[\s,/%]+/).filter(Boolean).map((v) => parseFloat(v));
    if (fn[1].toLowerCase().startsWith("hsl")) return { h: parts[0], s: parts[1], l: parts[2], a: parts[3] ?? 1 };
    [r, g, b] = parts.slice(0, 3).map((v) => v / 255);
    a = parts[3] ?? 1;
  } else return null;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return { h, s: sat * 100, l: l * 100, a };
}
function nightColor(v: unknown): unknown {
  if (typeof v === "string") {
    const c = parseColor(v.trim());
    if (!c) return v;
    const l = Math.min(90, Math.max(8, 100 - c.l * 0.92));
    return `hsla(${c.h.toFixed(0)}, ${(c.s * 0.7).toFixed(0)}%, ${l.toFixed(0)}%, ${c.a})`;
  }
  return Array.isArray(v) ? v.map(nightColor) : v;
}
export async function loadStyle(kind: MapStyle): Promise<unknown> {
  const style = (await (await fetch(STYLE_URL[kind])).json()) as { layers: { paint?: Record<string, unknown> }[] };
  if (kind === "night") {
    for (const layer of style.layers) for (const [k, v] of Object.entries(layer.paint ?? {})) if (k.endsWith("color")) layer.paint![k] = nightColor(v);
  }
  return style;
}

export function initialStyle(): MapStyle {
  try {
    const v = localStorage.getItem("spotdrop.mapstyle");
    if (v === "detailed" || v === "light" || v === "night") return v;
  } catch {
    // fine
  }
  return "detailed";
}
const MUNICH: [number, number] = [11.5755, 48.1372];
const FONT = ["Noto Sans Bold"];

export function useDark() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return dark;
}

/** Frame the spots around home if there are any: most searches are for Munich, far-away saves shouldn't zoom out the map. */
function focusBounds(spots: Spot[], home: [number, number]) {
  const near = spots.filter((s) => Math.abs(s.lat! - home[1]) < 0.25 && Math.abs(s.lng! - home[0]) < 0.35);
  const use = near.length > 0 ? near : spots;
  const b = new LngLatBounds();
  for (const s of use) b.extend([s.lng!, s.lat!]);
  return b;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Props {
  spots: Spot[];
  categories: Category[];
  homeCenter?: [number, number] | null;
  homeLabel?: string;
  /** Zoom to fit the results (e.g. after a search) instead of keeping the home view. */
  fitToResults: boolean;
  onOpen: (id: string) => void;
}

export function MapView({ spots, categories, homeCenter, homeLabel = "Munich", fitToResults, onOpen }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyle>(initialStyle);
  const dark = mapStyle === "night";
  const [styleJson, setStyleJson] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    try {
      localStorage.setItem("spotdrop.mapstyle", mapStyle);
    } catch {
      // fine
    }
    loadStyle(mapStyle)
      .then((j) => !cancelled && setStyleJson(j))
      .catch(() => !cancelled && setStyleJson(STYLE_URL[mapStyle]));
    return () => {
      cancelled = true;
    };
  }, [mapStyle]);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const home = homeCenter ?? MUNICH;

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const located = useMemo(() => spots.filter((s) => s.lat != null && s.lng != null), [spots]);
  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: located.map((s) => {
        const c = byId.get(s.category);
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [s.lng!, s.lat!] },
          properties: {
            id: s.id,
            name: s.name,
            color: c?.color ?? "#ff5a36",
            emoji: c?.emoji ?? "📍",
            sub: [s.neighborhood, s.city].filter(Boolean).join(", "),
            special: s.specialness ?? 0,
            icon: badgeId(c?.emoji ?? "📍", c?.color ?? "#ff5a36", (s.specialness ?? 0) >= 4),
          },
        };
      }),
    }),
    [located, byId],
  );

  // Create the map once per style.
  useEffect(() => {
    if (!el.current || !styleJson) return;
    const m = new MLMap({
      container: el.current,
      style: styleJson as never,
      center: home,
      zoom: 12.5,
      attributionControl: { compact: true },
      fadeDuration: 0,
      minZoom: 3,
      maxZoom: 19,
      renderWorldCopies: false,
    });
    // Smooth, predictable wheel/trackpad zoom (default is quite jumpy on Mac trackpads).
    m.scrollZoom.setWheelZoomRate(1 / 300);
    m.scrollZoom.setZoomRate(1 / 120);
    // Keep the canvas in sync with its container, otherwise zoom centers on the wrong point.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      // Cluster only when zoomed far out; in the city every place shows its own category badge.
      m.addSource("spots", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 22, clusterMaxZoom: 10 });
      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "spots",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#ffffff",
          "circle-opacity": 0.95,
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 24],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#1d1a17",
        },
      });
      m.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "spots",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FONT, "text-size": 13, "text-allow-overlap": true },
        paint: { "text-color": "#1d1a17" },
      });
      autoBadges(m);
      // Icon + name for every place; names hide automatically where they would overlap.
      m.addLayer({
        id: "points",
        type: "symbol",
        source: "spots",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 1],
          "icon-allow-overlap": true,
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 16, 13],
          "text-anchor": "left",
          "text-offset": [1.15, 0],
          "text-max-width": 12,
          "text-optional": true,
          "symbol-sort-key": ["-", 10, ["get", "special"]],
        },
        paint: { "text-color": dark ? "#f4eee7" : "#1d1a17", "text-halo-color": dark ? "#14110f" : "#ffffff", "text-halo-width": 1.6 },
      });

      m.on("click", "clusters", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = m.getSource("spots") as GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.3 });
      });
      m.on("click", "points", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        const node = document.createElement("button");
        node.className = "spot-popup";
        node.innerHTML = `<span class="spot-popup-emoji">${esc(p.emoji)}</span><span><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></span>`;
        node.onclick = () => onOpenRef.current(p.id);
        new Popup({ closeButton: false, offset: 12, maxWidth: "260px" })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setDOMContent(node)
          .addTo(m);
      });
      for (const layer of ["clusters", "points"]) {
        m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
      }
      setReady(true);
    });
    map.current = m;
    return () => {
      ro.disconnect();
      setReady(false);
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleJson]);

  // Push data updates without re-creating the map.
  useEffect(() => {
    if (!ready || !map.current) return;
    ensureBadgeIds(map.current, geojson.features.map((f) => f.properties.icon));
    (map.current.getSource("spots") as GeoJSONSource | undefined)?.setData(geojson);
  }, [geojson, ready, categories]);

  // Searching/filtering: frame the results.
  const resultKey = fitToResults ? located.map((s) => s.id).join(",") : "";
  useEffect(() => {
    if (!ready || !map.current || !fitToResults || !located.length) return;
    map.current.fitBounds(focusBounds(located, home), { padding: 80, maxZoom: 15, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey, ready]);

  const mappable = new Set(categories.filter((c) => c.template === "food" || c.template === "place").map((c) => c.id));
  const missing = spots.filter((s) => mappable.has(s.category) && s.kind !== "food" && (s.lat == null || s.lng == null)).length;

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-line">
      <div ref={el} className="h-full w-full" />
      <div className="absolute left-3 top-3 z-10 flex gap-2">
        <button
          onClick={() => map.current?.flyTo({ center: home, zoom: 12.5, duration: 800 })}
          className="flex items-center gap-1.5 rounded-full bg-card/95 px-3 py-1.5 text-xs font-medium shadow backdrop-blur hover:text-accent"
        >
          <Home size={13} /> {homeLabel}
        </button>
        {located.length > 0 && (
          <button
            onClick={() => {
              map.current?.fitBounds(focusBounds(located, home), { padding: 80, maxZoom: 15, duration: 600 });
            }}
            className="flex items-center gap-1.5 rounded-full bg-card/95 px-3 py-1.5 text-xs font-medium shadow backdrop-blur hover:text-accent"
          >
            <Crosshair size={13} /> Fit spots
          </button>
        )}
      </div>
      <div className="absolute bottom-9 right-3 z-10 flex rounded-full bg-card/95 p-0.5 text-xs shadow backdrop-blur">
        {(["detailed", "light", "night"] as const).map((st) => (
          <button
            key={st}
            onClick={() => setMapStyle(st)}
            className={`rounded-full px-2.5 py-1 font-medium capitalize transition ${mapStyle === st ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
          >
            {st}
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex gap-2 text-xs">
        <span className="rounded-full bg-card/90 px-3 py-1.5 font-medium shadow backdrop-blur">{located.length} on the map</span>
        {missing > 0 && <span className="rounded-full bg-card/90 px-3 py-1.5 text-muted shadow backdrop-blur">{missing} without location</span>}
      </div>
    </div>
  );
}
