// Discover: a separate feed of new things in Munich picked from the web for this user's taste.
// On "Refresh", four AI scouts run in parallel, each with web search + web fetch (Anthropic's crawler,
// which respects robots.txt — no scraping around bot protection), and return structured finds.
import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./usage.ts";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DATA_DIR, apiKey, getSettings } from "./config.ts";
import { db, listSpots, newId, now } from "./db.ts";
import { normalizeName } from "./dedupe.ts";
import { geocode } from "./geocode.ts";
import { getAccounts, getPrefs, tasteText } from "./taste.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS discover (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT,
  why TEXT,
  date_start TEXT,
  date_end TEXT,
  event_time TEXT,
  venue TEXT,
  address TEXT,
  neighborhood TEXT,
  lat REAL,
  lng REAL,
  url TEXT,
  source TEXT,
  price TEXT,
  score REAL,
  status TEXT NOT NULL DEFAULT 'new',   -- new | liked | disliked | hidden | saved
  spot_id TEXT
);
`);

{
  const cols = new Set((db.prepare("PRAGMA table_info(discover)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("image")) db.exec("ALTER TABLE discover ADD COLUMN image TEXT"); // file name, or 'none' if the source had none
  if (!cols.has("genres")) db.exec("ALTER TABLE discover ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'"); // techno sub-genres (JSON)
  if (!cols.has("collective")) db.exec("ALTER TABLE discover ADD COLUMN collective TEXT"); // promoter / crew behind a party
  if (!cols.has("search_id")) db.exec("ALTER TABLE discover ADD COLUMN search_id TEXT"); // set = result of a "find new places" search, not the feed
  if (!cols.has("search_category")) db.exec("ALTER TABLE discover ADD COLUMN search_category TEXT"); // library category it goes to when saved
}
export const DISCOVER_IMAGES = path.join(DATA_DIR, "discover-images");
fs.mkdirSync(DISCOVER_IMAGES, { recursive: true });

/** The source page's own preview picture (og:image / twitter:image), stored as a small local copy. */
async function fetchPreviewImage(id: string, url: string): Promise<string> {
  const get = (u: string, ms: number) => fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Spotdrop/1.0; personal app)", Accept: "text/html,image/*" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  const page = await get(url, 10_000);
  if (!page.ok || !/html/i.test(page.headers.get("content-type") ?? "")) return "none";
  const html = (await page.text()).slice(0, 600_000);
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1];
  const src = meta("og:image") ?? meta("og:image:url") ?? meta("twitter:image");
  if (!src) return "none";
  const imgUrl = new URL(src.replace(/&amp;/g, "&"), page.url).toString();
  const img = await get(imgUrl, 10_000);
  if (!img.ok) return "none";
  const buf = Buffer.from(await img.arrayBuffer());
  if (buf.length > 10_000_000) return "none";
  const file = `${id}.webp`;
  await sharp(buf, { failOn: "none" }).resize({ width: 560, height: 360, fit: "cover" }).webp({ quality: 68 }).toFile(path.join(DISCOVER_IMAGES, file));
  return file;
}

let imagesRunning = false;
/** Fetch preview pictures for finds that don't have one yet (one at a time, polite). */
export async function fillDiscoverImages() {
  if (imagesRunning) return;
  imagesRunning = true;
  try {
    const rows = db.prepare("SELECT id, url FROM discover WHERE image IS NULL AND url IS NOT NULL AND status != 'hidden'").all() as { id: string; url: string }[];
    let n = 0;
    for (const r of rows) {
      let file = "none";
      try {
        file = await fetchPreviewImage(r.id, r.url);
      } catch {
        // blocked / timeout: leave it without a picture
      }
      db.prepare("UPDATE discover SET image = ? WHERE id = ?").run(file, r.id);
      if (file !== "none") n++;
    }
    if (rows.length) console.log(`[discover] pictures: ${n}/${rows.length} sources had a preview image`);
  } finally {
    imagesRunning = false;
  }
}

export const TOPICS = {
  food: { label: "Food & pop-ups", emoji: "🍜" },
  thrift: { label: "Thrift & vintage", emoji: "🧥" },
  jewellery: { label: "Jewellery", emoji: "💍" },
  flea_market: { label: "Flohmarkt", emoji: "🧺" },
  festival: { label: "Festivals", emoji: "🎪" },
  music: { label: "Techno & raves", emoji: "🎧" },
  event: { label: "Events", emoji: "🎟️" },
  car_meet: { label: "Car meets", emoji: "🏎️" },
  unique: { label: "Unique", emoji: "✨" },
} as const;
type Topic = keyof typeof TOPICS;

/** Sub-genres for techno/rave finds (Discover → 🎧 Techno). */
export const GENRES = {
  hard_techno: "Hard techno", schranz: "Schranz", hardgroove: "Hardgroove", bounce: "Bounce", trance: "Trance", psytrance: "Psytrance",
  hardstyle: "Hardstyle", hardcore: "Hardcore / gabber", industrial: "Industrial / EBM", acid: "Acid", peak_time: "Peak-time techno",
  raw_techno: "Raw / dark techno", hypnotic: "Hypnotic / dub techno", minimal: "Minimal / tech house", melodic: "Melodic techno", eurodance: "Eurodance / 90s", breaks: "Breaks / UKG / jungle",
} as const;

interface Find {
  title: string;
  topic: Topic;
  kind: "event" | "place" | "popup";
  description: string;
  why: string;
  date_start: string | null;
  date_end: string | null;
  time: string | null;
  venue: string | null;
  address: string | null;
  neighborhood: string | null;
  url: string | null;
  source: string | null;
  price: string | null;
  score: number;
  genres: string[];
  collective: string | null;
}

const TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_finds",
  description: "Submit everything you found. Call exactly once at the end.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["finds"],
    properties: {
      finds: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "topic", "kind", "description", "why", "date_start", "date_end", "time", "venue", "address", "neighborhood", "url", "source", "price", "score", "genres", "collective"],
          properties: {
            title: { type: "string", description: "Name of the event / place / pop-up, as officially written." },
            topic: { type: "string", enum: Object.keys(TOPICS) },
            kind: { type: "string", enum: ["event", "place", "popup"], description: "event = happens on a date; popup = temporary food/shop pop-up; place = a permanent spot (store, café…)." },
            description: { type: "string", description: "1-2 factual sentences: what it is." },
            why: { type: "string", description: "One short sentence: why this fits this user's taste." },
            date_start: { type: ["string", "null"], description: "YYYY-MM-DD for events/pop-ups. null for permanent places." },
            date_end: { type: ["string", "null"], description: "YYYY-MM-DD last day, multi-day only." },
            time: { type: ["string", "null"], description: "e.g. '23:00', '11–18 Uhr'." },
            venue: { type: ["string", "null"] },
            address: { type: ["string", "null"], description: "Street address in Munich if known." },
            neighborhood: { type: ["string", "null"] },
            url: { type: ["string", "null"], description: "The page where you found it (event page, venue site, article). Required unless truly none." },
            source: { type: ["string", "null"], description: "Short source name, e.g. 'rausgegangen.de', 'Mit Vergnügen', 'Instagram @account', 'venue website'." },
            price: { type: ["string", "null"], description: "e.g. 'free', '15 €', 'from 8 €'." },
            score: { type: "number", description: "0-1: how well it fits the user's taste." },
            genres: { type: "array", items: { type: "string", enum: Object.keys(GENRES) }, description: "For parties/raves/club nights only: 1-3 sub-genres judged from the lineup, event text and the collective's usual sound. Empty for everything else." },
            collective: { type: ["string", "null"], description: "Collective / promoter / crew hosting the party (e.g. the label or rave series), if known. null otherwise." },
          },
        },
      },
    },
  } as Anthropic.Beta.BetaTool.InputSchema,
};

interface Scout {
  key: string;
  label: string;
  brief: string;
  /** Part of the 🎧 Techno group (can be refreshed on its own). */
  techno?: boolean;
}

export function scouts(accounts: string[]): Scout[] {
  const ig = accounts.length ? `Accounts the user follows: ${accounts.map((x) => "@" + x).join(", ")}.` : "";
  // Techno scouts each cross-check several platforms: no single listing has everything.
  const ravePlatforms = `Use SEVERAL platforms, not just one: Resident Advisor (ra.co/events/de/munich), rausgegangen.de (search "rausgegangen München techno / rave / party" if the page won't open), DICE (dice.fm), Shotgun (shotgun.live), Eventbrite, tixforgigs, Facebook events and Instagram posts as they appear in search results, in-muenchen.de, Mit Vergnügen München, plus the club and collective sites themselves. Name the platform in source.`;
  return [
    {
      key: "techno_clubs",
      label: "Techno · club nights",
      techno: true,
      brief: `Techno club nights in Munich in the next 4 weeks (topic "music"). Go through the listings of: Resident Advisor (ra.co/events/de/munich — fetch it), Blitz, Harry Klein, Bahnwärter Thiel, Neuraum, Rote Sonne, Palais, Import Export, MMA (Mixed Munich Arts), Pacha, Tonhalle/Tonwerk, Sweet Club, Charlie, Bahnhof/Container venues. Prefer nights with a real lineup over generic club parties; note headliners in the description. Tag genres from the lineup. ${ravePlatforms}`,
    },
    {
      key: "techno_hard",
      label: "Trance · bounce · hard techno · schranz",
      techno: true,
      brief: `The harder and faster end, in and around Munich (up to ~1.5 h away: Augsburg, Nuremberg, Ingolstadt, Salzburg) in the next 6 weeks (topic "music"): hard techno, schranz, hardgroove, bounce, trance / hard trance, psytrance, hardstyle, hardcore, industrial. Search e.g. "Hardtechno München", "Schranz Party München", "Bounce Party München", "Trance Rave München", "Hardgroove München", "Psytrance Open Air Bayern", RA listings filtered by these genres, ticket sites (ra.co, eventbrite, tixforgigs, shop.ticketpay), and promoter pages. Tag genres precisely. ${ravePlatforms}`,
    },
    {
      key: "techno_underground",
      label: "Collectives & underground raves",
      techno: true,
      brief: `Small collectives, crews and DIY parties in and around Munich in the next 6 weeks (topic "music"): warehouse / secret-location raves, open airs, boat or bunker parties, label nights, queer & FLINTA* techno nights, Kollektiv/crew series, Free-Open-Airs (e.g. at Isar spots in summer). Find collectives via RA promoter pages, rausgegangen.de (search "rausgegangen München rave / techno"), Mit Vergnügen, Facebook/Instagram events as they appear in search results, local blogs and radio (egoFM, M94.5). Prefer tiny, niche and community-run over big commercial events; always fill in the collective. If dates are only announced as "secret location", still include them with the date. ${ravePlatforms}`,
    },
    {
      key: "events",
      label: "Festivals & events",
      brief: "Festivals, open-airs, concerts, art/culture nights and genuinely special one-off events in Munich in the next 6 weeks. Sources: rausgegangen.de (fetch https://rausgegangen.de/muenchen/ or search 'rausgegangen München'), muenchen.de/veranstaltungen, in-muenchen.de, Mit Vergnügen München, Mucbook. Skip generic tourist events.",
    },
    {
      key: "markets",
      label: "Flohmarkt & car meets",
      brief: "Flea markets (Flohmarkt, Hofflohmärkte, Nachtflohmarkt), vintage/design markets and car meets (Autotreffen, Cars & Coffee, tuning/JDM/oldtimer meets) in and around Munich in the next 6 weeks. IMPORTANT: a recurring series (e.g. the M-net Hofflohmärkte in different districts) is ONE find with the next date; mention the other dates in the description.",
    },
    {
      key: "food",
      label: "Food pop-ups & openings",
      brief: "Crazy/hyped food in Munich: food pop-ups, supper clubs, street-food markets and festivals, new openings and viral spots of the last ~3 months, unusual concepts. Prefer casual, affordable, creative and talked-about over fine dining (no Michelin lists unless it's a pop-up). Sources: Mit Vergnügen München, Mucbook, tz/Abendzeitung 'Neueröffnung', Munich food blogs and food Instagram accounts as they appear in search results.",
    },
    {
      key: "shopping",
      label: "Thrift, vintage & jewellery",
      brief: "Thrift, vintage and second-hand stores in Munich (curated vintage, designer second-hand, kilo sales), jewellery makers, ateliers and jewellery/design markets. Permanent places need an address; dated markets need a date. Avoid big chains.",
    },
    {
      key: "social",
      label: "Instagram & unique",
      brief: `What Munich 'happening' Instagram accounts and local guides are promoting right now: secret events, pop-ups, unusual spots. ${ig} Instagram pages usually can't be opened directly — use search results, articles and the linked event pages. If you can't find Instagram-sourced things, return genuinely unique/quirky Munich things (unusual bars, hidden spots, odd events) from any source instead — never return an empty list.`,
    },
  ];
}

// ---- run state ----
export interface RunState {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  lanes: { key: string; label: string; state: "waiting" | "running" | "done" | "error"; found: number; error?: string }[];
  added: number;
}
let state: RunState = { running: false, started_at: null, finished_at: null, lanes: [], added: 0 };
export const discoverState = () => state;

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const today = () => new Date().toISOString().slice(0, 10);
const fingerprint = (f: { title: string; date_start: string | null }) => `${normalizeName(f.title)}|${f.date_start ?? ""}`;

export async function runScout(scout: Scout, context: string): Promise<Find[]> {
  let best: Find[] = [];
  let followedUp = false;
  const client = new Anthropic({ apiKey: apiKey() });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `${context}\n\nYour assignment:\n${scout.brief}\n\nFind 6-12 varied matches (no near-duplicates). Return AT LEAST 5: if strict criteria leave too few, widen them (later dates, nearby topics, a bit outside Munich) rather than returning fewer. An empty list is never the right answer.
Articles, listicles, guides and calendars are SOURCES, not finds: open them and return each concrete place, event or pop-up in them as its own find (e.g. a "10 new openings" article = up to 10 finds), with that article as url. Use null for anything you don't know (dates for permanent places, price, address…). Then call submit_finds.` }];
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    TOOL,
    // Basic variants on purpose: the dynamic-filtering ones run code, and when that errors the scout tends to give up.
    { type: "web_search_20250305", name: "web_search", max_uses: 8 },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 },
  ];
  for (let turn = 0; turn < 6; turn++) {
    const r = await client.beta.messages.create({
      model: getSettings().model,
      max_tokens: 16000,
      system: "You are a Munich scout finding things for one specific person. Only report real things you found on the web, with the page you found them on. Never invent events, dates or addresses. Skip anything already in the past.",
      tools,
      tool_choice: { type: "auto" },
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    recordUsage(scout.key === "find" ? "find_places" : scout.techno ? "discover_techno" : "discover", r);
    if (r.stop_reason === "refusal") throw new Error("declined");
    if (process.env.DISCOVER_DEBUG) console.log(`[discover] ${scout.key} turn ${turn}: ${r.stop_reason}, ${r.content.filter((b) => b.type === "server_tool_use").length} web calls, blocks: ${r.content.map((b) => b.type).filter((t) => !t.endsWith("result")).join(",")}`);
    const call = r.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL.name);
    if (call) {
      const raw = (call.input as { finds?: unknown }).finds;
      // The model sometimes sends the list as a JSON string instead of an array.
      const list = (typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw) as Find[] | undefined;
      const finds = (Array.isArray(list) ? list : []).filter((f) => f && typeof f.title === "string" && f.title.trim());
      if (process.env.DISCOVER_DEBUG) console.log(`[discover] ${scout.key} submitted ${finds.length}`);
      if (finds.length > best.length) best = finds;
      // Too few: send it back once to look at other sources.
      if (best.length >= 5 || followedUp) return best;
      followedUp = true;
      messages.push({ role: "assistant", content: r.content as Anthropic.Beta.BetaContentBlockParam[] });
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: call.id,
          content: `Only ${finds.length} find(s). Search different sources and angles (other venues, listings, articles, nearby dates) and call submit_finds again with ALL finds — the earlier ones plus new ones, at least 5.`,
        }],
      });
      continue;
    }
    messages.push({ role: "assistant", content: r.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (r.stop_reason !== "pause_turn") messages.push({ role: "user", content: "Now call submit_finds with what you found." });
  }
  return best;
}

export function contextText(): string {
  const liked = (db.prepare("SELECT title FROM discover WHERE status IN ('liked','saved') ORDER BY updated_at DESC LIMIT 25").all() as { title: string }[]).map((r) => r.title);
  const disliked = (db.prepare("SELECT title FROM discover WHERE status = 'disliked' ORDER BY updated_at DESC LIMIT 25").all() as { title: string }[]).map((r) => r.title);
  const known = (db.prepare("SELECT title FROM discover WHERE (date_end IS NULL OR date_end >= ?) AND (date_start IS NULL OR date_start >= ? OR date_end >= ?) ORDER BY created_at DESC LIMIT 120").all(today(), today(), today()) as { title: string }[]).map((r) => r.title);
  const saved = listSpots().slice(0, 150).map((s) => s.name).filter(Boolean);
  const d = new Date();
  return [
    `Today is ${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}. City: Munich (München).`,
    `\nWhat this person says they're into:\n${getPrefs()}`,
    `\nWhat their saved library shows they like:\n${tasteText()}`,
    liked.length ? `\nThey liked these earlier finds: ${liked.join("; ")}` : "",
    disliked.length ? `\nThey did NOT like these (avoid similar): ${disliked.join("; ")}` : "",
    known.length ? `\nAlready in their Discover feed (don't repeat): ${known.join("; ")}` : "",
    saved.length ? `\nAlready saved in their library (don't suggest again): ${saved.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function store(f: Find, lane: string, techno = false, search?: { id: string; category: string }): boolean {
  if (techno && f.kind === "event") f.topic = "music";
  const date_start = iso(f.date_start);
  const date_end = iso(f.date_end) && iso(f.date_end)! >= (date_start ?? "") ? iso(f.date_end) : null;
  if ((date_end ?? date_start) && (date_end ?? date_start)! < today()) return false; // already over
  const topic = (f.topic in TOPICS ? f.topic : "event") as Topic;
  const fp = fingerprint({ title: f.title, date_start });
  const existing = db.prepare("SELECT id, search_id FROM discover WHERE fingerprint = ?").get(fp) as { id: string; search_id: string | null } | undefined;
  if (existing) {
    // Already known: a new search just picks it up again.
    if (search && existing.search_id) db.prepare("UPDATE discover SET search_id = ?, search_category = ?, updated_at = ? WHERE id = ?").run(search.id, search.category, now(), existing.id);
    return Boolean(search && existing.search_id);
  }
  const ts = now();
  const genres = (Array.isArray(f.genres) ? f.genres : []).filter((g) => g in GENRES).slice(0, 4);
  db.prepare(`INSERT INTO discover (id, fingerprint, created_at, updated_at, title, topic, kind, description, why, date_start, date_end, event_time, venue, address, neighborhood, url, source, price, score, genres, collective)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    newId(), fp, ts, ts, f.title.trim().slice(0, 160), topic, ["event", "place", "popup"].includes(f.kind) ? f.kind : date_start ? "event" : "place",
    f.description?.trim() || null, f.why?.trim() || null, date_start, date_end, f.time?.trim() || null, f.venue?.trim() || null,
    f.address?.trim() || null, f.neighborhood?.trim() || null, f.url?.trim() || null, f.source?.trim() || lane, f.price?.trim() || null,
    Math.max(0, Math.min(1, Number(f.score) || 0.5)), JSON.stringify(genres), f.collective?.trim() || null,
  );
  if (search) db.prepare("UPDATE discover SET search_id = ?, search_category = ? WHERE fingerprint = ?").run(search.id, search.category, fp);
  return true;
}

export function refreshDiscover(only?: "techno"): RunState {
  if (state.running) return state;
  if (!apiKey()) throw new Error("Add an Anthropic API key in Settings first.");
  const list = scouts(getAccounts()).filter((s) => only !== "techno" || s.techno);
  state = { running: true, started_at: now(), finished_at: null, added: 0, lanes: list.map((s) => ({ key: s.key, label: s.label, state: "waiting", found: 0 })) };
  const context = contextText();
  (async () => {
    await Promise.all(list.map(async (scout, i) => {
      state.lanes[i].state = "running";
      try {
        const finds = await runScout(scout, context);
        let n = 0;
        for (const f of finds) if (store(f, scout.label, scout.techno)) n++;
        console.log(`[discover] ${scout.key}: ${finds.length} found, ${n} new`);
        state.lanes[i] = { ...state.lanes[i], state: "done", found: n };
        state.added += n;
      } catch (e) {
        state.lanes[i] = { ...state.lanes[i], state: "error", error: (e as Error).message.slice(0, 160) };
        console.warn(`[discover] ${scout.key}:`, (e as Error).message.slice(0, 200));
      }
    }));
    state.running = false;
    state.finished_at = now();
    console.log(`[discover] refresh done: ${state.added} new`);
    fillDiscoverImages().catch(() => {});
    // Pins for anything with an address (free OpenStreetMap lookup, 1/s).
    const rows = db.prepare("SELECT id, title, venue, address FROM discover WHERE lat IS NULL AND (address IS NOT NULL OR venue IS NOT NULL)").all() as { id: string; title: string; venue: string | null; address: string | null }[];
    for (const r of rows) {
      const g = await geocode({ name: r.venue ?? r.title, address: r.address, city: "München", country: "Germany" });
      if (g?.precise) db.prepare("UPDATE discover SET lat = ?, lng = ?, neighborhood = COALESCE(neighborhood, ?) WHERE id = ?").run(g.lat, g.lng, g.neighborhood, r.id);
    }
  })();
  return state;
}

export function listDiscover() {
  const t = today();
  const rows = db.prepare(`SELECT * FROM discover WHERE status != 'hidden' AND search_id IS NULL AND (COALESCE(date_end, date_start) IS NULL OR COALESCE(date_end, date_start) >= ?)
                     ORDER BY CASE WHEN date_start IS NULL THEN 1 ELSE 0 END, date_start, score DESC`).all(t) as Record<string, unknown>[];
  return rows.map((r) => {
    let genres: string[] = [];
    try { genres = JSON.parse(String(r.genres ?? "[]")); } catch { /* ignore */ }
    return { ...r, genres };
  });
}

export function setDiscoverStatus(id: string, status: string) {
  if (!["new", "liked", "disliked", "hidden", "saved"].includes(status)) throw new Error("bad status");
  db.prepare("UPDATE discover SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
}

export function getDiscover(id: string) {
  const r = db.prepare("SELECT * FROM discover WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!r) return r;
  let genres: string[] = [];
  try { genres = JSON.parse(String(r.genres ?? "[]")); } catch { /* ignore */ }
  return { ...r, genres } as Record<string, unknown>;
}

/** Where a Discover find goes when saved into the library. */
export function libraryFieldsFor(d: Record<string, unknown>) {
  const topic = String(d.topic);
  const dated = Boolean(d.date_start);
  const category = d.search_category ? String(d.search_category) :
    dated && topic !== "food" ? "events"
      : topic === "food" ? (dated ? "events" : "food")
      : topic === "thrift" || topic === "jewellery" ? "shopping"
      : dated ? "events" : "places";
  return {
    category,
    kind: category === "food" ? "place" : category === "events" || category === "places" ? "activity" : "other",
    name: d.title,
    description: d.description,
    website: d.url,
    address: d.address,
    neighborhood: d.neighborhood,
    city: "München",
    country: "Germany",
    lat: d.lat,
    lng: d.lng,
    date_start: d.date_start,
    date_end: d.date_end,
    event_time: d.event_time,
    activity_type: category === "food" ? null : (TOPICS[topic as Topic]?.label ?? topic).toLowerCase(),
    tags: [topic === "music" ? "techno" : topic.replace("_", " "), ...(Array.isArray(d.genres) ? (d.genres as string[]).map((g) => g.replace("_", " ")) : []), "discover"],
    source_platform: "discover",
    specialness: Math.round(2 + Number(d.score ?? 0.5) * 2),
  };
}

export function markSaved(id: string, spotId: string) {
  db.prepare("UPDATE discover SET status = 'saved', spot_id = ?, updated_at = ? WHERE id = ?").run(spotId, now(), id);
}

// ---- "Find new places": a one-off search with the user's filters, for places not in the library yet ----

export interface FindQuery {
  category: string;            // library category the results belong to (food, drinks, places, shopping, …)
  text?: string;               // free text, e.g. "cozy, natural wine, good for a date"
  venues?: string[]; cuisines?: string[]; meals?: string[]; drinks?: string[]; service?: string[];
  areas?: string[]; price?: number | null; types?: string[];
}
export interface FindState { running: boolean; search_id: string | null; label: string | null; error: string | null; added: number }
let findState: FindState = { running: false, search_id: null, label: null, error: null, added: 0 };
export const placeFinderState = () => findState;

export function describeQuery(q: FindQuery, categoryName: string): string {
  const parts = [
    q.venues?.length ? q.venues.join(" / ").replace(/_/g, " ") : categoryName.toLowerCase(),
    q.cuisines?.length ? `cuisine: ${q.cuisines.join(", ")}` : "",
    q.meals?.length ? `for ${q.meals.join(" / ").replace(/_/g, " ")}` : "",
    q.drinks?.length ? `drinks: ${q.drinks.join(", ").replace(/_/g, " ")}` : "",
    q.service?.length ? q.service.join(" / ").replace(/_/g, " ") : "",
    q.types?.length ? `type: ${q.types.join(", ")}` : "",
    q.areas?.length ? `in ${q.areas.join(", ")}` : "",
    q.price != null ? `price up to ${"€".repeat(Math.max(1, q.price))}` : "",
    q.text?.trim() ? `"${q.text.trim()}"` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function findPlaces(q: FindQuery, categoryName: string, homeCity: string): FindState {
  if (findState.running) return findState;
  if (!apiKey()) throw new Error("Add an Anthropic API key in Settings first.");
  const label = describeQuery(q, categoryName);
  const search = { id: newId(), category: q.category };
  findState = { running: true, search_id: search.id, label, error: null, added: 0 };
  const scout: Scout = {
    key: "find",
    label: "Place finder",
    brief: `Find permanent places in ${homeCity || "Munich"} that match this request: ${label}.
Return real, currently open places (kind "place", no dates) that are NOT in the person's library (see the list above), with address and neighborhood. Prefer well-loved, distinctive independents over chains, and fit the person's taste. Use Google Maps listings, local guides (Mit Vergnügen, Mucbook, Falstaff, The Infatuation, Tripadvisor), blogs and the places' own sites. Topic: "food" for food and drink places, otherwise the closest topic.`,
  };
  (async () => {
    try {
      const finds = await runScout(scout, contextText());
      for (const f of finds) {
        f.date_start = null;
        f.date_end = null;
        f.kind = "place";
        if (store(f, "Place finder", false, search)) findState.added++;
      }
      console.log(`[discover] place finder "${label}": ${finds.length} found, ${findState.added} shown`);
      void fillDiscoverImages();
    } catch (e) {
      findState.error = (e as Error).message.slice(0, 200);
    } finally {
      findState.running = false;
    }
  })();
  return findState;
}

/** Results of the latest searches, newest search first. */
export function listFound(limit = 80) {
  const rows = db.prepare(`SELECT * FROM discover WHERE search_id IS NOT NULL AND status NOT IN ('hidden','disliked') ORDER BY updated_at DESC, score DESC LIMIT ?`).all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({ ...r, genres: [] as string[] }));
}
