import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSONSource, LngLatBounds, Map as MLMap, Marker, NavigationControl } from "maplibre-gl";
import { autoBadges, badgeId, ensureBadgeIds } from "../mapBadges.ts";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowDown, ArrowUp, Bike, ExternalLink, Footprints, Loader2, Plus, Route, Send, Sparkles, X } from "lucide-react";
import { api, type Category, type DiscoverItem, type Plan, type PlanStop, type RouteResult, type Spot } from "../api.ts";
import { initialStyle, loadStyle } from "./MapView.tsx";
import { cx } from "./ui.tsx";

/** A place that can be a stop: from the library or from Discover. */
interface Place {
  ref: string;
  name: string;
  lat: number;
  lng: number;
  emoji: string;
  color: string;
  sub: string;
  rating: number;
  group: "food" | "drinks" | "do" | "shop" | "discover";
  spotId?: string;
}

const EXAMPLES = ["Date night in Glockenbach with art and drinks", "Lazy Sunday brunch + flea market + coffee", "Techno night: dinner first, then a club", "Thrift shopping afternoon in Maxvorstadt"];
const STORE_KEY = "spotdrop.plan";

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6371;
};
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const fmtTime = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

function loadSaved(): Plan | null {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function PlanView({ spots, categories, aiOn, seed, onOpenSpot, toast }: {
  spots: Spot[];
  categories: Category[];
  aiOn: boolean;
  /** Stops handed over from elsewhere (e.g. "Turn into a route" on Ask results). */
  seed: Plan | null;
  onOpenSpot: (id: string) => void;
  toast: (m: string) => void;
}) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(() => seed ?? loadSaved());
  const [routeData, setRouteData] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const [radius, setRadius] = useState(0.8);
  const [group, setGroup] = useState<"all" | Place["group"]>("all");
  const [discover, setDiscover] = useState<DiscoverItem[]>([]);

  useEffect(() => {
    if (seed) setPlan(seed);
  }, [seed]);
  useEffect(() => {
    api.discover().then((d) => setDiscover(d.items)).catch(() => {});
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(plan));
    } catch {
      // fine
    }
  }, [plan]);

  // Every place with a map position, from the library and Discover.
  const places = useMemo(() => {
    const cats = new Map(categories.map((c) => [c.id, c]));
    const m = new Map<string, Place>();
    for (const s of spots) {
      if (s.lat == null || s.lng == null || s.status !== "ready") continue;
      const c = cats.get(s.category);
      const bar = s.venue_types.some((v) => ["bar", "wine_bar", "pub"].includes(v));
      m.set(`spot:${s.id}`, {
        ref: `spot:${s.id}`, spotId: s.id, name: s.name, lat: s.lat, lng: s.lng, emoji: c?.emoji ?? "📍", color: c?.color ?? "#ff5a36",
        sub: [s.neighborhood ?? s.city, s.venue_types[0]?.replace("_", " ") ?? s.activity_type, s.cuisines[0]].filter(Boolean).join(" · "),
        rating: (s.specialness ?? 2) + (s.favorite ? 1 : 0) - (s.visited ? 0.5 : 0),
        group: c?.template === "food" ? (bar || s.category === "drinks" ? "drinks" : "food") : s.category === "shopping" ? "shop" : "do",
      });
    }
    for (const d of discover) {
      if (d.lat == null || d.lng == null || d.status === "hidden" || d.status === "disliked") continue;
      m.set(`discover:${d.id}`, {
        ref: `discover:${d.id}`, name: d.title, lat: d.lat, lng: d.lng, emoji: "🔭", color: "#0891b2",
        sub: [d.neighborhood ?? d.venue, d.date_start ? new Date(`${d.date_start}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null].filter(Boolean).join(" · "),
        rating: 2 + (d.score ?? 0.5) * 2, group: "discover",
      });
    }
    return m;
  }, [spots, categories, discover]);

  const stops = useMemo(() => (plan?.stops ?? []).map((s) => ({ ...s, place: places.get(s.ref) })).filter((s): s is PlanStop & { place: Place } => Boolean(s.place)), [plan, places]);

  // Route through the stops whenever they or the mode change.
  const routeKey = `${plan?.mode}|${stops.map((s) => s.ref).join(",")}`;
  useEffect(() => {
    if (!plan || stops.length < 2) return setRouteData(null);
    let cancelled = false;
    setRouting(true);
    api.route(plan.mode, stops.map((s) => [s.place.lng, s.place.lat]))
      .then((r) => !cancelled && setRouteData(r))
      .catch((e) => !cancelled && toast((e as Error).message))
      .finally(() => !cancelled && setRouting(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // Recommendations: not in the plan, within the radius of any stop.
  const recs = useMemo(() => {
    if (!stops.length) return [];
    const inPlan = new Set(stops.map((s) => s.ref));
    return [...places.values()]
      .filter((p) => !inPlan.has(p.ref) && (group === "all" || p.group === group))
      .map((p) => ({ p, d: Math.min(...stops.map((s) => km(p, s.place))) }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => b.p.rating - a.p.rating || a.d - b.d)
      .slice(0, 14);
  }, [places, stops, radius, group]);

  const ask = async (text: string) => {
    if (!text.trim()) return;
    setRequest(text);
    setBusy(true);
    try {
      const p = await api.plan(text);
      if (p.stops.length < 2) toast("Found fewer than two places with a map position for that — try something broader.");
      setPlan(p);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const update = (fn: (s: PlanStop[]) => PlanStop[]) => setPlan((p) => p && { ...p, stops: fn(p.stops) });
  const move = (i: number, dir: -1 | 1) => update((s) => {
    const next = [...s];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    return next;
  });
  /** Insert where it adds the least detour. */
  const addStop = (p: Place) => update((s) => {
    const pts = s.map((x) => places.get(x.ref)).filter(Boolean) as Place[];
    let best = s.length;
    let bestCost = Infinity;
    for (let i = 0; i <= pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const cost = (a ? km(a, p) : 0) + (b ? km(p, b) : 0) - (a && b ? km(a, b) : 0);
      if (cost < bestCost) [bestCost, best] = [cost, i];
    }
    const next = [...s];
    next.splice(best, 0, { ref: p.ref, time: null, reason: "Added by you" });
    return next;
  });

  const gmaps = stops.length >= 2
    ? `https://www.google.com/maps/dir/?api=1&origin=${stops[0].place.lat},${stops[0].place.lng}&destination=${stops.at(-1)!.place.lat},${stops.at(-1)!.place.lng}${stops.length > 2 ? `&waypoints=${stops.slice(1, -1).map((s) => `${s.place.lat},${s.place.lng}`).join("|")}` : ""}&travelmode=${plan?.mode === "bike" ? "bicycling" : "walking"}`
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 pb-4">
      {/* Ask for a plan */}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(request); }}>
        <div className="relative flex-1">
          <Sparkles size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-accent" />
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            disabled={!aiOn}
            placeholder={aiOn ? "Plan something… e.g. “date night in Glockenbach with art and drinks on Friday”" : "Add an API key in Settings to plan with AI"}
            className="w-full rounded-2xl border border-line bg-card py-3 pl-11 pr-4 text-[15px] outline-none focus:border-accent disabled:opacity-60"
          />
        </div>
        <button disabled={!aiOn || busy || !request.trim()} className="flex items-center gap-2 rounded-2xl bg-accent px-5 font-medium text-white hover:brightness-110 disabled:opacity-50">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} <span className="hidden sm:inline">Plan</span>
        </button>
      </form>
      {!plan && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => ask(ex)} disabled={!aiOn} className="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium hover:border-accent hover:text-accent">{ex}</button>
          ))}
        </div>
      )}

      {plan && (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[380px_1fr]">
          {/* Stops + recommendations */}
          <div className="scrollbar-thin min-h-0 space-y-4 overflow-y-auto lg:max-h-[calc(100vh-13rem)]">
            <div>
              <h2 className="font-display text-2xl font-semibold leading-tight">{plan.title}</h2>
              <p className="mt-1 text-sm text-muted">{plan.summary}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl border border-line bg-card p-0.5 text-sm">
                {([["foot", Footprints, "Walk"], ["bike", Bike, "Bike"]] as const).map(([m, Icon, label]) => (
                  <button key={m} onClick={() => setPlan({ ...plan, mode: m })} className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium", plan.mode === m ? "bg-ink text-paper" : "text-muted hover:text-ink")}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
              {routeData && <span className="text-sm text-muted"><Route size={14} className="-mt-0.5 inline" /> {fmtDist(routeData.distance)} · {fmtTime(routeData.duration)}</span>}
              {routing && <Loader2 size={14} className="animate-spin text-muted" />}
              {gmaps && (
                <a href={gmaps} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110">
                  Google Maps <ExternalLink size={12} />
                </a>
              )}
            </div>

            <ol className="space-y-1.5">
              {stops.map((s, i) => (
                <li key={s.ref}>
                  {i > 0 && routeData?.legs[i - 1] && (
                    <p className="py-1 pl-11 text-[11px] text-muted">↓ {fmtDist(routeData.legs[i - 1].distance)} · {fmtTime(routeData.legs[i - 1].duration)}</p>
                  )}
                  <div className="group flex items-start gap-3 rounded-2xl border border-line bg-card p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: s.place.color }}>{i + 1}</span>
                    <button className="min-w-0 flex-1 text-left" onClick={() => s.place.spotId && onOpenSpot(s.place.spotId)}>
                      <span className="block truncate text-sm font-semibold">{s.place.emoji} {s.place.name}</span>
                      <span className="block truncate text-xs text-muted">{[s.time, s.place.sub].filter(Boolean).join(" · ")}</span>
                      <span className="block text-xs text-ink/75">{s.reason}</span>
                    </button>
                    <span className="flex shrink-0 flex-col opacity-60 group-hover:opacity-100">
                      <button disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 hover:bg-line/60 disabled:opacity-20" aria-label="Move up"><ArrowUp size={13} /></button>
                      <button disabled={i === stops.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 hover:bg-line/60 disabled:opacity-20" aria-label="Move down"><ArrowDown size={13} /></button>
                    </span>
                    <button onClick={() => update((x) => x.filter((y) => y.ref !== s.ref))} className="rounded p-0.5 text-muted hover:text-red-500" aria-label="Remove stop"><X size={14} /></button>
                  </div>
                </li>
              ))}
            </ol>

            {/* Recommendations around the route */}
            <div className="space-y-2 rounded-2xl border border-line bg-card/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Nearby ideas</h3>
                <span className="text-xs text-muted">within {radius < 1 ? `${Math.round(radius * 1000)} m` : `${radius.toFixed(1)} km`}</span>
              </div>
              <input type="range" min={0.2} max={3} step={0.1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" aria-label="Radius" />
              <div className="flex flex-wrap gap-1">
                {([["all", "All"], ["food", "🍽️ Food"], ["drinks", "🍸 Drinks"], ["do", "🗺️ Do"], ["shop", "🛍️ Shops"], ["discover", "🔭 Discover"]] as const).map(([g, label]) => (
                  <button key={g} onClick={() => setGroup(g)} className={cx("rounded-full border px-2.5 py-0.5 text-xs font-medium", group === g ? "border-ink bg-ink text-paper" : "border-line hover:border-accent")}>{label}</button>
                ))}
              </div>
              {recs.length ? (
                <ul className="space-y-1">
                  {recs.map(({ p, d }) => (
                    <li key={p.ref} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-paper">
                      <span className="text-base">{p.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-[11px] text-muted">{fmtDist(d * 1000)} away{p.sub ? ` · ${p.sub}` : ""}</span>
                      </span>
                      <button onClick={() => addStop(p)} className="flex items-center gap-0.5 rounded-lg bg-accent-soft px-2 py-1 text-xs font-semibold text-accent hover:bg-accent hover:text-white">
                        <Plus size={12} /> Add
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">Nothing saved within this radius. Drag the slider to widen it.</p>
              )}
            </div>
            <button onClick={() => { setPlan(null); setRouteData(null); setRequest(""); }} className="text-xs font-medium text-muted hover:text-ink">Clear plan</button>
          </div>

          <PlanMap stops={stops.map((s) => s.place)} route={routeData} recs={recs.map((r) => r.p)} onAdd={addStop} />
        </div>
      )}
    </div>
  );
}

/** Numbered stops, the route line, and recommendation dots you can click to add. */
function PlanMap({ stops, route, recs, onAdd }: { stops: Place[]; route: RouteResult | null; recs: Place[]; onAdd: (p: Place) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const recsRef = useRef(recs);
  recsRef.current = recs;

  useEffect(() => {
    let m: MLMap | null = null;
    let ro: ResizeObserver | null = null;
    const style = initialStyle();
    loadStyle(style).then((json) => {
      if (!el.current) return;
      m = new MLMap({ container: el.current, style: json as never, center: [11.5755, 48.1372], zoom: 13, attributionControl: { compact: true } });
      m.addControl(new NavigationControl({ showCompass: false }), "top-right");
      m.scrollZoom.setWheelZoomRate(1 / 300);
      ro = new ResizeObserver(() => m?.resize());
      ro.observe(el.current);
      m.on("load", () => {
        m!.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m!.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
        m!.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#ff5a36", "line-width": 4.5 }, layout: { "line-cap": "round", "line-join": "round" } });
        m!.addSource("recs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        autoBadges(m!);
        m!.addLayer({ id: "recs", type: "symbol", source: "recs", layout: { "icon-image": ["get", "icon"], "icon-size": 0.75, "icon-allow-overlap": true }, paint: { "icon-opacity": 0.9 } });
        m!.addLayer({ id: "recs-label", type: "symbol", source: "recs", minzoom: 14, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true }, paint: { "text-color": style === "night" ? "#f4eee7" : "#1d1a17", "text-halo-color": style === "night" ? "#14110f" : "#ffffff", "text-halo-width": 1.4 } });
        m!.on("click", "recs", (e) => {
          const ref = e.features?.[0]?.properties?.ref;
          const p = recsRef.current.find((r) => r.ref === ref);
          if (p) onAddRef.current(p);
        });
        m!.on("mouseenter", "recs", () => (m!.getCanvas().style.cursor = "pointer"));
        m!.on("mouseleave", "recs", () => (m!.getCanvas().style.cursor = ""));
        setReady(true);
      });
      map.current = m;
    });
    return () => {
      ro?.disconnect();
      m?.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  // Numbered stop markers + frame them.
  const stopKey = stops.map((s) => s.ref).join(",");
  useEffect(() => {
    if (!ready || !map.current) return;
    for (const mk of markers.current) mk.remove();
    markers.current = stops.map((s, i) => {
      const node = document.createElement("div");
      node.style.cssText = `width:30px;height:30px;border-radius:50%;background:${s.color};color:#fff;font:700 14px system-ui;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.35)`;
      node.textContent = String(i + 1);
      node.title = s.name;
      return new Marker({ element: node }).setLngLat([s.lng, s.lat]).addTo(map.current!);
    });
    if (stops.length) {
      const b = new LngLatBounds();
      for (const s of stops) b.extend([s.lng, s.lat]);
      map.current.fitBounds(b, { padding: 90, maxZoom: 15.5, duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopKey, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("route") as GeoJSONSource).setData(
      route ? { type: "Feature", geometry: route.geometry, properties: {} } : { type: "FeatureCollection", features: [] },
    );
  }, [route, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    ensureBadgeIds(map.current, recs.map((p) => badgeId(p.emoji, p.color)));
    (map.current.getSource("recs") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: recs.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { ref: p.ref, name: p.name, color: p.color, icon: badgeId(p.emoji, p.color) } })),
    });
  }, [recs, ready]);

  return (
    <div className="relative min-h-[420px] overflow-hidden rounded-2xl border border-line lg:h-[calc(100vh-13rem)]">
      <div ref={el} className="h-full min-h-[420px] w-full" />
      <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-card/90 px-3 py-1.5 text-xs shadow backdrop-blur">Small dots = nearby ideas · click one to add it</p>
    </div>
  );
}
