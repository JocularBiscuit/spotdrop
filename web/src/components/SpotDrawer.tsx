import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, CalendarDays, CalendarPlus, Check, Sparkles, ChevronDown, Copy, ExternalLink, Globe, ImagePlus, AtSign, Loader2, Map, ScanSearch, Search, Trash2, X,
} from "lucide-react";
import { DRINKS, MEALS, PLATFORMS, PRICE, RATING_LABEL, SERVICE, VENUES } from "../../../shared/vocab.ts";
import { formatDateRange } from "./CalendarView.tsx";
import { weekLines } from "../../../shared/hours.ts";
import { api, imageFiles, imageUrl, isProcessing, thumbUrl, type Category, type Collection, type Spot } from "../api.ts";
import { Button, Chip, cx, inputCls, OpenNow, SaveButton, Select, Switch, Section, SpecialnessPicker, TagInput, ToggleGroup } from "./ui.tsx";

interface Props {
  spot: Spot;
  all: Spot[];
  categories: Category[];
  collections: Collection[];
  aiOn: boolean;
  onClose: () => void;
  onChanged: (s?: Spot) => void;
  onDeleted: () => void;
  onOpen: (id: string) => void;
  toast: (msg: string) => void;
  /** Set while working through "Needs a look": fixed buttons, next item opens automatically. */
  review?: {
    index: number;
    total: number;
    reason: string;
    onAction: (action: "good" | "skip" | "prev" | "delete" | "instructed") => void;
  };
}

/** Text input that saves on blur / Enter. */
function Field({ label, value, onSave, placeholder, multiline, icon, mono, big }: {
  label?: string; value: string | null; onSave: (v: string | null) => void; placeholder?: string; multiline?: boolean; icon?: ReactNode; mono?: boolean; big?: boolean;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const commit = () => {
    const next = v.trim() || null;
    if (next !== (value ?? null)) onSave(next);
  };
  const cls = cx(inputCls, !!icon && "pl-9", big && "border-transparent bg-transparent px-1 font-display text-2xl font-semibold hover:border-line focus:bg-card");
  return (
    <label className="block space-y-1">
      {label && <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>}
      <span className="relative block">
        {icon && <span className="pointer-events-none absolute left-3 top-2.5 text-muted">{icon}</span>}
        {multiline ? (
          <textarea className={cx(cls, "min-h-20 resize-y", mono && "font-mono text-[13px]")} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />
        ) : (
          <input className={cls} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        )}
      </span>
    </label>
  );
}

const PROFILE_URLS: Record<string, (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
  threads: (h) => `https://www.threads.net/@${h}`,
  github: (h) => `https://github.com/${h}`,
  reddit: (h) => `https://www.reddit.com/user/${h}`,
  pinterest: (h) => `https://www.pinterest.com/${h}`,
  linkedin: (h) => `https://www.linkedin.com/in/${h}`,
};
const profileUrl = (platform: string | null, handle: string) => (platform && PROFILE_URLS[platform] ? PROFILE_URLS[platform](encodeURIComponent(handle)) : null);

function LinkButton({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-1.5 text-sm font-medium hover:border-accent" href={href} target="_blank" rel="noreferrer">
      {icon} {children} <ExternalLink size={12} />
    </a>
  );
}

/** Editable bullet list (key points, ingredients). */
function ListEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    if (draft.trim()) onChange([...value, draft.trim()]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      {value.map((item, i) => (
        <div key={`${i}-${item}`} className="group flex items-start gap-2 rounded-xl bg-card px-3 py-2 text-sm">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span className="flex-1">{item}</span>
          <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-ink" aria-label="Remove">
            <X size={14} />
          </button>
        </div>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        onBlur={add}
        placeholder={placeholder}
        className={inputCls}
      />
    </div>
  );
}

export function SpotDrawer({ spot, all, categories, collections, aiOn, onClose, onChanged, onDeleted, onOpen, toast, review }: Props) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showInstruct, setShowInstruct] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [withImage, setWithImage] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = isProcessing(spot);
  const img = spot.images[Math.min(active, spot.images.length - 1)];
  const dup = spot.duplicate_of ? all.find((s) => s.id === spot.duplicate_of) : null;
  // Other items extracted from the same screenshot(s), e.g. the rest of a "top 5" list.
  const files = new Set(spot.images.map((i) => i.file));
  const siblings = all.filter((o) => o.id !== spot.id && o.images.some((i) => files.has(i.file)));

  useEffect(() => {
    setActive(0);
    setConfirmDelete(false);
  }, [spot.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return lightbox ? setLightbox(false) : onClose();
      // Review shortcuts (not while typing in a field).
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select");
      if (!review || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") { e.preventDefault(); review.onAction("good"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); review.onAction("skip"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); review.onAction("prev"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, onClose, review]);

  const patch = async (fields: Partial<Spot>) => {
    try {
      onChanged(await api.update(spot.id, fields));
    } catch (e) {
      toast(`Couldn't save: ${(e as Error).message}`);
    }
  };
  const run = async (fn: () => Promise<Spot | unknown>, msg?: string) => {
    try {
      const res = await fn();
      onChanged(res && typeof res === "object" && "id" in res ? (res as Spot) : undefined);
      if (msg) toast(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const addImages = (files: File[]) => files.length && run(() => api.addImages(spot.id, files), `Added ${files.length} screenshot${files.length > 1 ? "s" : ""}`);

  const category = categories.find((c) => c.id === spot.category);
  const template = category?.template ?? "generic";
  const isFoodVenue = template === "food" && spot.kind !== "food";
  const located = template === "place" || isFoodVenue;
  const showFoodFields = template === "food" || template === "recipe";
  // The one-line "what is it, where, how much" summary and the main links, shown right under the name.
  const venueLabel = spot.venue_types.map((v) => VENUES[v as keyof typeof VENUES]?.label).filter(Boolean)[0];
  const summary = [
    template === "food" ? (spot.kind === "food" ? "Food post" : venueLabel) : spot.activity_type,
    ...(showFoodFields ? spot.cuisines.slice(0, 2) : []),
    [spot.neighborhood, spot.city].filter(Boolean).join(", ") || null,
    located && spot.price != null ? PRICE[spot.price] : null,
  ].filter(Boolean).join(" · ");
  const mapsLink = located && spot.kind !== "food"
    ? spot.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([spot.name, spot.address, spot.city].filter(Boolean).join(", "))}`
    : null;
  const webLink = spot.website ? (/^https?:/.test(spot.website) ? spot.website : `https://${spot.website}`) : null;
  const profileLink = template === "account" && spot.handle && !spot.website ? profileUrl(spot.platform, spot.handle) : null;
  const ocr = spot.images.map((i) => i.ocr_text).filter(Boolean).join("\n—\n");

  return (
    <>
      <div className="fixed inset-0 z-[1500] bg-black/20 backdrop-blur-[1px] lg:hidden" onClick={onClose} />
      <aside
        className="animate-slide-in fixed inset-y-0 right-0 z-[1600] flex w-full max-w-[560px] flex-col border-l border-line bg-paper shadow-2xl"
        onDragOver={(e) => { if (!Array.from(e.dataTransfer.types).includes("Files")) return; e.preventDefault(); e.stopPropagation(); setDropping(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
        onDrop={(e) => { if (!Array.from(e.dataTransfer.types).includes("Files")) return; e.preventDefault(); e.stopPropagation(); setDropping(false); addImages(imageFiles(e.dataTransfer.files)); }}
      >
        {dropping && (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-semibold text-accent">
            Drop to add screenshots to “{spot.name || "this item"}”
          </div>
        )}

        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Select
            value={spot.category}
            onChange={(v) => patch({ category: v })}
            options={categories.map((c) => ({ value: c.id, label: <span>{c.emoji} {c.name}</span> }))}
            ariaLabel="Category"
            className="w-52"
            buttonClassName="py-1.5 font-medium"
          />
          {template === "food" && (
            <div className="flex gap-1">
              <Chip active={spot.kind !== "food"} onClick={() => patch({ kind: "place" })} title="A specific restaurant, café, bar…">📍 Spot</Chip>
              <Chip active={spot.kind === "food"} onClick={() => patch({ kind: "food" })} title="A dish or food idea without a specific place">🍜 Food post</Chip>
            </div>
          )}
          <SaveButton on={spot.favorite} onToggle={() => patch({ favorite: !spot.favorite })} size={20} className="ml-auto" />
          <Button variant="ghost" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>

        {review && (
          <div className="flex items-start gap-2 border-b border-accent/30 bg-accent-soft px-4 py-2.5 text-sm">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" />
            <span className="flex-1"><b className="font-semibold">Needs a look · {review.index + 1} of {review.total}.</b> {review.reason}</span>
          </div>
        )}

        {busy && review && (
          <div className="flex items-center gap-2 border-b border-line bg-card px-4 py-3 text-sm">
            <Loader2 size={15} className="animate-spin text-accent" />
            <span className="flex-1">{spot.status_detail ?? "Working on it…"}</span>
            <span className="text-xs text-muted">stays here until it's done</span>
          </div>
        )}

        {/* Tell the AI what to do with this screenshot */}
        {aiOn && (review || showInstruct || spot.needs_review) && !busy && (
          <form
            className="space-y-2 border-b border-line bg-card px-4 py-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const text = instruction.trim();
              if (!text) return;
              try {
                onChanged(await api.analyze(spot.id, { instruction: text, useImage: withImage, research: true }));
                setInstruction("");
                setShowInstruct(false);
                toast("Redoing it with your instruction… check the result, then click Looks good");
              } catch (err) {
                toast((err as Error).message);
              }
            }}
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Sparkles size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent" />
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Tell the AI what this is or what to do…"
                  className={cx(inputCls, "pl-9")}
                />
              </div>
              <Button variant="primary" disabled={!instruction.trim()}>Redo</Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              {["Multiple spots / info in this image: add each one separately", "This is a song, put it in Misc", "Wrong place, it's in Schwabing", "Not food, it's a shop"].map((ex) => (
                <button key={ex} type="button" onClick={() => setInstruction(ex)} className="rounded-full border border-line px-2 py-0.5 hover:border-accent hover:text-ink">{ex}</button>
              ))}
              <Switch size="sm" checked={withImage} onChange={setWithImage} label="include screenshot" className="ml-auto" />
            </div>
          </form>
        )}

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {/* Images */}
          <div className="relative bg-black/90">
            {img ? (
              <button className="block w-full" onClick={() => setLightbox(true)} aria-label="View full screenshot">
                <img src={thumbUrl(img)} alt="" className="mx-auto max-h-[46vh] w-auto object-contain" />
              </button>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-white/60">No screenshot</div>
            )}
            {busy && (
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-4 py-2 text-xs text-white backdrop-blur">
                <Loader2 size={14} className="animate-spin" /> {spot.status_detail ?? "Working…"}
              </div>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2">
            {spot.images.map((im, i) => (
              <div key={im.id} className="group relative shrink-0">
                <button onClick={() => setActive(i)} className={cx("h-14 w-11 overflow-hidden rounded-lg border-2", i === active ? "border-accent" : "border-transparent opacity-70 hover:opacity-100")}>
                  <img src={thumbUrl(im)} alt="" className="h-full w-full object-cover" />
                </button>
                {spot.images.length > 1 && (
                  <>
                    <button
                      onClick={() => run(() => api.removeImage(spot.id, im.id))}
                      className="absolute -right-1 -top-1 hidden rounded-full bg-ink p-0.5 text-paper group-hover:block"
                      aria-label="Remove screenshot"
                      title="Remove this screenshot"
                    >
                      <X size={10} />
                    </button>
                    {new Set(spot.images.map((x) => x.file)).size > 1 && (
                      <button
                        onClick={() => run(async () => { const r = await api.splitImage(spot.id, im.id); return r.original; }, "Split off — both are being re-sorted")}
                        className="absolute inset-x-0 -bottom-1 hidden rounded-md bg-accent px-0.5 text-[9px] font-semibold leading-4 text-white group-hover:block"
                        title="This screenshot is something else: make it its own item"
                      >
                        Split off
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()} className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-line text-muted hover:border-accent hover:text-accent" title="Add screenshots">
              <ImagePlus size={16} />
            </button>
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { addImages(imageFiles(e.target.files)); e.target.value = ""; }} />
          </div>

          <div className="space-y-6 p-5">
            {spot.status === "error" && (
              <div className="flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
                <AlertTriangle size={18} className="shrink-0 text-red-500" />
                <span className="flex-1 break-words">{spot.status_detail}</span>
                {aiOn && <Button className="shrink-0" onClick={() => run(() => api.analyze(spot.id, { research: true }), "Trying again…")}>Try again</Button>}
              </div>
            )}
            {spot.status === "ready" && spot.status_detail && (
              <div className="flex items-center gap-3 rounded-2xl bg-accent-soft px-3 py-2 text-sm">
                <span className="flex-1 break-words">{spot.status_detail}</span>
                {spot.ai_pending && aiOn && <Button className="shrink-0" onClick={() => run(() => api.analyze(spot.id, { research: true }), "Finishing with AI…")}>Finish with AI</Button>}
              </div>
            )}

            {dup && (
              <div className="rounded-2xl border border-gold/40 bg-gold/10 p-3">
                <div className="flex items-center gap-3">
                  <Copy size={18} className="shrink-0 text-gold" />
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onOpen(dup.id)}>
                    {dup.images[0] && <img src={thumbUrl(dup.images[0])} alt="" className="h-10 w-10 rounded-lg object-cover" />}
                    <span className="min-w-0 text-sm">
                      Looks like the same as <b className="font-semibold">{dup.name}</b>
                      <span className="block truncate text-xs text-muted">{[dup.city, dup.country].filter(Boolean).join(", ")}</span>
                    </span>
                  </button>
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <Button onClick={() => run(() => api.notDuplicate(spot.id), "Kept both")}>Keep both</Button>
                  <Button variant="primary" onClick={() => run(async () => { const merged = await api.merge(spot.id, dup.id); onOpen(merged.id); return merged; }, "Merged")}>
                    Merge into it
                  </Button>
                </div>
              </div>
            )}

            {siblings.length > 0 && (
              <div className="rounded-2xl border border-line bg-card p-3">
                <p className="mb-2 text-xs font-medium text-muted">Also in this screenshot ({siblings.length + 1} places total):</p>
                <div className="flex flex-wrap gap-1.5">
                  {siblings.map((sib) => (
                    <button key={sib.id} onClick={() => onOpen(sib.id)} className="rounded-full border border-line px-2.5 py-1 text-xs font-medium hover:border-accent hover:text-accent">
                      {categories.find((c) => c.id === sib.category)?.emoji} {sib.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Name + the most important facts and links first */}
            <div className="space-y-2">
              <Field
                value={spot.name}
                onSave={(v) => patch({ name: v ?? "" })}
                placeholder={template === "food" ? (spot.kind === "food" ? "Dish name" : "Name") : template === "account" ? "Account / person name" : "Title"}
                big
              />
              {summary && <p className="px-1 text-sm capitalize text-muted">{summary}</p>}
              {spot.official_description && (
                <blockquote className="mx-1 border-l-2 border-accent pl-3 text-[15px] leading-snug text-ink/90">
                  {spot.official_description}
                  {spot.official_source && <span className="ml-1.5 whitespace-nowrap text-xs text-muted">· {spot.official_source}</span>}
                </blockquote>
              )}
              {located && !!spot.opening_hours?.length && (
                <details className="px-1 text-sm">
                  <summary className="cursor-pointer list-none"><OpenNow hours={spot.opening_hours} className="text-sm" /> <span className="text-xs text-muted">· all hours</span></summary>
                  <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-ink/80">
                    {weekLines(spot.opening_hours).flatMap((l) => [<span key={`d${l.days}`} className="text-muted">{l.days}</span>, <span key={`h${l.days}`}>{l.hours}</span>])}
                  </div>
                </details>
              )}
              {spot.date_start && (
                <p className="flex items-center gap-1.5 px-1 text-sm font-medium text-accent"><CalendarDays size={14} /> {formatDateRange(spot)}</p>
              )}
              {template === "account" && (
                <div className="grid grid-cols-[1fr_1.3fr] gap-2">
                  <Select
                    value={spot.platform ?? ""}
                    onChange={(v) => patch({ platform: v || null })}
                    placeholder="Platform…"
                    options={PLATFORMS.map((p) => ({ value: p, label: <span className="capitalize">{p}</span> }))}
                    ariaLabel="Platform"
                  />
                  <Field value={spot.handle} onSave={(v) => patch({ handle: v?.replace(/^@/, "") ?? null })} placeholder="handle" icon={<AtSign size={15} />} />
                </div>
              )}
              {(mapsLink || webLink || spot.instagram || profileLink || spot.date_start) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {mapsLink && (
                    <a href={mapsLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-accent/30 hover:brightness-110">
                      <Map size={15} /> Google Maps <ExternalLink size={12} />
                    </a>
                  )}
                  {webLink && <LinkButton href={webLink} icon={<Globe size={14} />}>{template === "account" ? "Profile" : "Website"}</LinkButton>}
                  {profileLink && <LinkButton href={profileLink} icon={<AtSign size={14} />}>@{spot.handle}</LinkButton>}
                  {spot.instagram && <LinkButton href={`https://instagram.com/${spot.instagram}`} icon={<AtSign size={14} />}>@{spot.instagram}</LinkButton>}
                  {spot.date_start && <LinkButton href={`/api/calendar.ics?id=${spot.id}`} icon={<CalendarPlus size={14} />}>Add to calendar</LinkButton>}
                </div>
              )}
            </div>

            <Section title={RATING_LABEL[template]}>
              <SpecialnessPicker value={spot.specialness} onChange={(n) => patch({ specialness: n })} />
              {spot.specialness_reason && <p className="text-xs text-muted">{spot.specialness_reason}</p>}
            </Section>

            <Field label={template === "food" || template === "place" ? (spot.official_description ? "From your screenshot" : "About") : "Summary"} value={spot.description} onSave={(v) => patch({ description: v })} placeholder="What is it and why save it?" multiline />

            {showFoodFields && (
              <>
                <Section title="Meal">
                  <ToggleGroup vocab={MEALS} value={spot.meals} onChange={(v) => patch({ meals: v })} />
                </Section>
                {isFoodVenue && (
                  <Section title="Sit down or to go">
                    <ToggleGroup vocab={SERVICE} value={spot.service} onChange={(v) => patch({ service: v })} />
                  </Section>
                )}
                <Section title="Food & cuisine">
                  <TagInput value={spot.cuisines} onChange={(v) => patch({ cuisines: v })} placeholder="e.g. japanese, vegan, seafood" />
                </Section>
                <Section title={template === "food" && spot.kind !== "food" ? "Signature dishes" : "Dishes"}>
                  <TagInput value={spot.dishes} onChange={(v) => patch({ dishes: v })} placeholder="e.g. tonkotsu ramen, pastel de nata" lowercase={false} />
                </Section>
                {template === "food" && (
                  <Section title="Drinks">
                    <ToggleGroup vocab={DRINKS} value={spot.drinks} onChange={(v) => patch({ drinks: v })} />
                  </Section>
                )}
                {isFoodVenue && (
                  <Section title="Type of place">
                    <ToggleGroup vocab={VENUES} value={spot.venue_types} onChange={(v) => patch({ venue_types: v })} />
                  </Section>
                )}
              </>
            )}
            {template !== "food" && (
              <Field
                label="Type"
                value={spot.activity_type}
                onSave={(v) => patch({ activity_type: v?.toLowerCase() ?? null })}
                placeholder={template === "place" ? "museum, hike, viewpoint, market…" : template === "account" ? "food creator, fitness, travel…" : "e.g. clothing, skincare, ai, quote…"}
              />
            )}

            {located && (
              <Section title="Price">
                <div className="flex gap-1.5">
                  {PRICE.map((p, i) => (
                    <Chip key={p} active={spot.price === i} onClick={() => patch({ price: spot.price === i ? null : i })}>{p}</Chip>
                  ))}
                </div>
              </Section>
            )}

            <Field label="My notes" value={spot.notes} onSave={(v) => patch({ notes: v })} placeholder="Who recommended it, what to try, why it matters…" multiline />

            {(!located || spot.key_points.length > 0) && (
              <Section title={template === "recipe" ? "Ingredients" : "Key points"}>
                <ListEditor value={spot.key_points} onChange={(v) => patch({ key_points: v })} placeholder={template === "recipe" ? "Add ingredient…" : "Add a point…"} />
              </Section>
            )}

            {(!located || spot.content) && (
              <Field
                label={template === "recipe" ? "Steps" : "Saved text"}
                value={spot.content}
                onSave={(v) => patch({ content: v })}
                placeholder={template === "recipe" ? "Steps…" : "Quote, code, prompt or anything worth keeping verbatim"}
                multiline
                mono={template === "generic"}
              />
            )}

            <Section title={template === "account" ? "Topics" : "Tags"}>
              <TagInput value={spot.tags} onChange={(v) => patch({ tags: v })} placeholder="date night, python, gift idea…" />
            </Section>

            <Section title="Collections">
              {collections.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {collections.map((c) => {
                    const on = spot.collections.includes(c.id);
                    return (
                      <Chip key={c.id} active={on} onClick={() => patch({ collections: on ? spot.collections.filter((x) => x !== c.id) : [...spot.collections, c.id] })}>
                        {c.emoji} {c.name}
                      </Chip>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted">Create collections in the sidebar (e.g. “Japan trip”) to group things across categories.</p>
              )}
            </Section>

            {/* Less important, rarely edited: tucked away */}
            <details className="group rounded-2xl border border-line bg-card/50" open={showDetails} onToggle={(e) => setShowDetails((e.target as HTMLDetailsElement).open)}>
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
                <ChevronDown size={15} className="text-muted transition group-open:rotate-180" />
                Details
                <span className="truncate text-xs font-normal text-muted">{[located ? "address" : null, "date", "links", spot.source_handle ? "source" : null].filter(Boolean).join(" · ")}</span>
              </summary>
              <div className="space-y-5 border-t border-line px-4 py-4">
                {(located || template === "food") && (
                  <Section title="Location">
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Field value={spot.city} onSave={(v) => patch({ city: v })} placeholder={located ? "City" : "City (optional)"} />
                        <Field value={spot.country} onSave={(v) => patch({ country: v })} placeholder={located ? "Country" : "Origin / country"} />
                      </div>
                      {located && <Field value={spot.address} onSave={(v) => patch({ address: v })} placeholder="Address" icon={<Map size={15} />} />}
                      {located && <Field value={spot.neighborhood} onSave={(v) => patch({ neighborhood: v })} placeholder="Neighborhood (e.g. Schwabing)" />}
                    </div>
                  </Section>
                )}

                {spot.date_start || showDate ? (
                  <Section
                    title="Date"
                    action={spot.date_start ? (
                      <button onClick={() => { patch({ date_start: null, date_end: null, event_time: null }); setShowDate(false); }} className="text-xs font-medium text-muted hover:text-red-500">Remove date</button>
                    ) : undefined}
                  >
                    <div className="grid grid-cols-[1fr_1fr_0.8fr] gap-2">
                      <label className="block">
                        <span className="text-[10px] text-muted">From</span>
                        <input type="date" className={inputCls} value={spot.date_start ?? ""} onChange={(e) => patch({ date_start: e.target.value || null, ...(e.target.value ? {} : { date_end: null }) })} />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-muted">Until (optional)</span>
                        <input type="date" className={inputCls} value={spot.date_end ?? ""} min={spot.date_start ?? undefined} disabled={!spot.date_start} onChange={(e) => patch({ date_end: e.target.value || null })} />
                      </label>
                      <div>
                        <span className="text-[10px] text-muted">Time</span>
                        <Field value={spot.event_time} onSave={(v) => patch({ event_time: v })} placeholder="19:00" />
                      </div>
                    </div>
                  </Section>
                ) : (
                  <Switch checked={false} onChange={() => setShowDate(true)} label={<span className="text-sm">Has a date (event, pop-up, opening…)</span>} />
                )}

                <Section title="Links">
                  <div className="space-y-2">
                    <Field value={spot.website} onSave={(v) => patch({ website: v })} placeholder={template === "account" ? "Profile link" : "Website"} icon={<Globe size={15} />} />
                    {(template === "food" || template === "place" || spot.instagram) && (
                      <Field value={spot.instagram} onSave={(v) => patch({ instagram: v?.replace(/^@/, "") ?? null })} placeholder="Instagram handle" icon={<AtSign size={15} />} />
                    )}
                    {located && <Field value={spot.maps_url} onSave={(v) => patch({ maps_url: v })} placeholder="Google Maps link (optional)" icon={<Map size={15} />} />}
                    {located && <Field label="Official description" value={spot.official_description} onSave={(v) => patch({ official_description: v, ...(v ? {} : { official_source: null }) })} placeholder="One line from Google Maps or the venue's website" multiline />}
                  </div>
                </Section>

                {(spot.source_platform || spot.source_handle) && (
                  <p className="text-xs text-muted">Saved from {spot.source_platform ?? "?"}{spot.source_handle && <> · by @{spot.source_handle}</>}</p>
                )}
              </div>
            </details>

            {ocr && (
              <div>
                <button onClick={() => setShowOcr(!showOcr)} className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink">
                  <ChevronDown size={14} className={cx("transition", showOcr && "rotate-180")} /> Text found in screenshot
                </button>
                {showOcr && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 font-sans text-xs text-muted">{ocr}</pre>}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-card/60 px-4 py-3 backdrop-blur">
          {(template === "food" || template === "place") && (
            <Button
              onClick={() => patch({ visited: !spot.visited })}
              className={spot.visited ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : ""}
              title="Mark whether you've been here — recommendations favor places you haven't tried"
            >
              <Check size={15} /> {spot.visited ? "Been there" : "Not been yet"}
            </Button>
          )}
          {spot.needs_review && !busy && !review ? (
            <Button variant="primary" onClick={() => patch({ needs_review: false })}><Check size={15} /> Looks good</Button>
          ) : null}
          {!review && !spot.needs_review && aiOn && (
            <Button disabled={busy} onClick={() => setShowInstruct(!showInstruct)} title="Tell the AI what this is or what to change">
              <Sparkles size={15} /> Fix with AI…
            </Button>
          )}
          <Button disabled={busy || !aiOn} title={aiOn ? "Search the web again using the current name & city" : "Add an API key in Settings"} onClick={() => run(() => api.analyze(spot.id, { research: true }), "Researching…")}>
            <Search size={15} /> Research
          </Button>
          <Button disabled={busy || !aiOn || !spot.images.length} title="Send the screenshot itself to Claude (for photos without text)" onClick={() => run(() => api.analyze(spot.id, { useImage: true, research: true }), "Analyzing image…")}>
            <ScanSearch size={15} /> Analyze image
          </Button>
          <div className="ml-auto">
            {confirmDelete ? (
              <span className="flex items-center gap-1">
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => run(async () => { await api.remove(spot.id); onDeleted(); }, "Deleted")}>Delete</Button>
              </span>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} aria-label="Delete spot"><Trash2 size={15} /></Button>
            )}
          </div>
        </div>

        {/* Review bar: the same buttons stay in the same place for every item. */}
        {review && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-ink px-4 py-3 text-paper">
            <button onClick={() => review.onAction("prev")} disabled={review.index === 0} className="rounded-lg px-2 py-1.5 text-sm text-paper/70 hover:bg-white/10 disabled:opacity-30" title="Previous (←)">
              ← Back
            </button>
            <span className="hidden text-xs text-paper/60 2xl:inline">Enter = looks good · → = skip · your fixes teach the AI</span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <button onClick={() => review.onAction("delete")} className="flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-red-300 hover:bg-white/10" title="Delete this item">
                <Trash2 size={15} /> Delete
              </button>
              <button onClick={() => review.onAction("skip")} className="whitespace-nowrap rounded-xl border border-white/20 px-4 py-2 text-sm font-medium hover:bg-white/10" title="Skip (→)">
                Skip →
              </button>
              <button onClick={() => review.onAction("good")} className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white shadow-lg hover:brightness-110" title="Looks good (Enter)">
                <Check size={16} /> Looks good
              </button>
            </div>
          </div>
        )}
      </aside>

      {lightbox && img && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/90 p-6" onClick={() => setLightbox(false)}>
          <img src={imageUrl(img)} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
          <button className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Close"><X /></button>
        </div>
      )}
    </>
  );
}
