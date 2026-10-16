import { analyze, aiEnabled, type ExtractedItem } from "./ai.ts";
import { getSettings } from "./config.ts";
import { createSpot, db, getSpot, imagesFor, insertImage, listCategories, newId, updateSpot, type CategoryRow } from "./db.ts";
import { mergeIfDuplicate } from "./dedupe.ts";
import { noteProcessed } from "./organize.ts";
import { geocode } from "./geocode.ts";
import { imageForModel, imagePath } from "./images.ts";
import { DRINKS, LOCATED_TEMPLATES, MEALS, PLATFORMS, SERVICE, VENUES } from "../shared/vocab.ts";
import { classifyLocally, findListedPlaces } from "./local-classify.ts";
import { getRules, learnedScores, relevantExamples } from "./learn.ts";
import { needsOfficial, queueOfficial } from "./official.ts";
import { formatOcrForModel, ocrImage, ocrSignal, type OcrLine } from "./ocr.ts";

export interface ProcessOptions {
  /** Force sending the screenshot to Claude (user clicked "Analyze image"). */
  useImage?: boolean;
  /** Override the auto-research setting. */
  research?: boolean;
  /** Re-run on a spot the user already edited: pass their fields as hints. */
  rerun?: boolean;
  /** Free-text instruction from the user ("it's a list of 5 cafés, add all"). */
  instruction?: string;
}

const CONCURRENCY = 2;
const queue: { id: string; opts: ProcessOptions }[] = [];
const active = new Set<string>();

export function enqueue(id: string, opts: ProcessOptions = {}) {
  if (active.has(id) || queue.some((q) => q.id === id)) return;
  updateSpot(id, { status: "queued", status_detail: null });
  queue.push({ id, opts });
  pump();
}

function pump() {
  while (active.size < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    active.add(job.id);
    processSpot(job.id, job.opts)
      .catch((e: Error) => {
        console.error(`[pipeline] ${job.id}:`, e.message);
        const msg = /authentication_error|invalid x-api-key/i.test(e.message)
          ? "Your Anthropic API key was rejected. Update it in Settings, then click “Try again”."
          : /credit|billing/i.test(e.message)
            ? "Your Anthropic account is out of credits. Top it up, then click “Try again”."
            : e.message.slice(0, 300);
        // If the local pass already sorted it, keep it usable; only the AI part is pending.
        const sortedLocally = getSpot(job.id)?.ai_pending;
        updateSpot(job.id, sortedLocally
          ? { status: "ready", status_detail: `Sorted on your Mac. AI step failed: ${msg}`, needs_review: false }
          : { status: "error", status_detail: msg, needs_review: true });
      })
      .finally(() => {
        active.delete(job.id);
        pump();
      });
  }
}

/** Resume work interrupted by a restart. */
export function resumeUnfinished() {
  const rows = db.prepare("SELECT id FROM spots WHERE status IN ('queued','ocr','analyzing')").all() as { id: string }[];
  for (const r of rows) enqueue(r.id);
}

const mapsUrl = (s: { name?: unknown; address?: unknown; city?: unknown; country?: unknown }) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([s.name, s.address, s.city, s.country].filter(Boolean).join(", "))}`;


async function processSpot(id: string, opts: ProcessOptions) {
  const spot = getSpot(id);
  if (!spot) return;
  const settings = getSettings();

  // 1) Local OCR for any image that hasn't been read yet.
  updateSpot(id, { status: "ocr", status_detail: "Reading text locally…" });
  const allLines: OcrLine[] = [];
  for (const img of imagesFor(id)) {
    let lines: OcrLine[];
    if (img.ocr_lines === null) {
      const res = await ocrImage(imagePath(img.file));
      lines = res.lines;
      db.prepare("UPDATE images SET ocr_text = ?, ocr_lines = ? WHERE id = ?").run(res.text, JSON.stringify(res.lines), img.id);
    } else {
      lines = JSON.parse(img.ocr_lines);
    }
    allLines.push(...lines);
  }
  const ocrText = allLines.map((l) => l.text).join("\n");

  // 2) Local first pass: category, title, food details, handles… from the OCR text alone.
  //    Never overwrites what the user set, and only fills in items the AI hasn't handled yet.
  const categories = listCategories();
  const userFields = new Set((spot.user_fields as string[]) ?? []);
  if (spot.ai_pending || !spot.name) {
    const local = classifyLocally(allLines, categories, {
      homeCity: settings.homeCity,
      capturedAt: (spot.captured_at as string) ?? (spot.created_at as string),
      learned: learnedScores(ocrText),
    });
    const patch: Record<string, unknown> = { ...local, ai_pending: true };
    for (const f of userFields) delete patch[f];
    for (const [k, v] of Object.entries(patch)) {
      // Don't blank out values a previous run already found.
      if ((v === null || (Array.isArray(v) && !v.length)) && spot[k] != null && !(Array.isArray(spot[k]) && !(spot[k] as unknown[]).length)) delete patch[k];
    }
    if (spot.name) delete patch.name;
    updateSpot(id, patch);
  }

  // List posts: give every listed place its own item right away (AI can refine later).
  const splitLocally = async () => {
    const places = findListedPlaces(allLines);
    if (places.length < 2 || imagesFor(id).length !== 1 || (spot.user_fields as string[])?.includes("name")) return;
    const already = new Set(db.prepare("SELECT s.name FROM spots s JOIN images i ON i.spot_id = s.id WHERE i.file = ?").all(imagesFor(id)[0].file).map((r) => String((r as { name: string }).name)));
    const base = getSpot(id)!;
    for (const [i, p] of places.entries()) {
      if (i > 0 && already.has(p.name)) continue;
      const targetId = i === 0 ? id : createSpot();
      if (i > 0) {
        for (const img of imagesFor(id)) insertImage({ ...img, id: newId(), spot_id: targetId });
        // Siblings start from the same local guess; only the original carries the "finish with AI" flag.
        updateSpot(targetId, {
          category: base.category, kind: base.kind, cuisines: base.cuisines, city: base.city, country: base.country, collections: base.collections,
          captured_at: base.captured_at, status: "ready", ai_pending: false,
        });
      }
      updateSpot(targetId, { name: p.name, address: p.address });
      const geo = await geocode({ name: p.name, address: p.address, city: (base.city as string) ?? settings.homeCity });
      if (geo) updateSpot(targetId, { lat: geo.lat, lng: geo.lng, ...(geo.precise && geo.neighborhood ? { neighborhood: geo.neighborhood } : {}) });
    }
  };

  if (!aiEnabled()) {
    await splitLocally();
    updateSpot(id, {
      status: "ready",
      status_detail: "Sorted on your Mac from the screenshot text. Add an Anthropic API key in Settings to refine it with AI.",
      needs_review: false,
    });
    mergeIfDuplicate(id);
    return;
  }

  // 3) Claude: OCR text first; the image only when OCR is weak (and allowed) or explicitly requested.
  const weakOcr = ocrSignal(ocrText) < 25;
  const sendImage = Boolean(opts.useImage) || (settings.imageFallback && weakOcr);
  const research = opts.research ?? settings.autoResearch;
  updateSpot(id, {
    status: "analyzing",
    status_detail: opts.instruction
      ? "Following your instruction…"
      : [sendImage ? "Looking at the image" : "Reading the text", research ? "researching the web" : null].filter(Boolean).join(" & ") + "…",
  });

  const hints: Record<string, unknown> = {};
  if (opts.rerun) {
    // Only what the user typed/picked themselves counts as ground truth.
    for (const f of ["name", "city", "country", "address", "category", "kind"]) if (spot[f] && userFields.has(f)) hints[f] = spot[f];
  }

  const imagesB64 = sendImage ? await Promise.all(imagesFor(id).slice(0, 3).map((i) => imageForModel(i.file))) : [];
  let analysis: Awaited<ReturnType<typeof analyze>>;
  try {
    analysis = await analyze({
    ocrText: formatOcrForModel(allLines),
    imagesB64,
    research,
    hints,
    categories: categories.map((c) => ({ id: c.id, name: c.name, template: c.template, description: c.description, builtin: c.builtin })),
    rules: getRules().map((r) => r.text),
    examples: relevantExamples(ocrText),
    homeCity: settings.homeCity,
    instruction: opts.instruction,
    types: typesInUse(),
    capturedAt: (spot.captured_at as string) ?? (spot.created_at as string) ?? null,
    });
  } catch (e) {
    // AI unavailable: at least split list posts locally, then report the failure as usual.
    await splitLocally().catch(() => {});
    throw e;
  }
  const { items, usedSearch } = analysis;

  if (!items.length) {
    updateSpot(id, {
      ai_pending: false,
      status: "ready",
      status_detail: weakOcr && !sendImage ? "Couldn't identify anything. Try “Analyze image”." : "Couldn't make sense of this one — please fill in.",
      needs_review: true,
    });
    return;
  }

  // 4) First result fills this item; extra results (e.g. "top 5" posts) become new items sharing the screenshot.
  const ids: string[] = [];
  for (const [i, item] of items.entries()) {
    const targetId = i === 0 ? id : createSpot();
    if (i > 0) {
      for (const img of imagesFor(id)) insertImage({ ...img, id: newId(), spot_id: targetId });
      // Extra items inherit the collections of the screenshot they came from.
      updateSpot(targetId, { collections: spot.collections });
    }
    await applyResult(targetId, item, usedSearch, i === 0 ? userFields : new Set(), categories);
    ids.push(targetId);
  }
  const survivors = ids.map((sid) => mergeIfDuplicate(sid));
  noteProcessed(ids.length);
  // Official one-liner (Google Maps / own website) for places, looked up separately so it always searches.
  if (research) queueOfficial(survivors.filter(needsOfficial));
}

/** Most common types per category (top 12), so new items reuse them. */
function typesInUse(): Record<string, string[]> {
  const rows = db.prepare("SELECT category, activity_type t, COUNT(*) n FROM spots WHERE activity_type IS NOT NULL AND activity_type != '' GROUP BY category, activity_type ORDER BY n DESC").all() as { category: string; t: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) if ((out[r.category] ??= []).length < 12) out[r.category].push(r.t);
  return out;
}

const FOOD_FIELDS = ["meals", "venue_types", "cuisines", "dishes", "drinks", "service"] as const;
const pick = <T extends string>(values: unknown, allowed: Record<T, unknown>) =>
  (Array.isArray(values) ? values : []).filter((v): v is T => typeof v === "string" && v in allowed);
const cleanList = (values: unknown, max = 12) =>
  [...new Set((Array.isArray(values) ? values : []).filter((v) => typeof v === "string" && v.trim()).map((v) => (v as string).trim()))].slice(0, max);
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const stripAt = (v: string | null | undefined) => (v ? v.trim().replace(/^@/, "") || null : null);

/** Validate model output (also covers the non-strict fallback) and write it, without clobbering fields the user edited. */
async function applyResult(id: string, s: ExtractedItem, researched: boolean, userFields: Set<string>, categories: CategoryRow[]) {
  const category = categories.find((c) => c.id === s.category) ?? categories.find((c) => c.id === "misc")!;
  const template = category.template;
  const located = LOCATED_TEMPLATES.includes(template);
  const kind = template === "food" ? (s.kind === "food" ? "food" : "place") : template === "place" ? "activity" : "other";
  const platform = s.platform ? (PLATFORMS as readonly string[]).includes(s.platform.toLowerCase()) ? s.platform.toLowerCase() : "other" : null;

  const patch: Record<string, unknown> = {
    category: category.id,
    kind,
    name: String(s.name).trim().slice(0, 200),
    description: s.description?.trim() || null,
    key_points: cleanList(s.key_points, 15),
    content: s.content?.trim() || null,
    tags: cleanList(s.tags, 10).map((t) => t.toLowerCase()),
    city: s.city || null,
    country: s.country || null,
    address: located ? s.address || null : null,
    lat: typeof s.lat === "number" ? s.lat : null,
    lng: typeof s.lng === "number" ? s.lng : null,
    meals: pick(s.meals, MEALS),
    venue_types: pick(s.venue_types, VENUES),
    cuisines: cleanList(s.cuisines).map((t) => t.toLowerCase()),
    dishes: cleanList(s.dishes),
    drinks: pick(s.drinks, DRINKS),
    service: pick(s.service, SERVICE),
    activity_type: template === "food" ? null : s.activity_type?.trim().toLowerCase() || null,
    price: located && typeof s.price === "number" ? Math.max(0, Math.min(4, Math.round(s.price))) : null,
    specialness: Math.max(1, Math.min(5, Math.round(Number(s.specialness) || 2))),
    specialness_reason: s.specialness_reason || null,
    website: s.website || null,
    maps_url: located ? s.maps_url || null : null,
    instagram: stripAt(s.instagram),
    handle: template === "account" ? stripAt(s.handle) : null,
    platform: template === "account" ? platform : null,
    source_platform: s.source_platform?.toLowerCase() || null,
    source_handle: stripAt(s.source_handle),
    date_start: isoDate(s.date_start),
    date_end: isoDate(s.date_end) && isoDate(s.date_start) && isoDate(s.date_end)! >= isoDate(s.date_start)! ? isoDate(s.date_end) : null,
    event_time: s.event_time?.trim() || null,
    neighborhood: s.neighborhood?.trim() || null,
    // Only from a real web lookup; a run without one never erases what an earlier lookup found.
    ...(researched && s.official_description?.trim()
      ? { official_description: s.official_description.trim().slice(0, 300), official_source: s.official_source?.trim() || null }
      : {}),
    confidence: typeof s.confidence === "number" ? s.confidence : null,
    researched,
    ai_pending: false,
    status: "ready",
    status_detail: null,
    // Only ask the user to look when the AI was genuinely unsure, and say about what.
    needs_review: !(Number(s.confidence) >= 0.5),
    review_reason: Number(s.confidence) >= 0.5 ? null : s.unsure_about?.trim() || "Not sure the name or category is right",
  };

  // Only food & recipes keep food fields.
  if (template !== "food" && template !== "recipe") for (const f of FOOD_FIELDS) patch[f] = [];
  if (template === "recipe") for (const f of ["venue_types", "drinks", "service"]) patch[f] = [];

  // Fields the user set by hand win over the model.
  for (const f of userFields) delete patch[f];

  const final = { ...getSpot(id), ...patch } as Record<string, unknown>;
  const finalTemplate = categories.find((c) => c.id === final.category)?.template ?? template;
  if (LOCATED_TEMPLATES.includes(finalTemplate) && final.kind !== "food") {
    const geo = await geocode({ name: final.name as string, address: final.address as string, city: final.city as string, country: final.country as string });
    if (geo && !userFields.has("lat")) {
      patch.lat = geo.lat;
      patch.lng = geo.lng;
      if (geo.precise && geo.neighborhood && !userFields.has("neighborhood")) patch.neighborhood = geo.neighborhood;
      if (geo.precise && geo.city && !final.city && !userFields.has("city")) patch.city = geo.city;
    }
    if (!final.maps_url && !userFields.has("maps_url")) patch.maps_url = mapsUrl(final);
  } else if (!userFields.has("lat")) {
    patch.lat = null;
    patch.lng = null;
  }
  updateSpot(id, patch);
}
