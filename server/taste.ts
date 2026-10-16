// What the user is into, derived from their library (what they save, rate highly, bookmark, visit)
// plus their own words. Used by Discover to pick things from the web.
import { getMeta, listCategories, listSpots, setMeta } from "./db.ts";

export const DEFAULT_PREFS =
  "Good food spots and food pop-ups, bars, markets, festivals, concerts and club nights, and anything unique or quirky in the city.";

export function getPrefs(): string {
  return getMeta("discover_prefs") ?? DEFAULT_PREFS;
}
export function setPrefs(text: string) {
  setMeta("discover_prefs", text.trim().slice(0, 1500));
}
export function getAccounts(): string[] {
  try {
    return JSON.parse(getMeta("discover_accounts") ?? "[]");
  } catch {
    return [];
  }
}
export function setAccounts(list: string[]) {
  const clean = [...new Set(list.map((a) => String(a).trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "")).filter(Boolean))];
  setMeta("discover_accounts", JSON.stringify(clean.slice(0, 40)));
}

const top = (counts: Map<string, number>, n: number) =>
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

export interface Taste {
  categories: string[];
  cuisines: string[];
  venues: string[];
  drinks: string[];
  areas: string[];
  types: string[];
  tags: string[];
  favorites: string[];
}

/** Weighted counts: favorites and high ratings count more, low ratings less. */
export function tasteProfile(): Taste {
  const cats = new Map(listCategories().map((c) => [c.id, c.name]));
  const counters = { categories: new Map<string, number>(), cuisines: new Map<string, number>(), venues: new Map<string, number>(), drinks: new Map<string, number>(), areas: new Map<string, number>(), types: new Map<string, number>(), tags: new Map<string, number>() };
  const add = (m: Map<string, number>, k: unknown, w: number) => {
    const key = String(k ?? "").trim().toLowerCase();
    if (key) m.set(key, (m.get(key) ?? 0) + w);
  };
  const favorites: string[] = [];
  for (const s of listSpots()) {
    if (s.status !== "ready" || s.category === "misc" || s.category === "photos") continue;
    const w = 1 + (s.favorite ? 2 : 0) + (s.visited ? 1 : 0) + Math.max(0, Number(s.specialness ?? 2) - 2) * 0.5;
    add(counters.categories, cats.get(String(s.category)), w);
    for (const x of s.cuisines as string[]) add(counters.cuisines, x, w);
    for (const x of s.venue_types as string[]) add(counters.venues, x.replace("_", " "), w);
    for (const x of s.drinks as string[]) add(counters.drinks, x.replace("_", " "), w);
    add(counters.areas, s.neighborhood, w);
    add(counters.types, s.activity_type, w);
    for (const x of s.tags as string[]) add(counters.tags, x, w * 0.5);
    if ((s.favorite || Number(s.specialness) >= 4) && favorites.length < 15) favorites.push(String(s.name));
  }
  return {
    categories: top(counters.categories, 6),
    cuisines: top(counters.cuisines, 10),
    venues: top(counters.venues, 6),
    drinks: top(counters.drinks, 5),
    areas: top(counters.areas, 8),
    types: top(counters.types, 10),
    tags: top(counters.tags, 12),
    favorites,
  };
}

export function tasteText(t = tasteProfile()): string {
  const line = (label: string, xs: string[]) => (xs.length ? `- ${label}: ${xs.join(", ")}` : "");
  return [
    line("Saves most", t.categories),
    line("Cuisines", t.cuisines),
    line("Kinds of places", t.venues),
    line("Drinks", t.drinks),
    line("Favourite areas", t.areas),
    line("Other things they save", t.types),
    line("Recurring topics", t.tags),
    line("Spots they love", t.favorites),
  ].filter(Boolean).join("\n");
}
