import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { api, type Category, type Collection, type Spot } from "../api.ts";
import { countBy, needsLook } from "../filters.ts";
import { recommendations } from "../recommend.ts";
import { formatDateRange } from "./CalendarView.tsx";
import { cx, Flames } from "./ui.tsx";

interface Props {
  spots: Spot[];
  categories: Category[];
  collections: Collection[];
  homeCity: string;
  aiOn: boolean;
  pendingAi: number;
  onOpen: (id: string) => void;
  onBrowseCategory: (id: string) => void;
  onBrowseCollection: (id: string) => void;
  onShowReview: () => void;
  onFinishAi: () => void;
  onGo: (section: "munich" | "calendar" | "library" | "map") => void;
  onOpenSettings: () => void;
  onShowSaved: () => void;
  onPlanRoute: (title: string, summary: string, picks: { id: string; reason: string }[]) => void;
}

const EXAMPLES = ["Date night in Glockenbach", "Rainy Sunday ideas", "Cheap lunch in Maxvorstadt", "Best cocktails", "Something sweet nearby", "What's on this weekend?"];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 11 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Compact recommendation card. */
function Pick({ s, category, reason, onOpen }: { s: Spot; category?: Category; reason?: string; onOpen: () => void }) {
  const sub = [s.neighborhood ?? s.city, s.venue_types[0]?.replace("_", " "), s.cuisines[0], s.activity_type].filter(Boolean).slice(0, 2).join(" · ");
  return (
    <button onClick={onOpen} className="group flex w-full items-start gap-3 rounded-2xl border border-line bg-card p-3 text-left transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: `${category?.color ?? "#78716c"}1f` }}>
        {category?.emoji ?? "📦"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[16px] font-semibold leading-snug line-clamp-2 group-hover:text-accent">{s.name}</span>
        {sub && <span className="block truncate text-xs capitalize text-muted">{sub}</span>}
        {s.date_start && <span className="block truncate text-xs font-medium text-accent">{formatDateRange(s)}</span>}
        {reason && <span className="mt-1 block text-xs leading-snug text-ink/75">{reason}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {!!s.specialness && <span className="text-accent"><Flames value={s.specialness} size={11} /></span>}
        {s.visited && <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-600"><Check size={10} /> been</span>}
      </span>
    </button>
  );
}

function Shelf({ title, emoji, children, action }: { title: string; emoji: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-xl font-semibold">{emoji} {title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4";

export function Dashboard(p: Props) {
  const catById = useMemo(() => new Map(p.categories.map((c) => [c.id, c])), [p.categories]);
  const rec = useMemo(() => recommendations(p.spots, p.categories), [p.spots, p.categories]);
  const byCategory = useMemo(() => new Map(countBy(p.spots, (s) => s.category)), [p.spots]);
  const byCollection = useMemo(() => new Map(countBy(p.spots, (s) => s.collections)), [p.spots]);
  const review = p.spots.filter(needsLook).length;

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; answer: string; picks: { id: string; reason: string }[] } | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const ask = async (q: string) => {
    if (!q.trim()) return;
    setQuestion(q);
    setAsking(true);
    setAskError(null);
    try {
      setAnswer({ q, ...(await api.ask(q)) });
    } catch (e) {
      setAskError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const spotById = useMemo(() => new Map(p.spots.map((s) => [s.id, s])), [p.spots]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 pb-24">
      {/* Hero: ask your library */}
      <section className="rounded-3xl border border-line bg-gradient-to-br from-accent-soft via-card to-card p-6 md:p-8">
        <p className="text-sm font-medium text-muted">{greeting()} 👋</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">What are you in the mood for?</h1>
        <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
          <div className="relative flex-1">
            <Sparkles size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-accent" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={p.aiOn ? `Ask your library… e.g. “date night in ${p.homeCity}”` : "Add an API key in Settings to ask your library"}
              disabled={!p.aiOn}
              className="w-full rounded-2xl border border-line bg-card py-3.5 pl-11 pr-4 text-[15px] outline-none transition focus:border-accent focus:shadow-[0_0_0_4px] focus:shadow-accent/10 disabled:opacity-60"
            />
          </div>
          <button disabled={!p.aiOn || asking || !question.trim()} className="flex items-center gap-2 rounded-2xl bg-accent px-5 font-medium text-white shadow-lg shadow-accent/25 transition hover:brightness-110 disabled:opacity-50">
            {asking ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} <span className="hidden sm:inline">Ask</span>
          </button>
        </form>
        {!p.aiOn ? (
          <button onClick={p.onOpenSettings} className="mt-3 text-sm font-medium text-accent hover:underline">Open Settings →</button>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => ask(ex)} className="rounded-full border border-line bg-card/80 px-3 py-1 text-xs font-medium text-ink/80 hover:border-accent hover:text-accent">
                {ex}
              </button>
            ))}
          </div>
        )}

        {(answer || askError || asking) && (
          <div className="mt-6 space-y-3">
            {asking && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Looking through your saves…</p>}
            {askError && <p className="text-sm text-red-600">{askError}</p>}
            {answer && !asking && (
              <>
                <div className="flex flex-wrap items-start gap-3">
                  <p className="flex-1 text-[15px]"><span className="text-muted">“{answer.q}” — </span>{answer.answer}</p>
                  {answer.picks.filter((pk) => spotById.get(pk.id)?.lat != null).length >= 2 && (
                    <button
                      onClick={() => p.onPlanRoute(answer.q, answer.answer, answer.picks.filter((pk) => spotById.get(pk.id)?.lat != null))}
                      className="shrink-0 rounded-xl bg-ink px-3 py-1.5 text-sm font-semibold text-paper hover:opacity-90"
                    >
                      🗺️ Turn into a route
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {answer.picks.map((pk) => {
                    const s = spotById.get(pk.id);
                    return s ? <Pick key={pk.id} s={s} category={catById.get(s.category)} reason={pk.reason} onOpen={() => p.onOpen(s.id)} /> : null;
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* To-dos, only when there is something to do */}
      {(review > 0 || p.pendingAi > 0) && (
        <div className="flex flex-wrap gap-2">
          {review > 0 && (
            <button onClick={p.onShowReview} className="flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-sm hover:border-accent">
              <Sparkles size={15} className="text-accent" /> <b className="font-semibold">{review}</b> need a quick look
            </button>
          )}
          {p.pendingAi > 0 && p.aiOn && (
            <button onClick={p.onFinishAi} className="flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-sm hover:border-accent">
              <RefreshCw size={15} className="text-accent" /> Finish <b className="font-semibold">{p.pendingAi}</b> with AI
            </button>
          )}
        </div>
      )}

      {p.spots.some((s) => s.favorite) && (
        <Shelf title="Saved" emoji="🔖" action={<SeeAll onClick={() => p.onShowSaved()} label="All saved" />}>
          <div className={grid}>
            {p.spots.filter((s) => s.favorite).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8).map((s) => (
              <Pick key={s.id} s={s} category={catById.get(s.category)} onOpen={() => p.onOpen(s.id)} />
            ))}
          </div>
        </Shelf>
      )}

      {rec.rightNow.length > 0 && (
        <Shelf title={rec.moment.title} emoji={rec.moment.emoji} action={<SeeAll onClick={() => p.onGo("munich")} label={`All of ${p.homeCity}`} />}>
          <div className={grid}>{rec.rightNow.map((s) => <Pick key={s.id} s={s} category={catById.get(s.category)} onOpen={() => p.onOpen(s.id)} />)}</div>
        </Shelf>
      )}

      {(rec.thisWeek.length > 0 || rec.later.length > 0) && (
        <Shelf title={rec.thisWeek.length ? "This week" : "Coming up"} emoji="📅" action={<SeeAll onClick={() => p.onGo("calendar")} label="Calendar" />}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {(rec.thisWeek.length ? rec.thisWeek : rec.later).map((s) => (
              <button key={s.id} onClick={() => p.onOpen(s.id)} className="w-64 shrink-0 rounded-2xl border border-line bg-card p-3.5 text-left hover:border-accent/50">
                <p className="text-xs font-semibold text-accent">{formatDateRange(s)}</p>
                <p className="mt-1 font-display text-[16px] font-semibold leading-snug line-clamp-2">{catById.get(s.category)?.emoji} {s.name}</p>
                {(s.neighborhood || s.city) && <p className="mt-0.5 text-xs text-muted">{s.neighborhood ?? s.city}</p>}
              </button>
            ))}
          </div>
        </Shelf>
      )}

      {rec.mustGo.length > 0 && (
        <Shelf title="Must-gos you haven't tried" emoji="🔥">
          <div className={grid}>{rec.mustGo.map((s) => <Pick key={s.id} s={s} category={catById.get(s.category)} onOpen={() => p.onOpen(s.id)} />)}</div>
        </Shelf>
      )}

      {rec.rediscover.length > 0 && (
        <Shelf title="Rediscover" emoji="💎">
          <p className="-mt-2 mb-3 text-sm text-muted">Good saves you haven't looked at in a while.</p>
          <div className={grid}>{rec.rediscover.map((s) => <Pick key={s.id} s={s} category={catById.get(s.category)} onOpen={() => p.onOpen(s.id)} />)}</div>
        </Shelf>
      )}

      <Shelf title="Recently added" emoji="🆕" action={<SeeAll onClick={() => p.onGo("library")} label="Library" />}>
        <div className={grid}>{rec.recent.map((s) => <Pick key={s.id} s={s} category={catById.get(s.category)} onOpen={() => p.onOpen(s.id)} />)}</div>
      </Shelf>

      {/* Browse */}
      <Shelf title="Browse" emoji="🗂️">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {p.categories.filter((c) => byCategory.get(c.id)).map((c) => (
            <button key={c.id} onClick={() => p.onBrowseCategory(c.id)} className="group flex items-center gap-3 rounded-2xl border border-line bg-card p-3 text-left hover:border-accent/40">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: `${c.color}1f` }}>{c.emoji}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold group-hover:text-accent">{c.name}</span>
                <span className="text-xs text-muted">{byCategory.get(c.id)} saved</span>
              </span>
            </button>
          ))}
          {p.collections.map((c) => (
            <button key={c.id} onClick={() => p.onBrowseCollection(c.id)} className="group flex items-center gap-3 rounded-2xl border border-dashed border-line bg-card/60 p-3 text-left hover:border-accent/40">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-line/50 text-xl">{c.emoji}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold group-hover:text-accent">{c.name}</span>
                <span className="text-xs text-muted">Collection · {byCollection.get(c.id) ?? 0}</span>
              </span>
            </button>
          ))}
        </div>
      </Shelf>
    </div>
  );
}

function SeeAll({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cx("flex items-center gap-1 text-sm font-medium text-accent hover:underline")}>
      {label} <ArrowRight size={14} />
    </button>
  );
}
