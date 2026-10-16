import { useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { api, type MobileInfo } from "../api.ts";
import { Button } from "./ui.tsx";

/** Header button: sync the encrypted phone version by hand. A dot means there are changes not on the phone yet. */
export function PhoneSync({ toast }: { toast: (msg: string) => void }) {
  const [sn, setSn] = useState<MobileInfo["snapshot"] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => api.mobile().then((m) => setSn(m.snapshot)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!sn?.configured) return null;
  const sync = async () => {
    setBusy(true);
    try {
      setSn(await api.publishMobile());
      toast("Phone version updated ✓");
    } catch (e) {
      toast(`Phone sync failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const last = sn.last_published ? new Date(sn.last_published).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";
  return (
    <Button
      variant="ghost"
      onClick={sync}
      disabled={busy || sn.publishing}
      className="relative"
      aria-label="Sync to phone"
      title={busy ? "Encrypting and uploading…" : `Sync to phone · last synced ${last}${sn.pending ? " · changes waiting" : " · up to date"}`}
    >
      {busy || sn.publishing ? <Loader2 size={18} className="animate-spin" /> : <Smartphone size={18} />}
      {sn.pending && !busy && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />}
    </Button>
  );
}
