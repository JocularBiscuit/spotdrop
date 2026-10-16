import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Bookmark, CalendarDays, Compass, Route, Inbox, LayoutDashboard, Layers, Map as MapIcon, MapPin, Plus, RotateCcw, Settings2, Sparkles } from "lucide-react";
import { DRINKS, MEALS, RATING_LABEL, SERVICE, SPECIALNESS, VENUES, type Template } from "../../../shared/vocab.ts";
import { DRAG_MIME, type Category, type Collection, type Spot } from "../api.ts";
import { activeFilterCount, clearRefinements, countBy, inScope, isHome, needsLook, type Filters } from "../filters.ts";
import { Chip, cx, Flames, Section, Select, ToggleGroup, inputCls } from "./ui.tsx";

export type Section = "home" | "munich" | "map" | "plan" | "calendar" | "library" | "discover";

interface Props {
  section: Section;
  setSection: (s: Section) => void;
  homeCity: string;
  spots: Spot[];
  categories: Category[];
  collections: Collection[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  onDropIds: (ids: string[], target: { category?: string; collection?: string }) => void;
  onManage: () => void;
  onCreateCollection: (name: string) => void;
}

function NavItem({ active, icon, label, count, onClick, onDropIds, muted }: {
  active: boolean; icon: ReactNode; label: string; count: number; onClick: () => void; onDropIds?: (ids: string[]) => void; muted?: boolean;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => Boolean(onDropIds) && Array.from(e.dataTransfer.types).includes(DRAG_MIME);
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        try { onDropIds?.(JSON.parse(e.dataTransfer.getData(DRAG_MIME))); } catch { /* not ours */ }
      }}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition",
        active ? "bg-ink font-medium text-paper" : "hover:bg-line/50",
        over && "bg-accent-soft ring-2 ring-accent",
        muted && !active && "text-muted",
      )}
    >
      <span className="flex w-5 justify-center text-base leading-none">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className={cx("text-xs tabular-nums", active ? "text-paper/70" : "text-muted")}>{count || ""}</span>
    </button>
  );
}

export function Sidebar({ section, setSection, homeCity, spots, categories, collections, filters, setFilters, onDropIds, onManage, onCreateCollection }: Props) {
  const [newCollection, setNewCollection] = useState<string | null>(null);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
  const go = (patch: Partial<Filters>) => setFilters(clearRefinements({ ...filters, reviewOnly: false, home: false, saved: false, ...patch }));
  const savedCount = spots.filter((s) => s.favorite).length;
  const homeCount = spots.filter(isHome).length;
  const today = new Date().toISOString().slice(0, 10);
  const upcomingCount = spots.filter((s) => s.date_start && (s.date_end ?? s.date_start) >= today).length;
  const located = spots.filter((s) => s.lat != null).length;

  const byCategory = useMemo(() => new Map(countBy(spots, (s) => s.category)), [spots]);
  const byCollection = useMemo(() => new Map(countBy(spots, (s) => s.collections)), [spots]);
  const reviewCount = spots.filter(needsLook).length;

  const current = categories.find((c) => c.id === filters.category);
  const template: Template | "all" = current?.template ?? "all";
  const scope = useMemo(() => spots.filter((s) => inScope(s, filters)), [spots, filters]);
  const counts = useMemo(
    () => ({
      meals: new Map(countBy(scope, (s) => s.meals)),
      venues: new Map(countBy(scope, (s) => s.venue_types)),
      drinks: new Map(countBy(scope, (s) => s.drinks)),
      service: new Map(countBy(scope, (s) => s.service)),
      cuisines: countBy(scope, (s) => s.cuisines.map((c) => c.toLowerCase())).slice(0, 24),
      tags: countBy(scope, (s) => s.tags.map((c) => c.toLowerCase())).slice(0, 30),
      platforms: countBy(scope, (s) => s.platform),
      countries: countBy(scope, (s) => s.country),
      cities: countBy(filters.country ? scope.filter((s) => s.country === filters.country) : scope, (s) => s.city),
      foodTypes: new Map(countBy(scope, (s) => s.kind)),
      hoods: countBy(scope, (s) => s.neighborhood).slice(0, 24),
    }),
    [scope, filters.country],
  );
  const nActive = activeFilterCount(filters);
  // Food filters also in the "everything" views: food is the main thing people browse.
  const isFood = template === "food" || (template === "all" && (counts.venues.size > 0 || counts.meals.size > 0));
  const showWhere = (template === "all" || template === "food" || template === "place") && counts.countries.length > 0;

  const toggleIn = (key: "cuisines" | "tags" | "platforms", value: string) =>
    set(key, filters[key].includes(value) ? filters[key].filter((x) => x !== value) : [...filters[key], value]);

  return (
    <div className="space-y-6">
      {/* Main sections */}
      <nav className="space-y-0.5">
        <NavItem active={section === "home"} icon={<LayoutDashboard size={16} />} label="Home" count={0} onClick={() => setSection("home")} />
        <NavItem active={section === "munich"} icon={<MapPin size={16} />} label={homeCity} count={homeCount} onClick={() => { go({ category: "all", collection: "" }); setSection("munich"); }} />
        <NavItem active={section === "map"} icon={<MapIcon size={16} />} label="Map" count={located} onClick={() => setSection("map")} />
        <NavItem active={section === "plan"} icon={<Route size={16} />} label="Plan" count={0} onClick={() => setSection("plan")} />
        <NavItem active={section === "calendar"} icon={<CalendarDays size={16} />} label="Calendar" count={upcomingCount} onClick={() => setSection("calendar")} />
        <NavItem active={section === "discover"} icon={<Compass size={16} className={section === "discover" ? "" : "text-accent"} />} label="Discover" count={0} onClick={() => setSection("discover")} />
        <NavItem
          active={section === "library" && filters.category === "all" && !filters.collection && !filters.reviewOnly && !filters.saved}
          icon={<Layers size={16} />}
          label="Library"
          count={spots.length}
          onClick={() => { go({ category: "all", collection: "" }); setSection("library"); }}
        />
        <NavItem
          active={section === "library" && filters.saved}
          icon={<Bookmark size={16} className={filters.saved && section === "library" ? "" : "text-accent"} />}
          label="Saved"
          count={savedCount}
          onClick={() => { go({ category: "all", collection: "", saved: true }); setSection("library"); }}
        />
        {reviewCount > 0 && (
          <NavItem
            active={section === "library" && filters.reviewOnly}
            icon={<Sparkles size={16} className={filters.reviewOnly ? "" : "text-accent"} />}
            label="Needs a look"
            count={reviewCount}
            onClick={() => { go({ category: "all", collection: "", reviewOnly: true }); setSection("library"); }}
          />
        )}
      </nav>

      <div className="space-y-1">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Categories</h3>
          <span className="flex">
            <button onClick={onManage} className="rounded-md p-1 text-muted hover:bg-line/50 hover:text-accent" title="AI organizer: evolve categories">
              <Sparkles size={14} />
            </button>
            <button onClick={onManage} className="rounded-md p-1 text-muted hover:bg-line/50 hover:text-ink" title="Manage categories">
              <Settings2 size={14} />
            </button>
          </span>
        </div>
        <nav className="space-y-0.5">
          {categories.map((c) => (
            <NavItem
              key={c.id}
              active={section === "library" && filters.category === c.id && !filters.collection}
              icon={c.emoji}
              label={c.name}
              count={byCategory.get(c.id) ?? 0}
              muted={!byCategory.get(c.id)}
              onClick={() => { go({ category: c.id, collection: "" }); setSection("library"); }}
              onDropIds={(ids) => onDropIds(ids, { category: c.id })}
            />
          ))}
        </nav>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Collections</h3>
          <button onClick={() => setNewCollection("")} className="rounded-md p-1 text-muted hover:bg-line/50 hover:text-ink" title="New collection">
            <Plus size={14} />
          </button>
        </div>
        <nav className="space-y-0.5">
          {collections.map((c) => (
            <NavItem
              key={c.id}
              active={section === "library" && filters.collection === c.id}
              icon={c.emoji}
              label={c.name}
              count={byCollection.get(c.id) ?? 0}
              onClick={() => { go({ category: "all", collection: c.id }); setSection("library"); }}
              onDropIds={(ids) => onDropIds(ids, { collection: c.id })}
            />
          ))}
          {newCollection !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newCollection.trim()) onCreateCollection(newCollection.trim());
                setNewCollection(null);
              }}
            >
              <input
                autoFocus
                value={newCollection}
                onChange={(e) => setNewCollection(e.target.value)}
                onBlur={() => { if (newCollection.trim()) onCreateCollection(newCollection.trim()); setNewCollection(null); }}
                onKeyDown={(e) => e.key === "Escape" && setNewCollection(null)}
                placeholder="e.g. Japan trip, Gift ideas…"
                className={cx(inputCls, "py-1.5")}
              />
            </form>
          ) : (
            collections.length === 0 && (
              <button onClick={() => setNewCollection("")} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm text-muted hover:bg-line/50">
                <Inbox size={16} className="w-5" /> Group things across categories
              </button>
            )
          )}
        </nav>
      </div>

      {/* Contextual refinements */}
      {(section === "library" || section === "munich") && scope.length > 0 && (
        <div className="space-y-5 border-t border-line pt-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Refine</h2>
            {nActive > 0 && (
              <button onClick={() => setFilters(clearRefinements(filters))} className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                <RotateCcw size={12} /> Reset ({nActive})
              </button>
            )}
          </div>

          {isFood && (counts.foodTypes.get("food") ?? 0) > 0 && (
            <Section title="Type">
              <div className="flex gap-1.5">
                {([["all", "All"], ["place", "📍 Spots"], ["food", "🍜 Food posts"]] as const).map(([k, label]) => (
                  <Chip key={k} active={filters.foodType === k} onClick={() => set("foodType", k)}>{label}</Chip>
                ))}
              </div>
            </Section>
          )}

          {counts.hoods.length > 1 && (filters.home || template === "food" || template === "place") && (
            <Section title="Neighborhood">
              <div className="flex flex-wrap gap-1.5">
                {counts.hoods.map(([h, n]) => (
                  <Chip key={h} active={filters.neighborhood === h} onClick={() => set("neighborhood", filters.neighborhood === h ? "" : h)}>
                    {h} <span className={cx("tabular-nums", filters.neighborhood === h ? "text-white/80" : "text-muted")}>{n}</span>
                  </Chip>
                ))}
              </div>
            </Section>
          )}

          {showWhere && !filters.home && (
            <Section title="Where">
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={filters.country}
                  onChange={(v) => setFilters({ ...filters, country: v, city: "" })}
                  options={[{ value: "", label: "All countries" }, ...counts.countries.map(([c, n]) => ({ value: c, label: `${c} (${n})` }))]}
                />
                <Select
                  value={filters.city}
                  onChange={(v) => set("city", v)}
                  options={[{ value: "", label: "All cities" }, ...counts.cities.map(([c, n]) => ({ value: c, label: `${c} (${n})` }))]}
                  align="right"
                />
              </div>
            </Section>
          )}

          <Section title={template === "all" ? "Rating" : RATING_LABEL[template]}>
            <div className="flex flex-wrap gap-1.5">
              {[0, 2, 3, 4, 5].map((n) => (
                <Chip key={n} active={filters.minSpecial === n} onClick={() => set("minSpecial", n)} title={n ? SPECIALNESS[n as 1].label : undefined}>
                  {n ? <><Flames value={n} size={11} />{n < 5 && "+"}</> : "Any"}
                </Chip>
              ))}
            </div>
          </Section>

          {(isFood || template === "recipe") && (
            <Section title="Meal">
              <ToggleGroup vocab={MEALS} value={filters.meals} onChange={(v) => set("meals", v)} counts={counts.meals} />
            </Section>
          )}
          {isFood && (
            <>
              <Section title="Sit down or to go">
                <ToggleGroup vocab={SERVICE} value={filters.service} onChange={(v) => set("service", v)} counts={counts.service} />
              </Section>
              <Section title="Type of place">
                <ToggleGroup vocab={VENUES} value={filters.venues} onChange={(v) => set("venues", v)} counts={counts.venues} />
              </Section>
              <Section title="Drinks">
                <ToggleGroup vocab={DRINKS} value={filters.drinks} onChange={(v) => set("drinks", v)} counts={counts.drinks} />
              </Section>
            </>
          )}
          {(isFood || template === "recipe") && counts.cuisines.length > 0 && (
            <Section title="Food & cuisine">
              <ChipCloud items={counts.cuisines} selected={filters.cuisines} onToggle={(v) => toggleIn("cuisines", v)} />
            </Section>
          )}
          {template === "account" && counts.platforms.length > 0 && (
            <Section title="Platform">
              <ChipCloud items={counts.platforms} selected={filters.platforms} onToggle={(v) => toggleIn("platforms", v)} />
            </Section>
          )}
          {counts.tags.length > 0 && (
            <Section title={template === "account" ? "Topics" : "Tags"}>
              <ChipCloud items={counts.tags} selected={filters.tags} onToggle={(v) => toggleIn("tags", v)} prefix="#" />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function ChipCloud({ items, selected, onToggle, prefix = "" }: { items: [string, number][]; selected: string[]; onToggle: (v: string) => void; prefix?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([c, n]) => {
        const on = selected.includes(c);
        return (
          <Chip key={c} active={on} onClick={() => onToggle(c)}>
            <span className="capitalize">{prefix}{c}</span>
            <span className={cx("tabular-nums", on ? "text-white/80" : "text-muted")}>{n}</span>
          </Chip>
        );
      })}
    </div>
  );
}
