import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, Check, ChevronDown, ExternalLink, Loader2, MapPin, RefreshCw, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { api, type Category, type DiscoverData, type DiscoverItem, type FindQuery, type Spot } from "../api.ts";
import { PlaceFinder } from "./PlaceFinder.tsx";
import { formatDateRange } from "./CalendarView.tsx";
import { Button, cx, inputCls, TagInput } from "./ui.tsx";
import { DateFilterBar } from "./DateFilterBar.tsx";
import { ANY_DATE, inDateFilter, type DateFilter } from "../../../shared/dates.ts";


type Tab = "feed" | "techno" | "find";

export function DiscoverView({ toast, onSaved, onOpenSettings, aiOn, categories, spots }: { toast: (m: string) => void; onSaved: () => void; onOpenSettings: () => void; aiOn: boolean; categories: Category[]; spots: Spot[] }) {
  const [data, setData] = useState<DiscoverData | null>(null);
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("spotdrop.discoverTab") as Tab) || "feed");
  const [genres, setGenres] = useState<string[]>([]);
  useEffect(() => { try { localStorage.setItem("spotdrop.discoverTab", tab); } catch { /* ignore */ } }, [tab]);
  const [topic, setTopic] = useState("all");
  const [dates, setDates] = useState<DateFilter>(ANY_DATE);
  const [placesOnly, setPlacesOnly] = useState(false);
  const [showTaste, setShowTaste] = useState(false);
  const [prefs, setPrefs] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api.discover();
      setData(d);
      setPrefs((p) => p || d.prefs);
    } catch (e) {
      toast((e as Error).message);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);
  // While scouts are out, poll for results.
  useEffect(() => {
    if (!data?.state.running && !data?.finder.running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.state.running, data?.finder.running, load]);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    return all.filter((i) => {
      if (tab === "techno") return i.topic === "music" && inDateFilter(i, dates) && (!genres.length || genres.some((g) => i.genres?.includes(g)));
      if (i.topic === "music") return false; // lives in the Techno tab
      if (topic !== "all" && i.topic !== topic) return false;
      if (placesOnly) return !i.date_start;
      return inDateFilter(i, dates);
    });
  }, [data, topic, dates, placesOnly, tab, genres]);

  const genreCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of data?.items ?? []) if (i.topic === "music") for (const g of i.genres ?? []) m.set(g, (m.get(g) ?? 0) + 1);
    return m;
  }, [data]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of data?.items ?? []) if (i.topic !== "music") m.set(i.topic, (m.get(i.topic) ?? 0) + 1);
    return m;
  }, [data]);

  const refresh = async (only?: "techno") => {
    try {
      await api.refreshDiscover(only);
      toast("Scouts are out looking… this takes 1–3 minutes");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const search = async (q: FindQuery) => {
    try {
      await api.findPlaces(q);
      toast("Searching the web for new places… about a minute");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const patchItem = (d: DiscoverData, id: string, patch: Partial<DiscoverItem>): DiscoverData => {
    const upd = (list: DiscoverItem[]) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)).filter((x) => x.status !== "hidden");
    return { ...d, items: upd(d.items), found: upd(d.found) };
  };
  const setStatus = async (item: DiscoverItem, status: DiscoverItem["status"]) => {
    setData((d) => d && patchItem(d, item.id, { status }));
    await api.discoverStatus(item.id, status).catch((e) => toast((e as Error).message));
  };
  const save = async (item: DiscoverItem) => {
    try {
      await api.saveDiscover(item.id);
      setData((d) => d && patchItem(d, item.id, { status: "saved" }));
      toast(`Saved “${item.title}” to your library`);
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (!data) return <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>;
  const { state, topics, taste } = data;
  const dated = items.filter((i) => i.date_start);
  const places = items.filter((i) => !i.date_start);
  const tasteChips = [...(taste.categories ?? []), ...(taste.cuisines ?? []).slice(0, 6), ...(taste.areas ?? []).slice(0, 4), ...(taste.types ?? []).slice(0, 6)];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">🔭 Discover</h1>
          <p className="mt-0.5 text-sm text-muted">
            New things in Munich from the web, picked for your taste. Separate from your library: save what you like.
            {state.finished_at && !state.running && <> · Last refresh {new Date(state.finished_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</>}
          </p>
        </div>
        <Button onClick={() => setShowTaste(!showTaste)}>
          Your taste <ChevronDown size={14} className={cx("transition", showTaste && "rotate-180")} />
        </Button>
        {aiOn ? (
          tab !== "find" && (
            <Button variant="primary" onClick={() => refresh(tab === "techno" ? "techno" : undefined)} disabled={state.running}>
              {state.running ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {state.running ? "Looking…" : tab === "techno" ? "Refresh techno" : "Refresh all"}
            </Button>
          )
        ) : (
          <Button variant="primary" onClick={onOpenSettings}>Add API key to use Discover</Button>
        )}
      </div>

      {state.running && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {state.lanes.map((l) => (
            <div key={l.key} className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm">
              {l.state === "running" || l.state === "waiting" ? <Loader2 size={14} className="animate-spin text-accent" /> : l.state === "done" ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-red-500" />}
              <span className="flex-1 truncate">{l.label}</span>
              {l.state === "done" && <span className="text-xs text-muted">+{l.found}</span>}
            </div>
          ))}
        </div>
      )}
      {!state.running && state.lanes.some((l) => l.state === "error") && (
        <p className="text-xs text-red-500">Some scouts failed: {state.lanes.filter((l) => l.state === "error").map((l) => `${l.label} (${l.error})`).join(", ")}</p>
      )}

      {showTaste && (
        <div className="animate-pop space-y-4 rounded-2xl border border-line bg-card p-4">
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">What your library says you like</h3>
            <div className="flex flex-wrap gap-1.5">
              {tasteChips.length ? tasteChips.map((t) => <span key={t} className="rounded-full bg-line/60 px-2.5 py-0.5 text-xs capitalize">{t}</span>) : <span className="text-sm text-muted">Save some spots first.</span>}
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">In your own words</span>
            <textarea
              className={cx(inputCls, "min-h-20")}
              value={prefs}
              onChange={(e) => setPrefs(e.target.value)}
              onBlur={() => prefs !== data.prefs && api.discoverSettings({ prefs }).then(load)}
            />
          </label>
          <div className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Instagram accounts to follow</span>
            <TagInput value={data.accounts} onChange={(accounts) => api.discoverSettings({ accounts }).then(load)} placeholder="e.g. mitvergnuegen_muenchen, munich.food… (Enter to add)" lowercase />
            <p className="text-[11px] text-muted">Instagram can't be read directly; the scouts look for what these accounts announce via web search and linked event pages.</p>
          </div>
          <p className="text-[11px] text-muted">👍 / 👎 on cards also teach the scouts. "Refresh all" (8 scouts) costs about $0.80 with Haiku or ~$6 with Opus; "Refresh techno" (3 scouts) about $0.30 / $2.40. Nothing runs automatically. Real costs: Settings → AI cost.</p>
        </div>
      )}

      <div className="flex w-fit rounded-xl border border-line bg-card p-0.5 text-sm">
        {([["feed", "✨ Feed"], ["techno", "🎧 Techno"], ["find", "🔎 Find places"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-lg px-3 py-1.5 font-medium transition", tab === k ? "bg-ink text-paper" : "text-muted hover:text-ink")}>{label}</button>
        ))}
      </div>

      {tab === "find" ? (
        <PlaceFinder
          categories={categories}
          spots={spots}
          finder={data.finder}
          found={data.found}
          aiOn={aiOn}
          onSearch={search}
          renderCard={(i) => <Card key={i.id} item={i} topics={topics} genreNames={data.genres} onStatus={setStatus} onSave={save} />}
        />
      ) : tab === "techno" ? (
        <TechnoTab
          items={items}
          allCount={data.items.filter((i) => i.topic === "music").length}
          dates={dates}
          setDates={setDates}
          genres={genres}
          setGenres={setGenres}
          genreNames={data.genres}
          genreCounts={genreCounts}
          running={state.running}
          renderCard={(i) => <Card key={i.id} item={i} topics={topics} genreNames={data.genres} onStatus={setStatus} onSave={save} />}
        />
      ) : (<>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <DateFilterBar value={dates} onChange={(f) => { setDates(f); setPlacesOnly(false); }} className="w-full" />
        <button onClick={() => { setPlacesOnly(!placesOnly); setDates(ANY_DATE); }} className={cx("rounded-full border px-3 py-1 text-xs font-medium", placesOnly ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-accent")}>📍 Places only</button>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setTopic("all")} className={cx("rounded-full border px-3 py-1 text-xs font-medium", topic === "all" ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-accent")}>
            Everything <span className="opacity-60">{data.items.filter((i) => i.topic !== "music").length}</span>
          </button>
          {Object.entries(topics).filter(([k]) => counts.get(k)).map(([k, t]) => (
            <button key={k} onClick={() => setTopic(topic === k ? "all" : k)} className={cx("rounded-full border px-3 py-1 text-xs font-medium", topic === k ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-accent")}>
              {t.emoji} {t.label} <span className="opacity-60">{counts.get(k)}</span>
            </button>
          ))}
        </div>
      </div>

      {!data.items.length && !state.running && (
        <div className="rounded-3xl border-2 border-dashed border-line px-6 py-14 text-center">
          <p className="font-display text-2xl">Nothing discovered yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">Click <b>Refresh</b>: the scouts search Munich (rausgegangen.de, local guides, food news, flea markets, vintage & jewellery, Instagram happenings; parties are in the 🎧 Techno tab) for things that match your taste.</p>
        </div>
      )}

      {dated.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold">📅 Coming up</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {dated.map((i) => <Card key={i.id} item={i} topics={topics} genreNames={data.genres} onStatus={setStatus} onSave={save} />)}
          </div>
        </section>
      )}
      {places.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold">📍 Places to check out</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {places.map((i) => <Card key={i.id} item={i} topics={topics} genreNames={data.genres} onStatus={setStatus} onSave={save} />)}
          </div>
        </section>
      )}
      </>)}
    </div>
  );
}

/** 🎧 Techno: club nights, hard sounds and small collectives, filtered by date and sub-genre. */
function TechnoTab({ items, allCount, dates, setDates, genres, setGenres, genreNames, genreCounts, running, renderCard }: {
  items: DiscoverItem[]; allCount: number; dates: DateFilter; setDates: (f: DateFilter) => void;
  genres: string[]; setGenres: (g: string[]) => void; genreNames: Record<string, string>; genreCounts: Map<string, number>;
  running: boolean; renderCard: (i: DiscoverItem) => React.ReactNode;
}) {
  const sorted = [...items].sort((a, b) => (a.date_start ?? "9").localeCompare(b.date_start ?? "9"));
  return (
    <div className="space-y-4">
      <DateFilterBar value={dates} onChange={setDates} />
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setGenres([])} className={cx("rounded-full border px-3 py-1 text-xs font-medium", !genres.length ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-accent")}>All sounds</button>
        {Object.entries(genreNames).map(([k, label]) => {
          const n = genreCounts.get(k) ?? 0;
          const on = genres.includes(k);
          return (
            <button key={k} onClick={() => setGenres(on ? genres.filter((g) => g !== k) : [...genres, k])} className={cx("rounded-full border px-3 py-1 text-xs font-medium transition", on ? "border-accent bg-accent text-white" : "border-line bg-card hover:border-accent", !n && !on && "opacity-40")}>
              {label} {n > 0 && <span className="opacity-60">{n}</span>}
            </button>
          );
        })}
      </div>
      {!allCount && !running && (
        <div className="rounded-3xl border-2 border-dashed border-line px-6 py-14 text-center">
          <p className="font-display text-2xl">No parties yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">Click <b>Refresh techno</b>: three scouts check Resident Advisor, rausgegangen, DICE, Shotgun, club and collective pages for club nights, trance/bounce/hard techno/schranz and small underground parties.</p>
        </div>
      )}
      {allCount > 0 && !sorted.length && <p className="text-sm text-muted">Nothing matches these dates / sounds.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{sorted.map(renderCard)}</div>
    </div>
  );
}

function Card({ item, topics, genreNames, onStatus, onSave }: {
  item: DiscoverItem;
  topics: DiscoverData["topics"];
  genreNames: Record<string, string>;
  onStatus: (i: DiscoverItem, s: DiscoverItem["status"]) => void;
  onSave: (i: DiscoverItem) => void;
}) {
  const t = topics[item.topic];
  const where = [item.venue, item.neighborhood].filter(Boolean).join(" · ") || item.address;
  return (
    <div className={cx("group flex flex-col gap-1.5 overflow-hidden rounded-2xl border bg-card p-3 transition", item.status === "liked" || item.status === "saved" ? "border-accent/50" : "border-line", item.status === "disliked" && "opacity-50")}>
      {item.image && item.image !== "none" && (
        <a href={item.url ?? undefined} target="_blank" rel="noreferrer" className="-mx-3 -mt-3 mb-1 block aspect-[2/1] overflow-hidden bg-line/40">
          <img src={`/media/discover/${item.image}`} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        </a>
      )}
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-base">{t?.emoji ?? "✨"}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{t?.label ?? item.topic}{item.kind === "popup" ? " · pop-up" : ""}</p>
          <h3 className="font-display text-[15px] font-semibold leading-snug line-clamp-2">{item.title}</h3>
        </div>
        <button onClick={() => onStatus(item, "hidden")} className="rounded-full p-1 text-muted opacity-0 transition hover:text-ink group-hover:opacity-100" aria-label="Hide" title="Hide">
          <X size={15} />
        </button>
      </div>
      {item.date_start && <p className="text-[13px] font-medium text-accent">{formatDateRange(item)}</p>}
      {where && <p className="flex items-center gap-1 text-xs text-muted"><MapPin size={12} /> {where}</p>}
      {(item.genres?.length > 0 || item.collective) && (
        <div className="flex flex-wrap items-center gap-1">
          {item.genres?.map((g) => <span key={g} className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium">{genreNames[g] ?? g}</span>)}
          {item.collective && <span className="text-[11px] text-muted">by {item.collective}</span>}
        </div>
      )}
      {item.description && <p className="text-[12.5px] leading-snug text-ink/85 line-clamp-3" title={item.description}>{item.description}</p>}
      {item.why && <p className="text-xs italic leading-snug text-muted line-clamp-2" title={item.why}>✨ {item.why}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {item.price && <span className="rounded-md bg-line/50 px-1.5 py-0.5 text-[11px]">{item.price}</span>}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] text-muted hover:text-accent">
            {item.source ?? "Source"} <ExternalLink size={10} />
          </a>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button onClick={() => onStatus(item, item.status === "liked" ? "new" : "liked")} className={cx("rounded-lg p-1.5 hover:bg-line/50", item.status === "liked" ? "text-accent" : "text-muted")} aria-label="Like" title="More like this">
            <ThumbsUp size={15} className={cx(item.status === "liked" && "fill-current")} />
          </button>
          <button onClick={() => onStatus(item, item.status === "disliked" ? "new" : "disliked")} className={cx("rounded-lg p-1.5 hover:bg-line/50", item.status === "disliked" ? "text-ink" : "text-muted")} aria-label="Dislike" title="Less like this">
            <ThumbsDown size={15} className={cx(item.status === "disliked" && "fill-current")} />
          </button>
          {item.status === "saved" ? (
            <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-600"><Check size={13} /> In library</span>
          ) : (
            <button onClick={() => onSave(item)} className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110">
              <Bookmark size={13} /> Save
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
