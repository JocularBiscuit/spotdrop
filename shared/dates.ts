// Date filter for "coming up" lists. All dates are local YYYY-MM-DD.
// mobile/index.html has a copy of rangeFor()/overlaps() (standalone page without a build step).

export type DatePreset = "any" | "today" | "tomorrow" | "weekend" | "week" | "month" | "custom";
export interface DateFilter { preset: DatePreset; from?: string; to?: string }
export const ANY_DATE: DateFilter = { preset: "any" };

export const DATE_PRESETS: [DatePreset, string][] = [
  ["any", "Any time"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["weekend", "This weekend"], ["week", "Next 7 days"], ["month", "Next 30 days"],
];

export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** [from, to] inclusive, or null for "any time". The weekend is Friday–Sunday (from today if it's already the weekend). */
export function rangeFor(f: DateFilter, now = new Date()): [string, string] | null {
  const today = localDay(now);
  switch (f.preset) {
    case "today": return [today, today];
    case "tomorrow": { const t = localDay(plus(now, 1)); return [t, t]; }
    case "weekend": {
      const dow = now.getDay(); // 0 = Sunday
      const toFri = dow === 0 ? -2 : 5 - dow;
      return [toFri < 0 || dow === 5 ? today : localDay(plus(now, toFri)), localDay(plus(now, dow === 0 ? 0 : 7 - dow))];
    }
    case "week": return [today, localDay(plus(now, 6))];
    case "month": return [today, localDay(plus(now, 30))];
    case "custom": return f.from ? [f.from, f.to && f.to >= f.from ? f.to : f.from] : null;
    default: return null;
  }
}

/** Does a dated item happen (at least partly) within the filter? Undated items never match a set filter. */
export function inDateFilter(item: { date_start?: string | null; date_end?: string | null }, f: DateFilter, now = new Date()): boolean {
  const r = rangeFor(f, now);
  if (!r) return true;
  if (!item.date_start) return false;
  return item.date_start <= r[1] && (item.date_end ?? item.date_start) >= r[0];
}

export function dateFilterLabel(f: DateFilter): string {
  if (f.preset !== "custom") return DATE_PRESETS.find(([k]) => k === f.preset)?.[1] ?? "Any time";
  const r = rangeFor(f);
  if (!r) return "Pick dates";
  const fmt = (v: string) => new Date(`${v}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return r[0] === r[1] ? fmt(r[0]) : `${fmt(r[0])} – ${fmt(r[1])}`;
}
