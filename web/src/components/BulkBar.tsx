import { useEffect, useRef, useState } from "react";
import { Check, ChevronUp, FolderInput, Library, RefreshCw, Trash2, X } from "lucide-react";
import type { BulkAction, Category, Collection } from "../api.ts";
import { Button, cx } from "./ui.tsx";

interface Props {
  count: number;
  categories: Category[];
  collections: Collection[];
  aiOn: boolean;
  onAction: (action: BulkAction, value?: string) => Promise<void>;
  onSelectAll: () => void;
  onClear: () => void;
  onNewCollection: () => Promise<string | null>;
}

function Menu({ label, icon, children, open, setOpen }: { label: string; icon: React.ReactNode; children: React.ReactNode; open: boolean; setOpen: (v: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, setOpen]);
  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" className="text-paper hover:bg-white/10" onClick={() => setOpen(!open)}>
        {icon} <span className="hidden sm:inline">{label}</span> <ChevronUp size={14} className={cx("transition", !open && "rotate-180")} />
      </Button>
      {open && (
        <div className="animate-pop absolute bottom-full left-0 mb-2 max-h-80 w-60 overflow-y-auto rounded-2xl border border-line bg-card p-1.5 text-ink shadow-2xl">
          {children}
        </div>
      )}
    </div>
  );
}

const itemCls = "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm hover:bg-paper";

export function BulkBar({ count, categories, collections, aiOn, onAction, onSelectAll, onClear, onNewCollection }: Props) {
  const [menu, setMenu] = useState<"category" | "collection" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (action: BulkAction, value?: string) => {
    setBusy(true);
    setMenu(null);
    try {
      await onAction(action, value);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="animate-pop fixed bottom-5 left-1/2 z-[1200] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 whitespace-nowrap rounded-2xl bg-ink px-2 py-1.5 text-paper shadow-2xl">
      <span className="px-2 text-sm font-semibold tabular-nums">{count} selected</span>
      <button onClick={onSelectAll} className="rounded-lg px-2 py-1 text-xs text-paper/70 hover:bg-white/10 hover:text-paper">All</button>
      <span className="mx-1 h-5 w-px bg-white/20" />

      <Menu label="Move to" icon={<FolderInput size={15} />} open={menu === "category"} setOpen={(v) => setMenu(v ? "category" : null)}>
        {categories.map((c) => (
          <button key={c.id} className={itemCls} onClick={() => act("category", c.id)}>
            <span className="w-5 text-center">{c.emoji}</span> {c.name}
          </button>
        ))}
      </Menu>

      <Menu label="Collection" icon={<Library size={15} />} open={menu === "collection"} setOpen={(v) => setMenu(v ? "collection" : null)}>
        {collections.map((c) => (
          <div key={c.id} className="flex items-center">
            <button className={itemCls} onClick={() => act("add_collection", c.id)}>
              <span className="w-5 text-center">{c.emoji}</span> <span className="flex-1 truncate">{c.name}</span>
            </button>
            <button className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-paper hover:text-ink" title="Remove selected from this collection" onClick={() => act("remove_collection", c.id)}>
              remove
            </button>
          </div>
        ))}
        <button
          className={cx(itemCls, "text-accent")}
          onClick={async () => {
            const id = await onNewCollection();
            if (id) act("add_collection", id);
          }}
        >
          <span className="w-5 text-center">＋</span> New collection…
        </button>
      </Menu>

      <Button variant="ghost" className="text-paper hover:bg-white/10" onClick={() => act("reviewed")} disabled={busy} title="Mark as reviewed">
        <Check size={15} /> <span className="hidden md:inline">Looks good</span>
      </Button>
      <Button variant="ghost" className="text-paper hover:bg-white/10" onClick={() => act("analyze")} disabled={busy || !aiOn} title={aiOn ? "Run AI again on the selection" : "Add an API key in Settings"}>
        <RefreshCw size={15} /> <span className="hidden md:inline">Re-analyze</span>
      </Button>
      {confirmDelete ? (
        <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => act("delete")} disabled={busy}>
          Delete {count}?
        </Button>
      ) : (
        <Button variant="ghost" className="text-red-300 hover:bg-white/10" onClick={() => setConfirmDelete(true)} aria-label="Delete selected">
          <Trash2 size={15} />
        </Button>
      )}
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button onClick={onClear} className="rounded-lg p-1.5 text-paper/70 hover:bg-white/10 hover:text-paper" aria-label="Clear selection">
        <X size={16} />
      </button>
    </div>
  );
}
