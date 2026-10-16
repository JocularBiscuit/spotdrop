import type { Spot } from "./api.ts";

export interface Filters {
  q: string;
  /** "all" or a category id. */
  category: string;
  /** "" or a collection id. */
  collection: string;
  reviewOnly: boolean;
  /** Only things in the home city (Munich). */
  home: boolean;
  /** Only bookmarked ("Saved") items. */
  saved: boolean;
  /** Food template only: venues vs dish posts. */
  foodType: "all" | "place" | "food";
  meals: string[];
  venues: string[];
  drinks: string[];
  service: string[];
  cuisines: string[];
  platforms: string[];
  tags: string[];
  /** Type within a category (shopping: clothing, skincare…; places: hike, museum…). */
  types: string[];
  minSpecial: number;
  country: string;
  city: string;
  neighborhood: string;
  sort: "new" | "special" | "name";
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  category: "all",
  collection: "",
  reviewOnly: false,
  home: false,
  saved: false,
  foodType: "all",
  meals: [],
  venues: [],
  drinks: [],
  service: [],
  cuisines: [],
  platforms: [],
  tags: [],
  types: [],
  minSpecial: 0,
  country: "",
  city: "",
  neighborhood: "",
  sort: "new",
};

/** Refinements that only make sense inside one view; cleared when switching category / collection. */
export const clearRefinements = (f: Filters): Filters => ({
  ...EMPTY_FILTERS,
  q: f.q,
  category: f.category,
  collection: f.collection,
  reviewOnly: f.reviewOnly,
  home: f.home,
  saved: f.saved,
  sort: f.sort,
});

export const activeFilterCount = (f: Filters) =>
  f.meals.length + f.venues.length + f.drinks.length + f.service.length + f.cuisines.length + f.tags.length + f.platforms.length + f.types.length +
  (f.foodType !== "all" ? 1 : 0) + (f.minSpecial ? 1 : 0) + (f.country ? 1 : 0) + (f.city ? 1 : 0) + (f.neighborhood ? 1 : 0);

const anyOf = (selected: string[], values: string[]) => !selected.length || selected.some((s) => values.includes(s));
const lc = (s: unknown) => String(s ?? "").toLowerCase();

// ---- home city ---------------------------------------------------------------------
const KNOWN_CITIES: Record<string, { aliases: string[]; center: [number, number] }> = {
  munich: { aliases: ["munich", "munchen", "monaco di baviera"], center: [11.5755, 48.1372] },
};
export const HOME = { city: "Munich", aliases: KNOWN_CITIES.munich.aliases, center: KNOWN_CITIES.munich.center as [number, number] | null };

export function setHomeCity(city: string) {
  const key = normalize(city);
  const known = Object.values(KNOWN_CITIES).find((c) => c.aliases.includes(key));
  HOME.city = city || "Munich";
  HOME.aliases = known?.aliases ?? [key];
  HOME.center = known?.center ?? null;
}

const kmBetween = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const r = Math.PI / 180;
  const x = (lng2 - lng1) * r * Math.cos(((lat1 + lat2) / 2) * r);
  return Math.hypot(x, (lat2 - lat1) * r) * 6371;
};

/** In the home city: by name, or within ~20 km of its center. */
export function isHome(s: Spot): boolean {
  if (s.city && HOME.aliases.includes(normalize(s.city))) return true;
  if (HOME.center && s.lat != null && s.lng != null) return kmBetween(s.lat, s.lng, HOME.center[1], HOME.center[0]) < 20;
  return false;
}

/** The "where am I" part only: category, collection, review, home. */
export function inScope(s: Spot, f: Pick<Filters, "category" | "collection" | "reviewOnly"> & { home?: boolean; saved?: boolean }) {
  if (f.saved && !s.favorite) return false;
  if (f.home && !isHome(s)) return false;
  if (f.category !== "all" && s.category !== f.category) return false;
  if (f.collection && !s.collections.includes(f.collection)) return false;
  if (f.reviewOnly && !needsLook(s)) return false;
  return true;
}

export const needsLook = (s: Spot) => s.needs_review || Boolean(s.duplicate_of) || s.status === "error";

/** Why an item is in "Needs a look", in plain words. */
export function reviewReason(s: Spot, names?: Map<string, string>): string {
  if (s.status === "error") return `Something went wrong: ${s.status_detail ?? "unknown error"}`;
  if (s.duplicate_of) return `Might be the same as “${names?.get(s.duplicate_of) ?? "another item"}”`;
  if (s.review_reason) return `AI unsure: ${s.review_reason}`;
  // Older items: the AI wrote its doubt into the rating note.
  if (s.specialness_reason && /uncertain|unverified|unidentified|little (detail|info)|limited|not (clear|sure|listed)|unknown|guess/i.test(s.specialness_reason)) {
    return `AI unsure: ${s.specialness_reason}`;
  }
  const pct = s.confidence != null ? ` (${Math.round(s.confidence * 100)}% sure)` : "";
  return `AI wasn't sure the name or category is right${pct}`;
}

// ---- search --------------------------------------------------------------------
// Typo-tolerant, umlaut-insensitive ranked search over everything we know about an item.

/** "Café München" → "cafe munchen", "Muenchen" → "munchen", "Straße" → "strasse". */
export const normalize = (s: string) =>
  s.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").replace(/[^a-z0-9@#]+/g, " ").trim();

function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

interface Indexed { fields: { tokens: string[]; text: string; weight: number }[] }
const indexCache = new WeakMap<Spot, Indexed>();

function indexSpot(s: Spot, categoryName: string): Indexed {
  const cached = indexCache.get(s);
  if (cached) return cached;
  const f = (weight: number, ...parts: unknown[]) => {
    const text = normalize(parts.flat().filter(Boolean).join(" "));
    return { text, tokens: text.split(" ").filter(Boolean), weight };
  };
  const idx = {
    fields: [
      f(10, s.name),
      f(6, s.neighborhood, s.city, s.country, s.address),
      f(5, s.cuisines, s.dishes, s.tags, s.venue_types, s.drinks, s.meals, s.activity_type, categoryName, s.handle, s.instagram, s.platform),
      f(3, s.description, s.key_points, s.notes, s.source_handle),
      f(1, s.content, s.images.map((i) => i.ocr_text)),
    ],
  };
  indexCache.set(s, idx);
  return idx;
}

/** Score of one query word against an item: exact/prefix > substring > typo match. 0 = no match. */
function wordScore(idx: Indexed, word: string): number {
  let best = 0;
  const maxTypos = word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0;
  for (const field of idx.fields) {
    for (const t of field.tokens) {
      let sc = 0;
      if (t === word) sc = 1;
      else if (t.startsWith(word)) sc = 0.85;
      else if (word.length >= 3 && t.includes(word)) sc = 0.6;
      else if (maxTypos && editDistanceWithin(word, t.slice(0, word.length + maxTypos), maxTypos)) sc = 0.5;
      if (sc) best = Math.max(best, sc * field.weight);
    }
    // Multi-word phrases inside a field ("pastel de nata").
    if (!best && word.includes(" ") && field.text.includes(word)) best = field.weight;
  }
  return best;
}

export function searchScore(s: Spot, words: string[], categoryName = ""): number {
  const idx = indexSpot(s, categoryName);
  let total = 0;
  for (const w of words) {
    const sc = wordScore(idx, w);
    if (!sc) return 0; // every word must match somewhere
    total += sc;
  }
  return total + (s.specialness ?? 0) * 0.1;
}

/** OR within a group, AND across groups. With a search query, results are ranked by relevance. */
export function applyFilters(spots: Spot[], f: Filters, categoryNames?: Map<string, string>): Spot[] {
  const words = normalize(f.q).split(" ").filter(Boolean);
  const scores = new Map<string, number>();
  const out = spots.filter((s) => {
    if (!inScope(s, f)) return false;
    if (f.foodType !== "all" && s.kind !== f.foodType) return false;
    if (!anyOf(f.meals, s.meals) || !anyOf(f.venues, s.venue_types) || !anyOf(f.drinks, s.drinks) || !anyOf(f.service, s.service)) return false;
    if (!anyOf(f.cuisines, s.cuisines.map(lc))) return false;
    if (!anyOf(f.tags, s.tags.map(lc))) return false;
    if (f.types.length && !f.types.includes(lc(s.activity_type))) return false;
    if (f.platforms.length && !f.platforms.includes(s.platform ?? "")) return false;
    if (f.minSpecial && (s.specialness ?? 0) < f.minSpecial) return false;
    if (f.country && s.country !== f.country) return false;
    if (f.city && s.city !== f.city) return false;
    if (f.neighborhood && s.neighborhood !== f.neighborhood) return false;
    if (words.length) {
      const sc = searchScore(s, words, categoryNames?.get(s.category) ?? "");
      if (!sc) return false;
      scores.set(s.id, sc);
    }
    return true;
  });
  if (words.length && f.sort === "new") out.sort((a, b) => scores.get(b.id)! - scores.get(a.id)!);
  else if (f.sort === "special") out.sort((a, b) => (b.specialness ?? 0) - (a.specialness ?? 0));
  else if (f.sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function countBy(spots: Spot[], pick: (s: Spot) => string[] | string | null): [string, number][] {
  const m = new Map<string, number>();
  for (const s of spots) {
    const v = pick(s);
    for (const x of Array.isArray(v) ? v : v ? [v] : []) m.set(x, (m.get(x) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
