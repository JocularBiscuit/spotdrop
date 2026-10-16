import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import { imageUrl, isProcessing, thumbUrl, type Category, type Spot, type SpotImage } from "../api.ts";
import { cx } from "./ui.tsx";

export interface Shot {
  image: SpotImage;
  items: Spot[];
  added: string;
}

/** One entry per stored screenshot file (a "top 5" post is one screenshot with five items). */
export function groupScreenshots(spots: Spot[]): Shot[] {
  const byFile = new Map<string, Shot>();
  for (const s of spots) {
    for (const img of s.images) {
      const shot = byFile.get(img.file) ?? { image: img, items: [], added: s.created_at };
      if (!shot.items.includes(s)) shot.items.push(s);
      if (s.created_at < shot.added) shot.added = s.created_at;
      byFile.set(img.file, shot);
    }
  }
  return [...byFile.values()].sort((a, b) => b.added.localeCompare(a.added));
}

export function ScreenshotGallery({ shots, categories, onOpenItem }: { shots: Shot[]; categories: Category[]; onOpenItem: (id: string) => void }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const open = openIdx !== null ? shots[openIdx] : null;

  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
      if (e.key === "ArrowRight") setOpenIdx((i) => (i === null ? i : Math.min(shots.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpenIdx((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx, shots.length]);

  if (!shots.length) return <p className="py-20 text-center text-muted">No screenshots match.</p>;

  const ItemChips = ({ shot, dark }: { shot: Shot; dark?: boolean }) => (
    <div className="flex flex-wrap gap-1">
      {shot.items.map((s) => {
        const c = catById.get(s.category);
        return (
          <button
            key={s.id}
            onClick={(e) => { e.stopPropagation(); setOpenIdx(null); onOpenItem(s.id); }}
            className={cx(
              "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium transition",
              dark ? "bg-white/10 text-white hover:bg-white/20" : "bg-line/60 text-ink/80 hover:bg-accent-soft",
            )}
            title={`Open ${s.name}`}
          >
            <span>{c?.emoji ?? "📦"}</span>
            <span className="truncate">{s.name || "Untitled"}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="columns-2 gap-3 pb-24 sm:columns-3 lg:columns-4 2xl:columns-5 [&>*]:mb-3">
        {shots.map((shot, i) => {
          const busy = shot.items.some(isProcessing);
          return (
            <div key={shot.image.file} className="break-inside-avoid overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
              <button className="relative block w-full" onClick={() => setOpenIdx(i)} aria-label="View screenshot">
                <img
                  src={thumbUrl(shot.image)}
                  alt=""
                  loading="lazy"
                  className="w-full"
                  style={shot.image.width && shot.image.height ? { aspectRatio: `${shot.image.width} / ${shot.image.height}` } : undefined}
                />
                {busy && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"><Loader2 className="animate-spin" /></span>
                )}
                {shot.items.length > 1 && (
                  <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                    {shot.items.length} items
                  </span>
                )}
              </button>
              <div className="space-y-1.5 p-2.5">
                <ItemChips shot={shot} />
                <p className="text-[11px] text-muted">{new Date(shot.added).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-[3000] flex bg-black/90" onClick={() => setOpenIdx(null)}>
          <div className="flex min-w-0 flex-1 items-center justify-center p-6">
            <img src={imageUrl(open.image)} alt="" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
          <aside className="hidden w-72 shrink-0 flex-col gap-4 border-l border-white/10 p-5 text-white md:flex" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">{(openIdx ?? 0) + 1} / {shots.length}</span>
              <button className="rounded-full p-1.5 hover:bg-white/10" onClick={() => setOpenIdx(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Items from this screenshot</p>
              <ItemChips shot={open} dark />
            </div>
            {open.image.original_name && <p className="break-all text-xs text-white/50">{open.image.original_name}</p>}
            <a
              href={imageUrl(open.image)}
              download={(open.image.original_name ?? "screenshot").replace(/\.[a-z0-9]+$/i, "") + ".webp"}
              className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-white/10 py-2 text-sm font-medium hover:bg-white/20"
            >
              <Download size={15} /> Save image
            </a>
          </aside>
          {openIdx! > 0 && (
            <button className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={(e) => { e.stopPropagation(); setOpenIdx(openIdx! - 1); }} aria-label="Previous">
              <ChevronLeft />
            </button>
          )}
          {openIdx! < shots.length - 1 && (
            <button className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 md:right-[19rem]" onClick={(e) => { e.stopPropagation(); setOpenIdx(openIdx! + 1); }} aria-label="Next">
              <ChevronRight />
            </button>
          )}
        </div>
      )}
    </>
  );
}
