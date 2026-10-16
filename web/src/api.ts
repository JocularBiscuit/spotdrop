import type { CategoryDef } from "../../shared/vocab.ts";

export interface SpotImage {
  id: string;
  file: string;
  thumb: string;
  width: number | null;
  height: number | null;
  ocr_text: string | null;
  original_name: string | null;
  /** Vertical center (0-1) of the photo in the screenshot; -1/null = none (crop centered). */
  focus_y?: number | null;
}

/** object-position that centers a screenshot's photo in a box of the given aspect ratio (width / height). */
export function focusPosition(img: SpotImage | undefined, boxAspect: number): string {
  const f = img?.focus_y;
  if (f == null || f < 0 || !img?.width || !img.height) return "50% 50%";
  const h = img.height / img.width; // image height when the box is 1 wide
  const box = 1 / boxAspect;
  if (h <= box) return "50% 50%";
  const p = Math.min(Math.max((f * h - box / 2) / (h - box), 0), 1);
  return `50% ${Math.round(p * 100)}%`;
}

export interface Spot {
  id: string;
  kind: "place" | "food" | "activity" | "other";
  category: string;
  collections: string[];
  name: string;
  status: "queued" | "ocr" | "analyzing" | "ready" | "error";
  status_detail: string | null;
  needs_review: boolean;
  city: string | null;
  country: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  meals: string[];
  venue_types: string[];
  cuisines: string[];
  dishes: string[];
  drinks: string[];
  service: string[];
  activity_type: string | null;
  price: number | null;
  specialness: number | null;
  specialness_reason: string | null;
  description: string | null;
  website: string | null;
  maps_url: string | null;
  instagram: string | null;
  source_platform: string | null;
  source_handle: string | null;
  notes: string | null;
  tags: string[];
  key_points: string[];
  content: string | null;
  handle: string | null;
  platform: string | null;
  user_fields: string[];
  /** Sorted locally only; the AI step hasn't run (no key) or failed. */
  ai_pending: boolean;
  date_start: string | null;
  date_end: string | null;
  event_time: string | null;
  neighborhood: string | null;
  captured_at: string | null;
  visited: boolean;
  favorite: boolean;
  official_description: string | null;
  official_source: string | null;
  /** 7 strings Mon..Sun, [] = looked up but unknown, null = not looked up yet */
  opening_hours: string[] | null;
  last_viewed_at: string | null;
  review_reason: string | null;
  confidence: number | null;
  duplicate_of: string | null;
  researched: boolean;
  created_at: string;
  updated_at: string;
  images: SpotImage[];
}

export interface Status {
  ocrEngine: "apple-vision" | "tesseract" | "none";
  settings: PublicSettings;
}

export interface PublicSettings {
  model: string;
  models: string[];
  autoResearch: boolean;
  imageFallback: boolean;
  homeCity: string;
  autoOrganize: boolean;
  hasKey: boolean;
  keySource: "settings" | "env" | null;
  keyPreview: string | null;
}

export interface Category extends CategoryDef {
  builtin: boolean;
  sort: number;
}

export interface Collection {
  id: string;
  name: string;
  emoji: string;
  created_at: string;
}

export interface OrganizeResult { summary: string; newCategories: string[]; moved: number; tagsMerged: number; descriptionsUpdated: number; typed?: number }
export interface OrganizerInfo {
  running: boolean;
  sinceLast: number;
  every: number;
  log: { id: string; created_at: string; trigger: string; summary: string; changes: OrganizeResult & { moves: string[] } }[];
}

export interface Rule { text: string; source: "ai" | "user" }
export interface Learning { rules: Rule[]; corrections: number; terms: number }

export interface DiscoverItem {
  id: string;
  title: string;
  topic: string;
  kind: "event" | "place" | "popup";
  description: string | null;
  why: string | null;
  date_start: string | null;
  date_end: string | null;
  event_time: string | null;
  venue: string | null;
  address: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  url: string | null;
  source: string | null;
  price: string | null;
  score: number | null;
  status: "new" | "liked" | "disliked" | "hidden" | "saved";
  spot_id: string | null;
  /** Local copy of the source page's preview picture ('none' = source had none). */
  image: string | null;
  /** Techno sub-genres (keys of DiscoverData.genres). */
  genres: string[];
  collective: string | null;
  /** Set for "Find places" results. */
  search_id?: string | null;
  search_category?: string | null;
  created_at: string;
}
export interface FinderState { running: boolean; search_id: string | null; label: string | null; error: string | null; added: number }
export interface FindQuery {
  category: string; text?: string; venues?: string[]; cuisines?: string[]; meals?: string[]; drinks?: string[]; service?: string[];
  areas?: string[]; types?: string[]; price?: number | null;
}
export interface DiscoverRun {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  added: number;
  lanes: { key: string; label: string; state: "waiting" | "running" | "done" | "error"; found: number; error?: string }[];
}
export interface DiscoverData {
  items: DiscoverItem[];
  state: DiscoverRun;
  prefs: string;
  accounts: string[];
  taste: Record<string, string[]>;
  topics: Record<string, { label: string; emoji: string }>;
  genres: Record<string, string>;
  found: DiscoverItem[];
  finder: FinderState;
}

export interface PlanStop { ref: string; time: string | null; reason: string }
export interface Plan { title: string; summary: string; mode: "foot" | "bike"; stops: PlanStop[] }
export interface RouteResult { geometry: GeoJSON.LineString; distance: number; duration: number; legs: { distance: number; duration: number }[] }

export interface UsageSummary {
  days: number;
  total: number;
  features: { feature: string; label: string; calls: number; input: number; output: number; searches: number; cost: number }[];
}

export interface MobileInfo {
  inbox: { available: boolean; path: string; imported: number; last: string | null };
  snapshot: { configured: boolean; publishing: boolean; url: string | null; last_published: string | null; last_error: string | null; pending: boolean };
  cf: { accountId: string; hasToken: boolean; hasPassphrase: boolean; project: string };
}

export type BulkAction = "category" | "add_collection" | "remove_collection" | "reviewed" | "analyze" | "delete";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  status: () => req<Status>("/api/status"),
  saveSettings: (s: Partial<PublicSettings> & { anthropicApiKey?: string }) => req<PublicSettings>("/api/settings", json("PUT", s)),
  spots: () => req<Spot[]>("/api/spots"),
  upload: (files: File[], collection?: string | null) => {
    const fd = new FormData();
    if (collection) fd.append("collection", collection);
    files.forEach((f) => {
      fd.append("modified", String(f.lastModified || ""));
      fd.append("files", f, f.name);
    });
    return req<{ spots: Spot[]; failed: string[]; skipped: string[] }>("/api/upload", { method: "POST", body: fd });
  },
  addImages: (id: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    return req<Spot>(`/api/spots/${id}/images`, { method: "POST", body: fd });
  },
  removeImage: (id: string, imageId: string) => req<Spot>(`/api/spots/${id}/images/${imageId}`, { method: "DELETE" }),
  create: (fields: Partial<Spot>) => req<Spot>("/api/spots", json("POST", fields)),
  update: (id: string, fields: Partial<Spot>) => req<Spot>(`/api/spots/${id}`, json("PATCH", fields)),
  remove: (id: string) => req<{ ok: true }>(`/api/spots/${id}`, { method: "DELETE" }),
  analyze: (id: string, opts: { useImage?: boolean; research?: boolean; instruction?: string }) => req<Spot>(`/api/spots/${id}/analyze`, json("POST", opts)),
  merge: (id: string, into: string) => req<Spot>(`/api/spots/${id}/merge`, json("POST", { into })),
  notDuplicate: (id: string) => req<Spot>(`/api/spots/${id}/not-duplicate`, json("POST", {})),
  library: () => req<{ categories: Category[]; collections: Collection[] }>("/api/library"),
  createCategory: (c: Partial<CategoryDef>) => req<Category>("/api/categories", json("POST", c)),
  updateCategory: (id: string, c: Partial<CategoryDef>) => req<Category>(`/api/categories/${id}`, json("PATCH", c)),
  deleteCategory: (id: string) => req<{ ok: true }>(`/api/categories/${id}`, { method: "DELETE" }),
  createCollection: (c: { name: string; emoji?: string }) => req<Collection>("/api/collections", json("POST", c)),
  updateCollection: (id: string, c: { name?: string; emoji?: string }) => req<Collection>(`/api/collections/${id}`, json("PATCH", c)),
  deleteCollection: (id: string) => req<{ ok: true }>(`/api/collections/${id}`, { method: "DELETE" }),
  viewed: (id: string) => req<{ ok: true }>(`/api/spots/${id}/viewed`, { method: "POST" }),
  ask: (question: string) => req<{ answer: string; picks: { id: string; reason: string }[] }>("/api/ask", json("POST", { question })),
  splitImage: (id: string, imageId: string) => req<{ original: Spot; created: Spot }>(`/api/spots/${id}/images/${imageId}/split`, { method: "POST" }),
  learning: () => req<Learning>("/api/learning"),
  saveRules: (rules: Rule[]) => req<Learning>("/api/learning/rules", json("PUT", { rules })),
  official: () => req<{ missing: number; queued: number }>("/api/official"),
  fetchOfficial: (ids?: string[]) => req<{ queued: number }>("/api/official", json("POST", ids ? { ids } : {})),
  discover: () => req<DiscoverData>("/api/discover"),
  refreshDiscover: (only?: "techno") => req<DiscoverRun>("/api/discover/refresh", json("POST", only ? { only } : {})),
  findPlaces: (q: FindQuery) => req<FinderState>("/api/discover/find", json("POST", q)),
  found: () => req<{ finder: FinderState; found: DiscoverItem[] }>("/api/discover/find"),
  discoverSettings: (b: { prefs?: string; accounts?: string[] }) => req<{ prefs: string; accounts: string[] }>("/api/discover/settings", json("PUT", b)),
  discoverStatus: (id: string, status: DiscoverItem["status"]) => req<{ ok: true }>(`/api/discover/${id}`, json("PATCH", { status })),
  saveDiscover: (id: string) => req<Spot>(`/api/discover/${id}/save`, { method: "POST" }),
  plan: (request: string) => req<Plan>("/api/plan", json("POST", { request })),
  route: (mode: "foot" | "bike", points: [number, number][]) => req<RouteResult>("/api/route", json("POST", { mode, points })),
  usage: (days = 30) => req<UsageSummary>(`/api/usage?days=${days}`),
  mobile: () => req<MobileInfo>("/api/mobile"),
  saveMobile: (b: { cfAccountId?: string; cfApiToken?: string; snapshotPassphrase?: string }) => req<{ ok: true }>("/api/mobile", json("PUT", b)),
  publishMobile: () => req<MobileInfo["snapshot"]>("/api/mobile/publish", { method: "POST" }),
  openInbox: () => req<{ ok: true }>("/api/mobile/open-inbox", { method: "POST" }),
  quit: () => req<{ ok: true }>("/api/quit", { method: "POST" }),
  organizer: () => req<OrganizerInfo>("/api/organize"),
  organize: () => req<OrganizeResult>("/api/organize", { method: "POST" }),
  bulk: (ids: string[], action: BulkAction, value?: string) => req<{ ok: true; count: number }>("/api/bulk", json("POST", { ids, action, value })),
};

/** MIME type used when dragging cards onto categories / collections. */
export const DRAG_MIME = "application/x-spotdrop-ids";

export const thumbUrl = (img: SpotImage) => `/media/thumbs/${img.thumb}`;
export const imageUrl = (img: SpotImage) => `/media/images/${img.file}`;
export const isProcessing = (s: Spot) => s.status === "queued" || s.status === "ocr" || s.status === "analyzing";

export const IMAGE_TYPES = /^image\/|\.(heic|heif|png|jpe?g|webp|gif|tiff?)$/i;
export const imageFiles = (list: FileList | File[] | null | undefined) =>
  Array.from(list ?? []).filter((f) => IMAGE_TYPES.test(f.type) || IMAGE_TYPES.test(f.name));
