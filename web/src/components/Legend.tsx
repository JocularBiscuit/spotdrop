import { AlertTriangle, CalendarDays, Check, Copy, Image as ImageIcon, MapPin, Sparkles, X } from "lucide-react";
import type { Category } from "../api.ts";
import { Flames } from "./ui.tsx";

/** Explains what the bits on a card mean. */
export function Legend({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <li className="flex items-center gap-2">
      <span className="flex w-16 shrink-0 justify-center">{icon}</span>
      <span className="text-ink/80">{children}</span>
    </li>
  );
  return (
    <div className="animate-pop absolute right-0 top-full z-[1100] mt-2 w-[min(760px,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-4 text-xs shadow-2xl">
      <button onClick={onClose} className="absolute right-3 top-3 rounded-full p-1 text-muted hover:bg-line/50 hover:text-ink" aria-label="Hide legend">
        <X size={14} />
      </button>
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Category</h4>
          <p className="mb-2 text-ink/80">Color strip and icon on top of each card:</p>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: `${c.color}1f` }}>
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} /> {c.emoji} {c.name}
              </span>
            ))}
          </div>
        </div>
        <ul className="space-y-1.5">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Food & drink</h4>
          <Row icon={<span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold">☕ Café</span>}>Type of place</Row>
          <Row icon={<span className="rounded-full border border-line px-2 py-0.5">Japanese</span>}>Cuisine</Row>
          <Row icon={<i className="text-ink/75">ramen · gyoza</i>}>Signature dishes</Row>
          <Row icon={<span className="rounded-md bg-line/50 px-1.5 py-0.5">🥗 Lunch</span>}>Meal, drinks, 🪑 sit down / 🥡 to go</Row>
          <Row icon={<span className="font-medium">$ – $$$$</span>}>Price</Row>
        </ul>
        <ul className="space-y-1.5">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Symbols</h4>
          <Row icon={<span className="text-accent"><Flames value={3} size={12} /></span>}>Rating 1–5: how special (places) or useful (everything else)</Row>
          <Row icon={<MapPin size={13} className="text-muted" />}>Neighborhood, city</Row>
          <Row icon={<CalendarDays size={13} className="text-accent" />}>Has a date (in the calendar)</Row>
          <Row icon={<Check size={13} strokeWidth={3} className="text-emerald-600" />}>You've been there</Row>
          <Row icon={<Sparkles size={13} className="text-accent" />}>Needs a look: AI was unsure</Row>
          <Row icon={<Copy size={13} className="text-gold" />}>Possible duplicate</Row>
          <Row icon={<AlertTriangle size={13} className="text-red-500" />}>Error while sorting</Row>
          <Row icon={<ImageIcon size={13} className="text-muted" />}>Has screenshot(s) (number = how many)</Row>
        </ul>
      </div>
    </div>
  );
}
