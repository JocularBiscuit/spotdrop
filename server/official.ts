// "Official" one-liner for a place: the description from its Google Maps / Google Business listing or its
// own website, copied as written, plus the weekly opening hours. A small, focused web lookup, separate from
// sorting, so it always searches.
import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./usage.ts";
import { apiKey, getSettings } from "./config.ts";
import { db, getCategory, getSpot, updateSpot } from "./db.ts";

const TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_official",
  description: "Submit what you found. Call exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["found", "description", "source", "hours"],
    properties: {
      found: { type: "boolean", description: "true only if you found an official description text." },
      description: { type: "string", description: "The official short description copied as written, original language, max ~200 characters. Empty if not found." },
      source: { type: "string", description: "Where it is from: 'Google Maps', 'Website', 'Instagram bio', 'Tripadvisor', … Empty if not found." },
      hours: {
        type: "array",
        items: { type: "string" },
        description: "Regular opening hours, exactly 7 entries Monday..Sunday. Each: 24h ranges 'HH:MM-HH:MM', several separated by ', ' (e.g. '11:30-14:30, 17:30-22:00'); a close after midnight like '18:00-02:00'; 'closed' for closed days. Empty array if you couldn't find the hours.",
      },
    },
  } as Anthropic.Beta.BetaTool.InputSchema,
};

export function needsOfficial(id: string) {
  const s = getSpot(id);
  if (!s || !s.name || (s.official_description && s.opening_hours)) return false;
  const tpl = getCategory(String(s.category))?.template;
  return (tpl === "food" && s.kind !== "food") || tpl === "place" || (s.category === "shopping" && Boolean(s.address || s.city));
}

export async function fetchOfficial(id: string): Promise<boolean> {
  const s = getSpot(id);
  if (!s || !apiKey()) return false;
  const where = [s.address, s.neighborhood, s.city, s.country].filter(Boolean).join(", ");
  const client = new Anthropic({ apiKey: apiKey() });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{
    role: "user",
    content: `Find the short official description of this place, exactly as the business presents itself:
Name: ${s.name}
Location: ${where || "unknown"}
${s.website ? `Website: ${s.website}` : ""}

1. Official description. Look for (in this order): the description on its Google Maps / Google Business listing (often shown in search results), the meta description or "about" line of its own website, its Instagram bio. Copy the text as written, in its original language (often German), max ~200 characters. Do not write your own description; if you can't find official text, say found=false.
2. Regular weekly opening hours (Google Maps listing or the website), Monday to Sunday. Leave hours empty if you can't find them; don't guess.
Then call submit_official.`,
  }];
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    TOOL,
    { type: "web_search_20260209", name: "web_search", max_uses: 3 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 },
  ];
  for (let turn = 0; turn < 4; turn++) {
    const r = await client.beta.messages.create({
      model: getSettings().model,
      max_tokens: 4000,
      tools,
      tool_choice: { type: "auto" },
      messages,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    recordUsage("official", r);
    if (r.stop_reason === "refusal") return false;
    const call = r.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL.name);
    if (call) {
      const out = call.input as { found: boolean; description: string; source: string; hours?: string[] };
      const text = out.description?.trim();
      const hours = cleanHours(out.hours);
      // Never overwrite a description that's already there (it may have been edited by hand).
      const patch: Record<string, unknown> = { opening_hours: hours };
      if (!s.official_description && out.found && text) Object.assign(patch, { official_description: text.slice(0, 300), official_source: out.source?.trim() || null });
      updateSpot(id, patch);
      return Boolean(out.found && text) || hours.length > 0;
    }
    messages.push({ role: "assistant", content: r.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (r.stop_reason !== "pause_turn") messages.push({ role: "user", content: "Now call submit_official." });
  }
  return false;
}

/** 7 valid day entries, or [] (= looked up, unknown). */
function cleanHours(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== 7) return [];
  const day = (v: unknown) => {
    const t = String(v ?? "").trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s*-\s*/g, "-");
    if (/^(closed|geschlossen|ruhetag)$/.test(t)) return "closed";
    const ranges = t.split(/\s*[,;/]\s*/).map((r) => r.replace(/(\d{1,2})[.:](\d{2})/g, (_m, h, m) => `${h.padStart(2, "0")}:${m}`)).filter((r) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(r));
    return ranges.join(", ");
  };
  const days = raw.map(day);
  return days.some((d) => d && d !== "closed") ? days : [];
}

// Background queue (one at a time), so bulk backfills don't hammer the API.
const queue: string[] = [];
let running = false;
export const officialQueueSize = () => queue.length + (running ? 1 : 0);

export function queueOfficial(ids: string[]) {
  for (const id of ids) if (!queue.includes(id)) queue.push(id);
  if (running) return;
  running = true;
  (async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await fetchOfficial(id);
      } catch (e) {
        console.warn("[official]", (e as Error).message.slice(0, 160));
      }
    }
    running = false;
  })();
}

export function missingOfficial(): string[] {
  const rows = db.prepare("SELECT id FROM spots WHERE status = 'ready' AND (official_description IS NULL OR official_description = '' OR opening_hours IS NULL)").all() as { id: string }[];
  return rows.map((r) => r.id).filter(needsOfficial);
}
