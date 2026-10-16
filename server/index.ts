import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { apiKey, getSettings, HOST, IMAGES_DIR, MODELS, PORT, saveSettings, THUMBS_DIR, WEB_DIST, type Settings } from "./config.ts";
import {
  createCategory, createCollection, createSpot, db, deleteCategory, deleteCollection, deleteSpot, EDITABLE_FIELDS, getCategory, getSpot,
  getMeta, imageExists, imagesFor, insertImage, listCategories, now, setMeta, listCollections, listSpots, updateCategory, updateCollection, updateSpot,
} from "./db.ts";
import { LOCATED_TEMPLATES } from "../shared/vocab.ts";
import { detachMisattachedImages, mergeFlaggedDuplicates, mergeSpots, refreshDuplicateFlag, splitImage, splitPlaceholderMerges } from "./dedupe.ts";
import { getRules, learningStats, recordCorrection, setRules } from "./learn.ts";
import { missingOfficial, officialQueueSize, queueOfficial } from "./official.ts";
import { DISCOVER_IMAGES, discoverState, fillDiscoverImages, findPlaces, GENRES, getDiscover, libraryFieldsFor, listDiscover, listFound, markSaved, placeFinderState, refreshDiscover, setDiscoverStatus, TOPICS, type FindQuery } from "./discover.ts";
import { getAccounts, getPrefs, setAccounts, setPrefs, tasteProfile } from "./taste.ts";
import { askLibrary } from "./ask.ts";
import { execFile } from "node:child_process";
import { INBOX, inboxStatus, startInbox } from "./inbox.ts";
import { publishSnapshot, snapshotStatus } from "./snapshot.ts";
import { usageSummary } from "./usage.ts";
import { makePlan, route } from "./plan.ts";
import { organize, organizerLog, organizerStatus } from "./organize.ts";
import { geocode, reverseNeighborhood } from "./geocode.ts";
import { backfillPhotoFocus, cleanupFiles, compressExistingImages, sha1, storeImage } from "./images.ts";
import { detectOcrEngine } from "./ocr.ts";
import { enqueue, resumeUnfinished } from "./pipeline.ts";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// Optional password for when the container runs somewhere other than your own Mac.
const PASSWORD = process.env.SPOTDROP_PASSWORD;
if (PASSWORD) {
  app.use((req, res, next) => {
    const [, b64] = (req.headers.authorization ?? "").split(" ");
    const pass = b64 ? Buffer.from(b64, "base64").toString().split(":").slice(1).join(":") : "";
    if (pass === PASSWORD) return next();
    res.set("WWW-Authenticate", 'Basic realm="Spotdrop"').status(401).send("Authentication required");
  });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 100 } });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);
const param = (req: Request, key: string) => String(req.params[key]);

app.use("/media/images", express.static(IMAGES_DIR, { immutable: true, maxAge: "365d" }));
app.use("/media/thumbs", express.static(THUMBS_DIR, { immutable: true, maxAge: "365d" }));
app.use("/media/discover", express.static(DISCOVER_IMAGES, { maxAge: "30d" }));

// ---- status & settings ---------------------------------------------------

function publicSettings() {
  const s = getSettings();
  const key = apiKey();
  return {
    model: s.model,
    models: MODELS,
    autoResearch: s.autoResearch,
    imageFallback: s.imageFallback,
    homeCity: s.homeCity,
    autoOrganize: s.autoOrganize,
    hasKey: Boolean(key),
    keySource: s.anthropicApiKey ? "settings" : key ? "env" : null,
    keyPreview: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
  };
}

app.get("/api/status", wrap(async (_req, res) => {
  res.json({ ocrEngine: await detectOcrEngine(), settings: publicSettings() });
}));

app.put("/api/settings", wrap((req, res) => {
  const body = req.body as Partial<Settings>;
  const patch: Partial<Settings> = {};
  if (typeof body.anthropicApiKey === "string") patch.anthropicApiKey = body.anthropicApiKey.trim();
  if (typeof body.model === "string" && (MODELS as readonly string[]).includes(body.model)) patch.model = body.model;
  if (typeof body.autoResearch === "boolean") patch.autoResearch = body.autoResearch;
  if (typeof body.imageFallback === "boolean") patch.imageFallback = body.imageFallback;
  if (typeof body.autoOrganize === "boolean") patch.autoOrganize = body.autoOrganize;
  if (typeof body.homeCity === "string") patch.homeCity = body.homeCity.trim().slice(0, 80);
  saveSettings(patch);
  res.json(publicSettings());
}));

// ---- spots ---------------------------------------------------------------

app.get("/api/spots", (_req, res) => {
  res.json(listSpots());
});

app.get("/api/spots/:id", (req, res) => {
  const spot = getSpot(param(req, "id"));
  if (!spot) return void res.status(404).json({ error: "not found" });
  res.json(spot);
});

/** Drop one or many screenshots → one new spot per screenshot, processed in the background. */
/** Store one screenshot as a new item (null if the exact file is already in the library). Shared by uploads and the iCloud inbox. */
async function importImage(buf: Buffer, name: string, mime: string, modifiedMs: number | undefined, collection: string | null = null): Promise<string | null> {
  if (imageExists(sha1(buf))) return null;
  const stored = await storeImage(buf, name, mime);
  const ts = Number(modifiedMs);
  const capturedAt = Number.isFinite(ts) && ts > 946684800000 && ts <= Date.now() + 86400000 ? new Date(ts).toISOString() : now();
  const spotId = createSpot({ name: "", category: "misc", kind: "other", captured_at: capturedAt, collections: collection ? [collection] : [] });
  insertImage({ ...stored, spot_id: spotId, ocr_text: null, ocr_lines: null });
  return spotId;
}

app.post("/api/upload", upload.array("files"), wrap(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const collection = typeof req.body?.collection === "string" && listCollections().some((c) => c.id === req.body.collection) ? req.body.collection : null;
  // File dates (lastModified, ms) in the same order as the files: anchors "this Saturday" etc.
  const modified = ([] as unknown[]).concat(req.body?.modified ?? []).map(Number);
  const created: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const [i, f] of files.entries()) {
    try {
      const id = await importImage(f.buffer, f.originalname, f.mimetype, modified[i], collection);
      if (id) created.push(id);
      else skipped.push(f.originalname);
    } catch (e) {
      console.error("[upload]", f.originalname, (e as Error).message);
      failed.push(f.originalname);
    }
  }
  for (const id of created) enqueue(id);
  res.json({ spots: created.map(getSpot), failed, skipped });
}));

/** Add more screenshots to an existing spot (e.g. a second post about the same place). */
app.post("/api/spots/:id/images", upload.array("files"), wrap(async (req, res) => {
  const id = param(req, "id");
  if (!getSpot(id)) return void res.status(404).json({ error: "not found" });
  for (const f of (req.files as Express.Multer.File[]) ?? []) {
    const stored = await storeImage(f.buffer, f.originalname, f.mimetype);
    insertImage({ ...stored, spot_id: id, ocr_text: null, ocr_lines: null });
  }
  res.json(getSpot(id));
}));

/** Two different things ended up in one item: give this screenshot its own item and re-sort both. */
app.post("/api/spots/:id/images/:imageId/split", (req, res) => {
  const id = param(req, "id");
  const row = db.prepare("SELECT file FROM images WHERE id = ? AND spot_id = ?").get(param(req, "imageId"), id) as { file: string } | undefined;
  if (!row) return void res.status(404).json({ error: "not found" });
  if (new Set(imagesFor(id).map((i) => i.file)).size < 2) return void res.status(400).json({ error: "This item has only one screenshot" });
  const newIdent = splitImage(id, row.file);
  for (const sid of [id, newIdent]) enqueue(sid, { useImage: true, research: true });
  res.json({ original: getSpot(id), created: getSpot(newIdent) });
});

app.delete("/api/spots/:id/images/:imageId", (req, res) => {
  const row = db.prepare("SELECT * FROM images WHERE id = ? AND spot_id = ?").get(param(req, "imageId"), param(req, "id")) as
    | { file: string; thumb: string }
    | undefined;
  if (row) {
    db.prepare("DELETE FROM images WHERE id = ?").run(param(req, "imageId"));
    cleanupFiles([row]);
  }
  res.json(getSpot(param(req, "id")));
});

/** Manual entry without a screenshot. */
app.post("/api/spots", wrap(async (req, res) => {
  const raw = pickEditable(req.body);
  const fields = normalizeFields({ category: "misc", ...raw }, null);
  const id = createSpot({ ...fields, user_fields: Object.keys(raw), status: "ready", needs_review: false });
  await maybeGeocode(id);
  refreshDuplicateFlag(id);
  res.json(getSpot(id));
}));

app.patch("/api/spots/:id", wrap(async (req, res) => {
  const id = param(req, "id");
  const before = getSpot(id);
  if (!before) return void res.status(404).json({ error: "not found" });
  const raw = pickEditable(req.body);
  const fields = normalizeFields(raw, before);
  // Only keys the user actually sent count as hand-edited (not ones derived by normalizeFields).
  const userFields = [...new Set([...((before.user_fields as string[]) ?? []), ...Object.keys(raw).filter((k) => k in fields && !AUTO_FIELDS.has(k))])];
  updateSpot(id, { ...fields, user_fields: userFields, ...(before.status === "ready" ? { status_detail: null } : {}) });
  if (before.status === "ready") recordCorrection(before, fields, "edit");
  const locationChanged = ["address", "city", "country", "name"].some((k) => k in fields && fields[k] !== before[k]);
  if (locationChanged && !("lat" in fields)) await maybeGeocode(id, true);
  if ("name" in fields || "city" in fields || "category" in fields) refreshDuplicateFlag(id);
  res.json(getSpot(id));
}));

app.delete("/api/spots/:id", (req, res) => {
  const id = param(req, "id");
  const imgs = imagesFor(id);
  deleteSpot(id);
  db.prepare("UPDATE spots SET duplicate_of = NULL WHERE duplicate_of = ?").run(id);
  cleanupFiles(imgs);
  res.json({ ok: true });
});

/** Opened in the UI: feeds the "rediscover" recommendations. Doesn't count as an edit. */
app.post("/api/spots/:id/viewed", (req, res) => {
  db.prepare("UPDATE spots SET last_viewed_at = ? WHERE id = ?").run(now(), param(req, "id"));
  res.json({ ok: true });
});

/** "Ask your library": natural-language recommendations from the user's own saves. */
app.post("/api/ask", wrap(async (req, res) => {
  const question = String(req.body?.question ?? "").trim().slice(0, 500);
  if (!question) return void res.status(400).json({ error: "Ask something" });
  if (!apiKey()) return void res.status(400).json({ error: "Add an Anthropic API key in Settings to ask your library." });
  res.json(await askLibrary(question));
}));

/** Re-run AI: { useImage?: boolean, research?: boolean } */
app.post("/api/spots/:id/analyze", (req, res) => {
  const id = param(req, "id");
  if (!getSpot(id)) return void res.status(404).json({ error: "not found" });
  if (!apiKey()) return void res.status(400).json({ error: "Add an Anthropic API key in Settings first." });
  const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim().slice(0, 600) : "";
  if (instruction) recordCorrection(getSpot(id)!, {}, "instruction", instruction);
  enqueue(id, { useImage: Boolean(req.body?.useImage), research: req.body?.research ?? true, rerun: true, instruction: instruction || undefined });
  res.json(getSpot(id));
});

app.post("/api/spots/:id/merge", wrap((req, res) => {
  const into = String(req.body?.into ?? "");
  mergeSpots(param(req, "id"), into);
  res.json(getSpot(into));
}));

app.post("/api/spots/:id/not-duplicate", (req, res) => {
  const spot = getSpot(param(req, "id"));
  if (!spot) return void res.status(404).json({ error: "not found" });
  const other = String(req.body?.other ?? spot.duplicate_of ?? "");
  updateSpot(spot.id, { not_duplicates: [...new Set([...(spot.not_duplicates as string[]), other])], duplicate_of: null });
  res.json(getSpot(spot.id));
});

// ---- categories & collections ------------------------------------------------

app.get("/api/library", (_req, res) => {
  res.json({ categories: listCategories(), collections: listCollections() });
});

app.post("/api/categories", wrap((req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return void res.status(400).json({ error: "Name is required" });
  res.json(createCategory({ ...req.body, name }));
}));

app.patch("/api/categories/:id", wrap((req, res) => {
  if (!getCategory(param(req, "id"))) return void res.status(404).json({ error: "not found" });
  updateCategory(param(req, "id"), req.body ?? {});
  normalizeKindsFor(param(req, "id"));
  res.json(getCategory(param(req, "id")));
}));

app.delete("/api/categories/:id", wrap((req, res) => {
  const cat = getCategory(param(req, "id"));
  if (cat?.builtin) return void res.status(400).json({ error: "Built-in categories can't be deleted" });
  deleteCategory(param(req, "id"));
  res.json({ ok: true });
}));

app.post("/api/collections", wrap((req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return void res.status(400).json({ error: "Name is required" });
  res.json(createCollection(name, req.body?.emoji));
}));

app.patch("/api/collections/:id", wrap((req, res) => {
  if (!listCollections().some((c) => c.id === param(req, "id"))) return void res.status(404).json({ error: "not found" });
  updateCollection(param(req, "id"), req.body ?? {});
  res.json(listCollections().find((c) => c.id === param(req, "id")));
}));

app.delete("/api/collections/:id", wrap((req, res) => {
  deleteCollection(param(req, "id"));
  res.json({ ok: true });
}));

/** Apply one action to many items: { ids, action, value }. */
app.post("/api/bulk", wrap(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter((id: string) => getSpot(id));
  const action = String(req.body?.action ?? "");
  const value = req.body?.value;
  if (action === "category" && !getCategory(String(value))) return void res.status(400).json({ error: "Unknown category" });
  if ((action === "add_collection" || action === "remove_collection") && !listCollections().some((c) => c.id === value)) {
    return void res.status(400).json({ error: "Unknown collection" });
  }
  if (action === "analyze" && !apiKey()) return void res.status(400).json({ error: "Add an Anthropic API key in Settings first." });

  for (const id of ids) {
    const spot = getSpot(id)!;
    const userFields = new Set((spot.user_fields as string[]) ?? []);
    switch (action) {
      case "category": {
        userFields.add("category");
        updateSpot(id, { ...normalizeFields({ category: value }, spot), user_fields: [...userFields] });
        recordCorrection(spot, { category: value }, "move");
        break;
      }
      case "add_collection":
        updateSpot(id, { collections: [...new Set([...(spot.collections as string[]), value])] });
        break;
      case "remove_collection":
        updateSpot(id, { collections: (spot.collections as string[]).filter((c) => c !== value) });
        break;
      case "reviewed":
        if (spot.needs_review) recordCorrection(spot, {}, "confirm");
        updateSpot(id, { needs_review: false, duplicate_of: null, review_reason: null, status_detail: spot.status === "ready" ? null : spot.status_detail });
        break;
      case "analyze":
        enqueue(id, { research: true, rerun: true });
        break;
      case "delete": {
        const imgs = imagesFor(id);
        deleteSpot(id);
        db.prepare("UPDATE spots SET duplicate_of = NULL WHERE duplicate_of = ?").run(id);
        cleanupFiles(imgs);
        break;
      }
      default:
        return void res.status(400).json({ error: `Unknown action ${action}` });
    }
  }
  if (action === "category") for (const id of ids) {
    await maybeGeocode(id);
    refreshDuplicateFlag(id);
  }
  res.json({ ok: true, count: ids.length });
}));

/** iCalendar feed of every dated item — subscribe in Apple Calendar (File → New Calendar Subscription). */
app.get("/api/calendar.ics", (req, res) => {
  const only = typeof req.query.id === "string" ? req.query.id : null;
  const esc = (t: unknown) => String(t ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
  const day = (d: string) => d.replace(/-/g, "");
  const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const cats = new Map(listCategories().map((c) => [c.id, c]));
  const events = listSpots()
    .filter((s) => s.date_start && (!only || s.id === only))
    .map((s) => {
      const start = String(s.date_start);
      const end = nextDay(String(s.date_end || s.date_start));
      const where = [s.address, s.neighborhood, s.city].filter(Boolean).join(", ");
      const desc = [s.event_time && `Time: ${s.event_time}`, s.description, s.website, `Saved in Spotdrop (${cats.get(String(s.category))?.name ?? ""})`].filter(Boolean).join("\n");
      return [
        "BEGIN:VEVENT",
        `UID:${s.id}@spotdrop`,
        `DTSTAMP:${String(s.updated_at).replace(/[-:]/g, "").slice(0, 15)}Z`,
        `DTSTART;VALUE=DATE:${day(start)}`,
        `DTEND;VALUE=DATE:${day(end)}`,
        `SUMMARY:${esc(`${cats.get(String(s.category))?.emoji ?? ""} ${s.name}${s.event_time ? ` (${s.event_time})` : ""}`.trim())}`,
        where && `LOCATION:${esc(where)}`,
        `DESCRIPTION:${esc(desc)}`,
        "END:VEVENT",
      ].filter(Boolean).join("\r\n");
    });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  if (only) res.setHeader("Content-Disposition", `attachment; filename="spotdrop-event.ics"`);
  res.send(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Spotdrop//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Spotdrop", ...events, "END:VCALENDAR"].join("\r\n"));
});

/** "Stop Spotdrop" in Settings: shut the server down cleanly (the Spotdrop app starts it again). */
app.post("/api/quit", (_req, res) => {
  res.json({ ok: true });
  console.log("[server] stopped from the app");
  setTimeout(() => process.exit(0), 300);
});

// ---- Discover: new things in Munich from the web, picked for this user's taste --------------

app.get("/api/discover", (_req, res) => {
  res.json({ items: listDiscover(), state: discoverState(), prefs: getPrefs(), accounts: getAccounts(), taste: tasteProfile(), topics: TOPICS, genres: GENRES, found: listFound(), finder: placeFinderState() });
});

app.post("/api/discover/refresh", wrap((req, res) => {
  res.json(refreshDiscover(req.body?.only === "techno" ? "techno" : undefined));
}));

/** "Find new places": search the web with library-style filters for places not saved yet. */
app.post("/api/discover/find", wrap((req, res) => {
  const b = req.body ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 12) : []);
  const cat = getCategory(String(b.category ?? "food"));
  if (!cat) return void res.status(400).json({ error: "Unknown category" });
  const q: FindQuery = {
    category: cat.id, text: typeof b.text === "string" ? b.text.slice(0, 300) : "",
    venues: list(b.venues), cuisines: list(b.cuisines), meals: list(b.meals), drinks: list(b.drinks), service: list(b.service),
    areas: list(b.areas), types: list(b.types), price: typeof b.price === "number" ? b.price : null,
  };
  res.json(findPlaces(q, String(cat.name), getSettings().homeCity));
}));

app.get("/api/discover/find", (_req, res) => {
  res.json({ finder: placeFinderState(), found: listFound() });
});

app.put("/api/discover/settings", (req, res) => {
  if (typeof req.body?.prefs === "string") setPrefs(req.body.prefs);
  if (Array.isArray(req.body?.accounts)) setAccounts(req.body.accounts);
  res.json({ prefs: getPrefs(), accounts: getAccounts() });
});

app.patch("/api/discover/:id", wrap((req, res) => {
  setDiscoverStatus(param(req, "id"), String(req.body?.status ?? ""));
  res.json({ ok: true });
}));

/** Save a Discover find into the library (it then behaves like any other saved item). */
app.post("/api/discover/:id/save", wrap(async (req, res) => {
  const d = getDiscover(param(req, "id"));
  if (!d) return void res.status(404).json({ error: "not found" });
  if (d.spot_id && getSpot(String(d.spot_id))) return void res.json(getSpot(String(d.spot_id)));
  const fields = normalizeFields(libraryFieldsFor(d) as Record<string, unknown>, null);
  // Saved from Discover = bookmarked, so it also shows up under 🔖 Saved.
  const id = createSpot({ ...fields, status: "ready", needs_review: false, researched: true, favorite: true });
  if (fields.lat == null) await maybeGeocode(id);
  markSaved(String(d.id), id);
  res.json(getSpot(id));
}));

// ---- Plan: natural-language outings with routes ---------------------------------------

app.post("/api/plan", wrap(async (req, res) => {
  const request = String(req.body?.request ?? "").trim().slice(0, 500);
  if (!request) return void res.status(400).json({ error: "Describe what you want to do" });
  res.json(await makePlan(request));
}));

/** { mode: "foot" | "bike", points: [[lng, lat], …] } → route geometry, distance, per-leg times. */
app.post("/api/route", wrap(async (req, res) => {
  const mode = req.body?.mode === "bike" ? "bike" : "foot";
  const points = (Array.isArray(req.body?.points) ? req.body.points : [])
    .filter((p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n)))
    .slice(0, 25) as [number, number][];
  if (points.length < 2) return void res.status(400).json({ error: "Need at least two stops" });
  res.json(await route(mode, points));
}));

// ---- mobile: iCloud inbox + encrypted phone snapshot -------------------------------------

app.get("/api/mobile", (_req, res) => {
  const st = getSettings();
  res.json({
    inbox: inboxStatus(),
    snapshot: snapshotStatus(),
    cf: { accountId: st.cfAccountId, hasToken: Boolean(st.cfApiToken), hasPassphrase: Boolean(st.snapshotPassphrase), project: st.cfProject },
  });
});

app.put("/api/mobile", (req, res) => {
  const b = req.body ?? {};
  const patch: Partial<Settings> = {};
  if (typeof b.cfAccountId === "string") patch.cfAccountId = b.cfAccountId.trim();
  if (typeof b.cfApiToken === "string" && b.cfApiToken.trim()) patch.cfApiToken = b.cfApiToken.trim();
  if (typeof b.snapshotPassphrase === "string" && b.snapshotPassphrase) {
    if (b.snapshotPassphrase.length < 10) return void res.status(400).json({ error: "Use a passphrase of at least 10 characters." });
    patch.snapshotPassphrase = b.snapshotPassphrase;
    setMeta("snapshot_salt", ""); // new passphrase → new key
    setMeta("snapshot_fingerprint", "");
  }
  saveSettings(patch);
  res.json({ ok: true });
});

app.post("/api/mobile/publish", wrap(async (_req, res) => {
  res.json(await publishSnapshot(true));
}));

app.post("/api/mobile/open-inbox", (_req, res) => {
  execFile("open", [INBOX], () => {});
  res.json({ ok: true });
});

// ---- AI cost transparency ------------------------------------------------------------

app.get("/api/usage", (req, res) => {
  res.json(usageSummary(Math.min(365, Math.max(1, Number(req.query.days) || 30))));
});

// ---- official descriptions -------------------------------------------------------------

app.get("/api/official", (_req, res) => {
  res.json({ missing: missingOfficial().length, queued: officialQueueSize() });
});

app.post("/api/official", (req, res) => {
  if (!apiKey()) return void res.status(400).json({ error: "Add an Anthropic API key in Settings first." });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : missingOfficial();
  queueOfficial(ids);
  res.json({ queued: ids.length });
});

// ---- learning from corrections ------------------------------------------------------

app.get("/api/learning", (_req, res) => {
  res.json({ rules: getRules(), ...learningStats() });
});

app.put("/api/learning/rules", (req, res) => {
  setRules(Array.isArray(req.body?.rules) ? req.body.rules : []);
  res.json({ rules: getRules(), ...learningStats() });
});

// ---- AI organizer ----------------------------------------------------------------

app.get("/api/organize", (_req, res) => {
  res.json({ ...organizerStatus(), log: organizerLog() });
});

app.post("/api/organize", wrap(async (_req, res) => {
  if (!apiKey()) return void res.status(400).json({ error: "Add an Anthropic API key in Settings first." });
  res.json(await organize("manual"));
}));

app.get("/api/export", (_req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="spotdrop-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    categories: listCategories(),
    collections: listCollections(),
    items: listSpots().map(({ images, ...s }) => ({ ...s, images: images.map((i) => ({ file: i.file, ocr_text: i.ocr_text })) })),
  });
});

function pickEditable(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return out;
  for (const k of EDITABLE_FIELDS) if (k in body) out[k] = (body as Record<string, unknown>)[k];
  return out;
}

/** Fields changed by the system, not by the user's own judgement. */
const AUTO_FIELDS = new Set(["needs_review", "duplicate_of", "favorite", "visited"]);

const KIND_FOR_TEMPLATE = (template: string, current: unknown) =>
  template === "food" ? (current === "food" ? "food" : "place") : template === "place" ? "activity" : "other";

/** Keep category / kind / collections consistent and valid. */
function normalizeFields(fields: Record<string, unknown>, before: Record<string, unknown> | null): Record<string, unknown> {
  const out = { ...fields };
  if ("category" in out) {
    const cat = getCategory(String(out.category));
    if (!cat) delete out.category;
    else out.kind = KIND_FOR_TEMPLATE(cat.template, out.kind ?? before?.kind);
  } else if ("kind" in out && before) {
    const cat = getCategory(String(before.category));
    if (cat) out.kind = KIND_FOR_TEMPLATE(cat.template, out.kind);
  }
  if ("collections" in out) {
    const valid = new Set(listCollections().map((c) => c.id));
    out.collections = (Array.isArray(out.collections) ? out.collections : []).filter((c) => valid.has(String(c)));
  }
  return out;
}

/** After a category's template changes, fix up the kinds of its items. */
function normalizeKindsFor(categoryId: string) {
  const cat = getCategory(categoryId);
  if (!cat) return;
  const rows = db.prepare("SELECT id, kind FROM spots WHERE category = ?").all(categoryId) as { id: string; kind: string }[];
  for (const r of rows) {
    const kind = KIND_FOR_TEMPLATE(cat.template, r.kind);
    if (kind !== r.kind) db.prepare("UPDATE spots SET kind = ? WHERE id = ?").run(kind, r.id);
  }
}

async function maybeGeocode(id: string, force = false) {
  const s = getSpot(id);
  const template = s ? getCategory(String(s.category))?.template : null;
  if (!s || !template || !LOCATED_TEMPLATES.includes(template) || s.kind === "food" || (!force && s.lat != null)) return;
  const hit = await geocode({ name: s.name as string, address: s.address as string, city: s.city as string, country: s.country as string });
  if (hit) updateSpot(id, { lat: hit.lat, lng: hit.lng });
}

/** Items mapped before neighborhoods existed get theirs from their coordinates (runs once, in the background). */
async function backfillNeighborhoods() {
  const rows = db.prepare("SELECT id, lat, lng FROM spots WHERE lat IS NOT NULL AND lng IS NOT NULL AND (neighborhood IS NULL OR neighborhood = '')").all() as { id: string; lat: number; lng: number }[];
  // Pins shared by several items are city-level fallbacks (e.g. "Munich" → city center): no real neighborhood.
  const shared = new Map<string, number>();
  for (const r of db.prepare("SELECT lat, lng FROM spots WHERE lat IS NOT NULL").all() as { lat: number; lng: number }[]) {
    const k = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
    shared.set(k, (shared.get(k) ?? 0) + 1);
  }
  let n = 0;
  for (const r of rows) {
    if ((shared.get(`${r.lat.toFixed(5)},${r.lng.toFixed(5)}`) ?? 0) > 1) continue;
    const hit = await reverseNeighborhood(r.lat, r.lng);
    if (hit?.neighborhood) {
      db.prepare("UPDATE spots SET neighborhood = ? WHERE id = ? AND (neighborhood IS NULL OR neighborhood = '')").run(hit.neighborhood, r.id);
      n++;
    }
  }
  if (rows.length) console.log(`[geo] added neighborhoods to ${n}/${rows.length} items`);
}

// ---- frontend --------------------------------------------------------------

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Express 5 passes listen errors to this callback instead of throwing.
app.listen(PORT, HOST, async (err?: Error) => {
  if (err) {
    const busy = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
    console.error(busy
      ? `\n  ✋ Port ${PORT} is already in use: Spotdrop (or something else) is already running.\n     Stop the other one first (Ctrl+C in its terminal), or run with PORT=5281 npm start.\n`
      : `\n  Could not start the server: ${err.message}\n`);
    process.exit(1);
  }
  const engine = await detectOcrEngine();
  console.log(`\n  🍜 Spotdrop running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`     OCR: ${engine} · AI: ${apiKey() ? getSettings().model : "off (no API key)"}\n`);
  resumeUnfinished();
  // One-time cleanups for libraries from older versions.
  if (!getMeta("review_reset_v1")) {
    // "Needs a look" used to include everything below 75% confidence; now only real problems.
    db.exec("UPDATE spots SET needs_review = 0 WHERE status = 'ready' AND (confidence IS NULL OR confidence >= 0.5)");
    setMeta("review_reset_v1", now());
  }
  if (!getMeta("split_placeholder_v1")) {
    // Older versions merged different screenshots that only shared a placeholder name ("Munich city photo post").
    const split = splitPlaceholderMerges();
    for (const sid of split) enqueue(sid, { useImage: true, research: true });
    if (split.length) console.log(`[dedupe] split ${split.length} screenshot(s) back out of placeholder-named items`);
    setMeta("split_placeholder_v1", now());
  }
  if (!getMeta("detach_misattached_v1")) {
    const n = detachMisattachedImages();
    if (n) console.log(`[dedupe] detached ${n} screenshot(s) that belonged to other places`);
    setMeta("detach_misattached_v1", now());
  }
  mergeFlaggedDuplicates();
  compressExistingImages(db).catch((e) => console.warn("[images]", e.message));
  startInbox((buf, name, mime, mtime) => importImage(buf, name, mime, mtime), (ids) => ids.forEach((id) => enqueue(id)));
  setTimeout(() => fillDiscoverImages().catch(() => {}), 20_000);
  setTimeout(() => backfillPhotoFocus().catch((e) => console.warn("[images]", e.message)), 3_000);
  backfillNeighborhoods().catch((e) => console.warn("[geo]", e.message));
});
