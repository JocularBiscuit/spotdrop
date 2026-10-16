// What the AI actually costs: every Claude call records its tokens and web searches per feature.
// Prices: platform.claude.com/docs/en/about-claude/pricing (USD, checked 2026-10-16).
import { db, newId, now } from "./db.ts";

db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, feature TEXT NOT NULL, model TEXT,
  input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
  searches INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0
)`);

/** USD per million tokens: input, output, cache write (5 min), cache read. */
export const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};
export const WEB_SEARCH_USD = 10 / 1000; // web fetch has no extra charge beyond tokens

export const FEATURES: Record<string, string> = {
  sort: "Sorting a screenshot",
  official: "Official description & opening hours",
  discover: "Discover feed scouts",
  discover_techno: "Techno scouts",
  find_places: "Find new places",
  plan: "Plan an outing",
  ask: "Ask your library",
  organize: "AI organizer",
};

interface Usage {
  input_tokens?: number | null; output_tokens?: number | null;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export function costOf(model: string, u: Usage): number {
  const p = PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? "claude-opus-5-5"];
  return ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite + (u.cache_read_input_tokens ?? 0) * p.cacheRead) / 1e6
    + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

/** Call after every messages.create. Never throws: tracking must not break the feature. */
export function recordUsage(feature: string, res: { model?: string; usage?: Usage | null } | null | undefined) {
  try {
    const u = res?.usage;
    if (!u) return;
    const model = res?.model ?? "";
    db.prepare("INSERT INTO ai_usage (id, ts, feature, model, input, output, cache_read, cache_write, searches, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      newId(), now(), feature, model, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0,
      u.server_tool_use?.web_search_requests ?? 0, costOf(model, u),
    );
  } catch (e) {
    console.warn("[usage]", (e as Error).message);
  }
}

/** Spend per feature over the last `days` days. "runs" groups multi-turn calls loosely by counting calls. */
export function usageSummary(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db.prepare(`SELECT feature, COUNT(*) calls, SUM(input + cache_read + cache_write) input, SUM(output) output, SUM(searches) searches, SUM(cost) cost
                           FROM ai_usage WHERE ts >= ? GROUP BY feature ORDER BY cost DESC`).all(since) as { feature: string; calls: number; input: number; output: number; searches: number; cost: number }[];
  const total = rows.reduce((a, r) => a + r.cost, 0);
  return { days, total, features: rows.map((r) => ({ ...r, label: FEATURES[r.feature] ?? r.feature })) };
}
