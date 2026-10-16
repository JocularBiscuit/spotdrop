import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./config.ts";
import { BUILTIN_CATEGORIES, TEMPLATES, type CategoryDef } from "../shared/vocab.ts";

export const db = new DatabaseSync(path.join(DATA_DIR, "spotdrop.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS spots (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'place',          -- place | food | activity
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',       -- queued | ocr | analyzing | ready | error
  status_detail TEXT,
  needs_review INTEGER NOT NULL DEFAULT 1,
  city TEXT, country TEXT, address TEXT,
  lat REAL, lng REAL,
  meals TEXT NOT NULL DEFAULT '[]',
  venue_types TEXT NOT NULL DEFAULT '[]',
  cuisines TEXT NOT NULL DEFAULT '[]',
  dishes TEXT NOT NULL DEFAULT '[]',
  drinks TEXT NOT NULL DEFAULT '[]',
  service TEXT NOT NULL DEFAULT '[]',
  activity_type TEXT,
  price INTEGER,
  specialness INTEGER,
  specialness_reason TEXT,
  description TEXT,
  website TEXT, maps_url TEXT, instagram TEXT,
  source_platform TEXT, source_handle TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  confidence REAL,
  duplicate_of TEXT,
  not_duplicates TEXT NOT NULL DEFAULT '[]',
  researched INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  spot_id TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  thumb TEXT NOT NULL,
  width INTEGER, height INTEGER,
  dhash TEXT,
  ocr_text TEXT,
  ocr_lines TEXT,
  original_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS images_spot ON images(spot_id);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📁',
  color TEXT NOT NULL DEFAULT '#78716c',
  template TEXT NOT NULL DEFAULT 'generic',
  description TEXT NOT NULL DEFAULT '',
  builtin INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📌',
  created_at TEXT NOT NULL
);
`);

db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
export const getMeta = (key: string) => (db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
export const setMeta = (key: string, value: string) => {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
};

// ---- migrations (additive, safe to run on every start) ----
const spotColumns = new Set((db.prepare("PRAGMA table_info(spots)").all() as { name: string }[]).map((c) => c.name));
const addColumn = (name: string, ddl: string) => {
  if (!spotColumns.has(name)) db.exec(`ALTER TABLE spots ADD COLUMN ${name} ${ddl}`);
};
const hadCategory = spotColumns.has("category");
addColumn("category", "TEXT NOT NULL DEFAULT 'misc'");
addColumn("key_points", "TEXT NOT NULL DEFAULT '[]'");
addColumn("content", "TEXT");
addColumn("handle", "TEXT");
addColumn("platform", "TEXT");
addColumn("collections", "TEXT NOT NULL DEFAULT '[]'");
addColumn("user_fields", "TEXT NOT NULL DEFAULT '[]'");
addColumn("ai_pending", "INTEGER NOT NULL DEFAULT 0");
addColumn("date_start", "TEXT");   // YYYY-MM-DD
addColumn("date_end", "TEXT");     // YYYY-MM-DD, multi-day events
addColumn("event_time", "TEXT");   // free text, e.g. "19:00" or "11–18 Uhr"
addColumn("neighborhood", "TEXT"); // e.g. Schwabing, Glockenbachviertel
addColumn("captured_at", "TEXT");
addColumn("visited", "INTEGER NOT NULL DEFAULT 0");   // "Been there"
addColumn("last_viewed_at", "TEXT");                   // for "rediscover" recommendations
addColumn("review_reason", "TEXT");
addColumn("favorite", "INTEGER NOT NULL DEFAULT 0");   // bookmarked ("Saved")
addColumn("official_description", "TEXT");             // one line from Google Maps / the venue's own site
addColumn("official_source", "TEXT");
addColumn("opening_hours", "TEXT");                    // JSON: 7 strings Mon..Sun ("12:00-22:00", "closed", ""); "[]" = looked up, unknown; NULL = not looked up                  // e.g. "Google Maps", "website"                    // what the AI was unsure about  // when the screenshot was taken (file date), anchors relative dates
{
  const imageColumns = new Set((db.prepare("PRAGMA table_info(images)").all() as { name: string }[]).map((c) => c.name));
  if (!imageColumns.has("sha1")) db.exec("ALTER TABLE images ADD COLUMN sha1 TEXT");
  // Vertical center (0-1) of the photo inside a screenshot (e.g. the venue picture at the top of a Google Maps card),
  // so tiles crop to the picture instead of the buttons. NULL = not computed yet, -1 = no photo found (crop centered).
  if (!imageColumns.has("focus_y")) db.exec("ALTER TABLE images ADD COLUMN focus_y REAL");
  db.exec("CREATE INDEX IF NOT EXISTS images_sha1 ON images(sha1)");
}
if (!hadCategory) {
  // Spots saved before categories existed were all food or activities.
  db.exec("UPDATE spots SET category = CASE WHEN kind = 'activity' THEN 'places' ELSE 'food' END");
}
{
  const ts = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO categories (id, name, emoji, color, template, description, builtin, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET sort = excluded.sort`,
  );
  BUILTIN_CATEGORIES.forEach((c, i) => upsert.run(c.id, c.name, c.emoji, c.color, c.template, c.description, i, ts));
}
if (!getMeta("split_drinks")) {
  // "Food & Drink" became "Food" + "Bars & Drinks": move pure bars (no kitchen-type venue) over, once.
  const food = BUILTIN_CATEGORIES.find((c) => c.id === "food")!;
  db.prepare("UPDATE categories SET name = ?, description = ? WHERE id = 'food' AND name = 'Food & Drink'").run(food.name, food.description);
  const BAR = ["bar", "wine_bar", "pub", "rooftop"];
  const rows = db.prepare("SELECT id, venue_types FROM spots WHERE category = 'food' AND kind != 'food'").all() as { id: string; venue_types: string }[];
  const move = db.prepare("UPDATE spots SET category = 'drinks' WHERE id = ?");
  let moved = 0;
  for (const r of rows) {
    let v: string[] = [];
    try { v = JSON.parse(r.venue_types || "[]"); } catch { /* ignore */ }
    if (v.length && v.every((x) => BAR.includes(x)) && v.some((x) => x !== "rooftop")) { move.run(r.id); moved++; }
  }
  setMeta("split_drinks", "1");
  if (moved) console.log(`[db] moved ${moved} bar(s) to Bars & Drinks`);
}

export const JSON_FIELDS = ["meals", "venue_types", "cuisines", "dishes", "drinks", "service", "tags", "not_duplicates", "key_points", "collections", "user_fields"] as const;

export const EDITABLE_FIELDS = [
  "kind", "name", "needs_review", "city", "country", "address", "lat", "lng",
  "meals", "venue_types", "cuisines", "dishes", "drinks", "service", "activity_type",
  "price", "specialness", "specialness_reason", "description", "website", "maps_url",
  "instagram", "source_platform", "source_handle", "notes", "tags", "duplicate_of",
  "category", "key_points", "content", "handle", "platform", "collections",
  "date_start", "date_end", "event_time", "neighborhood", "captured_at", "visited", "favorite", "official_description", "official_source", "opening_hours",
] as const;

export interface ImageRow {
  id: string; spot_id: string; file: string; thumb: string;
  width: number | null; height: number | null; dhash: string | null;
  ocr_text: string | null; ocr_lines: string | null; original_name: string | null; created_at: string;
  sha1?: string | null;
  focus_y?: number | null;
}

export type Spot = Record<string, unknown> & { id: string; images: ImageRow[] };

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

function hydrate(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const f of JSON_FIELDS) {
    try {
      out[f] = JSON.parse(String(row[f] ?? "[]"));
    } catch {
      out[f] = [];
    }
  }
  out.needs_review = Boolean(row.needs_review);
  out.researched = Boolean(row.researched);
  out.ai_pending = Boolean(row.ai_pending);
  out.visited = Boolean(row.visited);
  out.favorite = Boolean(row.favorite);
  try {
    out.opening_hours = row.opening_hours == null ? null : JSON.parse(String(row.opening_hours));
  } catch {
    out.opening_hours = null;
  }
  return out;
}

export function imagesFor(spotId: string): ImageRow[] {
  return db.prepare("SELECT * FROM images WHERE spot_id = ? ORDER BY created_at").all(spotId) as unknown as ImageRow[];
}

export function getSpot(id: string): Spot | null {
  const row = db.prepare("SELECT * FROM spots WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...hydrate(row), images: imagesFor(id) } as Spot;
}

export function listSpots(): Spot[] {
  const rows = db.prepare("SELECT * FROM spots ORDER BY created_at DESC").all() as Record<string, unknown>[];
  const imgs = db.prepare("SELECT * FROM images ORDER BY created_at").all() as unknown as ImageRow[];
  const bySpot = new Map<string, ImageRow[]>();
  for (const img of imgs) {
    const list = bySpot.get(img.spot_id) ?? [];
    list.push(img);
    bySpot.set(img.spot_id, list);
  }
  return rows.map((r) => ({ ...hydrate(r), images: bySpot.get(String(r.id)) ?? [] }) as Spot);
}

export function createSpot(fields: Record<string, unknown> = {}): string {
  const id = newId();
  const ts = now();
  db.prepare("INSERT INTO spots (id, created_at, updated_at) VALUES (?, ?, ?)").run(id, ts, ts);
  if (Object.keys(fields).length) updateSpot(id, fields);
  return id;
}

const ALL_COLUMNS = new Set<string>([...EDITABLE_FIELDS, "status", "status_detail", "confidence", "researched", "not_duplicates", "user_fields", "ai_pending", "last_viewed_at", "review_reason"]);

export function updateSpot(id: string, fields: Record<string, unknown>) {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, raw] of Object.entries(fields)) {
    if (!ALL_COLUMNS.has(key) || raw === undefined) continue;
    let value: unknown = raw;
    if ((JSON_FIELDS as readonly string[]).includes(key)) value = JSON.stringify(Array.isArray(raw) ? raw : []);
    else if (typeof raw === "boolean") value = raw ? 1 : 0;
    else if (raw !== null && typeof raw === "object") value = JSON.stringify(raw);
    sets.push(`${key} = ?`);
    values.push(value as string | number | null);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  values.push(now(), id);
  db.prepare(`UPDATE spots SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteSpot(id: string) {
  db.prepare("DELETE FROM spots WHERE id = ?").run(id);
}

export function insertImage(img: Omit<ImageRow, "created_at">) {
  db.prepare(
    `INSERT INTO images (id, spot_id, file, thumb, width, height, dhash, ocr_text, ocr_lines, original_name, sha1, focus_y, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(img.id, img.spot_id, img.file, img.thumb, img.width, img.height, img.dhash, img.ocr_text, img.ocr_lines, img.original_name, img.sha1 ?? null, img.focus_y ?? null, now());
}

export function fileStillReferenced(file: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM images WHERE file = ? LIMIT 1").get(file));
}

// ---- categories & collections -----------------------------------------------

export interface CategoryRow extends CategoryDef {
  builtin: boolean;
  sort: number;
}

export function listCategories(): CategoryRow[] {
  const rows = db.prepare("SELECT * FROM categories ORDER BY sort, created_at").all() as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as CategoryRow), builtin: Boolean(r.builtin) }));
}

export function getCategory(id: string): CategoryRow | null {
  return listCategories().find((c) => c.id === id) ?? null;
}

export const isTemplate = (t: unknown): t is CategoryDef["template"] => typeof t === "string" && t in TEMPLATES;

function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
  let id = base;
  for (let i = 2; getCategory(id); i++) id = `${base}-${i}`;
  return id;
}

export function createCategory(c: Partial<CategoryDef> & { name: string }): CategoryRow {
  const id = slugify(c.name);
  db.prepare(
    `INSERT INTO categories (id, name, emoji, color, template, description, builtin, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 100, ?)`,
  ).run(id, c.name.trim(), c.emoji || "📁", c.color || "#78716c", isTemplate(c.template) ? c.template : "generic", c.description ?? "", now());
  return getCategory(id)!;
}

export function updateCategory(id: string, c: Partial<CategoryDef>) {
  const cur = getCategory(id);
  if (!cur) throw new Error("category not found");
  const next = {
    name: c.name?.trim() || cur.name,
    emoji: c.emoji || cur.emoji,
    color: c.color || cur.color,
    // Built-ins keep their template so the AI schema and UI stay consistent.
    template: !cur.builtin && isTemplate(c.template) ? c.template : cur.template,
    description: c.description ?? cur.description,
  };
  db.prepare("UPDATE categories SET name = ?, emoji = ?, color = ?, template = ?, description = ? WHERE id = ?")
    .run(next.name, next.emoji, next.color, next.template, next.description, id);
}

/** Custom categories only; their items fall back to Misc. */
export function deleteCategory(id: string) {
  const cur = getCategory(id);
  if (!cur) return;
  if (cur.builtin) throw new Error("Built-in categories can't be deleted");
  db.prepare("UPDATE spots SET category = 'misc', updated_at = ? WHERE category = ?").run(now(), id);
  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
}

export interface CollectionRow {
  id: string;
  name: string;
  emoji: string;
  created_at: string;
}

export function listCollections(): CollectionRow[] {
  return db.prepare("SELECT * FROM collections ORDER BY name COLLATE NOCASE").all() as unknown as CollectionRow[];
}

export function createCollection(name: string, emoji?: string): CollectionRow {
  const id = newId();
  db.prepare("INSERT INTO collections (id, name, emoji, created_at) VALUES (?, ?, ?, ?)").run(id, name.trim(), emoji || "📌", now());
  return listCollections().find((c) => c.id === id)!;
}

export function updateCollection(id: string, fields: { name?: string; emoji?: string }) {
  const cur = listCollections().find((c) => c.id === id);
  if (!cur) throw new Error("collection not found");
  db.prepare("UPDATE collections SET name = ?, emoji = ? WHERE id = ?").run(fields.name?.trim() || cur.name, fields.emoji || cur.emoji, id);
}

/** Removes the collection and its membership from every item (items themselves stay). */
export function deleteCollection(id: string) {
  const rows = db.prepare("SELECT id, collections FROM spots WHERE collections LIKE ?").all(`%${id}%`) as { id: string; collections: string }[];
  for (const r of rows) {
    const list = (JSON.parse(r.collections) as string[]).filter((c) => c !== id);
    db.prepare("UPDATE spots SET collections = ? WHERE id = ?").run(JSON.stringify(list), r.id);
  }
  db.prepare("DELETE FROM collections WHERE id = ?").run(id);
}

/** Exact same file already imported? (sha1 of the original upload bytes) */
export function imageExists(sha1: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM images WHERE sha1 = ? LIMIT 1").get(sha1));
}
