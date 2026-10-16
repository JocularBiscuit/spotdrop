// "Ask your library": answer natural-language questions ("date night in Glockenbach", "rainy Sunday")
// with picks from the user's own saves. Sends a compact text version of the library (never images).
import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./usage.ts";
import { apiKey, getSettings } from "./config.ts";
import { listCategories, listSpots } from "./db.ts";

const TOOL: Anthropic.Beta.BetaTool = {
  name: "recommend",
  description: "Return the answer and the picked items. Call exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["answer", "picks"],
    properties: {
      answer: { type: "string", description: "1-2 friendly sentences. If nothing fits well, say so honestly." },
      picks: {
        type: "array",
        description: "Best matching items, best first, at most 8.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item", "reason"],
          properties: {
            item: { type: "integer", description: "Item number from the library list." },
            reason: { type: "string", description: "Short reason why it fits (max ~12 words)." },
          },
        },
      },
    },
  } as Anthropic.Beta.BetaTool.InputSchema,
};

export async function askLibrary(question: string): Promise<{ answer: string; picks: { id: string; reason: string }[] }> {
  const settings = getSettings();
  const cats = new Map(listCategories().map((c) => [c.id, c.name]));
  const spots = listSpots().filter((s) => s.status === "ready");
  const clip = (t: unknown, n: number) => String(t ?? "").replace(/\s+/g, " ").slice(0, n);
  const lines = spots.map((s, i) => {
    const facts = [
      cats.get(String(s.category)),
      [s.neighborhood, s.city].filter(Boolean).join(", "),
      [...(s.venue_types as string[]), ...(s.cuisines as string[])].slice(0, 4).join("/"),
      (s.meals as string[]).join("/"),
      (s.drinks as string[]).slice(0, 3).join("/"),
      (s.service as string[]).join("/"),
      s.price != null ? "$".repeat(Number(s.price)) || "free" : "",
      s.specialness ? `${s.specialness}/5` : "",
      s.date_start ? `on ${s.date_start}${s.date_end ? `–${s.date_end}` : ""}` : "",
      s.visited ? "been there" : "",
      (s.tags as string[]).slice(0, 4).join(","),
    ].filter(Boolean).join(" · ");
    return `${i}. ${clip(s.name, 70)} — ${facts} — ${clip(s.description, 100)}`;
  });

  const now = new Date();
  const when = now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const client = new Anthropic({ apiKey: apiKey() });
  const response = await client.beta.messages.create({
    model: settings.model,
    max_tokens: 4000,
    // The library is the big, stable part: cache it so follow-up questions are cheap and fast.
    system: [
      {
        type: "text",
        text: `You recommend things from the user's personal library of saved screenshots (food spots, bars, cafés, places, events, shops, ideas…). Their home city is ${settings.homeCity}. Only recommend items from the list. Prefer highly rated places they haven't been to, respect what they ask for (area, time of day, budget, vibe), and use dates for events. Answer by calling recommend.\n\nLibrary:\n${lines.join("\n")}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: `It is ${when}.\nQuestion: ${question}` }],
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  recordUsage("ask", response);
  if (response.stop_reason === "refusal") throw new Error("Claude declined this question.");
  const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL.name);
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join(" ");
  if (!call) return { answer: text || "I couldn't find a good answer.", picks: [] };
  const input = call.input as { answer: string; picks: { item: number; reason: string }[] };
  const picks = (input.picks ?? [])
    .filter((p) => spots[p.item])
    .slice(0, 8)
    .map((p) => ({ id: spots[p.item].id, reason: p.reason }));
  return { answer: input.answer, picks };
}
