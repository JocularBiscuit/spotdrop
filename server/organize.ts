// The AI organizer: looks at the whole library (text only — names, categories, tags, short summaries)
// and evolves its structure: new categories when enough items share a theme, moves items into better
// categories, merges near-duplicate tags, sharpens custom category descriptions so future sorting improves.
// Runs automatically as the library grows and on demand. Never touches anything the user sorted by hand.
import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./usage.ts";
import { apiKey, getSettings } from "./config.ts";
import { createCategory, db, getMeta, setMeta, getCategory, listCategories, listSpots, now, newId, updateCategory, updateSpot } from "./db.ts";
import { TEMPLATES, type Template } from "../shared/vocab.ts";
import { correctionDigest, getRules, setRules } from "./learn.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS organizer_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes TEXT NOT NULL DEFAULT '{}'
);
`);

export { getMeta, setMeta };

/** Run automatically after this many newly AI-sorted items. */
const AUTO_EVERY = 20;
let running: Promise<OrganizeResult> | null = null;

export interface OrganizeResult {
  summary: string;
  newCategories: string[];
  moved: number;
  tagsMerged: number;
  descriptionsUpdated: number;
  typed: number;
}

/** Called by the pipeline after items were sorted; kicks off a background run when enough is new. */
export function noteProcessed(n: number) {
  const count = Number(getMeta("items_since_organize") ?? 0) + n;
  setMeta("items_since_organize", String(count));
  if (count >= AUTO_EVERY && getSettings().autoOrganize && apiKey() && !running) {
    organize("auto").catch((e) => console.warn("[organize]", (e as Error).message));
  }
}

export function organizerLog(limit = 20) {
  return (db.prepare("SELECT * FROM organizer_log ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, string>[]).map((r) => ({
    ...r,
    changes: JSON.parse(r.changes),
  }));
}

export const organizerStatus = () => ({ running: Boolean(running), sinceLast: Number(getMeta("items_since_organize") ?? 0), every: AUTO_EVERY });

const TOOL: Anthropic.Beta.BetaTool = {
  name: "apply_reorganization",
  description: "Apply the library improvements. Call exactly once. Empty arrays are fine when the library is already well organized.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["new_categories", "moves", "tag_merges", "description_updates", "type_updates", "rules", "summary"],
    properties: {
      new_categories: {
        type: "array",
        description: "At most 3. Only when ≥5 items clearly share a theme that existing categories don't capture well (e.g. many skincare products sitting in Shopping, many gym posts in Misc).",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "name", "emoji", "template", "description"],
          properties: {
            key: { type: "string", description: "Short temporary key you use in moves, e.g. 'new_skincare'." },
            name: { type: "string", description: "Short category name, e.g. 'Skincare & Beauty'." },
            emoji: { type: "string" },
            template: { type: "string", enum: Object.keys(TEMPLATES) },
            description: { type: "string", description: "What belongs here — used to sort future screenshots." },
          },
        },
      },
      moves: {
        type: "array",
        description: "Items that clearly belong in a different (existing or new) category. Never move locked items.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item", "to"],
          properties: {
            item: { type: "integer", description: "Item number from the list." },
            to: { type: "string", description: "Existing category id or a new category key." },
          },
        },
      },
      tag_merges: {
        type: "array",
        description: "Near-duplicate tags to unify, e.g. ['skin care','skincare'] → 'skincare'. Only obvious synonyms/spelling variants.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to"],
          properties: { from: { type: "array", items: { type: "string" } }, to: { type: "string" } },
        },
      },
      description_updates: {
        type: "array",
        description: "Sharper descriptions for user-created categories (only those marked custom), based on what they actually contain.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "description"],
          properties: { id: { type: "string" }, description: { type: "string" } },
        },
      },
      type_updates: {
        type: "array",
        description: "Give every non-food item marked [no type] a type within its category, and fix inconsistent ones. Per category use a small, consistent set (3-10 types, 1-2 lowercase words), e.g. shopping: skincare, clothing, concept store, second hand; places: hike, museum, viewpoint. Food & drink items never get a type.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item", "type"],
          properties: { item: { type: "integer" }, type: { type: "string" } },
        },
      },
      rules: {
        type: "array",
        description: "The complete, updated list of short house rules (max 15) that capture patterns in the user's corrections, e.g. 'Drugstore products → Skincare & Beauty', 'TikTok \"top X spots\" posts: add every place'. Keep good existing AI rules, drop ones the corrections contradict. Never repeat or edit the user's own rules (listed separately). Empty if no clear patterns yet.",
        items: { type: "string" },
      },
      summary: { type: "string", description: "One or two sentences for the user describing what changed and why (or that nothing needed changing)." },
    },
  } as Anthropic.Beta.BetaTool.InputSchema,
};

const SYSTEM = `You are the librarian of someone's screenshot library (food spots, places, events, accounts, tech, shopping, ideas…). Their home city is {HOME}; finding great food spots and things to do there matters most.

You get every category (with item counts) and a compact list of every item. Improve the structure conservatively:
- Create a new category only when at least 5 items clearly share a theme that is badly served today, and it will keep being useful. Max 3 per run. Prefer specific, useful categories over vague ones.
- Move items that are clearly mis-sorted, especially out of Misc. Don't shuffle items between two reasonable options.
- Items marked [locked] were sorted by the user: never move them.
- Merge only obvious duplicate tags.
- Look at the user's recent corrections and keep the house rules up to date, so future screenshots get sorted the way the user wants.
- Give every item marked [no type] a type (see type_updates); keep each category's set of types small and consistent.
- Changes are applied automatically, so when in doubt, leave it.
Finish by calling apply_reorganization exactly once.`;

export function organize(trigger: "auto" | "manual"): Promise<OrganizeResult> {
  if (running) return running;
  running = run(trigger).finally(() => {
    running = null;
  });
  return running;
}

async function run(trigger: "auto" | "manual"): Promise<OrganizeResult> {
  if (!apiKey()) throw new Error("Add an Anthropic API key in Settings first.");
  const settings = getSettings();
  const categories = listCategories();
  const spots = listSpots().filter((s) => s.status === "ready");
  const counts = new Map<string, number>();
  for (const s of spots) counts.set(String(s.category), (counts.get(String(s.category)) ?? 0) + 1);

  const catLines = categories
    .map((c) => `- ${c.id} (${c.builtin ? "built-in" : "custom"}, ${counts.get(c.id) ?? 0} items, fields: ${c.template}): ${c.name} — ${c.description}`)
    .join("\n");
  const clip = (t: unknown, n: number) => String(t ?? "").replace(/\s+/g, " ").slice(0, n);
  const itemLines = spots
    .map((s, i) => {
      const locked = ((s.user_fields as string[]) ?? []).includes("category") ? " [locked]" : "";
      const tags = [...(s.tags as string[]), ...(s.cuisines as string[])].slice(0, 6).join(",");
      const isFood = categories.find((c) => c.id === s.category)?.template === "food";
      const type = isFood ? "" : s.activity_type ? ` {type: ${s.activity_type}}` : " [no type]";
      return `${i}. [${s.category}]${locked}${type} ${clip(s.name, 60)} | ${tags} | ${clip(s.description, 90)}`;
    })
    .join("\n");

  const client = new Anthropic({ apiKey: apiKey() });
  const rules = getRules();
  const digest = correctionDigest();
  const learning = [
    rules.length ? `Current house rules:\n${rules.map((r) => `- [${r.source === "user" ? "user's own — keep as is" : "ai"}] ${r.text}`).join("\n")}` : "No house rules yet.",
    digest ? `Recent corrections by the user (the AI's guess → what the user wanted):\n${digest}` : "No corrections yet.",
  ].join("\n\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Categories:\n${catLines}\n\nItems:\n${itemLines}\n\n${learning}\n\nImprove the organization, update the house rules, and call apply_reorganization.` },
  ];
  let input: Record<string, unknown> | null = null;
  for (let turn = 0; turn < 3 && !input; turn++) {
    const response = await client.beta.messages.create({
      model: settings.model,
      max_tokens: 16000,
      system: SYSTEM.replace("{HOME}", settings.homeCity || "unknown"),
      tools: [TOOL],
      tool_choice: { type: "auto" },
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    recordUsage("organize", response);
    if (response.stop_reason === "refusal") throw new Error("Claude declined the reorganization.");
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL.name);
    if (call) input = call.input as Record<string, unknown>;
    else {
      messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      messages.push({ role: "user", content: "Now call apply_reorganization." });
    }
  }
  if (!input) throw new Error("The organizer returned no result.");
  const result = apply(input, spots, trigger);
  setMeta("items_since_organize", "0");
  return result;
}

type Item = ReturnType<typeof listSpots>[number];

function apply(input: Record<string, unknown>, spots: Item[], trigger: string): OrganizeResult {
  const newCats = (Array.isArray(input.new_categories) ? input.new_categories : []).slice(0, 3) as { key: string; name: string; emoji: string; template: string; description: string }[];
  const moves = (Array.isArray(input.moves) ? input.moves : []).slice(0, 300) as { item: number; to: string }[];

  // Only create categories that actually receive enough items.
  const keyToId = new Map<string, string>();
  const created: string[] = [];
  for (const c of newCats) {
    const incoming = moves.filter((m) => m.to === c.key && spots[m.item]).length;
    if (incoming < 4 || !c.name?.trim()) continue;
    const existing = listCategories().find((x) => x.name.toLowerCase() === c.name.trim().toLowerCase());
    const cat = existing ?? createCategory({ name: c.name.trim(), emoji: c.emoji || "📁", template: (c.template in TEMPLATES ? c.template : "generic") as Template, description: c.description ?? "", color: "#6366f1" });
    keyToId.set(c.key, cat.id);
    if (!existing) created.push(`${cat.emoji} ${cat.name}`);
  }

  let moved = 0;
  const moveLog: string[] = [];
  for (const m of moves) {
    const s = spots[m.item];
    if (!s) continue;
    if (((s.user_fields as string[]) ?? []).includes("category")) continue; // user decided
    const target = keyToId.get(m.to) ?? (getCategory(m.to) ? m.to : null);
    if (!target || target === s.category) continue;
    const tpl = getCategory(target)!.template;
    updateSpot(s.id, { category: target, kind: tpl === "food" ? (s.kind === "food" ? "food" : "place") : tpl === "place" ? "activity" : "other" });
    moved++;
    if (moveLog.length < 40) moveLog.push(`${s.name} → ${getCategory(target)!.name}`);
  }

  // Tag merges across the whole library.
  let tagsMerged = 0;
  const merges = (Array.isArray(input.tag_merges) ? input.tag_merges : []) as { from: string[]; to: string }[];
  if (merges.length) {
    const map = new Map<string, string>();
    for (const m of merges) for (const f of m.from ?? []) if (f && m.to && f.toLowerCase() !== m.to.toLowerCase()) map.set(f.toLowerCase(), m.to.toLowerCase());
    for (const s of listSpots()) {
      const tags = s.tags as string[];
      if (!tags.some((t) => map.has(t.toLowerCase()))) continue;
      updateSpot(s.id, { tags: [...new Set(tags.map((t) => map.get(t.toLowerCase()) ?? t))] });
      tagsMerged++;
    }
  }

  let descriptionsUpdated = 0;
  for (const d of (Array.isArray(input.description_updates) ? input.description_updates : []) as { id: string; description: string }[]) {
    const c = getCategory(d.id);
    if (c && !c.builtin && d.description?.trim()) {
      updateCategory(c.id, { description: d.description.trim() });
      descriptionsUpdated++;
    }
  }

  // House rules: AI rules are replaced by the new list, the user's own rules always stay.
  if (Array.isArray(input.rules)) {
    const userRules = getRules().filter((r) => r.source === "user");
    const aiRules = (input.rules as unknown[]).map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, 15);
    setRules([...userRules, ...aiRules.filter((t) => !userRules.some((u) => u.text === t)).map((text) => ({ text, source: "ai" as const }))]);
  }

  // Types within categories (the quick-filter "Type" row).
  let typed = 0;
  for (const t of (Array.isArray(input.type_updates) ? input.type_updates : []) as { item: number; type: string }[]) {
    const s = spots[t.item];
    const type = String(t.type ?? "").trim().toLowerCase().slice(0, 40);
    if (!s || !type || ((s.user_fields as string[]) ?? []).includes("activity_type")) continue;
    if (getCategory(String(s.category))?.template === "food") continue;
    updateSpot(s.id, { activity_type: type });
    typed++;
  }

  const summary = String(input.summary ?? "").trim() || (moved || created.length ? "Reorganized the library." : "Everything already looked well organized.");
  const result = { summary, newCategories: created, moved, tagsMerged, descriptionsUpdated, typed };
  db.prepare("INSERT INTO organizer_log (id, created_at, trigger, summary, changes) VALUES (?, ?, ?, ?, ?)").run(
    newId(), now(), trigger, summary, JSON.stringify({ ...result, moves: moveLog }),
  );
  console.log(`[organize] ${summary} (${moved} moved, ${created.length} new categories)`);
  return result;
}
