// Natural-language day/evening plans from the user's own saves + Discover finds, and real routes
// between the stops (OpenStreetMap routing: walking or cycling, free, no key).
import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./usage.ts";
import { apiKey, getSettings } from "./config.ts";
import { db, listCategories, listSpots } from "./db.ts";

export interface Candidate {
  ref: string; // "spot:<id>" or "discover:<id>"
  name: string;
  line: string;
}

/** Everything that has a map position: library items and upcoming Discover finds. */
export function planCandidates(): Candidate[] {
  const cats = new Map(listCategories().map((c) => [c.id, c.name]));
  const out: Candidate[] = [];
  for (const s of listSpots()) {
    if (s.status !== "ready" || s.lat == null || s.lng == null) continue;
    const facts = [
      cats.get(String(s.category)),
      s.neighborhood ?? s.city,
      [...(s.venue_types as string[]), ...(s.cuisines as string[])].slice(0, 3).join("/"),
      (s.meals as string[]).join("/"),
      (s.drinks as string[]).slice(0, 2).join("/"),
      s.activity_type,
      s.price != null ? "$".repeat(Number(s.price)) || "free" : "",
      s.specialness ? `${s.specialness}/5` : "",
      s.date_start ? `on ${s.date_start}${s.date_end ? `–${s.date_end}` : ""}${s.event_time ? ` ${s.event_time}` : ""}` : "",
      s.visited ? "been there" : "",
      s.favorite ? "saved" : "",
    ].filter(Boolean).join(" · ");
    out.push({ ref: `spot:${s.id}`, name: String(s.name), line: `${s.name} — ${facts}` });
  }
  const today = new Date().toISOString().slice(0, 10);
  const finds = db.prepare(`SELECT * FROM discover WHERE status NOT IN ('hidden','disliked','saved') AND lat IS NOT NULL
                            AND (COALESCE(date_end, date_start) IS NULL OR COALESCE(date_end, date_start) >= ?)`).all(today) as Record<string, unknown>[];
  for (const d of finds) {
    const facts = [`Discover: ${d.topic}`, d.neighborhood ?? d.venue, d.date_start ? `on ${d.date_start}${d.event_time ? ` ${d.event_time}` : ""}` : "", d.price].filter(Boolean).join(" · ");
    out.push({ ref: `discover:${d.id}`, name: String(d.title), line: `${d.title} — ${facts}` });
  }
  return out;
}

const TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_plan",
  description: "Submit the plan. Call exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "mode", "stops"],
    properties: {
      title: { type: "string", description: "Short title, e.g. 'Art & cocktails in Glockenbach'." },
      summary: { type: "string", description: "1-2 sentences: the idea of the plan and anything to know (dates, reservations)." },
      mode: { type: "string", enum: ["foot", "bike"], description: "foot if stops are close (< ~1.5 km apart), else bike." },
      stops: {
        type: "array",
        description: "2-6 stops in visiting order, geographically sensible (no zig-zag).",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item", "time", "reason"],
          properties: {
            item: { type: "integer", description: "Number from the candidate list." },
            time: { type: ["string", "null"], description: "Suggested time, e.g. '19:00'. null if not time-bound." },
            reason: { type: "string", description: "Why this stop, max ~12 words." },
          },
        },
      },
    },
  } as Anthropic.Beta.BetaTool.InputSchema,
};

export interface Plan {
  title: string;
  summary: string;
  mode: "foot" | "bike";
  stops: { ref: string; time: string | null; reason: string }[];
}

export async function makePlan(request: string): Promise<Plan> {
  if (!apiKey()) throw new Error("Add an Anthropic API key in Settings to plan.");
  const settings = getSettings();
  const cands = planCandidates();
  if (cands.length < 2) throw new Error("Not enough places with a map position yet.");
  const when = new Date().toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const client = new Anthropic({ apiKey: apiKey() });
  const r = await client.beta.messages.create({
    model: settings.model,
    max_tokens: 4000,
    system: [{
      type: "text",
      text: `You plan outings in ${settings.homeCity} using ONLY the user's own saved places and their Discover finds listed below. Build a realistic, enjoyable sequence: sensible order and geography, fitting times of day, respect dates of events (only include a dated event if it's on the requested day), prefer highly rated places they haven't been to. Call submit_plan.\n\nCandidates:\n${cands.map((c, i) => `${i}. ${c.line}`).join("\n")}`,
      cache_control: { type: "ephemeral" },
    }],
    tools: [TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: `Now: ${when}.\nRequest: ${request}` }],
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  recordUsage("plan", r);
  if (r.stop_reason === "refusal") throw new Error("Claude declined this request.");
  const call = r.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL.name);
  if (!call) throw new Error("Couldn't build a plan. Try rephrasing.");
  const input = call.input as { title: string; summary: string; mode: "foot" | "bike"; stops: { item: number; time: string | null; reason: string }[] };
  return {
    title: input.title,
    summary: input.summary,
    mode: input.mode === "bike" ? "bike" : "foot",
    stops: (input.stops ?? []).filter((s) => cands[s.item]).map((s) => ({ ref: cands[s.item].ref, time: s.time ?? null, reason: s.reason })),
  };
}

// ---- routing -------------------------------------------------------------------------
const ROUTERS = { foot: "routed-foot", bike: "routed-bike" } as const;
const routeCache = new Map<string, unknown>();

/** Route through the given [lng, lat] points (OpenStreetMap / OSRM, free public service, cached). */
export async function route(mode: "foot" | "bike", points: [number, number][]) {
  const coords = points.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const key = `${mode}:${coords}`;
  if (routeCache.has(key)) return routeCache.get(key);
  const url = `https://routing.openstreetmap.de/${ROUTERS[mode]}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url, { headers: { "User-Agent": "Spotdrop/1.0 (self-hosted personal app)" } });
  if (!res.ok) throw new Error(`Routing service: ${res.status}`);
  const data = (await res.json()) as { code: string; routes?: { distance: number; duration: number; geometry: unknown; legs: { distance: number; duration: number }[] }[] };
  if (data.code !== "Ok" || !data.routes?.[0]) throw new Error("No route found between these stops.");
  const r0 = data.routes[0];
  // OSRM's public bike/foot speeds are optimistic/pessimistic; use common real-world paces instead.
  const speed = mode === "foot" ? 4.8 : 15; // km/h
  const legs = r0.legs.map((l) => ({ distance: l.distance, duration: (l.distance / 1000 / speed) * 3600 }));
  const out = { geometry: r0.geometry, distance: r0.distance, duration: legs.reduce((a, l) => a + l.duration, 0), legs };
  if (routeCache.size > 200) routeCache.clear();
  routeCache.set(key, out);
  return out;
}
