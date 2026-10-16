import { AlertTriangle, AtSign, CalendarDays, Check, Copy, Image as ImageIcon, Loader2, MapPin, RefreshCw, Sparkles } from "lucide-react";
import { DRINKS, MEALS, PRICE, SERVICE, VENUES } from "../../../shared/vocab.ts";
import { DRAG_MIME, focusPosition, isProcessing, thumbUrl, type Category, type Spot } from "../api.ts";
import { cx, Flames, OpenNow, SaveButton } from "./ui.tsx";
import { formatDateRange } from "./CalendarView.tsx";

const emoji = (vocab: Record<string, { emoji: string; label: string }>, keys: string[]) =>
  keys.filter((k) => vocab[k]).map((k) => ({ key: k, ...vocab[k] }));

interface Props {
  spot: Spot;
  category: Category | undefined;
  showCategory: boolean;
  selected: boolean;
  selecting: boolean;
  /** Ids to drag along when this card is dragged (the whole selection if it's part of it). */
  dragIds: () => string[];
  onOpen: () => void;
  onRetry?: () => void;
  onToggleSelect: (shift: boolean) => void;
  /** Show the screenshot as a thumbnail on top of the card. */
  showImage?: boolean;
  /** Extra line, e.g. why it needs a look. */
  note?: string;
  onFavorite?: () => void;
}

/** Text-first card: screenshots are often not representative, so the card shows what the item *is*. */
export function SpotCard({ spot, category, showCategory, selected, selecting, dragIds, onOpen, onRetry, onToggleSelect, showImage, note, onFavorite }: Props) {
  const busy = isProcessing(spot);
  const template = category?.template ?? "generic";
  const located = template === "food" || template === "place";
  const color = category?.color ?? "#78716c";
  const place = [spot.neighborhood, spot.city].filter(Boolean).join(", ") || spot.country || "";
  const upcoming = spot.date_start && (spot.date_end ?? spot.date_start) >= new Date().toISOString().slice(0, 10);

  const isFood = template === "food" || template === "recipe";
  // Food & drink at a glance: what kind of place, what food, what drinks, when, sit or to go.
  const venueChips = template === "food" ? emoji(VENUES, spot.venue_types).slice(0, 2) : [];
  const cuisineChips = isFood ? spot.cuisines.slice(0, 3) : [];
  const detailChips = isFood ? [...emoji(MEALS, spot.meals), ...emoji(DRINKS, spot.drinks), ...emoji(SERVICE, spot.service)] : [];
  let subtitle: string | null = null;
  if (template === "food") subtitle = spot.kind === "food" ? "Food post" : null;
  else if (template === "place") subtitle = spot.activity_type;
  else if (template === "recipe") subtitle = [spot.cuisines[0], spot.dishes[0]].filter(Boolean).join(" · ");
  else if (template === "account") subtitle = [spot.platform, ...spot.tags.slice(0, 2)].filter(Boolean).join(" · ");

  const dishes = isFood && spot.dishes.length ? spot.dishes.slice(0, 4).join(" · ") : null;
  const body = isFood ? (dishes ? null : spot.description) : spot.description;
  const tagLine = located || template === "account" ? [] : spot.tags.slice(0, 3);
  const canRetry = (spot.status === "error" || spot.ai_pending) && !busy && onRetry;

  return (
    <div
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragIds()));
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5",
        selected ? "border-accent ring-2 ring-accent" : "border-line",
      )}
    >
      {/* category color strip, or the screenshot when images are switched on */}
      {showImage && spot.images[0] ? (
        <button type="button" onClick={onOpen} className="relative block aspect-[16/10] w-full overflow-hidden bg-line/40" tabIndex={-1}>
          <img src={thumbUrl(spot.images[0])} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" style={{ objectPosition: focusPosition(spot.images[0], 16 / 10) }} />
          <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: color }} />
        </button>
      ) : (
        <div className="h-1 w-full" style={{ background: color }} />
      )}

      <button
        type="button"
        onClick={(e) => (selecting || e.metaKey || e.ctrlKey || e.shiftKey ? onToggleSelect(e.shiftKey) : onOpen())}
        className="flex flex-1 flex-col gap-2 p-3.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <div className="flex items-start gap-3 pr-14">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
            style={{ background: `${color}1f` }}
            aria-hidden
          >
            {busy ? <Loader2 size={18} className="animate-spin" style={{ color }} /> : category?.emoji ?? "📦"}
          </span>
          <div className="min-w-0 flex-1">
            {showCategory && category && (
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>{category.name}</p>
            )}
            <h3 className="font-display text-[17px] leading-snug font-semibold line-clamp-2">
              {spot.name || (busy ? "Reading screenshot…" : "Untitled")}
            </h3>
          </div>
        </div>

        {note && !busy && (
          <p className="flex items-start gap-1.5 rounded-lg bg-accent-soft px-2 py-1.5 text-xs leading-snug text-ink">
            <Sparkles size={12} className="mt-0.5 shrink-0 text-accent" /> {note}
          </p>
        )}
        {busy ? (
          <p className="text-xs text-muted">{spot.status_detail ?? "Queued…"}</p>
        ) : (
          <>
            {(subtitle || (template === "account" && spot.handle)) && (
              <p className="flex items-center gap-1 truncate text-xs capitalize text-muted">
                {template === "account" && spot.handle && <span className="normal-case font-medium text-ink/80"><AtSign size={11} className="-mt-0.5 inline" />{spot.handle}</span>}
                {template === "account" && spot.handle && subtitle && <span>·</span>}
                <span className="truncate">{subtitle}</span>
              </p>
            )}
            {spot.date_start && (
              <p className={cx("flex items-center gap-1 text-xs font-medium", upcoming ? "text-accent" : "text-muted line-through")}>
                <CalendarDays size={12} className="shrink-0" /> <span className="truncate">{formatDateRange(spot)}</span>
              </p>
            )}
            {located && place && (
              <p className="flex items-center gap-1 text-xs text-ink/80">
                <MapPin size={12} className="shrink-0 text-muted" /> <span className="truncate">{place}</span>
              </p>
            )}
            {(venueChips.length > 0 || cuisineChips.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {venueChips.map((v) => (
                  <span key={v.key} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${color}1f`, color: "var(--color-ink)" }}>
                    {v.emoji} {v.label}
                  </span>
                ))}
                {cuisineChips.map((c) => (
                  <span key={c} className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium capitalize text-ink/80">{c}</span>
                ))}
              </div>
            )}
            {dishes && <p className="text-[12.5px] leading-snug italic text-ink/75 line-clamp-1">{dishes}</p>}
            {detailChips.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {detailChips.slice(0, 5).map((d) => (
                  <span key={d.key} className="inline-flex items-center gap-0.5 rounded-md bg-line/50 px-1.5 py-0.5 text-[11px] text-ink/80">{d.emoji} {d.label}</span>
                ))}
                {detailChips.length > 5 && <span className="px-1 text-[11px] text-muted">+{detailChips.length - 5}</span>}
              </div>
            )}
            {body && <p className="text-[13px] leading-snug text-ink/75 line-clamp-2">{body}</p>}
          </>
        )}

        <div className="mt-auto flex min-w-0 items-center gap-1.5 pt-1">
          {located && spot.opening_hours?.length ? <OpenNow hours={spot.opening_hours} className="truncate text-[11px]" /> : null}
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {tagLine.map((t) => <span key={t} className="truncate rounded-full bg-line/60 px-1.5 py-0.5 text-[11px] text-ink/70">#{t}</span>)}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted">
            {spot.status === "error" && <AlertTriangle size={14} className="text-red-500" aria-label="Error" />}
            {spot.duplicate_of && <Copy size={14} className="text-gold" aria-label="Possible duplicate" />}
            {spot.needs_review && !busy && spot.status !== "error" && <Sparkles size={14} className="text-accent" aria-label="Needs review" />}
            {spot.visited && <span className="flex items-center text-emerald-600" title="Been there"><Check size={13} strokeWidth={3} /></span>}
            {located && spot.price != null && <span className="text-xs font-medium text-ink/70">{PRICE[spot.price]}</span>}
            {!!spot.specialness && <span className="text-accent"><Flames value={spot.specialness} size={12} /></span>}
            {!showImage && spot.images.length > 0 && (
              <span className="flex items-center gap-0.5 text-[11px]" title={`${spot.images.length} screenshot${spot.images.length > 1 ? "s" : ""}`}>
                <ImageIcon size={12} />{spot.images.length > 1 && spot.images.length}
              </span>
            )}
          </span>
        </div>
      </button>

      {canRetry && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRetry!(); }}
          className={cx(
            "mx-3.5 mb-3 -mt-1 flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-semibold transition",
            spot.status === "error" ? "bg-red-600 text-white hover:bg-red-700" : "bg-accent-soft text-ink hover:bg-accent hover:text-white",
          )}
        >
          <RefreshCw size={13} /> {spot.status === "error" ? "Try again" : "Finish with AI"}
        </button>
      )}

      {onFavorite && (
        <SaveButton
          on={spot.favorite}
          onToggle={onFavorite}
          className={cx(
            "absolute right-1.5 bg-card/80 backdrop-blur",
            showImage && spot.images[0] ? "top-1.5" : "top-3",
            !spot.favorite && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        />
      )}

      {/* Selection checkbox */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleSelect(e.shiftKey); }}
        aria-label={selected ? "Deselect" : "Select"}
        aria-pressed={selected}
        className={cx(
          "absolute right-10 flex h-6 w-6 items-center justify-center rounded-full border-2 transition",
          showImage && spot.images[0] ? "top-2" : "top-3.5",
          selected ? "border-accent bg-accent text-white" : "border-line bg-card text-transparent hover:border-accent hover:text-accent",
          !selected && !selecting && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Check size={14} strokeWidth={3} />
      </button>
    </div>
  );
}
