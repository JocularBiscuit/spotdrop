import { openState } from "../../../shared/hours.ts";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Bookmark, Check, ChevronDown, Flame, X } from "lucide-react";
import { SPECIALNESS } from "../../../shared/vocab.ts";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnVariant = "primary" | "ghost" | "outline" | "danger";
export function Button({ variant = "outline", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-accent text-white shadow-sm shadow-accent/30 hover:brightness-110",
        variant === "outline" && "border border-line bg-card hover:bg-paper",
        variant === "ghost" && "hover:bg-line/60",
        variant === "danger" && "text-red-600 hover:bg-red-500/10 dark:text-red-400",
        className,
      )}
    />
  );
}

export function Chip({ active, onClick, children, className, title }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string; title?: string }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition",
        active ? "border-accent bg-accent text-white" : "border-line bg-card text-ink/80",
        onClick && !active && "hover:border-accent/50 hover:text-ink",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

type Vocab = Record<string, { label: string; emoji: string }>;

export function ToggleGroup({ vocab, value, onChange, counts }: { vocab: Vocab; value: string[]; onChange: (v: string[]) => void; counts?: Map<string, number> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(vocab).map(([key, { label, emoji }]) => {
        const on = value.includes(key);
        const n = counts?.get(key);
        if (counts && !n && !on) return null;
        return (
          <Chip key={key} active={on} onClick={() => onChange(on ? value.filter((v) => v !== key) : [...value, key])}>
            <span>{emoji}</span>
            {label}
            {n !== undefined && <span className={cx("tabular-nums", on ? "text-white/80" : "text-muted")}>{n}</span>}
          </Chip>
        );
      })}
    </div>
  );
}

export function Flames({ value, size = 14, className }: { value: number | null; size?: number; className?: string }) {
  if (!value) return null;
  return (
    <span className={cx("inline-flex items-center", className)} title={SPECIALNESS[value as 1]?.label}>
      {Array.from({ length: value }, (_, i) => (
        <Flame key={i} size={size} className="-mx-[1px] fill-current" />
      ))}
    </span>
  );
}

export function SpecialnessPicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className={cx("p-0.5 transition", n <= shown ? "text-accent" : "text-line hover:text-muted")}
            aria-label={SPECIALNESS[n as 1].label}
          >
            <Flame size={24} className={cx(n <= shown && "fill-current")} />
          </button>
        ))}
      </div>
      <span className="text-sm font-medium text-muted">{shown ? SPECIALNESS[shown as 1].label : "Not rated"}</span>
    </div>
  );
}

export function TagInput({ value, onChange, placeholder, lowercase = true }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; lowercase?: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => (lowercase ? s.trim().toLowerCase() : s.trim())).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card px-2 py-1.5 focus-within:border-accent">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-ink">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="text-muted hover:text-ink" aria-label={`Remove ${t}`}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        placeholder={value.length ? "" : placeholder}
        className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted/70"
      />
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent";

/** Instagram-style save button. */
export function SaveButton({ on, onToggle, size = 16, className }: { on: boolean; onToggle: () => void; size?: number; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-pressed={on}
      aria-label={on ? "Remove from Saved" : "Save"}
      title={on ? "Saved — click to remove" : "Save"}
      className={cx("rounded-full p-1.5 transition hover:scale-110", on ? "text-accent" : "text-muted hover:text-ink", className)}
    >
      <Bookmark size={size} className={cx(on && "fill-current")} />
    </button>
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
}

/** App-styled dropdown (replaces the native macOS select). */
export function Select({ value, options, onChange, placeholder = "Choose…", className, buttonClassName, disabled, icon, align = "left", ariaLabel }: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
  icon?: ReactNode;
  align?: "left" | "right";
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          "flex w-full items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-left text-sm transition hover:border-accent/50 disabled:opacity-60",
          open && "border-accent",
          buttonClassName,
        )}
      >
        {icon}
        <span className={cx("flex-1 truncate", !current && "text-muted")}>{current?.label ?? placeholder}</span>
        <ChevronDown size={14} className={cx("shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="listbox"
          className={cx(
            "animate-pop scrollbar-thin absolute top-full z-[1200] mt-1.5 max-h-72 min-w-full overflow-y-auto rounded-2xl border border-line bg-card p-1.5 shadow-2xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={cx("flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-paper", o.value === value && "font-semibold")}
            >
              <span className="flex-1">{o.label}</span>
              {o.value === value && <Check size={14} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** App-styled on/off switch (replaces native checkboxes). */
export function Switch({ checked, onChange, label, className, size = "md" }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx("inline-flex items-center gap-2 text-left", className)}>
      <span className={cx("relative shrink-0 rounded-full transition", checked ? "bg-accent" : "bg-line", sm ? "h-4 w-7" : "h-6 w-10")}>
        <span className={cx("absolute rounded-full bg-white shadow transition-all", sm ? "top-0.5 h-3 w-3" : "top-0.5 h-5 w-5", checked ? (sm ? "left-[14px]" : "left-[18px]") : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

/** "Open · until 22:00" in green / "Closed · opens 18:00" in muted, from the stored weekly hours. */
export function OpenNow({ hours, className }: { hours: string[] | null | undefined; className?: string }) {
  const st = openState(hours);
  if (!st) return null;
  return <span className={cx("whitespace-nowrap text-xs font-medium", st.open ? "text-emerald-600" : "text-muted", className)}>{st.text}</span>;
}
