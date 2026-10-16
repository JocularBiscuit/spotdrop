import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./usage.ts";
import { apiKey, getSettings } from "./config.ts";
import { getMeta, setMeta } from "./db.ts";
import { DRINKS, MEALS, PLATFORMS, SERVICE, VENUES, type Template } from "../shared/vocab.ts";

export interface ExtractedItem {
  category: string;
  kind: "place" | "food" | "activity" | "other";
  name: string;
  description: string;
  key_points: string[];
  content: string | null;
  tags: string[];
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
  specialness: number;
  specialness_reason: string;
  website: string | null;
  maps_url: string | null;
  instagram: string | null;
  handle: string | null;
  platform: string | null;
  source_platform: string | null;
  source_handle: string | null;
  date_start: string | null;
  date_end: string | null;
  event_time: string | null;
  neighborhood: string | null;
  unsure_about: string | null;
  official_description: string | null;
  official_source: string | null;
  confidence: number;
}

export interface CategoryInfo {
  id: string;
  name: string;
  template: Template;
  description: string;
  builtin: boolean;
}

export interface AnalyzeInput {
  ocrText: string;
  imagesB64: string[];
  research: boolean;
  categories: CategoryInfo[];
  homeCity: string;
  /** House rules learned from the user's corrections (or written by them). */
  rules?: string[];
  /** Similar past corrections by this user. */
  examples?: string[];
  /** The user's own instruction for this screenshot; overrides everything else. */
  instruction?: string;
  /** Types already used per category, so the model reuses them. */
  types?: Record<string, string[]>;
  /** When the screenshot was taken (ISO). Anchors relative dates like "this Saturday". */
  capturedAt: string | null;
  /** Fields the user already confirmed or typed (take precedence over OCR). */
  hints?: Record<string, unknown>;
}

const str = { type: "string" };
const nullableStr = { type: ["string", "null"] };
const nullableNum = { type: ["number", "null"] };
const strArray = { type: "array", items: str };
const enumArray = (values: object) => ({ type: "array", items: { type: "string", enum: Object.keys(values) } });

function itemSchema(categoryIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "category", "kind", "name", "description", "key_points", "content", "tags",
      "city", "country", "address", "lat", "lng", "meals", "venue_types", "cuisines", "dishes", "drinks", "service",
      "activity_type", "price", "specialness", "specialness_reason", "website", "maps_url", "instagram",
      "handle", "platform", "source_platform", "source_handle", "date_start", "date_end", "event_time", "neighborhood", "unsure_about", "official_description", "official_source", "confidence",
    ],
    properties: {
      category: { type: "string", enum: categoryIds, description: "The single best-fitting library category (see the category list in the instructions)." },
      kind: { type: "string", enum: ["place", "food", "activity", "other"], description: "place = a specific venue; food = a dish / food idea without an identifiable venue; activity = a thing to do / sight; other = everything that is not a place, dish or activity." },
      name: { ...str, description: "Short, specific title. Venue / activity / dish name as officially written; for accounts the display name; for anything else a clear 3-8 word title of what the screenshot is about." },
      description: { ...str, description: "1-3 sentence summary: what it is and why it was worth saving." },
      key_points: { ...strArray, description: "Key takeaways, facts or steps (tech: core ideas; ideas: the points; recipes: ingredients with amounts; shopping: price/specs). Up to ~8 short items. Empty for simple venues." },
      content: { ...nullableStr, description: "Cleaned-up text worth keeping verbatim: a quote, a code snippet, a prompt, recipe steps, a list. Fix OCR errors, drop UI chrome. null if nothing worth keeping." },
      tags: { ...strArray, description: "3-6 lowercase topic tags for finding it later, e.g. 'python', 'productivity', 'running shoes', 'date night'. Prefer reusing existing tags style." },
      city: nullableStr,
      country: { ...nullableStr, description: "Country name in English." },
      address: { ...nullableStr, description: "Street address, only if found in the screenshot or verified via search." },
      lat: { ...nullableNum, description: "Only if verified from a reliable source; otherwise null." },
      lng: nullableNum,
      meals: { ...enumArray(MEALS), description: "Food & drink / recipes only: which meals / times of day." },
      venue_types: { ...enumArray(VENUES), description: "Food & drink venues only." },
      cuisines: { ...strArray, description: "Food only: cuisine / food style in lowercase English, e.g. 'japanese', 'neapolitan pizza', 'vegan'." },
      dishes: { ...strArray, description: "Food only: signature or shown dishes, e.g. 'tonkotsu ramen'." },
      drinks: { ...enumArray(DRINKS), description: "Food & drink only: drinks the place is known for." },
      service: { ...enumArray(SERVICE), description: "Venues only: dine_in = sit down, takeaway = to go." },
      activity_type: { ...nullableStr, description: "The item's TYPE within its category, 1-2 lowercase words, for every category except Food and Bars & Drinks (null there). Examples — places: museum, hike, viewpoint, beach, hotel; events: market, concert, pop-up, exhibition; shopping: clothing, skincare, furniture, gadgets, gift; tech: ai, devops, web dev, productivity app; ideas: quote, life tip, mindset; accounts: food creator, fitness, travel. Reuse an existing type from the list in the instructions whenever one fits." },
      price: { ...nullableNum, description: "Places / venues only: integer 0-4 (0 free … 4 very expensive). null otherwise or if unknown." },
      specialness: { type: "integer", description: "1-5. Venues & places: how special (1 nice to know … 3 worth a detour … 5 once in a lifetime). Everything else: how useful / interesting it looks (1 meh … 5 gem)." },
      specialness_reason: { ...str, description: "One short sentence justifying the rating." },
      website: { ...nullableStr, description: "Most useful link: venue website, product page, article, repo, profile URL." },
      maps_url: { ...nullableStr, description: "Google Maps URL for places, if found." },
      instagram: { ...nullableStr, description: "Instagram handle of the venue/brand, without @." },
      handle: { ...nullableStr, description: "Accounts only: the handle of the account the screenshot is about, without @." },
      platform: { ...nullableStr, description: `Accounts only: platform of that account, one of ${PLATFORMS.join(", ")}.` },
      source_platform: { ...nullableStr, description: "Where the screenshot was taken: instagram, tiktok, youtube, x, reddit, website, google_maps, other." },
      source_handle: { ...nullableStr, description: "Account that posted the content (creator), without @." },
      date_start: { ...nullableStr, description: "If the screenshot announces something on a specific date (event, pop-up, market, concert, opening, sale, deadline): that date as YYYY-MM-DD. Resolve relative dates ('this Saturday', '12.10.') against the screenshot date. null if no date." },
      date_end: { ...nullableStr, description: "Last day for multi-day things (YYYY-MM-DD), else null." },
      event_time: { ...nullableStr, description: "Time of day if given, e.g. '19:00' or '11–18 Uhr'. null otherwise." },
      neighborhood: { ...nullableStr, description: "City district / neighborhood if known, e.g. 'Schwabing', 'Glockenbachviertel', 'Maxvorstadt'." },
      official_description: { ...nullableStr, description: "Places, venues, shops and products only, and only if you found it via web search: the short description from an official source — the Google Maps / Google Business listing, or the venue's own website — copied as written, in its original language (often German), max ~180 characters. Never write your own; null if no official text was found." },
      official_source: { ...nullableStr, description: "Where official_description came from: 'Google Maps', 'Website', 'Instagram bio', … null if none." },
      unsure_about: { ...nullableStr, description: "Only if confidence < 0.6: in ≤10 words, what exactly you're unsure about, e.g. 'venue name not readable', 'which of two categories', 'not one specific place'. null otherwise." },
      confidence: { type: "number", description: "0-1: how sure you are that the CATEGORY and NAME are right. A venue clearly named in the screenshot is ≥0.8 even if you couldn't verify extra details online. Go below 0.6 only if the name is unreadable/guessed, the category is genuinely ambiguous, or it isn't one specific thing." },
    },
  };
}

function submitTool(categoryIds: string[], strict: boolean): Anthropic.Beta.BetaTool {
  return {
    name: "submit_items",
    description: "Submit the final structured result. Call exactly once when done.",
    strict,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          description: "Every distinct thing this screenshot is about. Usually one. A 'top 5 cafés in Lisbon' post yields several; a single tweet or article yields one.",
          items: itemSchema(categoryIds),
        },
      },
    } as Anthropic.Beta.BetaTool.InputSchema,
  };
}

const TEMPLATE_GUIDE: Record<Template, string> = {
  food: "fill meals, venue_types, cuisines, dishes, drinks, service, price and location",
  place: "fill activity_type (type), price and location",
  recipe: "fill cuisines, dishes, meals, key_points (ingredients) and content (steps)",
  account: "fill activity_type (type), handle, platform, website (profile URL) and tags (what they post about)",
  generic: "fill activity_type (type), description, key_points, content and tags; leave venue fields empty",
};

function systemPrompt(categories: CategoryInfo[], homeCity: string, types: Record<string, string[]>) {
  const typeList = Object.entries(types).filter(([, t]) => t.length).map(([c, t]) => `- ${c}: ${t.join(", ")}`).join("\n");
  const list = categories
    .map((c) => `- ${c.id}: ${c.name}${c.builtin ? "" : " (user-created, prefer it when it fits)"} — ${c.description || "no description"} → ${TEMPLATE_GUIDE[c.template]}`)
    .join("\n");
  return `You organise someone's screenshot library. They screenshot things on Instagram, TikTok, YouTube, X, Reddit, Google Maps and websites so they don't forget them — food spots, places, recipes, accounts to follow, tech concepts, products, ideas — and you turn each screenshot into a well-sorted, searchable entry.

You receive the OCR text of the screenshot(s) — lines marked [LARGE] are big on screen and are often the title or venue name — and sometimes the image itself. Social-media UI text (likes, "Follow", usernames, captions, hashtags, location tags) is context: location tags and @handles often name the venue or the account.

Library categories:
${list}
${typeList ? `\nTypes already in use (reuse these so filters stay tidy):\n${typeList}\n` : ""}
The user lives in ${homeCity || "an unknown city"}. Their most important use is finding great food spots, bars, cafés and things to do there${homeCity ? ` — so for posts in German or posts that don't name a city, assume ${homeCity} unless clues say otherwise, and verify venues in ${homeCity} first` : ""}.

Rules:
- Pick the single most specific category. Anything tied to a specific date (pop-up, market, concert, festival, opening, event) goes to events, and still gets its location. User-created categories win over built-in ones when they fit. Use misc only as a last resort.
- Only create items for things this screenshot actually shows or lists. For a carousel / slideshow slide ("2/8", "3/10"), create only the place on this slide, not places from other slides or ones merely hinted at in hashtags. A caption that explicitly lists several places is a list: then add each.
- Text written over a photo (e.g. "pasta paradiso", "the noodle bar") is usually the name of the place shown; the account that posted it (e.g. "foodie.anna") is the source_handle, not the place.
- A screenshot of a profile page or a post where the point is the creator → accounts. A post where the point is the restaurant → food, even if a creator posted it.
- Never invent facts. Leave fields null/empty rather than guess, and lower confidence if unsure.
- Only fill the fields that make sense for the chosen category (see the arrow hints); leave the rest empty/null.
- If the user supplied hints (e.g. a corrected name, city or category), treat them as ground truth.

Web search (when available): use it when it adds real value — verifying a venue and filling address/dishes/links and the official one-line description (Google Maps listing or the venue's own site), identifying an account, finding a product page or a tool's website. Don't search for quotes, memes, generic tips or concepts that are fully explained in the screenshot. 1-3 searches is usually enough.

Finish by calling submit_items exactly once.`;
}

export function aiEnabled() {
  return Boolean(apiKey());
}

/** Remembered across restarts so a rejected strict schema doesn't cost an extra request every time. */
let strictSupported = getMeta("ai_strict_schema") !== "rejected";

export async function analyze(input: AnalyzeInput): Promise<{ items: ExtractedItem[]; usedSearch: boolean }> {
  if (!strictSupported) return analyzeOnce(input, false);
  try {
    return await analyzeOnce(input, true);
  } catch (e) {
    // If the API ever rejects the strict schema (e.g. complexity limits), fall back to non-strict + our own validation.
    if (e instanceof Anthropic.BadRequestError && /schema|strict|grammar/i.test(e.message)) {
      console.warn("[ai] strict schema rejected, using non-strict from now on:", e.message.slice(0, 200));
      strictSupported = false;
      setMeta("ai_strict_schema", "rejected");
      return analyzeOnce(input, false);
    }
    throw e;
  }
}

async function analyzeOnce(input: AnalyzeInput, strict: boolean): Promise<{ items: ExtractedItem[]; usedSearch: boolean }> {
  const settings = getSettings();
  const client = new Anthropic({ apiKey: apiKey() });
  const categoryIds = input.categories.map((c) => c.id);

  const tools: Anthropic.Beta.BetaToolUnion[] = [submitTool(categoryIds, strict)];
  if (input.research) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });

  const text = [
    "OCR text of the screenshot(s):",
    "<ocr>",
    input.ocrText || "(no text found)",
    "</ocr>",
    `Today: ${new Date().toISOString().slice(0, 10)}.${input.capturedAt ? ` Screenshot taken: ${input.capturedAt.slice(0, 10)} (${new Date(input.capturedAt).toLocaleDateString("en-US", { weekday: "long" })}).` : ""}`,
    input.hints && Object.keys(input.hints).length ? `User hints (ground truth): ${JSON.stringify(input.hints)}` : "",
    input.examples?.length ? `Similar screenshots this user corrected before (learn from these):\n${input.examples.join("\n")}` : "",
    input.instruction ? `The user looked at this screenshot and says (follow this, it overrides your own judgement): """${input.instruction}"""\nSince the user checked it, set confidence ≥ 0.8 unless the instruction itself is unclear.` : "",
    input.imagesB64.length ? "The screenshot image(s) are attached." : "The image itself is not available — work from the text.",
    input.research ? "Web search is available if it adds value. Then call submit_items." : "Web search is not available. Call submit_items with what the text supports.",
  ].filter(Boolean).join("\n");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...input.imagesB64.map((data) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data } })),
    { type: "text", text },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  const system = systemPrompt(input.categories, input.homeCity, input.types ?? {})
    + (input.rules?.length ? `\n\nThis user's house rules (learned from their corrections; follow them):\n${input.rules.map((r) => `- ${r}`).join("\n")}` : "");

  let usedSearch = false;
  let nudged = false;
  for (let turn = 0; turn < 6; turn++) {
    const response = await client.beta.messages.create({
      model: settings.model,
      max_tokens: 16000,
      system,
      tools,
      tool_choice: { type: "auto" },
      messages,
      output_config: { effort: input.research ? "medium" : "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    recordUsage("sort", response);

    if (response.content.some((b) => b.type === "server_tool_use")) usedSearch = true;

    if (response.stop_reason === "refusal") {
      throw new Error(`Claude declined to analyze this screenshot${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}.`);
    }

    const submit = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "submit_items",
    );
    if (submit) {
      const items = ((submit.input as { items?: ExtractedItem[] }).items ?? []).filter((s) => s && typeof s.name === "string" && s.name.trim());
      return { items, usedSearch };
    }

    if (response.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens.");

    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (response.stop_reason === "pause_turn") continue;

    // end_turn without calling the tool: ask once more.
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Now call submit_items with your result." });
  }
  throw new Error("Claude did not return a result.");
}
