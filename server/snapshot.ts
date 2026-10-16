// Read-only phone version: an encrypted snapshot of the library + Discover, published to Cloudflare Pages.
// The data is encrypted on this Mac (AES-256-GCM, key from the passphrase via PBKDF2-SHA256) BEFORE upload,
// so Cloudflare only ever stores ciphertext. The phone page asks for the passphrase and decrypts locally.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import sharp from "sharp";
import { DATA_DIR, ROOT, THUMBS_DIR, getSettings, saveSettings } from "./config.ts";
import { db, getMeta, listCategories, listCollections, listSpots, setMeta } from "./db.ts";
import { DISCOVER_IMAGES, GENRES, listDiscover, listFound } from "./discover.ts";

const OUT = path.join(DATA_DIR, "mobile-dist");
const VIEWER = path.join(ROOT, "mobile", "index.html");
const ITERATIONS = 600_000;

export interface SnapshotStatus {
  configured: boolean;
  publishing: boolean;
  url: string | null;
  last_published: string | null;
  last_error: string | null;
  /** Something changed since the last publish. */
  pending: boolean;
}

let publishing = false;
export function snapshotStatus(): SnapshotStatus {
  const s = getSettings();
  return {
    configured: Boolean(s.cfAccountId && s.cfApiToken && s.snapshotPassphrase),
    publishing,
    url: getMeta("snapshot_url") ?? null,
    last_published: getMeta("snapshot_published") ?? null,
    last_error: getMeta("snapshot_error") ?? null,
    pending: fingerprint() !== getMeta("snapshot_fingerprint"),
  };
}

/** Changes whenever something visible changes, so we only publish when needed. */
function fingerprint(): string {
  const a = db.prepare("SELECT COUNT(*) n, MAX(updated_at) m FROM spots").get() as { n: number; m: string };
  const b = db.prepare("SELECT COUNT(*) n, MAX(updated_at) m FROM discover").get() as { n: number; m: string };
  const c = db.prepare("SELECT COUNT(*) n FROM categories").get() as { n: number };
  const imgs = db.prepare("SELECT COUNT(*) n FROM discover WHERE image IS NOT NULL AND image != 'none'").get() as { n: number };
  // A new version of the phone page also counts as a change.
  const viewer = crypto.createHash("sha1").update(fs.readFileSync(VIEWER)).digest("hex").slice(0, 10);
  return `${a.n}|${a.m}|${b.n}|${b.m}|${c.n}|${imgs.n}|${viewer}|${getSettings().homeCity}`;
}

async function smallImage(file: string): Promise<string | null> {
  try {
    const buf = await sharp(file).resize({ width: 360, height: 220, fit: "cover" }).webp({ quality: 50 }).toBuffer();
    return `data:image/webp;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function thumbData(file: string | undefined, focus?: number | null): Promise<string | null> {
  if (!file) return null;
  try {
    const src = path.join(THUMBS_DIR, file);
    let img = sharp(src);
    const { width = 0, height = 0 } = await sharp(src).metadata();
    if (focus != null && focus >= 0 && height > width) {
      // Square crop centered on the photo inside the screenshot.
      const top = Math.round(Math.min(Math.max(focus * height - width / 2, 0), height - width));
      img = sharp(src).extract({ left: 0, top, width, height: width });
    }
    const buf = await img.resize({ width: 220, height: 220, fit: "cover" }).webp({ quality: 50 }).toBuffer();
    return `data:image/webp;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function buildPayload() {
  const cats = listCategories().map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, color: c.color, template: c.template }));
  const items = [];
  for (const s of listSpots()) {
    if (s.status !== "ready") continue;
    items.push({
      id: s.id, name: s.name, category: s.category, kind: s.kind,
      description: s.description, official: s.official_description, official_source: s.official_source,
      city: s.city, neighborhood: s.neighborhood, address: s.address, lat: s.lat, lng: s.lng,
      meals: s.meals, venues: s.venue_types, cuisines: s.cuisines, dishes: s.dishes, drinks: s.drinks, service: s.service,
      type: s.activity_type, tags: s.tags, price: s.price, rating: s.specialness, hours: s.opening_hours,
      date_start: s.date_start, date_end: s.date_end, time: s.event_time,
      website: s.website, maps_url: s.maps_url, instagram: s.instagram, handle: s.handle, platform: s.platform,
      notes: s.notes, saved: s.favorite, visited: s.visited, collections: s.collections, created_at: s.created_at,
      thumb: await thumbData(s.images[0]?.thumb, s.images[0]?.focus_y),
    });
  }
  const discover = ([...listDiscover(), ...listFound()] as Record<string, unknown>[])
    .filter((d) => d.status !== "disliked")
    .map((d) => ({ image: d.image && d.image !== "none" ? path.join(DISCOVER_IMAGES, String(d.image)) : null, id: d.id, title: d.title, topic: d.topic, kind: d.kind, description: d.description, why: d.why, date_start: d.date_start, date_end: d.date_end, time: d.event_time, venue: d.venue, address: d.address, neighborhood: d.neighborhood, lat: d.lat, lng: d.lng, url: d.url, source: d.source, price: d.price, status: d.status, genres: d.genres, collective: d.collective, found: Boolean(d.search_id) }));
  for (const d of discover) (d as Record<string, unknown>).image = d.image ? await smallImage(d.image) : null;
  return { v: 1, generated_at: new Date().toISOString(), home_city: getSettings().homeCity, categories: cats, collections: listCollections(), items, discover, genres: GENRES };
}

/** AES-256-GCM with a PBKDF2 key. The salt is kept stable so the phone's remembered key keeps working. */
function encrypt(payload: unknown, passphrase: string) {
  let salt = getMeta("snapshot_salt");
  if (!salt) {
    salt = crypto.randomBytes(16).toString("base64");
    setMeta("snapshot_salt", salt);
  }
  const key = crypto.pbkdf2Sync(passphrase, Buffer.from(salt, "base64"), ITERATIONS, 32, "sha256");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt, iv: iv.toString("base64"), data: data.toString("base64") };
}

function wrangler(args: string[], env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = path.join(ROOT, "node_modules", ".bin", "wrangler");
    execFile(bin, args, { cwd: ROOT, env: { ...process.env, ...env, WRANGLER_SEND_METRICS: "false" }, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      if (err) reject(new Error(out.split("\n").filter((l) => /error|✘|failed/i.test(l)).slice(0, 3).join(" ").trim() || err.message));
      else resolve(out);
    });
  });
}

/** The static phone site: viewer page + encrypted data. */
export async function writeSnapshotDir(passphrase: string, out = OUT) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(VIEWER, path.join(out, "index.html"));
  fs.copyFileSync(path.join(ROOT, "web", "public", "favicon.svg"), path.join(out, "icon.svg"));
  fs.writeFileSync(path.join(out, "manifest.webmanifest"), JSON.stringify({ name: "Spotdrop", short_name: "Spotdrop", display: "standalone", start_url: "./", background_color: "#14110f", theme_color: "#14110f", icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }] }));
  // Never cache the data file, so the phone always gets the latest snapshot.
  fs.writeFileSync(path.join(out, "_headers"), "/snapshot.json\n  Cache-Control: no-store\n/*\n  X-Robots-Tag: noindex\n  Referrer-Policy: no-referrer\n");
  fs.writeFileSync(path.join(out, "snapshot.json"), JSON.stringify(encrypt(await buildPayload(), passphrase)));
  return out;
}

/** Build, encrypt and upload. Returns the public (but encrypted) URL. */
export async function publishSnapshot(force = false): Promise<SnapshotStatus> {
  let s = getSettings();
  // pages.dev names are global: a random suffix avoids clashes and makes the address hard to guess.
  if (!s.cfProject) s = saveSettings({ cfProject: `spotdrop-${crypto.randomBytes(4).toString("hex").slice(0, 6)}` });
  if (!snapshotStatus().configured) throw new Error("Add your Cloudflare account ID, API token and a passphrase first.");
  if (publishing) return snapshotStatus();
  const fp = fingerprint();
  if (!force && fp === getMeta("snapshot_fingerprint")) return snapshotStatus();
  publishing = true;
  try {
    await writeSnapshotDir(s.snapshotPassphrase);

    const env = { CLOUDFLARE_API_TOKEN: s.cfApiToken, CLOUDFLARE_ACCOUNT_ID: s.cfAccountId };
    if (!getMeta("snapshot_project_ready")) {
      // First time: create the Pages project (fine if it already exists).
      await wrangler(["pages", "project", "create", s.cfProject, "--production-branch", "main"], env).catch((e) => {
        if (!/already exists|8000002/i.test(e.message)) throw e;
      });
      setMeta("snapshot_project_ready", "1");
    }
    const out = await wrangler(["pages", "deploy", OUT, "--project-name", s.cfProject, "--branch", "main", "--commit-dirty=true"], env);
    const url = `https://${s.cfProject}.pages.dev`;
    void out;
    setMeta("snapshot_url", url);
    setMeta("snapshot_published", new Date().toISOString());
    setMeta("snapshot_fingerprint", fp);
    setMeta("snapshot_error", "");
    console.log(`[snapshot] published to ${url}`);
  } catch (e) {
    setMeta("snapshot_error", (e as Error).message.slice(0, 300));
    console.warn("[snapshot]", (e as Error).message.slice(0, 300));
    throw e;
  } finally {
    publishing = false;
  }
  return snapshotStatus();
}
