import { db, getSpot, imagesFor, listSpots, newId, now, updateSpot, deleteSpot, JSON_FIELDS, type Spot } from "./db.ts";
import { hammingHex } from "./images.ts";

const STOPWORDS = /\b(the|restaurant|restaurante|ristorante|cafe|caffe|coffee|bar|bistro|kitchen|eatery|trattoria|osteria|pizzeria|bakery|boulangerie|le|la|el|il|der|die|das)\b/g;

/** AI fallback titles for screenshots it couldn't identify; never treat two of these as the same thing. */
export const isPlaceholderName = (s: string) =>
  /\b(unnamed|unknown|untitled|unidentified|post|guide|spots?|list|photos?|screenshot|playlist|carousel|slideshow|video|reel|tiktok|instagram)\b/i.test(s) || !s.trim();

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(STOPWORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

const sameish = (a: unknown, b: unknown) => !a || !b || normalizeName(String(a)) === normalizeName(String(b));

/** Finds an existing spot that looks like the same thing (by name+city or near-identical screenshot). */
export function findDuplicate(spot: Spot): Spot | null {
  const notDup = new Set((spot.not_duplicates as string[]) ?? []);
  const myHashes = spot.images.map((i) => i.dhash).filter(Boolean) as string[];
  for (const other of listSpots()) {
    if (other.id === spot.id || notDup.has(other.id) || ((other.not_duplicates as string[]) ?? []).includes(spot.id)) continue;
    if (other.status !== "ready") continue;

    const a = String(spot.name ?? "");
    const b = String(other.name ?? "");
    // "Step 5" vs "Step 6", "Top 10" vs "Top 5": different numbers mean different things.
    const nums = (t: string) => (normalizeName(t).match(/\d+/g) ?? []).join(",");
    if (nums(a) !== nums(b)) continue;
    // Placeholder titles ("Munich city photo post", "Vegan pizza spot (unnamed)") aren't real names to match on.
    if (isPlaceholderName(a) || isPlaceholderName(b)) continue;

    const sim = nameSimilarity(a, b);
    const sameName = sim >= 0.9 && normalizeName(a).length >= 3;
    if (sameName && spot.category === other.category && sameish(spot.city, other.city) && sameish(spot.country, other.country)) return other;

    // Near-identical screenshot (re-saved / re-cropped) *and* a matching name. Series from one creator look alike, so be strict.
    const sameImage = other.images.some((img) => img.dhash && myHashes.some((h) => hammingHex(h, img.dhash!) <= 2));
    if (sameImage && sim >= 0.75) return other;
  }
  return null;
}

/**
 * Automatic dedupe: if this item is clearly something already in the library, fold it into the
 * existing one (older item wins, gets the new screenshot + any new info). Returns the surviving id.
 */
export function mergeIfDuplicate(id: string): string {
  const spot = getSpot(id);
  if (!spot || spot.status !== "ready") return id;
  const dup = findDuplicate(spot);
  if (!dup) {
    if (spot.duplicate_of) updateSpot(id, { duplicate_of: null });
    return id;
  }
  const [older, newer] = String(dup.created_at) <= String(spot.created_at) ? [dup, spot] : [spot, dup];
  mergeSpots(newer.id, older.id);
  console.log(`[dedupe] merged "${newer.name}" into "${older.name}"`);
  return older.id;
}

/** Fold duplicates that were only flagged by older versions. */
export function mergeFlaggedDuplicates() {
  const rows = db.prepare("SELECT id FROM spots WHERE duplicate_of IS NOT NULL").all() as { id: string }[];
  for (const r of rows) if (getSpot(r.id)) mergeIfDuplicate(r.id);
}

export function refreshDuplicateFlag(id: string) {
  const spot = getSpot(id);
  if (!spot) return;
  const dup = findDuplicate(spot);
  updateSpot(id, { duplicate_of: dup?.id ?? null });
}

/** Merge `sourceId` into `targetId`: images move over, empty fields are filled, lists are unioned. */
export function mergeSpots(sourceId: string, targetId: string) {
  const src = getSpot(sourceId);
  const dst = getSpot(targetId);
  if (!src || !dst) throw new Error("spot not found");

  const patch: Record<string, unknown> = {};
  const scalar = ["city", "country", "address", "lat", "lng", "activity_type", "price", "specialness_reason", "description", "website", "maps_url", "instagram", "source_platform", "source_handle", "content", "handle", "platform"];
  for (const f of scalar) if ((dst[f] === null || dst[f] === "") && src[f] !== null && src[f] !== "") patch[f] = src[f];
  for (const f of JSON_FIELDS) {
    if (f === "not_duplicates") continue;
    patch[f] = [...new Set([...((dst[f] as string[]) ?? []), ...((src[f] as string[]) ?? [])])];
  }
  patch.specialness = Math.max(Number(dst.specialness ?? 0), Number(src.specialness ?? 0)) || null;
  if (src.notes) patch.notes = [dst.notes, src.notes].filter(Boolean).join("\n\n");
  patch.duplicate_of = null;

  db.prepare("UPDATE images SET spot_id = ? WHERE spot_id = ?").run(targetId, sourceId);
  // Drop exact duplicate rows of the same file (multi-spot screenshots) after moving.
  const seen = new Set<string>();
  for (const img of imagesFor(targetId)) {
    if (seen.has(img.file)) db.prepare("DELETE FROM images WHERE id = ?").run(img.id);
    seen.add(img.file);
  }
  updateSpot(targetId, patch);
  deleteSpot(sourceId);
  db.prepare("UPDATE spots SET duplicate_of = NULL WHERE duplicate_of = ?").run(sourceId);
}

/**
 * One-time repair: items that older versions merged under a placeholder name may hold screenshots of
 * different places. Give every extra screenshot its own item again. Returns the ids to re-sort.
 */
export function splitPlaceholderMerges(): string[] {
  const created: string[] = [];
  for (const spot of listSpots()) {
    if (!isPlaceholderName(String(spot.name ?? ""))) continue;
    const files = [...new Set(spot.images.map((i) => i.file))];
    if (files.length < 2) continue;
    created.push(spot.id); // the original was a mix too: re-sort it as well
    for (const file of files.slice(1)) created.push(splitImage(spot.id, file));
  }
  return created;
}

/** Move one screenshot (all its rows on this item) into a brand-new item. */
export function splitImage(spotId: string, file: string): string {
  const spot = getSpot(spotId);
  if (!spot) throw new Error("not found");
  const id = newId();
  const ts = now();
  db.prepare("INSERT INTO spots (id, created_at, updated_at, name, category, kind, collections, captured_at) VALUES (?, ?, ?, '', 'misc', 'other', ?, ?)")
    .run(id, ts, ts, JSON.stringify(spot.collections ?? []), (spot.captured_at as string) ?? ts);
  db.prepare("UPDATE images SET spot_id = ? WHERE spot_id = ? AND file = ?").run(id, spotId, file);
  // Both halves were mixed up: let them be re-sorted from scratch, and never auto-merge them back together.
  db.prepare("UPDATE spots SET not_duplicates = ? WHERE id = ?").run(JSON.stringify([...((spot.not_duplicates as string[]) ?? []), id]), spotId);
  db.prepare("UPDATE spots SET not_duplicates = ? WHERE id = ?").run(JSON.stringify([spotId]), id);
  return id;
}

/**
 * One-time repair: an item that holds a screenshot which doesn't mention the item's name but does name
 * another saved item got that screenshot by mistake (carousel slides of different places). Detach it.
 */
export function detachMisattachedImages(): number {
  const all = listSpots();
  const names = all.map((s) => ({ id: s.id, n: normalizeName(String(s.name ?? "")) })).filter((x) => x.n.length >= 4);
  let detached = 0;
  for (const spot of all) {
    const files = [...new Set(spot.images.map((i) => i.file))];
    if (files.length < 2) continue;
    const mine = normalizeName(String(spot.name ?? ""));
    if (mine.length < 4) continue;
    for (const file of files) {
      const text = normalizeName(spot.images.filter((i) => i.file === file).map((i) => i.ocr_text ?? "").join(" "));
      if (text.includes(mine)) continue;
      const other = names.find((x) => x.id !== spot.id && text.includes(x.n));
      if (!other) continue;
      db.prepare("DELETE FROM images WHERE spot_id = ? AND file = ?").run(spot.id, file);
      detached++;
    }
  }
  return detached;
}
