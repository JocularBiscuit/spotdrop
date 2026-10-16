import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { isProcessing, type Category, type Spot } from "../api.ts";
import { countBy, type Filters } from "../filters.ts";
import { formatDateRange } from "./CalendarView.tsx";
import { SpotCard } from "./SpotCard.tsx";
import { DateSelect } from "./DateFilterBar.tsx";
import { ANY_DATE, inDateFilter, type DateFilter } from "../../../shared/dates.ts";

interface Props {
  homeCity: string;
  spots: Spot[]; // already limited to the home city + search
  categories: Category[];
  selected: Set<string>;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string, shift: boolean) => void;
  onRetry?: (id: string) => void;
  /** "See all" → switch to the grid with these filters. */
  onDrill: (patch: Partial<Filters>) => void;
  showImages?: boolean;
  onFavorite?: (s: Spot) => void;
  onVisited?: (s: Spot) => void;
}

const bySpecial = (a: Spot, b: Spot) => (b.specialness ?? 0) - (a.specialness ?? 0) || b.created_at.localeCompare(a.created_at);

/** The home-city dashboard: the best saved food, drinks and things to do, grouped. */
export function HomeView({ homeCity, spots, categories, selected, onOpen, onToggleSelect, onRetry, onDrill, showImages, onFavorite, onVisited }: Props) {
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const today = new Date().toISOString().slice(0, 10);
  const ready = spots.filter((s) => !isProcessing(s));
  const tpl = (s: Spot) => catById.get(s.category)?.template;
  const venue = (s: Spot, ...v: string[]) => s.venue_types.some((x) => v.includes(x));

  const [dates, setDates] = useState<DateFilter>(ANY_DATE);
  const allUpcoming = ready.filter((s) => s.date_start && (s.date_end ?? s.date_start) >= today).sort((a, b) => a.date_start!.localeCompare(b.date_start!));
  const upcoming = allUpcoming.filter((s) => inDateFilter(s, dates));
  const food = ready.filter((s) => tpl(s) === "food" && s.kind !== "food");
  const sections: { title: string; emoji: string; items: Spot[]; drill: Partial<Filters> }[] = [
    { title: "Restaurants", emoji: "🍽️", items: food.filter((s) => !venue(s, "cafe", "bakery", "bar", "wine_bar", "pub", "ice_cream") || venue(s, "restaurant", "fine_dining", "street_food")).sort(bySpecial), drill: { category: "food", venues: ["restaurant", "fine_dining", "street_food", "market"] } },
    { title: "Cafés, bakeries & sweets", emoji: "☕", items: food.filter((s) => venue(s, "cafe", "bakery", "ice_cream")).sort(bySpecial), drill: { category: "cafes" } },
    { title: "Bars & drinks", emoji: "🍸", items: food.filter((s) => venue(s, "bar", "wine_bar", "pub") || s.drinks.some((d) => ["cocktails", "natural_wine", "craft_beer"].includes(d))).sort(bySpecial), drill: { category: "drinks" } },
    { title: "Things to do", emoji: "🗺️", items: ready.filter((s) => tpl(s) === "place" && s.category !== "events").sort(bySpecial), drill: { category: "places" } },
    { title: "Shops", emoji: "🛍️", items: ready.filter((s) => s.category === "shopping").sort(bySpecial), drill: { category: "shopping" } },
  ];
  const hoods = countBy(ready, (s) => s.neighborhood).slice(0, 16);

  const Row = ({ items }: { items: Spot[] }) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
      {items.slice(0, 8).map((s) => (
        <SpotCard
          key={s.id}
          spot={s}
          category={catById.get(s.category)}
          showCategory={false}
          selected={selected.has(s.id)}
          selecting={selected.size > 0}
          dragIds={() => (selected.has(s.id) ? [...selected] : [s.id])}
          onOpen={() => onOpen(s.id)}
          onRetry={onRetry ? () => onRetry(s.id) : undefined}
          onToggleSelect={(shift) => onToggleSelect(s.id, shift)}
          showImage={showImages}
          onFavorite={onFavorite ? () => onFavorite(s) : undefined}
          onVisited={onVisited ? () => onVisited(s) : undefined}
        />
      ))}
    </div>
  );
  const Header = ({ emoji, title, count, onAll }: { emoji: string; title: string; count: number; onAll?: () => void }): ReactNode => (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="font-display text-xl font-semibold">{emoji} {title}</h2>
      <span className="text-sm text-muted tabular-nums">{count}</span>
      {onAll && count > 8 && (
        <button onClick={onAll} className="ml-auto flex items-center gap-1 text-sm font-medium text-accent hover:underline">See all <ArrowRight size={14} /></button>
      )}
    </div>
  );

  if (!ready.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-20 text-center text-muted">
        <p className="font-display text-2xl text-ink">Nothing saved in {homeCity} yet</p>
        <p className="max-w-md text-sm">Drop screenshots of {homeCity} restaurants, bars, cafés and events. Anything located in {homeCity} shows up here, grouped and ranked.</p>
      </div>
    );
  }

  return (
    <div className="space-y-9 pb-24">
      {hoods.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {hoods.map(([h, n]) => (
            <button key={h} onClick={() => onDrill({ neighborhood: h })} className="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium hover:border-accent hover:text-accent">
              {h} <span className="text-muted">{n}</span>
            </button>
          ))}
        </div>
      )}

      {allUpcoming.length > 0 && (
        <section>
          <Header emoji="📅" title="Coming up" count={upcoming.length} />
          <DateSelect value={dates} onChange={setDates} className="mb-3" />
          {!upcoming.length && <p className="text-sm text-muted">Nothing on those dates.</p>}
          <div className="flex gap-3 overflow-x-auto pb-2">
            {upcoming.slice(0, 12).map((s) => (
              <button key={s.id} onClick={() => onOpen(s.id)} className="w-60 shrink-0 rounded-2xl border border-line bg-card p-3 text-left hover:border-accent/50">
                <p className="text-xs font-semibold text-accent">{formatDateRange(s)}</p>
                <p className="mt-1 font-display text-[16px] font-semibold leading-snug line-clamp-2">{catById.get(s.category)?.emoji} {s.name}</p>
                {s.neighborhood && <p className="mt-0.5 text-xs text-muted">{s.neighborhood}</p>}
              </button>
            ))}
          </div>
        </section>
      )}

      {sections.filter((sec) => sec.items.length).map((sec) => (
        <section key={sec.title}>
          <Header emoji={sec.emoji} title={sec.title} count={sec.items.length} onAll={() => onDrill(sec.drill)} />
          <Row items={sec.items} />
        </section>
      ))}
    </div>
  );
}
