import { useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { Category, Spot } from "../api.ts";
import { Button, cx } from "./ui.tsx";
import { DateSelect } from "./DateFilterBar.tsx";
import { ANY_DATE, inDateFilter, type DateFilter } from "../../../shared/dates.ts";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Every day an item covers (multi-day events appear on each day, capped at 60 days). */
function daysOf(s: Spot): string[] {
  if (!s.date_start) return [];
  const out: string[] = [];
  const d = new Date(`${s.date_start}T12:00:00`);
  const end = s.date_end ?? s.date_start;
  for (let i = 0; i < 60 && iso(d) <= end; i++, d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}

export function formatDateRange(s: Pick<Spot, "date_start" | "date_end" | "event_time">) {
  if (!s.date_start) return "";
  const fmt = (v: string, withYear: boolean) =>
    new Date(`${v}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  const thisYear = s.date_start.startsWith(String(new Date().getFullYear()));
  const range = s.date_end && s.date_end !== s.date_start ? `${fmt(s.date_start, false)} – ${fmt(s.date_end, !thisYear)}` : fmt(s.date_start, !thisYear);
  return s.event_time ? `${range} · ${s.event_time}` : range;
}

export function CalendarView({ spots, categories, onOpen }: { spots: Spot[]; categories: Category[]; onOpen: (id: string) => void }) {
  const today = iso(new Date());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const dated = useMemo(() => spots.filter((s) => s.date_start).sort((a, b) => a.date_start!.localeCompare(b.date_start!)), [spots]);
  const byDay = useMemo(() => {
    const m = new Map<string, Spot[]>();
    for (const s of dated) for (const d of daysOf(s)) m.set(d, [...(m.get(d) ?? []), s]);
    return m;
  }, [dated]);
  const [dates, setDates] = useState<DateFilter>(ANY_DATE);
  const upcoming = dated.filter((s) => (s.date_end ?? s.date_start)! >= today && inDateFilter(s, dates));
  const past = dated.filter((s) => (s.date_end ?? s.date_start)! < today).reverse();

  // Month grid, weeks starting Monday.
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const lastRowNeeded = cells.slice(35).some((d) => d.getMonth() === month.getMonth());
  const shown = lastRowNeeded ? cells : cells.slice(0, 35);
  const feed = `${location.protocol === "https:" ? "webcals" : "webcal"}://${location.host}/api/calendar.ics`;

  const Chip = ({ s }: { s: Spot }) => {
    const c = catById.get(s.category);
    return (
      <button
        onClick={() => onOpen(s.id)}
        className="block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight hover:brightness-95"
        style={{ background: `${c?.color ?? "#78716c"}22`, color: "var(--color-ink)" }}
        title={`${s.name}${s.event_time ? ` · ${s.event_time}` : ""}`}
      >
        {c?.emoji} {s.name}
      </button>
    );
  };

  return (
    <div className="grid gap-6 pb-24 xl:grid-cols-[1fr_320px]">
      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-display text-2xl font-semibold">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></Button>
            <Button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
            <Button variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
          {WEEKDAYS.map((d) => <div key={d} className="bg-card px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{d}</div>)}
          {shown.map((d) => {
            const key = iso(d);
            const items = byDay.get(key) ?? [];
            const inMonth = d.getMonth() === month.getMonth();
            return (
              <div key={key} className={cx("min-h-24 space-y-0.5 bg-card p-1.5", !inMonth && "bg-paper/60 opacity-60")}>
                <div className={cx("mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium", key === today ? "bg-accent text-white" : "text-muted")}>{d.getDate()}</div>
                {items.slice(0, 3).map((s) => <Chip key={s.id} s={s} />)}
                {items.length > 3 && <p className="px-1 text-[10px] text-muted">+{items.length - 3} more</p>}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="space-y-5">
        <div className="space-y-2 rounded-2xl border border-line bg-card p-4">
          <h3 className="text-sm font-semibold">Add to Apple Calendar</h3>
          <p className="text-xs text-muted">Subscribe once and every dated screenshot shows up in your calendar automatically while Spotdrop is running.</p>
          <div className="flex gap-2">
            <a href={feed} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white hover:brightness-110"><CalendarPlus size={15} /> Subscribe</a>
            <a href="/api/calendar.ics" download="spotdrop.ics" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-paper" title="Download .ics file"><Download size={15} /></a>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Upcoming</h3>
          <DateSelect value={dates} onChange={setDates} />
          {upcoming.length ? upcoming.map((s) => {
            const c = catById.get(s.category);
            return (
              <button key={s.id} onClick={() => onOpen(s.id)} className="flex w-full items-start gap-3 rounded-xl border border-line bg-card p-3 text-left hover:border-accent/50">
                <span className="flex w-11 shrink-0 flex-col items-center rounded-lg py-1" style={{ background: `${c?.color ?? "#78716c"}1f` }}>
                  <span className="text-[10px] font-semibold uppercase" style={{ color: c?.color }}>{new Date(`${s.date_start}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</span>
                  <span className="font-display text-lg font-semibold leading-none">{new Date(`${s.date_start}T12:00:00`).getDate()}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c?.emoji} {s.name}</span>
                  <span className="block truncate text-xs text-muted">{formatDateRange(s)}</span>
                  {(s.neighborhood || s.city) && <span className="block truncate text-xs text-muted">{[s.neighborhood, s.city].filter(Boolean).join(", ")}</span>}
                </span>
              </button>
            );
          }) : <p className="text-sm text-muted">{dates.preset !== "any" ? "Nothing on those dates." : "Nothing coming up."} Screenshots that mention a date (pop-ups, markets, concerts…) land here automatically.</p>}
        </div>

        {past.length > 0 && (
          <details className="space-y-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted">Past ({past.length})</summary>
            {past.slice(0, 30).map((s) => (
              <button key={s.id} onClick={() => onOpen(s.id)} className="mt-1.5 block w-full truncate rounded-lg px-2 py-1 text-left text-sm text-muted hover:bg-line/50">
                {formatDateRange(s)} · {s.name}
              </button>
            ))}
          </details>
        )}
      </aside>
    </div>
  );
}
