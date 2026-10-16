import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, Menu, PanelLeftClose, PanelLeftOpen, CalendarDays, Image as ImageIcon, Images, LayoutGrid, List, RefreshCw, Grid3x3, ImagePlus, Loader2, Map as MapIcon, Search, Settings, SlidersHorizontal, Upload, X } from "lucide-react";
import { api, imageFiles, isProcessing, type Plan, type BulkAction, type Category, type Collection, type Spot, type Status } from "./api.ts";
import { activeFilterCount, applyFilters, clearRefinements, reviewReason, countBy, EMPTY_FILTERS, HOME, setHomeCity, type Filters } from "./filters.ts";
import { CalendarView } from "./components/CalendarView.tsx";
import { HomeView } from "./components/HomeView.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { DiscoverView } from "./components/DiscoverView.tsx";
import { Legend } from "./components/Legend.tsx";
import { QuickFilters } from "./components/QuickFilters.tsx";
import type { Section } from "./components/Sidebar.tsx";
import { collectDroppedFiles } from "./import.ts";
import { BulkBar } from "./components/BulkBar.tsx";
import { ManageDialog } from "./components/ManageDialog.tsx";
import { PhoneSync } from "./components/PhoneSync.tsx";
// The map library is big; load it only when the map is opened.
const PlanView = lazy(() => import("./components/PlanView.tsx").then((m) => ({ default: m.PlanView })));
const MapView = lazy(() => import("./components/MapView.tsx").then((m) => ({ default: m.MapView })));
import { groupScreenshots, ScreenshotGallery } from "./components/ScreenshotGallery.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SpotCard } from "./components/SpotCard.tsx";
import { SpotRow } from "./components/SpotRow.tsx";
import { SpotDrawer } from "./components/SpotDrawer.tsx";
import { Button, cx, Select } from "./components/ui.tsx";

function loadFilters(): Filters {
  try {
    const stored = JSON.parse(localStorage.getItem("spotdrop.filters") ?? "{}");
    const out = { ...EMPTY_FILTERS };
    for (const k of Object.keys(EMPTY_FILTERS) as (keyof Filters)[]) {
      if (k in stored && typeof stored[k] === typeof EMPTY_FILTERS[k]) (out as Record<string, unknown>)[k] = stored[k];
    }
    return out;
  } catch {
    return EMPTY_FILTERS;
  }
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && Boolean(t.closest("input, textarea, select, [contenteditable]"));

export default function App() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [section, setSection] = useState<Section>(() => {
    try {
      const v = localStorage.getItem("spotdrop.section");
      return v === "munich" || v === "map" || v === "plan" || v === "calendar" || v === "library" || v === "discover" ? v : "home";
    } catch {
      return "home";
    }
  });
  const [libView, setLibView] = useState<"items" | "shots" | "map">("items");
  const [showImages, setShowImages] = useState(() => {
    try {
      return localStorage.getItem("spotdrop.images") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("spotdrop.images", showImages ? "1" : "0");
    } catch {
      // storage unavailable; fine
    }
  }, [showImages]);
  /** Category chip on the map ("all" or a category id). */
  const [mapCategory, setMapCategory] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [planSeed, setPlanSeed] = useState<Plan | null>(null);
  /** Snapshot of "Needs a look" while working through it, so items don't jump around. */
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showLegend) return;
    const close = (e: MouseEvent) => !legendRef.current?.contains(e.target as Node) && setShowLegend(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [showLegend]);
  const [layout, setLayout] = useState<"tiles" | "list">(() => {
    try {
      return localStorage.getItem("spotdrop.layout") === "list" ? "list" : "tiles";
    } catch {
      return "tiles";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("spotdrop.layout", layout);
    } catch {
      // fine
    }
  }, [layout]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState<{ done: number; total: number; added: number; skipped: number; failed: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Desktop: the sidebar can be tucked away for more room (remembered).
  const [sidebarHidden, setSidebarHidden] = useState(() => { try { return localStorage.getItem("spotdrop.sidebar") === "hidden"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("spotdrop.sidebar", sidebarHidden ? "hidden" : "shown"); } catch { /* ignore */ } }, [sidebarHidden]);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSpots(await api.spots());
    } catch (e) {
      toast(`Couldn't load: ${(e as Error).message}`);
    } finally {
      setLoaded(true);
    }
  }, [toast]);
  const refreshLibrary = useCallback(async () => {
    try {
      const lib = await api.library();
      setCategories(lib.categories);
      setCollections(lib.collections);
    } catch {
      // server unreachable; refresh() reports it
    }
  }, []);
  const refreshStatus = useCallback(() => api.status().then((st) => { setHomeCity(st.settings.homeCity ?? "Munich"); setStatus(st); }).catch(() => {}), []);

  useEffect(() => {
    refresh();
    refreshLibrary();
    refreshStatus();
  }, [refresh, refreshLibrary, refreshStatus]);

  // Stored view pointing at a deleted category / collection → back to Everything.
  useEffect(() => {
    if (!categories.length) return;
    const badCategory = filters.category !== "all" && !categories.some((c) => c.id === filters.category);
    const badCollection = filters.collection && !collections.some((c) => c.id === filters.collection);
    if (badCategory || badCollection) setFilters((f) => ({ ...f, category: badCategory ? "all" : f.category, collection: badCollection ? "" : f.collection }));
  }, [categories, collections, filters.category, filters.collection]);

  useEffect(() => {
    try {
      localStorage.setItem("spotdrop.filters", JSON.stringify({ ...filters, q: "" }));
      localStorage.setItem("spotdrop.section", section);
    } catch {
      // storage unavailable; fine
    }
  }, [filters, section]);

  // Poll while anything is processing (multi-item screenshots can also add new items).
  const processing = spots.filter(isProcessing).length;
  const failed = spots.filter((s) => !isProcessing(s) && (s.status === "error" || s.ai_pending));
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [processing, refresh]);

  // Bulk import: send in small batches so hundreds of images (whole folders) upload smoothly with progress.
  const importQueue = useRef<File[]>([]);
  const importRunning = useRef(false);
  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length) return toast("No images found in what you dropped");
      importQueue.current.push(...files);
      setImporting((p) => ({ done: p?.done ?? 0, total: (p?.total ?? 0) + files.length, added: p?.added ?? 0, skipped: p?.skipped ?? 0, failed: p?.failed ?? 0 }));
      if (importRunning.current) return;
      importRunning.current = true;
      const totals = { added: 0, skipped: 0, failed: 0 };
      const BATCH = 10;
      try {
        while (importQueue.current.length) {
          const batch = importQueue.current.splice(0, BATCH);
          try {
            const res = await api.upload(batch, filters.collection || null);
            totals.added += res.spots.length;
            totals.skipped += res.skipped?.length ?? 0;
            totals.failed += res.failed.length;
          } catch {
            totals.failed += batch.length;
          }
          setImporting((p) => p && { ...p, done: p.done + batch.length, ...totals });
          refresh();
        }
        const parts = [`Added ${totals.added} image${totals.added === 1 ? "" : "s"}`];
        if (totals.skipped) parts.push(`${totals.skipped} already in your library`);
        if (totals.failed) parts.push(`${totals.failed} failed`);
        toast(parts.join(" · "));
      } finally {
        importRunning.current = false;
        setImporting(null);
      }
    },
    [refresh, toast, filters.collection],
  );

  // Global drag & drop of files + paste.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      // Folders are walked recursively; anything that isn't an image is ignored.
      collectDroppedFiles(e.dataTransfer).then((files) => upload(imageFiles(files)));
    };
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      let files = imageFiles(e.clipboardData?.files);
      // Some browsers only expose a pasted picture as an item, not in .files.
      if (!files.length) files = imageFiles([...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => Boolean(f)));
      if (files.length) e.preventDefault();
      if (files.length) upload(files.map((f, i) => (f.name === "image.png" ? new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }) : f)));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [upload]);

  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  // status in deps: the home city comes from settings.
  // Each section has its own scope: Munich = home city, Map/Calendar = everything (+ search), Library = browse filters.
  const effective = useMemo<Filters>(() => {
    if (section === "munich") return { ...filters, home: true };
    if (section === "map") return { ...EMPTY_FILTERS, q: filters.q, category: mapCategory === "saved" ? "all" : mapCategory, saved: mapCategory === "saved" };
    if (section === "calendar" || section === "home") return { ...EMPTY_FILTERS, q: filters.q };
    return { ...filters, home: false };
  }, [section, filters, mapCategory]);
  const visible = useMemo(() => applyFilters(spots, effective, categoryNames), [spots, effective, categoryNames, status]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const currentCategory = categoryById.get(filters.category);
  const currentCollection = collections.find((c) => c.id === filters.collection);
  const open = spots.find((s) => s.id === openId) ?? null;
  const nFilters = activeFilterCount(effective);
  const aiOn = Boolean(status?.settings.hasKey);
  const counts = useMemo(() => new Map([...countBy(spots, (s) => s.category), ...countBy(spots, (s) => s.collections)]), [spots]);

  // Drop ids from the selection that no longer exist.
  useEffect(() => {
    setSelected((sel) => {
      const ids = new Set(spots.map((s) => s.id));
      const next = new Set([...sel].filter((id) => ids.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [spots]);

  const toggleSelect = (id: string, shift: boolean) => {
    // Read the anchor now: the state updater below runs later, after lastClicked has moved on.
    const anchor = lastClicked.current;
    lastClicked.current = id;
    setSelected((sel) => {
      const next = new Set(sel);
      if (shift && anchor) {
        const a = visible.findIndex((s) => s.id === anchor);
        const b = visible.findIndex((s) => s.id === id);
        if (a >= 0 && b >= 0) {
          for (const s of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(s.id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Keyboard: ⌘A selects everything visible, Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || openId || showManage || showSettings) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && (section === "library" || section === "munich") && libView === "items") {
        e.preventDefault();
        setSelected(new Set(visible.map((s) => s.id)));
      } else if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, openId, showManage, showSettings, section, libView]);

  // Opening an item counts as "seen" for the Rediscover shelf.
  useEffect(() => {
    if (openId) api.viewed(openId).catch(() => {});
  }, [openId]);

  // Opening something from "Needs a look" starts a review run over the current list.
  useEffect(() => {
    if (!openId) return setReviewQueue(null);
    if (section === "library" && filters.reviewOnly && !reviewQueue) setReviewQueue(visible.map((s) => s.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const nameById = useMemo(() => new Map(spots.map((s) => [s.id, s.name])), [spots]);

  const reviewAction = async (action: "good" | "skip" | "prev" | "delete" | "instructed") => {
    const current = spots.find((s) => s.id === openId);
    if (!current || !reviewQueue) return;
    const idx = reviewQueue.indexOf(current.id);
    if (action === "prev") {
      if (idx > 0) setOpenId(reviewQueue[idx - 1]);
      return;
    }
    let queue = reviewQueue;
    if (action === "instructed") {
      // The AI is redoing this one with the user's instruction: take it out of the run and move on.
      queue = reviewQueue.filter((id) => id !== current.id);
      setReviewQueue(queue);
    } else if (action === "good" || action === "delete") {
      try {
        if (action === "good") {
          if (current.duplicate_of) await api.notDuplicate(current.id);
          await api.bulk([current.id], "reviewed");
        } else {
          await api.remove(current.id);
        }
      } catch (e) {
        return toast((e as Error).message);
      }
      queue = reviewQueue.filter((id) => id !== current.id);
      setReviewQueue(queue);
      refresh();
    }
    const next = queue[action === "skip" ? idx + 1 : idx];
    if (action === "instructed" && !next) return setOpenId(null);
    if (next) setOpenId(next);
    else {
      setOpenId(null);
      toast(action === "skip" ? "That was the last one" : "All done, nothing left to look at 🎉");
    }
  };

  const bulk = async (ids: string[], action: BulkAction, value?: string) => {
    try {
      const res = await api.bulk(ids, action, value);
      const target = action === "category" ? categoryById.get(value!)?.name : collections.find((c) => c.id === value)?.name;
      const n = res.count;
      const what = `${n} item${n === 1 ? "" : "s"}`;
      toast(
        action === "category" ? `Moved ${what} to ${target}` :
        action === "add_collection" ? `Added ${what} to ${target}` :
        action === "remove_collection" ? `Removed ${what} from ${target}` :
        action === "delete" ? `Deleted ${what}` :
        action === "analyze" ? `Re-analyzing ${what}…` : `Marked ${what} as reviewed`,
      );
      if (action === "delete") setSelected(new Set());
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const createCollection = async (name: string): Promise<string | null> => {
    try {
      const c = await api.createCollection({ name });
      await refreshLibrary();
      toast(`Created collection “${c.name}”`);
      return c.id;
    } catch (e) {
      toast((e as Error).message);
      return null;
    }
  };

  const toggleFavorite = (s: Spot) => {
    setSpots((all) => all.map((x) => (x.id === s.id ? { ...x, favorite: !s.favorite } : x)));
    api.update(s.id, { favorite: !s.favorite }).catch((e) => toast((e as Error).message));
  };

  const toggleVisited = (s: Spot) => {
    setSpots((all) => all.map((x) => (x.id === s.id ? { ...x, visited: !s.visited } : x)));
    api.update(s.id, { visited: !s.visited }).catch((e) => toast((e as Error).message));
  };

  const onChanged = (s?: Spot) => {
    if (s) setSpots((all) => all.map((x) => (x.id === s.id ? s : x)));
    refresh();
  };

  const homeCity = status?.settings.homeCity || HOME.city;
  const title = section === "munich"
    ? { emoji: "📍", name: homeCity, desc: `Your saved food, drinks and things to do in ${homeCity}${filters.neighborhood ? ` · ${filters.neighborhood}` : ""}` }
    : section === "calendar"
    ? { emoji: "📅", name: "Calendar", desc: "Everything you saved that happens on a date." }
    : filters.saved
    ? { emoji: "🔖", name: "Saved", desc: "Everything you bookmarked." }
    : filters.reviewOnly
    ? { emoji: "✨", name: "Needs a look", desc: "Errors and items the AI wasn't sure about. Fix them or click “Looks good”." }
    : currentCollection
      ? { emoji: currentCollection.emoji, name: currentCollection.name, desc: "Collection · screenshots you drop here are added to it" }
      : currentCategory
        ? { emoji: currentCategory.emoji, name: currentCategory.name, desc: currentCategory.description }
        : { emoji: "", name: "Library", desc: "Everything you've saved. Pick a category on the left to narrow it down." };
  const goLibrary = (patch: Partial<Filters>) => {
    setFilters(clearRefinements({ ...filters, reviewOnly: false, saved: false, category: "all", collection: "", ...patch }));
    setLibView("items");
    setSection("library");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="sticky top-0 z-[1000] border-b border-line bg-paper/85 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-2 md:px-5">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-card lg:hidden"
            aria-label={showFilters ? "Close menu" : "Open menu"}
          >
            {showFilters ? <X size={18} /> : <Menu size={18} />}
          </button>
          <button
            onClick={() => setSidebarHidden(!sidebarHidden)}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-line/50 hover:text-ink lg:flex"
            title={sidebarHidden ? "Show sidebar" : "Hide sidebar for more room"}
            aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
          >
            {sidebarHidden ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button onClick={() => { setSection("home"); setOpenId(null); setShowFilters(false); setFilters({ ...filters, q: "" }); }} className="flex shrink-0 items-center gap-2" aria-label="Go to Home">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="hidden font-display text-xl font-bold tracking-tight sm:block">Spotdrop</span>
          </button>

          <div className="relative mx-auto min-w-0 flex-1 max-w-xl">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={filters.q}
              onChange={(e) => {
                setFilters({ ...filters, q: e.target.value });
                if (section === "home" && e.target.value) setSection("library");
              }}
              placeholder="Search everything: names, text in screenshots, tags, notes…"
              className="w-full rounded-full border border-line bg-card py-2 pl-10 pr-9 text-sm outline-none transition focus:border-accent focus:shadow-[0_0_0_4px] focus:shadow-accent/10"
            />
            {filters.q && (
              <button onClick={() => setFilters({ ...filters, q: "" })} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink" aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="primary" onClick={() => fileRef.current?.click()} title="Choose from Finder · or paste a screenshot anywhere with ⌘V">
              <Upload size={16} /> <span className="hidden md:inline">Add screenshots</span>
            </Button>
            <PhoneSync toast={toast} />
            <Button variant="ghost" onClick={() => setShowSettings(true)} aria-label="Settings" className="relative">
              <Settings size={18} />
              {status && !aiOn && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />}
            </Button>
            <input ref={fileRef} type="file" multiple accept="image/*,.heic,.heif" hidden onChange={(e) => { upload(imageFiles(e.target.files)); e.target.value = ""; }} />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className={cx(
          "scrollbar-thin w-64 shrink-0 overflow-y-auto border-r border-line px-3 py-4",
          showFilters ? "fixed inset-0 top-[53px] z-[900] block w-full bg-paper lg:static lg:w-64" : sidebarHidden ? "hidden" : "hidden lg:block",
        )}>
          <Sidebar
            section={section}
            setSection={(sec) => { setSection(sec); setSelected(new Set()); setShowFilters(false); if (sec === "library") setLibView("items"); }}
            homeCity={homeCity}
            spots={spots}
            categories={categories}
            collections={collections}
            filters={section === "munich" ? { ...filters, home: true } : { ...filters, home: false }}
            setFilters={(f) => { setFilters({ ...f, home: false }); setSelected(new Set()); }}
            onDropIds={(ids, target) => (target.category ? bulk(ids, "category", target.category) : bulk(ids, "add_collection", target.collection))}
            onManage={() => setShowManage(true)}
            onCreateCollection={createCollection}
          />
          {showFilters && <Button variant="primary" className="mt-6 w-full lg:hidden" onClick={() => setShowFilters(false)}>Show {visible.length} results</Button>}
        </aside>

        {/* Main */}
        <main className="scrollbar-thin flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3 md:px-5">
          {/* Background work, shown everywhere */}
          {(importing || processing > 0 || (section !== "home" && failed.length > 0) || (status && !aiOn && section !== "home")) && (
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
              {importing && (
                <span className="flex items-center gap-2 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-ink">
                  <Loader2 size={12} className="animate-spin text-accent" />
                  Importing {importing.done}/{importing.total}
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${(importing.done / Math.max(1, importing.total)) * 100}%` }} />
                  </span>
                  {importing.skipped > 0 && <span className="text-muted">{importing.skipped} duplicates skipped</span>}
                </span>
              )}
              {!importing && processing > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-ink">
                  <Loader2 size={12} className="animate-spin text-accent" /> Sorting {processing}…
                </span>
              )}
              {section !== "home" && failed.length > 0 && (
                <button
                  onClick={() => (aiOn ? bulk(failed.map((s) => s.id), "analyze") : setShowSettings(true))}
                  className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-ink hover:ring-1 hover:ring-accent"
                >
                  <RefreshCw size={12} /> {aiOn ? `Finish ${failed.length} with AI` : `${failed.length} sorted locally only`}
                </button>
              )}
              {status && !aiOn && section !== "home" && (
                <button onClick={() => setShowSettings(true)} className="rounded-full border border-line px-2.5 py-1 hover:border-accent">
                  Local-only mode · add API key for automatic sorting
                </button>
              )}
            </div>
          )}

          {/* Section header */}
          {(section === "munich" || section === "library" || section === "calendar") && loaded && spots.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1" title={title.desc || undefined}>
                <h1 className="flex min-w-0 items-baseline gap-x-2 truncate font-display text-xl font-semibold tracking-tight md:text-2xl">
                  {title.emoji && <span>{title.emoji}</span>} {title.name}
                  {section !== "calendar" && (
                    <span className="font-sans text-base font-normal text-muted tabular-nums">
                      {libView === "shots" ? `${groupScreenshots(visible).length} screenshots` : visible.length}
                    </span>
                  )}
                </h1>
              </div>
              {section !== "calendar" && (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Button className="lg:hidden" onClick={() => setShowFilters(true)}>
                    <SlidersHorizontal size={15} /> Browse {nFilters > 0 && <span className="rounded-full bg-accent px-1.5 text-xs text-white">{nFilters}</span>}
                  </Button>
                  <div ref={legendRef} className="relative">
                    <button
                      onClick={() => setShowLegend(!showLegend)}
                      className={cx("flex h-8 w-8 items-center justify-center rounded-xl text-sm font-semibold transition", showLegend ? "bg-ink text-paper" : "text-muted hover:bg-line/50 hover:text-ink")}
                      title="What do the symbols mean?"
                      aria-label="Legend"
                    >
                      ?
                    </button>
                    {showLegend && <Legend categories={categories.filter((c) => spots.some((s) => s.category === c.id))} onClose={() => setShowLegend(false)} />}
                  </div>
                  {(section === "library" || section === "munich") && (
                    <div className="flex rounded-xl border border-line bg-card p-0.5 text-sm">
                      {([["items", Grid3x3, "Items"], ["shots", Images, "Screenshots"], ["map", MapIcon, "Map"]] as const).map(([v, Icon, label]) => (
                        <button key={v} onClick={() => setLibView(v)} title={label} aria-label={label} className={cx("flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium transition", libView === v ? "bg-ink text-paper" : "text-muted hover:text-ink")}>
                          <Icon size={15} /> <span className="hidden 2xl:inline">{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {libView === "items" && (
                    <div className="flex rounded-xl border border-line bg-card p-0.5 text-sm">
                      {([["tiles", LayoutGrid, "Tiles"], ["list", List, "List"]] as const).map(([v, Icon, label]) => (
                        <button key={v} onClick={() => setLayout(v)} title={`${label} view`} aria-label={`${label} view`} className={cx("flex items-center rounded-lg px-2 py-1 transition", layout === v ? "bg-ink text-paper" : "text-muted hover:text-ink")}>
                          <Icon size={15} />
                        </button>
                      ))}
                      <button
                        onClick={() => setShowImages(!showImages)}
                        className={cx("flex items-center rounded-lg px-2 py-1 transition", showImages ? "bg-ink text-paper" : "text-muted hover:text-ink")}
                        title={showImages ? "Hide pictures" : "Show pictures"}
                        aria-label={showImages ? "Hide pictures" : "Show pictures"}
                      >
                        <ImageIcon size={15} />
                      </button>
                    </div>
                  )}
                  <Select
                    value={filters.sort}
                    onChange={(v) => setFilters({ ...filters, sort: v as Filters["sort"] })}
                    options={[{ value: "new", label: filters.q ? "Best match" : "Newest" }, { value: "special", label: "Top rated" }, { value: "name", label: "A–Z" }]}
                    icon={<ArrowDownUp size={14} className="text-muted" />}
                    align="right"
                    className="w-32"
                    buttonClassName="py-1 font-medium"
                    ariaLabel="Sort"
                  />
                </div>
              )}
            </div>
          )}

          {loaded && spots.length > 0 && (section === "library" || section === "munich") && !filters.reviewOnly && (
            <QuickFilters spots={spots} categories={categories} filters={effective} setFilters={(f) => setFilters({ ...f, home: false })} />
          )}

          {!loaded ? (
            <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>
          ) : spots.length === 0 ? (
            <EmptyState onPick={() => fileRef.current?.click()} />
          ) : section === "plan" ? (
            <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>}>
              <div className="mb-3">
                <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">🗺️ Plan</h1>
                <p className="text-sm text-muted">Describe an outing; get a route through your saves and Discover finds. Reorder, remove, or add nearby ideas.</p>
              </div>
              <PlanView spots={spots} categories={categories} aiOn={aiOn} seed={planSeed} onOpenSpot={setOpenId} toast={toast} />
            </Suspense>
          ) : section === "discover" ? (
            <DiscoverView toast={toast} onSaved={refresh} onOpenSettings={() => setShowSettings(true)} aiOn={aiOn} categories={categories} spots={spots} />
          ) : section === "home" ? (
            <Dashboard
              spots={spots}
              categories={categories}
              collections={collections}
              homeCity={homeCity}
              aiOn={aiOn}
              pendingAi={failed.length}
              onOpen={setOpenId}
              onBrowseCategory={(id) => goLibrary({ category: id })}
              onBrowseCollection={(id) => goLibrary({ collection: id })}
              onShowReview={() => goLibrary({ reviewOnly: true })}
              onFinishAi={() => bulk(failed.map((s) => s.id), "analyze")}
              onGo={(sec) => { if (sec === "library") goLibrary({}); else setSection(sec); }}
              onOpenSettings={() => setShowSettings(true)}
              onShowSaved={() => goLibrary({ saved: true })}
              onPlanRoute={(title, summary, ids) => {
                setPlanSeed({ title, summary, mode: "foot", stops: ids.map((x) => ({ ref: `spot:${x.id}`, time: null, reason: x.reason })) });
                setSection("plan");
              }}
            />
          ) : section === "calendar" ? (
            <CalendarView spots={visible} categories={categories} onOpen={setOpenId} />
          ) : section === "map" ? (
            <div className="flex min-h-[420px] flex-1 flex-col gap-3 pb-2">
              <div className="flex flex-wrap gap-1.5">
                {[{ id: "all", emoji: "✨", name: "Everything" }, ...(spots.some((s) => s.favorite && s.lat != null) ? [{ id: "saved", emoji: "🔖", name: "Saved" }] : []), ...categories.filter((c) => spots.some((s) => s.category === c.id && s.lat != null))].map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setMapCategory(c.id)}
                    className={cx("rounded-full border px-3 py-1 text-xs font-medium transition", mapCategory === c.id ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-accent")}
                  >
                    {c.emoji} {c.name}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1">
                <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>}>
                  <MapView spots={visible} categories={categories} homeCenter={HOME.center} homeLabel={homeCity} fitToResults={Boolean(filters.q)} onOpen={setOpenId} />
                </Suspense>
              </div>
            </div>
          ) : (section === "library" || section === "munich") && libView === "map" ? (
            <div className="h-[calc(100vh-15rem)] min-h-[420px] pb-2">
              <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>}>
                {/* Exactly the current selection, framed to fit. */}
                <MapView key={`${section}-${filters.category}`} spots={visible} categories={categories} homeCenter={HOME.center} homeLabel={homeCity} fitToResults={Boolean(filters.q)} onOpen={setOpenId} />
              </Suspense>
            </div>
          ) : section === "munich" && libView === "items" && !filters.q && nFilters === 0 && filters.category === "all" ? (
            <HomeView
              homeCity={homeCity}
              spots={visible}
              categories={categories}
              selected={selected}
              onOpen={setOpenId}
              onToggleSelect={toggleSelect}
              onRetry={aiOn ? (id) => bulk([id], "analyze") : undefined}
              onDrill={(patch) => setFilters({ ...clearRefinements({ ...filters, category: "all", collection: "" }), ...patch })}
              showImages={showImages}
              onFavorite={toggleFavorite}
              onVisited={toggleVisited}
            />
          ) : libView === "shots" && (section === "library" || section === "munich") ? (
            <ScreenshotGallery shots={groupScreenshots(visible)} categories={categories} onOpenItem={setOpenId} />
          ) : visible.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
              <p>{filters.q ? `Nothing matches “${filters.q}”.` : filters.collection ? "This collection is empty. Drag cards onto it in the sidebar, or drop screenshots here." : "Nothing here yet."}</p>
              {nFilters > 0 && <Button onClick={() => setFilters(clearRefinements(filters))}>Clear filters</Button>}
            </div>
          ) : (
            layout === "list" ? (
            <div className="mb-24 overflow-hidden rounded-2xl border border-line bg-paper">
              {visible.map((s) => (
                <SpotRow
                  key={s.id}
                  spot={s}
                  category={categoryById.get(s.category)}
                  showCategory={filters.category === "all"}
                  selected={selected.has(s.id)}
                  selecting={selected.size > 0}
                  dragIds={() => (selected.has(s.id) ? [...selected] : [s.id])}
                  onOpen={() => setOpenId(s.id)}
                  onToggleSelect={(shift) => toggleSelect(s.id, shift)}
                  showImage={showImages}
                  note={filters.reviewOnly && section === "library" ? reviewReason(s, nameById) : undefined}
                  onFavorite={() => toggleFavorite(s)}
                  onVisited={() => toggleVisited(s)}
                />
              ))}
            </div>
            ) : (
            <div className="grid grid-cols-1 gap-3 pb-24 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] md:gap-4">
              {visible.map((s) => (
                <SpotCard
                  key={s.id}
                  spot={s}
                  category={categoryById.get(s.category)}
                  showCategory={filters.category === "all"}
                  selected={selected.has(s.id)}
                  selecting={selected.size > 0}
                  dragIds={() => (selected.has(s.id) ? [...selected] : [s.id])}
                  onOpen={() => setOpenId(s.id)}
                  onRetry={aiOn ? () => bulk([s.id], "analyze") : undefined}
                  onToggleSelect={(shift) => toggleSelect(s.id, shift)}
                  showImage={showImages}
                  note={filters.reviewOnly && section === "library" ? reviewReason(s, nameById) : undefined}
                  onFavorite={() => toggleFavorite(s)}
                  onVisited={() => toggleVisited(s)}
                />
              ))}
            </div>
            )
          )}
        </main>
      </div>

      {selected.size > 0 && !open && (
        <BulkBar
          count={selected.size}
          categories={categories}
          collections={collections}
          aiOn={aiOn}
          onAction={(action, value) => bulk([...selected], action, value)}
          onSelectAll={() => setSelected(new Set(visible.map((s) => s.id)))}
          onClear={() => setSelected(new Set())}
          onNewCollection={async () => {
            const name = window.prompt("Name of the new collection");
            return name?.trim() ? createCollection(name.trim()) : null;
          }}
        />
      )}

      {open && (
        <SpotDrawer
          key={open.id}
          spot={open}
          all={spots}
          categories={categories}
          collections={collections}
          aiOn={aiOn}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onDeleted={() => { setOpenId(null); refresh(); }}
          onOpen={setOpenId}
          toast={toast}
          review={reviewQueue && reviewQueue.includes(open.id) ? {
            index: reviewQueue.indexOf(open.id),
            total: reviewQueue.length,
            reason: reviewReason(open, nameById),
            onAction: reviewAction,
          } : undefined}
        />
      )}

      {showSettings && status && <SettingsDialog status={status} onClose={() => setShowSettings(false)} onSaved={refreshStatus} />}
      {showManage && (
        <ManageDialog
          aiOn={aiOn}
          autoOrganize={status?.settings.autoOrganize ?? true}
          onSettingsChanged={refreshStatus}
          categories={categories}
          collections={collections}
          counts={counts}
          onClose={() => setShowManage(false)}
          onChanged={() => { refreshLibrary(); refresh(); }}
          toast={toast}
        />
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[4000] flex items-center justify-center bg-paper/70 p-6 backdrop-blur-md">
          <div className="animate-pop flex h-full max-h-[520px] w-full max-w-3xl flex-col items-center justify-center gap-4 rounded-[2rem] border-[3px] border-dashed border-accent bg-card/80">
            <div className="rounded-3xl bg-accent p-5 text-white shadow-xl shadow-accent/30"><ImagePlus size={40} /></div>
            <p className="font-display text-3xl font-semibold">Drop it like it's hot</p>
            <p className="text-center text-muted">
              Each screenshot is read, sorted into a category and summarized
              {currentCollection && <><br />and added to <b className="text-ink">{currentCollection.emoji} {currentCollection.name}</b></>}
            </p>
          </div>
        </div>
      )}

      <div className="fixed bottom-20 left-1/2 z-[5000] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="animate-pop rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper shadow-xl">{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center py-10">
      <button
        onClick={onPick}
        className="group flex w-full max-w-2xl flex-col items-center gap-5 rounded-[2rem] border-2 border-dashed border-line bg-card/50 px-8 py-16 text-center transition hover:border-accent hover:bg-card"
      >
        <div className="flex -space-x-3 text-4xl">
          {["🍜", "🗺️", "👤", "💻", "💡"].map((e, i) => (
            <span key={e} className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-paper shadow-sm transition group-hover:-translate-y-1" style={{ transitionDelay: `${i * 40}ms`, rotate: `${(i - 2) * 6}deg` }}>{e}</span>
          ))}
        </div>
        <div>
          <h2 className="font-display text-3xl font-semibold">Rescue your screenshots from the camera roll</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">
            Drag them in from Apple Photos or Finder, or paste with ⌘V. Food spots, places, accounts, tech, ideas: each one is read on your Mac, sorted and summarized so you can find it again.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/30"><Upload size={16} /> Choose screenshots</span>
      </button>
    </div>
  );
}
