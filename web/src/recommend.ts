// Local, instant recommendations for the Home dashboard (no AI needed).
import type { Category, Spot } from "./api.ts";
import { isHome } from "./filters.ts";

const day = () => new Date().toISOString().slice(0, 10);

/** Stable "random" per item and day, so picks rotate daily but don't jump around on every refresh. */
function dailyNoise(id: string) {
  let h = 2166136261;
  for (const c of id + day()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export interface Moment {
  title: string;
  emoji: string;
  meals: string[];
  venues: string[];
  drinks: string[];
}

/** What fits right now, by weekday and time of day. */
export function currentMoment(now = new Date()): Moment {
  const h = now.getHours() + now.getMinutes() / 60;
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const dayName = now.toLocaleDateString("en-GB", { weekday: "long" });
  if (h >= 5 && h < (weekend ? 13 : 11)) {
    return weekend
      ? { title: `Brunch ideas for ${dayName}`, emoji: "🍳", meals: ["brunch", "breakfast"], venues: ["cafe", "bakery"], drinks: [] }
      : { title: "Breakfast & coffee", emoji: "🥐", meals: ["breakfast"], venues: ["cafe", "bakery"], drinks: ["coffee", "specialty_coffee"] };
  }
  if (h < 14.5) return { title: "Lunch today", emoji: "🥗", meals: ["lunch"], venues: ["street_food", "market", "restaurant"], drinks: [] };
  if (h < 17.5) return { title: "Afternoon coffee & cake", emoji: "☕", meals: ["dessert", "snack"], venues: ["cafe", "bakery", "ice_cream"], drinks: ["coffee", "specialty_coffee", "matcha"] };
  if (h < 22) return { title: weekend || now.getDay() === 5 ? `${dayName} night dinner` : "Dinner tonight", emoji: "🍝", meals: ["dinner"], venues: ["restaurant", "fine_dining"], drinks: [] };
  return { title: "Drinks tonight", emoji: "🍸", meals: ["late_night"], venues: ["bar", "wine_bar", "pub"], drinks: ["cocktails", "wine", "natural_wine", "beer", "craft_beer"] };
}

const fits = (s: Spot, m: Moment) =>
  s.meals.some((x) => m.meals.includes(x)) || s.venue_types.some((x) => m.venues.includes(x)) || s.drinks.some((x) => m.drinks.includes(x));

/** Best first: rating, not tried yet, a little daily rotation. */
const rank = (s: Spot) => (s.specialness ?? 2) * 2 + (s.visited ? -3 : 0) + dailyNoise(s.id) * 2.5;

export function recommendations(spots: Spot[], categories: Category[]) {
  const tpl = new Map(categories.map((c) => [c.id, c.template]));
  const today = day();
  const ready = spots.filter((s) => s.status === "ready");
  const homeFood = ready.filter((s) => tpl.get(s.category) === "food" && s.kind !== "food" && isHome(s));
  const moment = currentMoment();

  const rightNow = homeFood.filter((s) => fits(s, moment)).sort((a, b) => rank(b) - rank(a)).slice(0, 4);

  const inWeek = new Date();
  inWeek.setDate(inWeek.getDate() + 7);
  const weekEnd = inWeek.toISOString().slice(0, 10);
  const thisWeek = ready
    .filter((s) => s.date_start && (s.date_end ?? s.date_start) >= today && s.date_start <= weekEnd)
    .sort((a, b) => a.date_start!.localeCompare(b.date_start!));
  const later = ready
    .filter((s) => s.date_start && s.date_start > weekEnd)
    .sort((a, b) => a.date_start!.localeCompare(b.date_start!))
    .slice(0, 6);

  const mustGo = ready
    .filter((s) => ["food", "place"].includes(tpl.get(s.category) ?? "") && isHome(s) && !s.visited && (s.specialness ?? 0) >= 4 && !rightNow.includes(s))
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 4);

  // Good saves you haven't opened in a while: the "don't let it rot" shelf.
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const threeWeeks = new Date(Date.now() - 21 * 86400000).toISOString();
  const shown = new Set([...rightNow, ...mustGo].map((s) => s.id));
  const rediscover = ready
    .filter((s) => !shown.has(s.id) && s.created_at < threeWeeks && (!s.last_viewed_at || s.last_viewed_at < monthAgo) && (s.specialness ?? 0) >= 3 && !["photos", "misc"].includes(s.category))
    .sort((a, b) => dailyNoise(b.id) - dailyNoise(a.id))
    .slice(0, 4);

  const recent = [...ready].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4);

  return { moment, rightNow, thisWeek, later, mustGo, rediscover, recent };
}
