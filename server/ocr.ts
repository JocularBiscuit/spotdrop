import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BIN_DIR, ROOT } from "./config.ts";

const run = promisify(execFile);

export interface OcrLine {
  text: string;
  confidence: number;
  /** Relative text height (0-1). Big text in a screenshot is often the venue name. */
  h: number;
  y: number;
}

export type OcrEngine = "apple-vision" | "tesseract" | "none";

const SWIFT_SRC = path.join(ROOT, "server", "ocr", "vision-ocr.swift");
const VISION_BIN = path.join(BIN_DIR, "vision-ocr");

let engine: Promise<OcrEngine> | null = null;

async function hasCommand(cmd: string, args: string[]) {
  try {
    await run(cmd, args, { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/** Pick the best OCR engine once: Apple Vision on macOS (compiled on first run), else Tesseract. */
export function detectOcrEngine(): Promise<OcrEngine> {
  engine ??= pickEngine();
  return engine;
}

async function pickEngine(): Promise<OcrEngine> {
  if (process.platform === "darwin") {
    const stale = !fs.existsSync(VISION_BIN) || fs.statSync(VISION_BIN).mtimeMs < fs.statSync(SWIFT_SRC).mtimeMs;
    if (stale) {
      try {
        console.log("[ocr] compiling Apple Vision helper (one-time, ~20s)…");
        await run("swiftc", ["-O", SWIFT_SRC, "-o", VISION_BIN], { timeout: 180000 });
      } catch (e) {
        console.warn("[ocr] could not compile Vision helper:", (e as Error).message.split("\n")[0]);
      }
    }
    if (fs.existsSync(VISION_BIN)) return "apple-vision";
  }
  if (await hasCommand("tesseract", ["--version"])) return "tesseract";
  return "none";
}

export async function ocrImage(file: string): Promise<{ text: string; lines: OcrLine[] }> {
  const eng = await detectOcrEngine();
  if (eng === "apple-vision") {
    const { stdout } = await run(VISION_BIN, [file], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    const raw = JSON.parse(stdout) as { text: string; confidence: number; h: number; y: number }[];
    const lines = raw.map((l) => ({ text: l.text, confidence: l.confidence, h: l.h, y: l.y }));
    return { text: lines.map((l) => l.text).join("\n"), lines };
  }
  if (eng === "tesseract") {
    const langs = process.env.TESSERACT_LANGS ?? "eng";
    const { stdout } = await run("tesseract", [file, "stdout", "-l", langs, "--psm", "11"], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length > 1)
      .map((text, i) => ({ text, confidence: 0.7, h: 0, y: i }));
    return { text: lines.map((l) => l.text).join("\n"), lines };
  }
  return { text: "", lines: [] };
}

/** Rough measure of how much useful text OCR found (ignores UI chrome like "Follow", "Like"). */
export function ocrSignal(text: string): number {
  const UI_NOISE = /^(follow|following|like|likes|reply|share|send|save|more|comments?|views?|for you|explore|reels?|home|search|\d+[.,]?\d*[kKmM]?|\d{1,2}:\d{2})$/i;
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !UI_NOISE.test(l))
    .join(" ").length;
}

/** Format lines for the model, marking large text which is likely a title / venue name. */
export function formatOcrForModel(lines: OcrLine[]): string {
  if (!lines.length) return "(no text found)";
  const heights = lines.map((l) => l.h).filter((h) => h > 0).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  return lines
    .map((l) => {
      const big = median > 0 && l.h > median * 1.6 ? "[LARGE] " : "";
      const low = l.confidence < 0.4 ? " [low confidence]" : "";
      return `${big}${l.text}${low}`;
    })
    .join("\n");
}
