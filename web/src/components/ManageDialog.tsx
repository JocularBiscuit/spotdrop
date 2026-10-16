import { useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { TEMPLATES, type Template } from "../../../shared/vocab.ts";
import { api, type Category, type Collection, type Learning, type OrganizerInfo } from "../api.ts";
import { Button, cx, inputCls, Select, Switch } from "./ui.tsx";

const COLORS = ["#ff5a36", "#e8862a", "#ca8a04", "#2f9e8f", "#3b82f6", "#7c5cff", "#db2777", "#78716c"];

interface Props {
  aiOn: boolean;
  autoOrganize: boolean;
  onSettingsChanged: () => void;
  categories: Category[];
  collections: Collection[];
  counts: Map<string, number>;
  onClose: () => void;
  onChanged: () => void;
  toast: (msg: string) => void;
}

function CategoryEditor({ initial, onSave, onCancel }: {
  initial: Partial<Category>; onSave: (c: Partial<Category>) => Promise<void>; onCancel: () => void;
}) {
  const [c, setC] = useState<Partial<Category>>({ emoji: "📁", color: COLORS[4], template: "generic", description: "", ...initial });
  const builtin = Boolean(initial.builtin);
  return (
    <form
      className="space-y-3 rounded-2xl border border-accent/40 bg-paper p-4"
      onSubmit={(e) => { e.preventDefault(); if (c.name?.trim()) onSave(c); }}
    >
      <div className="flex gap-2">
        <input className={cx(inputCls, "w-14 text-center text-lg")} value={c.emoji} maxLength={4} onChange={(e) => setC({ ...c, emoji: e.target.value })} aria-label="Emoji" />
        <input className={inputCls} autoFocus value={c.name ?? ""} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="Category name, e.g. Coffee, Workouts, Home decor" />
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">What belongs here? (the AI uses this to sort)</span>
        <textarea
          className={cx(inputCls, "min-h-16")}
          value={c.description ?? ""}
          onChange={(e) => setC({ ...c, description: e.target.value })}
          placeholder="e.g. Workout routines, exercises, training plans and gym tips."
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Fields</span>
          <Select value={c.template ?? "generic"} disabled={builtin} onChange={(v) => setC({ ...c, template: v as Template })} options={Object.entries(TEMPLATES).map(([k, t]) => ({ value: k, label: t.label }))} />
          <span className="block text-[11px] text-muted">{TEMPLATES[(c.template ?? "generic") as Template].hint}</span>
        </label>
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Color</span>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((col) => (
              <button key={col} type="button" onClick={() => setC({ ...c, color: col })} className={cx("h-7 w-7 rounded-full border-2", c.color === col ? "border-ink" : "border-transparent")} style={{ background: col }} aria-label={col} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!c.name?.trim()}>Save</Button>
      </div>
    </form>
  );
}

export function ManageDialog({ aiOn, autoOrganize, onSettingsChanged, categories, collections, counts, onClose, onChanged, toast }: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [org, setOrg] = useState<OrganizerInfo | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [newRule, setNewRule] = useState("");
  useEffect(() => {
    api.organizer().then(setOrg).catch(() => {});
    api.learning().then(setLearning).catch(() => {});
  }, []);
  const saveRules = async (rules: Learning["rules"]) => {
    try {
      setLearning(await api.saveRules(rules));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const runOrganizer = async () => {
    setOrganizing(true);
    try {
      const r = await api.organize();
      toast(r.summary);
      onChanged();
      setOrg(await api.organizer());
      setLearning(await api.learning());
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setOrganizing(false);
    }
  };

  const guard = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      onChanged();
      if (msg) toast(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="animate-pop flex max-h-[88vh] w-full max-w-2xl flex-col rounded-3xl border border-line bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="font-display text-2xl font-semibold">Categories & collections</h2>
            <p className="text-sm text-muted">Each screenshot lives in one category. Collections group things across categories.</p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>

        <div className="scrollbar-thin space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-3 rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
            <div className="flex items-start gap-3">
              <Sparkles size={20} className="mt-0.5 shrink-0 text-accent" />
              <div className="flex-1">
                <h3 className="font-semibold">AI organizer</h3>
                <p className="text-sm text-muted">
                  Looks at your whole library (text only) and keeps it tidy: creates a category when enough items share a theme, moves mis-sorted items, merges duplicate tags. Never touches what you sorted yourself.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={!aiOn || organizing || org?.running} onClick={runOrganizer}>
                {organizing || org?.running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Organize now
              </Button>
              <Switch
                checked={autoOrganize}
                onChange={(v) => api.saveSettings({ autoOrganize: v }).then(onSettingsChanged)}
                label={<span className="text-sm">Automatically every {org?.every ?? 20} new screenshots</span>}
              />
              {!aiOn && <span className="text-xs text-muted">Needs an API key</span>}
            </div>
            {org && org.log.length > 0 && (
              <ul className="space-y-1.5">
                {org.log.slice(0, 5).map((l) => (
                  <li key={l.id} className="rounded-xl bg-card px-3 py-2 text-sm">
                    <span className="text-xs text-muted">{new Date(l.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {l.trigger}</span>
                    <p>{l.summary}</p>
                    {l.changes.moves?.length > 0 && (
                      <details className="text-xs text-muted">
                        <summary className="cursor-pointer">{l.changes.moved} moved{l.changes.newCategories?.length ? ` · new: ${l.changes.newCategories.join(", ")}` : ""}</summary>
                        <ul className="mt-1 list-disc pl-4">{l.changes.moves.map((m) => <li key={m}>{m}</li>)}</ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">What the AI has learned</h3>
              {learning && <span className="text-xs text-muted">{learning.corrections} corrections remembered · {learning.terms} words learned</span>}
            </div>
            <p className="text-xs text-muted">
              Every time you move, rename or fix something, or confirm an item in “Needs a look”, it's remembered. Similar screenshots then get sorted your way,
              both by the AI and by the on-device sorter. The organizer turns patterns into rules; you can add your own.
            </p>
            {learning && learning.rules.length > 0 && (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {learning.rules.map((r, i) => (
                  <li key={`${i}-${r.text}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className={cx("rounded-full px-1.5 text-[10px] font-semibold uppercase", r.source === "user" ? "bg-accent-soft text-accent" : "bg-line/60 text-muted")}>
                      {r.source === "user" ? "yours" : "learned"}
                    </span>
                    <span className="flex-1">{r.text}</span>
                    <button onClick={() => saveRules(learning.rules.filter((_, j) => j !== i))} className="rounded-md p-1 text-muted hover:text-red-500" aria-label="Delete rule">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newRule.trim() || !learning) return;
                saveRules([...learning.rules, { text: newRule.trim(), source: "user" }]);
                setNewRule("");
              }}
            >
              <input className={inputCls} value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="Add a rule, e.g. “Songs and playlists go to Misc”" />
              <Button disabled={!newRule.trim()}>Add</Button>
            </form>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Categories</h3>
              <Button onClick={() => setEditing("new")}><Plus size={15} /> New category</Button>
            </div>
            {editing === "new" && (
              <CategoryEditor
                initial={{}}
                onCancel={() => setEditing(null)}
                onSave={(c) => guard(() => api.createCategory(c), `Created “${c.name}”`).then(() => setEditing(null))}
              />
            )}
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {categories.map((c) =>
                editing === c.id ? (
                  <li key={c.id} className="p-2">
                    <CategoryEditor initial={c} onCancel={() => setEditing(null)} onSave={(patch) => guard(() => api.updateCategory(c.id, patch), "Saved").then(() => setEditing(null))} />
                  </li>
                ) : (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: `${c.color}22` }}>{c.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {c.name}
                        <span className="text-xs font-normal text-muted">{counts.get(c.id) ?? 0}</span>
                        {!c.builtin && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold uppercase text-accent">custom</span>}
                      </div>
                      <p className="truncate text-xs text-muted">{c.description || TEMPLATES[c.template].hint}</p>
                    </div>
                    <Button variant="ghost" onClick={() => setEditing(c.id)}>Edit</Button>
                    {!c.builtin && (confirm === c.id ? (
                      <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => guard(() => api.deleteCategory(c.id), "Deleted — items moved to Misc").then(() => setConfirm(null))}>
                        Delete?
                      </Button>
                    ) : (
                      <Button variant="danger" onClick={() => setConfirm(c.id)} aria-label={`Delete ${c.name}`}><Trash2 size={15} /></Button>
                    ))}
                  </li>
                ),
              )}
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Collections</h3>
            {collections.length === 0 ? (
              <p className="text-sm text-muted">No collections yet. Use ＋ in the sidebar, or select screenshots and pick “Collection”.</p>
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {collections.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                    <input
                      className={cx(inputCls, "w-14 text-center")}
                      defaultValue={c.emoji}
                      maxLength={4}
                      onBlur={(e) => e.target.value !== c.emoji && guard(() => api.updateCollection(c.id, { emoji: e.target.value }))}
                      aria-label="Emoji"
                    />
                    <input
                      className={inputCls}
                      defaultValue={c.name}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && guard(() => api.updateCollection(c.id, { name: e.target.value }), "Renamed")}
                      aria-label="Collection name"
                    />
                    <span className="w-8 text-right text-xs text-muted tabular-nums">{counts.get(c.id) ?? 0}</span>
                    {confirm === c.id ? (
                      <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => guard(() => api.deleteCollection(c.id), "Collection deleted (items kept)").then(() => setConfirm(null))}>
                        Delete?
                      </Button>
                    ) : (
                      <Button variant="danger" onClick={() => setConfirm(c.id)} aria-label={`Delete ${c.name}`}><Trash2 size={15} /></Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
