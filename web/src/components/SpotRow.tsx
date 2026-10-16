import { AlertTriangle, CalendarDays, Check, Copy, Loader2, Sparkles } from "lucide-react";
import { DRINKS, MEALS, PRICE, SERVICE, VENUES } from "../../../shared/vocab.ts";
import { DRAG_MIME, focusPosition, isProcessing, thumbUrl, type Category, type Spot } from "../api.ts";
import { formatDateRange } from "./CalendarView.tsx";
import { cx, Flames, OpenNow, SaveButton } from "./ui.tsx";

const labels = (vocab: Record<string, { emoji: string; label: string }>, keys: string[]) =>
  keys.filter((k) => vocab[k]).map((k) => `${vocab[k].emoji} ${vocab[k].label}`);

/** Compact one-line row for the list layout. */
export function SpotRow({ spot, category, showCategory, selected, selecting, dragIds, onOpen, onToggleSelect, showImage, note, onFavorite }: {
  spot: Spot;
  category: Category | undefined;
  showCategory: boolean;
  selected: boolean;
  selecting: boolean;
  dragIds: () => string[];
  onOpen: () => void;
  onToggleSelect: (shift: boolean) => void;
  showImage?: boolean;
  note?: string;
  onFavorite?: () => void;
}) {
  const busy = isProcessing(spot);
  const color = category?.color ?? "#78716c";
  const template = category?.template ?? "generic";
  const isFood = template === "food" || template === "recipe";
  const what = isFood
    ? [...labels(VENUES, spot.venue_types).slice(0, 1), ...spot.cuisines.slice(0, 2)]
    : [spot.activity_type, spot.handle ? `@${spot.handle}` : null].filter(Boolean) as string[];
  const extras = isFood ? [...labels(MEALS, spot.meals), ...labels(DRINKS, spot.drinks), ...labels(SERVICE, spot.service)] : spot.tags.slice(0, 3).map((t) => `#${t}`);
  const where = [spot.neighborhood, spot.city].filter(Boolean).join(", ");

  return (
    <div
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragIds()));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => (selecting || e.metaKey || e.ctrlKey || e.shiftKey ? onToggleSelect(e.shiftKey) : onOpen())}
      className={cx(
        "group flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 transition hover:bg-card",
        selected && "bg-accent-soft hover:bg-accent-soft",
      )}
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleSelect(e.shiftKey); }}
        aria-label={selected ? "Deselect" : "Select"}
        className={cx(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
          selected ? "border-accent bg-accent text-white" : "border-line text-transparent hover:border-accent",
          !selected && !selecting && "opacity-0 group-hover:opacity-100",
        )}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      {showImage && spot.images[0] ? (
        <img src={thumbUrl(spot.images[0])} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" style={{ objectPosition: focusPosition(spot.images[0], 1) }} />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: `${color}1f` }}>
          {busy ? <Loader2 size={16} className="animate-spin" style={{ color }} /> : category?.emoji ?? "📦"}
        </span>
      )}

      <div className="min-w-0 flex-[2]">
        <p className="truncate text-sm font-semibold">{spot.name || (busy ? "Reading screenshot…" : "Untitled")}</p>
        <p className="truncate text-xs text-muted">
          {note ? <span className="text-accent">✨ {note}</span> : [showCategory ? category?.name : null, ...what].filter(Boolean).join(" · ") || spot.description}
        </p>
        <OpenNow hours={spot.opening_hours} className="block md:hidden" />
      </div>
      <div className="hidden min-w-0 flex-[2] truncate text-xs text-ink/75 lg:block">{extras.slice(0, 4).join(" · ")}</div>
      <div className="hidden min-w-[9.5rem] flex-1 truncate text-xs text-muted md:block">
        {spot.date_start ? (
          <span className="flex items-center gap-1 font-medium text-accent"><CalendarDays size={12} /> {formatDateRange(spot)}</span>
        ) : (
          <>
            <span className="block truncate">{where}</span>
            <OpenNow hours={spot.opening_hours} className="block" />
          </>
        )}
      </div>
      <div className="flex w-36 shrink-0 items-center justify-end gap-1.5 text-muted">
        {spot.status === "error" && <AlertTriangle size={14} className="text-red-500" />}
        {spot.duplicate_of && <Copy size={14} className="text-gold" />}
        {spot.needs_review && !busy && <Sparkles size={14} className="text-accent" />}
        {spot.visited && <Check size={13} strokeWidth={3} className="text-emerald-600" />}
        {spot.price != null && (template === "food" || template === "place") && <span className="text-xs font-medium text-ink/70">{PRICE[spot.price]}</span>}
        {!!spot.specialness && <span className="text-accent"><Flames value={spot.specialness} size={11} /></span>}
        {onFavorite && <SaveButton on={spot.favorite} onToggle={onFavorite} size={15} className={cx(!spot.favorite && "opacity-40 group-hover:opacity-100")} />}
      </div>
    </div>
  );
}
