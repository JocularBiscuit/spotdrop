import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { DRINKS, MEALS, PRICE, SERVICE, VENUES } from "../../../shared/vocab.ts";
import type { Category, DiscoverItem, FinderState, FindQuery, Spot } from "../api.ts";
import { Button, cx, inputCls, Select, TagInput } from "./ui.tsx";

type Vocab = Record<string, { emoji: string; label: string }>;

/** Toggle chips for one filter group. */
function Chips({ label, vocab, keys, value, onChange }: { label: string; vocab?: Vocab; keys: string[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!keys.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {keys.map((k) => {
          const on = value.includes(k);
          return (
            <button
              key={k}
              onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
              className={cx("rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition", on ? "border-accent bg-accent text-white" : "border-line bg-card hover:border-accent")}
            >
              {vocab?.[k] ? `${vocab[k].emoji} ${vocab[k].label}` : k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const top = (values: (string | null | undefined)[], n: number) => {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
};

/** Discover → Find places: library-style filters, the web is searched for matching places you haven't saved yet. */
export function PlaceFinder({ categories, spots, finder, found, aiOn, onSearch, renderCard }: {
  categories: Category[];
  spots: Spot[];
  finder: FinderState;
  found: DiscoverItem[];
  aiOn: boolean;
  onSearch: (q: FindQuery) => void;
  renderCard: (item: DiscoverItem) => React.ReactNode;
}) {
  const located = categories.filter((c) => c.template === "food" || c.template === "place");
  const [q, setQ] = useState<FindQuery>({ category: located[0]?.id ?? "food", venues: [], cuisines: [], meals: [], drinks: [], service: [], areas: [], types: [], price: null, text: "" });
  const cat = categories.find((c) => c.id === q.category);
  const isFood = cat?.template === "food";
  const set = <K extends keyof FindQuery>(k: K, v: FindQuery[K]) => setQ({ ...q, [k]: v });

  // Suggestions from your own library, so the chips speak your language.
  const inCat = useMemo(() => spots.filter((s) => s.category === q.category), [spots, q.category]);
  const areas = useMemo(() => top(spots.map((s) => s.neighborhood), 16), [spots]);
  const cuisines = useMemo(() => top(inCat.flatMap((s) => s.cuisines.map((c) => c.toLowerCase())), 14), [inCat]);
  const types = useMemo(() => top(inCat.map((s) => s.activity_type?.toLowerCase()), 14), [inCat]);

  const latest = found.filter((f) => f.search_id === finder.search_id);
  const earlier = found.filter((f) => f.search_id !== finder.search_id);

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Looking for</p>
            <Select
              value={q.category}
              onChange={(v) => setQ({ ...q, category: v, venues: [], drinks: [], meals: [], service: [], cuisines: [], types: [] })}
              options={located.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` }))}
            />
          </div>
          <label className="min-w-[14rem] flex-1 space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Anything else (optional)</span>
            <input className={inputCls} value={q.text ?? ""} onChange={(e) => set("text", e.target.value)} placeholder="e.g. cozy for a date, natural wine, open late, with a terrace" />
          </label>
        </div>

        {isFood && (
          <>
            <Chips label="Type of place" vocab={VENUES} keys={Object.keys(VENUES)} value={q.venues ?? []} onChange={(v) => set("venues", v)} />
            <Chips label="When" vocab={MEALS} keys={Object.keys(MEALS)} value={q.meals ?? []} onChange={(v) => set("meals", v)} />
            <Chips label="Drinks" vocab={DRINKS} keys={Object.keys(DRINKS)} value={q.drinks ?? []} onChange={(v) => set("drinks", v)} />
            <Chips label="Sit down or to go" vocab={SERVICE} keys={Object.keys(SERVICE)} value={q.service ?? []} onChange={(v) => set("service", v)} />
            <div className="space-y-1">
              <Chips label="Cuisine" keys={cuisines} value={q.cuisines ?? []} onChange={(v) => set("cuisines", v)} />
              <TagInput value={(q.cuisines ?? []).filter((c) => !cuisines.includes(c))} onChange={(v) => set("cuisines", [...(q.cuisines ?? []).filter((c) => cuisines.includes(c)), ...v])} placeholder="Other cuisine… (Enter)" />
            </div>
          </>
        )}
        {!isFood && (
          <div className="space-y-1">
            <Chips label="Type" keys={types} value={q.types ?? []} onChange={(v) => set("types", v)} />
            <TagInput value={(q.types ?? []).filter((t) => !types.includes(t))} onChange={(v) => set("types", [...(q.types ?? []).filter((t) => types.includes(t)), ...v])} placeholder="Type, e.g. sauna, climbing gym, viewpoint… (Enter)" />
          </div>
        )}
        <div className="space-y-1">
          <Chips label="Area" keys={areas} value={q.areas ?? []} onChange={(v) => set("areas", v)} />
          <TagInput value={(q.areas ?? []).filter((a) => !areas.includes(a))} onChange={(v) => set("areas", [...(q.areas ?? []).filter((a) => areas.includes(a)), ...v])} placeholder="Other area… (Enter)" lowercase={false} />
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Price up to</p>
          <div className="flex flex-wrap gap-1.5">
            {[null, 1, 2, 3].map((p) => (
              <button key={String(p)} onClick={() => set("price", p)} className={cx("rounded-full border px-3 py-1 text-xs font-medium", q.price === p ? "border-accent bg-accent text-white" : "border-line bg-card hover:border-accent")}>
                {p == null ? "Any" : PRICE[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button variant="primary" onClick={() => onSearch(q)} disabled={!aiOn || finder.running}>
            {finder.running ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} {finder.running ? "Searching the web…" : "Find new places"}
          </Button>
          <p className="text-xs text-muted">Only places that aren't in your library yet. Takes about a minute, about $0.10 per search with Haiku, ~$0.80 with Opus.</p>
        </div>
        {finder.error && <p className="text-xs text-red-500">{finder.error}</p>}
      </div>

      {finder.label && (
        <section>
          <h2 className="mb-1 font-display text-xl font-semibold">🔎 {finder.running ? "Searching…" : `Found ${latest.length}`}</h2>
          <p className="mb-3 text-sm capitalize text-muted">{finder.label}</p>
          {!finder.running && !latest.length && <p className="text-sm text-muted">Nothing new this time. Try fewer filters or a wider area.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{latest.map(renderCard)}</div>
        </section>
      )}
      {earlier.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-muted">Earlier searches</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{earlier.map(renderCard)}</div>
        </section>
      )}
    </div>
  );
}
