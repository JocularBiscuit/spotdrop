import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const DATA_DIR = path.resolve(process.env.SPOTDROP_DATA ?? path.join(ROOT, "data"));
export const IMAGES_DIR = path.join(DATA_DIR, "images");
export const THUMBS_DIR = path.join(DATA_DIR, "thumbs");
export const BIN_DIR = path.join(DATA_DIR, "bin");
export const WEB_DIST = path.join(ROOT, "web", "dist");
export const PORT = Number(process.env.PORT ?? 5280);
export const HOST = process.env.HOST ?? "127.0.0.1";

for (const dir of [DATA_DIR, IMAGES_DIR, THUMBS_DIR, BIN_DIR]) fs.mkdirSync(dir, { recursive: true });

export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type Model = (typeof MODELS)[number];

export interface Settings {
  anthropicApiKey: string;
  model: Model;
  /** Look the spot up on the web (Claude web search). Only text is sent, never the image. */
  autoResearch: boolean;
  /** When local OCR finds (almost) no text, allow sending the screenshot to Claude. */
  imageFallback: boolean;
  /** Where the user lives: ambiguous or local-language posts are assumed to be here. */
  homeCity: string;
  /** Let the AI organizer evolve categories/tags automatically as the library grows. */
  autoOrganize: boolean;
  /** Phone snapshot on Cloudflare Pages (encrypted with the passphrase before upload). */
  cfAccountId: string;
  cfApiToken: string;
  cfProject: string;
  snapshotPassphrase: string;
}

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const DEFAULTS: Settings = {
  anthropicApiKey: "",
  model: "claude-opus-5-5",
  autoResearch: true,
  imageFallback: true,
  homeCity: "Munich",
  autoOrganize: true,
  cfAccountId: "",
  cfApiToken: "",
  cfProject: "",
  snapshotPassphrase: "",
};

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    // first run
  }
  cached = { ...DEFAULTS, ...stored };
  if (!MODELS.includes(cached.model)) cached.model = DEFAULTS.model;
  return cached;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  cached = next;
  return next;
}

/** Key from settings, else from the environment (ANTHROPIC_API_KEY). */
export function apiKey(): string {
  return getSettings().anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
}
