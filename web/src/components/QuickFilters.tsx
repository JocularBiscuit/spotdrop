import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { DRINKS, MEALS, SERVICE, VENUES } from "../../../shared/vocab.ts";
import type { Category, Spot } from "../api.ts";
import { activeFilterCount, clearRefinements, countBy, HOME, inScope, normalize, type Filters } from "../filters.ts";
import { cx } from "./ui.tsx";

type ListKey = "venues" | "meals" | "drinks" | "service" | "cuisines" | "types" | "tags" | "platforms";

interface Group {
  label: string;
  key: ListKey | "neighborhood" | "category";
  options: { value: string; label: string; count: number }[];
}

function isActive(f: Filters, key: Group["key"], value: string) {
  if (key === "category") return f.category === value;
  if (key === "neighborhood") return f.neighborhood === value;
  return f[key].includes(value);
}

/** One compact dropdown per filter group. */
function Dropdown({ group, filters, onToggle, onClear }: { group: Group; filters: Filters; onToggle: (v: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const selected = group.options.filter((o) => isActive(filters, group.key, o.value));
  const shown = q ? group.options.filter((o) => normalize(o.label).includes(normalize(q))) : group.options;
  const single = group.key === "category" || group.key === "neighborhood";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cx(
          "flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-1 text-[13px] font-medium transition",
          selected.length ? "border-accent bg-accent-soft text-ink" : "border-line bg-card text-ink/80 hover:border-accent/50",
        )}
      >
        {group.label}
        {selected.length > 0 && (
          <span className="max-w-32 truncate font-semibold text-accent">
            : {selected.length === 1 ? selected[0].label.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "") : selected.length}
          </span>
        )}
        <ChevronDown size={14} className={cx("text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="animate-pop absolute left-0 top-full z-[1100] mt-1.5 w-64 rounded-2xl border border-line bg-card p-1.5 shadow-2xl">
          {group.options.length > 10 && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${group.label.toLowerCase()}…`} className="mb-1 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
          )}
          <div className="scrollbar-thin max-h-72 overflow-y-auto">
            {shown.map((o) => {
              const on = isActive(filters, group.key, o.value);
              return (
                <button
                  key={o.value}
                  onClick={() => { onToggle(o.value); if (single) setOpen(false); }}
                  className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm capitalize hover:bg-paper", on && "font-semibold")}
                >
                  <span className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent text-white" : "border-line")}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate">{o.label}</span>
                  <span className="text-xs tabular-nums text-muted">{o.count}</span>
                </button>
              );
            })}
            {!shown.length && <p className="px-2.5 py-2 text-sm text-muted">No matches</p>}
          </div>
          {selected.length > 0 && (
            <button onClick={() => { onClear(); setOpen(false); }} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-accent hover:bg-paper">
              Clear {group.label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The most useful filters for the current view as a slim row of dropdowns above the results. */
export function QuickFilters({ spots, categories, filters, setFilters }: {
  spots: Spot[];
  categories: Category[];
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  const current = categories.find((c) => c.id === filters.category);
  const template = current?.template ?? "all";
  const scope = useMemo(() => spots.filter((s) => inScope(s, filters)), [spots, filters]);

  const groups = useMemo<Group[]>(() => {
    const vocabGroup = (label: string, key: ListKey, vocab: Record<string, { label: string; emoji: string }>, pick: (s: Spot) => string[]): Group => {
      const counts = new Map(countBy(scope, pick));
      return {
        label,
        key,
        options: Object.entries(vocab).map(([value, v]) => ({ value, label: `${v.emoji} ${v.label}`, count: counts.get(value) ?? 0 })).filter((o) => o.count > 0),
      };
    };
    const countGroup = (label: string, key: ListKey | "neighborhood", pick: (s: Spot) => string[] | string | null, max = 60, fmt = (v: string) => v): Group => ({
      label,
      key,
      options: countBy(scope, pick).slice(0, max).map(([value, count]) => ({ value, label: fmt(value), count })),
    });
    const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

    const out: Group[] = [];
    if (template === "all" && !filters.home) {
      const byCat = new Map(countBy(spots.filter((s) => inScope(s, { ...filters, category: "all" })), (s) => s.category));
      out.push({ label: "Category", key: "category", options: categories.filter((c) => byCat.get(c.id)).map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}`, count: byCat.get(c.id)! })) });
    }
    if (template === "food" || (template === "all" && filters.home)) {
      out.push(vocabGroup("Type", "venues", VENUES, (s) => s.venue_types));
      out.push(vocabGroup("When", "meals", MEALS, (s) => s.meals));
      out.push(countGroup("Cuisine", "cuisines", (s) => lower(s.cuisines)));
      out.push(vocabGroup("Drinks", "drinks", DRINKS, (s) => s.drinks));
      out.push(vocabGroup("Sit / to go", "service", SERVICE, (s) => s.service));
    } else if (template === "recipe") {
      out.push(vocabGroup("When", "meals", MEALS, (s) => s.meals));
      out.push(countGroup("Cuisine", "cuisines", (s) => lower(s.cuisines)));
    } else if (template !== "all") {
      const types = countGroup("Type", "types", (s) => (s.activity_type ? s.activity_type.toLowerCase() : null));
      if (types.options.length >= 2) out.push(types);
      const catWords = new Set(normalize(`${current?.name ?? ""} ${current?.id ?? ""}`).split(" "));
      const topics = countGroup("Topics", "tags", (s) => lower(s.tags), 80, (v) => `#${v}`);
      topics.options = topics.options.filter((o) => !HOME.aliases.includes(normalize(o.value)) && !catWords.has(normalize(o.value)) && o.count < scope.length * 0.8);
      out.push(topics);
      if (template === "account") out.push(countGroup("Platform", "platforms", (s) => s.platform));
    }
    if (template === "food" || template === "place" || filters.home) out.push(countGroup("Area", "neighborhood", (s) => s.neighborhood));
    return out.filter((g) => g.options.length > 0);
  }, [scope, spots, categories, filters, template, current]);

  if (!groups.length) return null;
  const n = activeFilterCount(filters);

  const toggle = (g: Group, value: string) => {
    if (g.key === "category") return setFilters(clearRefinements({ ...filters, category: filters.category === value ? "all" : value }));
    if (g.key === "neighborhood") return setFilters({ ...filters, neighborhood: filters.neighborhood === value ? "" : value });
    const list = filters[g.key];
    setFilters({ ...filters, [g.key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] });
  };
  const clear = (g: Group) => {
    if (g.key === "category") return setFilters(clearRefinements({ ...filters, category: "all" }));
    if (g.key === "neighborhood") return setFilters({ ...filters, neighborhood: "" });
    setFilters({ ...filters, [g.key]: [] });
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {groups.map((g) => (
        <Dropdown key={g.label} group={g} filters={filters} onToggle={(v) => toggle(g, v)} onClear={() => clear(g)} />
      ))}
      {n > 0 && (
        <button onClick={() => setFilters(clearRefinements(filters))} className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft">
          <X size={14} /> Clear all
        </button>
      )}
    </div>
  );
}
