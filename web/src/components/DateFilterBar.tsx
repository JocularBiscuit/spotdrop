import { CalendarRange } from "lucide-react";
import { DATE_PRESETS, localDay, type DateFilter } from "../../../shared/dates.ts";
import { cx } from "./ui.tsx";

/** Any time · Today · Tomorrow · This weekend · Next 7/30 days · pick a day or range. */
export function DateFilterBar({ value, onChange, className }: { value: DateFilter; onChange: (f: DateFilter) => void; className?: string }) {
  const custom = value.preset === "custom";
  const today = localDay(new Date());
  const dateCls = "rounded-lg border border-line bg-card px-2 py-1 text-xs outline-none focus:border-accent";
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", className)}>
      {DATE_PRESETS.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange({ preset: k })}
          className={cx("rounded-full border px-3 py-1 text-xs font-medium transition", value.preset === k ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-accent")}
        >
          {label}
        </button>
      ))}
      <button
        onClick={() => onChange(custom ? { preset: "any" } : { preset: "custom", from: value.from ?? today, to: value.to })}
        className={cx("flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition", custom ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-accent")}
      >
        <CalendarRange size={12} /> Pick dates
      </button>
      {custom && (
        <span className="flex items-center gap-1 text-xs text-muted">
          <input type="date" className={dateCls} value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />
          –
          <input type="date" className={dateCls} value={value.to ?? ""} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} />
          {value.to && <button onClick={() => onChange({ ...value, to: undefined })} className="text-accent hover:underline">single day</button>}
        </span>
      )}
    </div>
  );
}
