// Opening hours: 7 strings Monday..Sunday ("12:00-22:00", "11:30-14:30, 17:30-22:00", "closed", "" = unknown).
// mobile/index.html has a copy of openState() (it's a standalone page without a build step).

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const mins = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
/** [open, close] in minutes from that day's midnight; close may be > 24h for late nights. */
const ranges = (day: string | undefined): [number, number][] =>
  !day || day === "closed" ? [] : day.split(/,\s*/).map((r) => {
    const [a, b] = r.split("-").map(mins);
    return [a, b <= a ? b + 1440 : b];
  });
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export interface OpenState {
  open: boolean;
  /** e.g. "Open · until 22:00", "Closed · opens 18:00", "Closed · opens Tue 12:00" */
  text: string;
}

export function openState(hours: string[] | null | undefined, at = new Date()): OpenState | null {
  if (!hours || hours.length !== 7) return null;
  const today = (at.getDay() + 6) % 7; // Monday = 0
  const now = at.getHours() * 60 + at.getMinutes();
  const yesterday = (today + 6) % 7;
  // Still open from last night (e.g. bar 18:00-02:00)?
  for (const [, b] of ranges(hours[yesterday])) if (b > 1440 && now < b - 1440) return { open: true, text: `Open · until ${hhmm(b)}` };
  for (const [a, b] of ranges(hours[today])) if (now >= a && now < b) return { open: true, text: `Open · until ${hhmm(b)}` };
  for (const [a] of ranges(hours[today])) if (a > now) return { open: false, text: `Closed · opens ${hhmm(a)}` };
  for (let i = 1; i <= 7; i++) {
    const d = (today + i) % 7;
    const first = ranges(hours[d])[0];
    if (first) return { open: false, text: `Closed · opens ${i === 1 ? "tomorrow" : DAYS[d]} ${hhmm(first[0])}` };
  }
  return null;
}

/** "Mon–Fri 12:00-22:00 · Sat 10:00-23:00 · Sun closed" style lines, grouping equal neighbouring days. */
export function weekLines(hours: string[] | null | undefined): { days: string; hours: string }[] {
  if (!hours || hours.length !== 7) return [];
  const out: { days: string; hours: string }[] = [];
  for (let i = 0; i < 7; ) {
    let j = i;
    while (j + 1 < 7 && hours[j + 1] === hours[i]) j++;
    out.push({ days: i === j ? DAYS[i] : `${DAYS[i]}–${DAYS[j]}`, hours: hours[i] === "closed" ? "closed" : (hours[i] || "?").replace(/-/g, "–") });
    i = j + 1;
  }
  return out;
}
