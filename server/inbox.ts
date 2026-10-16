// iCloud inbox: on the iPhone, Share → Save to Files → iCloud Drive/Spotdrop Inbox.
// The Mac checks the folder every 20 s, imports new images like a normal drop, and moves them to
// "Spotdrop Inbox/Imported" so nothing is imported twice. Works whenever the Mac is on.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { getMeta, setMeta } from "./db.ts";

const ICLOUD = path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
export const INBOX = process.env.SPOTDROP_INBOX ?? path.join(ICLOUD, "Spotdrop Inbox");
const DONE = path.join(INBOX, "Imported");
const IMAGE = /\.(png|jpe?g|heic|heif|webp|gif|tiff?)$/i;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", heif: "image/heif", webp: "image/webp", gif: "image/gif", tif: "image/tiff", tiff: "image/tiff" };

type Importer = (buf: Buffer, name: string, mime: string, modifiedMs: number) => Promise<string | null>;

export const inboxStatus = () => ({
  available: fs.existsSync(ICLOUD) || Boolean(process.env.SPOTDROP_INBOX),
  path: INBOX,
  imported: Number(getMeta("inbox_imported") ?? 0),
  last: getMeta("inbox_last") ?? null,
});

let busy = false;

async function scan(importer: Importer, onImported: (ids: string[]) => void) {
  if (busy || !fs.existsSync(INBOX)) return;
  busy = true;
  try {
    const ids: string[] = [];
    for (const name of fs.readdirSync(INBOX)) {
      const full = path.join(INBOX, name);
      // Not downloaded yet from iCloud: shows up as ".Name.png.icloud" — ask macOS to fetch it.
      if (name.startsWith(".") && name.endsWith(".icloud")) {
        execFile("brctl", ["download", full], () => {});
        continue;
      }
      if (name.startsWith(".") || !IMAGE.test(name)) continue;
      const st = fs.statSync(full);
      if (!st.isFile() || Date.now() - st.mtimeMs < 3000) continue; // still being written
      try {
        const id = await importer(fs.readFileSync(full), name, MIME[name.split(".").pop()!.toLowerCase()] ?? "image/jpeg", st.mtimeMs);
        if (id) ids.push(id);
        fs.mkdirSync(DONE, { recursive: true });
        let target = path.join(DONE, name);
        if (fs.existsSync(target)) target = path.join(DONE, `${Date.now()}-${name}`);
        fs.renameSync(full, target);
      } catch (e) {
        console.warn("[inbox] could not import", name, (e as Error).message);
      }
    }
    if (ids.length) {
      setMeta("inbox_imported", String(Number(getMeta("inbox_imported") ?? 0) + ids.length));
      setMeta("inbox_last", new Date().toISOString());
      console.log(`[inbox] imported ${ids.length} screenshot(s) from iCloud`);
      onImported(ids);
    }
  } finally {
    busy = false;
  }
}

export function startInbox(importer: Importer, onImported: (ids: string[]) => void) {
  if (!inboxStatus().available) {
    console.log("[inbox] iCloud Drive not found, inbox disabled");
    return;
  }
  fs.mkdirSync(INBOX, { recursive: true });
  const readme = path.join(INBOX, "README.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, "Save screenshots here (iPhone: Share → Save to Files → Spotdrop Inbox).\nSpotdrop on your Mac imports them automatically and moves them to the Imported folder.\n");
  }
  const tick = () => scan(importer, onImported).catch((e) => console.warn("[inbox]", e.message));
  setTimeout(tick, 5000);
  setInterval(tick, 20000);
  console.log(`[inbox] watching ${INBOX}`);
}
