import { CalendarRange } from "lucide-react";
import { DATE_PRESETS, localDay, type DateFilter } from "../../../shared/dates.ts";
import { cx, Select } from "./ui.tsx";

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

/** Compact version: one dropdown (Any time · Today · … · Pick dates…), date inputs appear only for "Pick dates". */
export function DateSelect({ value, onChange, extra, className }: {
  value: DateFilter;
  onChange: (f: DateFilter) => void;
  /** Extra options (e.g. ["places", "📍 Places, no date"]) reported via onExtra. */
  extra?: { key: string; label: string; active: boolean; onPick: () => void };
  className?: string;
}) {
  const today = localDay(new Date());
  const current = extra?.active ? `x:${extra.key}` : value.preset;
  const dateCls = "rounded-lg border border-line bg-card px-2 py-1 text-xs outline-none focus:border-accent";
  return (
    <span className={cx("flex flex-wrap items-center gap-1.5", className)}>
      <Select
        value={current}
        onChange={(v) => {
          if (extra && v === `x:${extra.key}`) return extra.onPick();
          if (v === "custom") return onChange({ preset: "custom", from: value.from ?? today, to: value.to });
          onChange({ preset: v as DateFilter["preset"] });
        }}
        options={[
          ...DATE_PRESETS.map(([k, label]) => ({ value: k, label: k === "any" ? "📅 Any time" : label })),
          { value: "custom", label: "Pick dates…" },
          ...(extra ? [{ value: `x:${extra.key}`, label: extra.label }] : []),
        ]}
        className="w-40"
        buttonClassName="py-1 text-[13px] font-medium"
        ariaLabel="When"
      />
      {value.preset === "custom" && !extra?.active && (
        <span className="flex items-center gap-1 text-xs text-muted">
          <input type="date" className={dateCls} value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />
          –
          <input type="date" className={dateCls} value={value.to ?? ""} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} />
        </span>
      )}
    </span>
  );
}
