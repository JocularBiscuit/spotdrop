import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import sharp from "sharp";

export const sha1 = (buf: Buffer) => crypto.createHash("sha1").update(buf).digest("hex");
import { IMAGES_DIR, THUMBS_DIR } from "./config.ts";
import { db, fileStillReferenced, newId, type ImageRow } from "./db.ts";

const run = promisify(execFile);

const isHeic = (name: string, mime: string) => /\.(heic|heif)$/i.test(name) || /hei[cf]/i.test(mime);

/** HEIC (iPhone photos) -> JPEG. Uses macOS `sips` when present, otherwise a pure-JS decoder (Docker). */
async function heicToJpeg(buf: Buffer): Promise<Buffer> {
  if (process.platform === "darwin") {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spotdrop-"));
    const src = path.join(tmp, "in.heic");
    const dst = path.join(tmp, "out.jpg");
    try {
      fs.writeFileSync(src, buf);
      await run("sips", ["-s", "format", "jpeg", src, "--out", dst]);
      return fs.readFileSync(dst);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const { default: convert } = await import("heic-convert");
  return Buffer.from(await convert({ buffer: buf, format: "JPEG", quality: 0.9 }));
}

/** 64-bit difference hash, used to spot the same screenshot uploaded twice. */
async function dhash(buf: Buffer): Promise<string> {
  const px = await sharp(buf).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] < px[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hammingHex(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Space-saving copy: ≤1080 px wide (still crisp enough to read text), WebP q60. ~10–20× smaller than PNG screenshots. */
const MAX_WIDTH = 1080;
const MAX_HEIGHT = 3200;
async function compress(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate() // respect EXIF orientation
    .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 60, effort: 5 })
    .toBuffer();
}

/** One-time shrink of screenshots stored before compression existed (runs in the background on start). */
export async function compressExistingImages(db: import("node:sqlite").DatabaseSync) {
  const rows = db.prepare("SELECT DISTINCT file FROM images WHERE file NOT LIKE '%.webp' AND ocr_lines IS NOT NULL").all() as { file: string }[];
  if (!rows.length) return;
  let saved = 0;
  for (const { file } of rows) {
    const src = path.join(IMAGES_DIR, file);
    if (!fs.existsSync(src)) continue;
    try {
      const before = fs.statSync(src).size;
      const out = await compress(fs.readFileSync(src));
      const next = file.replace(/\.[a-z]+$/i, ".webp");
      fs.writeFileSync(path.join(IMAGES_DIR, next), out);
      db.prepare("UPDATE images SET file = ? WHERE file = ?").run(next, file);
      fs.rmSync(src);
      saved += before - out.length;
    } catch (e) {
      console.warn("[images] could not compress", file, (e as Error).message);
    }
  }
  console.log(`[images] compressed ${rows.length} stored screenshots, saved ${(saved / 1024 / 1024).toFixed(1)} MB`);
}

/** Store a compressed copy + thumbnail. Returns everything except spot_id/ocr fields. */
export async function storeImage(buf: Buffer, originalName: string, mime: string) {
  let input = buf;
  if (isHeic(originalName, mime)) input = await heicToJpeg(buf);

  const id = newId();
  const file = `${id}.webp`;
  const normalized = await compress(input);
  fs.writeFileSync(path.join(IMAGES_DIR, file), normalized);

  const thumb = `${id}.webp`;
  await sharp(normalized).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(THUMBS_DIR, thumb));

  const final = await sharp(normalized).metadata();
  return {
    id,
    file,
    thumb,
    width: final.width ?? null,
    height: final.height ?? null,
    dhash: await dhash(normalized),
    original_name: originalName,
    sha1: sha1(buf),
    focus_y: await photoFocus(normalized),
  };
}

/**
 * Where the photo sits in a screenshot, as the vertical center (0-1) of the longest band of "photo-like" rows
 * (many different colours) — e.g. the venue picture at the top of a Google Maps card, or the food in a post.
 * -1 when there's no clear photo (text screenshots), so those stay centered.
 */
export async function photoFocus(input: Buffer | string): Promise<number> {
  const W = 48, H = 160;
  const data = await sharp(input).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const score: number[] = [];
  for (let y = 0; y < H; y++) {
    const bins = new Set<number>();
    let sat = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
      bins.add((r >> 5) * 64 + (g >> 5) * 8 + (b >> 5));
      sat += Math.max(r, g, b) - Math.min(r, g, b);
    }
    score.push(bins.size + sat / W / 8);
  }
  const smooth = score.map((_, y) => {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) if (score[y + k] != null) { s += score[y + k]; n++; }
    return s / n;
  });
  const photo = smooth.map((v) => v >= 11);
  // Bridge short dips inside a photo (a dark area, an overlay).
  for (let y = 1; y < H; y++) {
    if (photo[y]) continue;
    let j = y;
    while (j < H && !photo[j]) j++;
    if (j < H && j - y <= 4) for (let k = y; k < j; k++) photo[k] = true;
    y = j;
  }
  let best: [number, number] = [0, 0];
  let start = -1;
  for (let y = 0; y <= H; y++) {
    if (y < H && photo[y]) { if (start < 0) start = y; }
    else if (start >= 0) { if (y - start > best[1] - best[0]) best = [start, y]; start = -1; }
  }
  return best[1] - best[0] >= H * 0.12 ? Math.round(((best[0] + best[1]) / 2 / H) * 1000) / 1000 : -1;
}

/** Fill focus_y for images stored before it existed (background, one at a time). */
export async function backfillPhotoFocus() {
  const rows = db.prepare("SELECT id, thumb FROM images WHERE focus_y IS NULL").all() as { id: string; thumb: string }[];
  const upd = db.prepare("UPDATE images SET focus_y = ? WHERE id = ?");
  for (const r of rows) {
    try {
      upd.run(await photoFocus(path.join(THUMBS_DIR, r.thumb)), r.id);
    } catch {
      upd.run(-1, r.id);
    }
  }
  if (rows.length) console.log(`[images] photo focus for ${rows.length} image(s)`);
}

export const imagePath = (file: string) => path.join(IMAGES_DIR, file);

/** Downscaled JPEG for sending to Claude (keeps requests small). */
export async function imageForModel(file: string): Promise<string> {
  const buf = await sharp(imagePath(file)).resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return buf.toString("base64");
}

/** Remove files from disk once no image row points at them anymore. */
export function cleanupFiles(rows: Pick<ImageRow, "file" | "thumb">[]) {
  for (const r of rows) {
    if (fileStillReferenced(r.file)) continue;
    fs.rmSync(path.join(IMAGES_DIR, r.file), { force: true });
    fs.rmSync(path.join(THUMBS_DIR, r.thumb), { force: true });
  }
}
