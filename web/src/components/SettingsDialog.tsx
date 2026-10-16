import { useEffect, useState } from "react";
import { Cpu, Download, Home, KeyRound, Smartphone, Lock, ScanText, X } from "lucide-react";
import { api, type MobileInfo, type Status, type UsageSummary } from "../api.ts";
import { Button, cx, inputCls, Select } from "./ui.tsx";

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5 · best results",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 · faster & cheaper",
  "claude-haiku-5-5": "Claude Haiku 5.5 · fastest & cheapest",
};
const OCR_LABELS = { "apple-vision": "Apple Vision (on-device)", tesseract: "Tesseract (local)", none: "Not available" };

function Toggle({ checked, onChange, title, desc }: { checked: boolean; onChange: (v: boolean) => void; title: string; desc: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-paper">
      <span className="flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={cx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition", checked ? "bg-accent" : "bg-line")}>
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", checked ? "left-[18px]" : "left-0.5")} />
      </span>
    </label>
  );
}

export function SettingsDialog({ status, onClose, onSaved }: { status: Status; onClose: () => void; onSaved: () => void }) {
  const s = status.settings;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (patch: Parameters<typeof api.saveSettings>[0]) => {
    setBusy(true);
    try {
      await api.saveSettings(patch);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="animate-pop flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-3xl border border-line bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between px-6 pb-3 pt-6">
          <h2 className="font-display text-2xl font-semibold">Settings</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={15} /> Anthropic API key</h3>
            {s.hasKey ? (
              <div className="flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="flex-1 font-mono text-xs">{s.keyPreview}</span>
                <span className="text-xs text-muted">{s.keySource === "env" ? "from ANTHROPIC_API_KEY" : "saved locally"}</span>
                {s.keySource === "settings" && (
                  <button className="text-xs font-medium text-accent hover:underline" onClick={() => save({ anthropicApiKey: "" })}>Remove</button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted">Without a key everything stays 100% local: OCR runs on your Mac and you fill in the details yourself.</p>
            )}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save({ anthropicApiKey: key }).then(() => setKey("")); }}>
              <input type="password" autoComplete="off" className={inputCls} placeholder={s.hasKey ? "Replace key…" : "sk-ant-…"} value={key} onChange={(e) => setKey(e.target.value)} />
              <Button variant="primary" disabled={!key.trim() || busy}>Save</Button>
            </form>
            <p className="text-[11px] text-muted">Stored only in <code>data/settings.json</code> on this machine. Get one at console.anthropic.com.</p>
          </div>

          <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Home size={15} /> Home city</h3>
            <input
              className={inputCls}
              defaultValue={s.homeCity}
              placeholder="Munich"
              onBlur={(e) => e.target.value.trim() !== s.homeCity && save({ homeCity: e.target.value.trim() || "Munich" })}
            />
            <p className="text-[11px] text-muted">Posts in German or without a city are assumed to be here, and it gets its own page with your best spots.</p>
          </div>

          <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Cpu size={15} /> Model</h3>
            <Select value={s.model} onChange={(v) => save({ model: v })} options={s.models.map((m) => ({ value: m, label: MODEL_LABELS[m] ?? m }))} />
          </div>

          <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Lock size={15} /> Privacy</h3>
            <Toggle
              checked={s.autoResearch}
              onChange={(v) => save({ autoResearch: v })}
              title="Research spots on the web"
              desc="Claude searches the name to fill in address, food, drinks & links. Sends only extracted text."
            />
            <Toggle
              checked={s.imageFallback}
              onChange={(v) => save({ imageFallback: v })}
              title="Send image when text isn't enough"
              desc="If OCR finds almost no text (e.g. just a photo of food), the screenshot is sent to Claude. Off = images never leave your machine unless you click “Analyze image”."
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-paper px-3 py-2.5 text-xs">
            <span className="flex items-center gap-2"><ScanText size={14} /> OCR engine</span>
            <span className="font-medium">{OCR_LABELS[status.ocrEngine]}</span>
          </div>

          <PhoneSection />

          {s.hasKey && <OfficialBackfill />}
          {s.hasKey && <UsagePanel />}

          <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
            <div className="flex-1">
              <p className="text-sm font-medium">Stop Spotdrop</p>
              <p className="text-xs text-muted">Shuts the background server down completely. Open the Spotdrop app to start it again (it also starts with your Mac).</p>
            </div>
            <Button
              className="shrink-0 text-red-600 dark:text-red-400"
              onClick={async () => {
                await api.quit().catch(() => {});
                document.body.innerHTML = '<div style="font-family:system-ui;display:flex;height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:#888"><b style="font-size:20px;color:inherit">Spotdrop is stopped.</b>Open the Spotdrop app to start it again.</div>';
              }}
            >
              Stop
            </Button>
          </div>

          <a href="/api/export" className="flex items-center justify-center gap-2 rounded-xl border border-line py-2 text-sm font-medium hover:bg-paper">
            <Download size={15} /> Export all data (JSON)
          </a>
        </div>
      </div>
    </div>
  );
}

/** What the AI really cost, per feature (tracked from every call's token usage, official prices). */
function UsagePanel() {
  const [u, setU] = useState<UsageSummary | null>(null);
  const [days, setDays] = useState(30);
  useEffect(() => { api.usage(days).then(setU).catch(() => {}); }, [days]);
  if (!u) return null;
  const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
  return (
    <div className="space-y-2 rounded-xl border border-line px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-medium">AI cost · {usd(u.total)}</p>
        {[7, 30, 365].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={cx("rounded-md px-1.5 py-0.5 text-xs", days === d ? "bg-ink text-paper" : "text-muted hover:text-ink")}>{d === 365 ? "1 y" : `${d} d`}</button>
        ))}
      </div>
      {u.features.length ? (
        <table className="w-full text-xs">
          <tbody>
            {u.features.map((f) => (
              <tr key={f.feature} className="border-t border-line/60">
                <td className="py-1 pr-2">{f.label}</td>
                <td className="py-1 pr-2 text-right text-muted tabular-nums">{f.calls} calls{f.searches ? ` · ${f.searches} searches` : ""}</td>
                <td className="py-1 text-right font-medium tabular-nums">{usd(f.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-xs text-muted">Nothing tracked yet in this period (tracking started 16 Oct 2026).</p>}
      <p className="text-[11px] text-muted">Measured from each request's tokens and web searches at Anthropic's list prices (USD). Your Anthropic console bill is the final word.</p>
    </div>
  );
}

/** One click to look up the official one-line description and opening hours for every place missing them. */
function OfficialBackfill() {
  const [info, setInfo] = useState<{ missing: number; queued: number } | null>(null);
  useEffect(() => {
    const load = () => api.official().then(setInfo).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  if (!info || (info.missing === 0 && info.queued === 0)) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
      <div className="flex-1">
        <p className="text-sm font-medium">Official descriptions & opening hours</p>
        <p className="text-xs text-muted">
          {info.queued > 0
            ? `Looking up ${info.queued} place${info.queued === 1 ? "" : "s"}… (you can close this)`
            : `${info.missing} place${info.missing === 1 ? "" : "s"} without the one-liner or opening hours from Google Maps / their website. About $0.02 each with Haiku, $0.15 with Opus.`}
        </p>
      </div>
      {info.queued === 0 && (
        <Button className="shrink-0" onClick={() => api.fetchOfficial().then(() => api.official().then(setInfo))}>Fetch</Button>
      )}
    </div>
  );
}

/** iCloud inbox status + the encrypted phone snapshot on Cloudflare Pages. */
function PhoneSection() {
  const [info, setInfo] = useState<MobileInfo | null>(null);
  const [account, setAccount] = useState("");
  const [token, setToken] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.mobile().then((m) => { setInfo(m); setAccount((a) => a || m.cf.accountId); }).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  if (!info) return null;
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.saveMobile({ cfAccountId: account, ...(token ? { cfApiToken: token } : {}), ...(pass ? { snapshotPassphrase: pass } : {}) });
      setToken("");
      setPass("");
      await load();
      setMsg("Saved.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    setMsg("Encrypting and uploading… (first time ~30 s)");
    try {
      await api.publishMobile();
      setMsg("Published ✓");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      load();
    }
  };
  const sn = info.snapshot;
  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Smartphone size={15} /> Phone</h3>

      <div className="rounded-lg bg-paper px-3 py-2 text-xs">
        <p className="font-medium">📥 iCloud inbox {info.inbox.available ? "· active" : "· iCloud Drive not found"}</p>
        <p className="text-muted">On iPhone: Share → Save to Files → iCloud Drive → <b>Spotdrop Inbox</b>. Imported automatically while this Mac is on{info.inbox.imported ? ` · ${info.inbox.imported} imported so far` : ""}.</p>
        {info.inbox.available && <button onClick={() => api.openInbox()} className="mt-1 font-medium text-accent hover:underline">Show folder in Finder</button>}
      </div>

      <div className="space-y-2 text-xs">
        <p className="font-medium">🔒 Read-only phone version (encrypted, Cloudflare Pages)</p>
        <input className={inputCls} placeholder="Cloudflare Account ID" value={account} onChange={(e) => setAccount(e.target.value)} />
        <input className={inputCls} type="password" autoComplete="off" placeholder={info.cf.hasToken ? "API token saved (enter to replace)" : "Cloudflare API token (Pages: Edit)"} value={token} onChange={(e) => setToken(e.target.value)} />
        <input className={inputCls} type="password" autoComplete="new-password" placeholder={info.cf.hasPassphrase ? "Passphrase saved (enter to change)" : "Passphrase for your phone (10+ characters)"} value={pass} onChange={(e) => setPass(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={busy}>Save</Button>
          <Button variant="primary" onClick={publish} disabled={busy || !sn.configured}>Publish now</Button>
          {msg && <span className="text-muted">{msg}</span>}
        </div>
        {sn.url && (
          <p>
            Phone address: <a href={sn.url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{sn.url}</a>
            {sn.last_published && <span className="text-muted"> · updated {new Date(sn.last_published).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>}
          </p>
        )}
        {sn.last_error && <p className="text-red-500">Last error: {sn.last_error}</p>}
        <p className="text-muted">Updates only when you sync: the 📱 button at the top (it shows a dot when there are changes) or Publish now here. Data is encrypted here before upload; Cloudflare only sees scrambled data.</p>
      </div>
    </div>
  );
}
