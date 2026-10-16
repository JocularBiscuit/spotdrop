// Learning from the user's corrections, three ways:
//  1. every correction is stored as an example; the most similar ones go into the AI prompt next time
//  2. words from corrected screenshots are tied to the chosen category (feeds the on-device sorter)
//  3. short "house rules" (distilled by the organizer, or written by the user) go into every prompt
import { db, getCategory, getMeta, imagesFor, newId, now, setMeta } from "./db.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  spot_id TEXT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,            -- edit | move | confirm | instruction
  before TEXT NOT NULL,          -- JSON: the AI's version
  after TEXT NOT NULL,           -- JSON: what the user wanted
  instruction TEXT,
  ocr TEXT NOT NULL DEFAULT ''   -- excerpt of the screenshot text
);
CREATE INDEX IF NOT EXISTS corrections_created ON corrections(created_at);
CREATE TABLE IF NOT EXISTS learned_terms (
  term TEXT NOT NULL,
  category TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (term, category)
);
`);

const LEARNED_FIELDS = ["category", "name", "kind", "activity_type", "city"] as const;

const STOP = new Set(
  "the and for with this that from your you are was have has but not all can our out new just like more what when where will into about here there they them their its it's it’s der die das und mit für von den dem ein eine ist sind auf aus bei nicht auch noch nur wie was wir ihr sie zum zur im am follow following likes like reply share send save more comments views original audio sound for you".split(" "),
);

/** Distinctive words of a screenshot: hashtags, @handles and longer words (no UI noise). */
export function termsOf(text: string): string[] {
  const t = text.toLowerCase();
  const tags = [...t.matchAll(/[#@][\p{L}\p{N}_.]{2,30}/gu)].map((m) => m[0]);
  const words = (t.normalize("NFD").replace(/[̀-ͯ]/g, "").match(/\p{L}{4,20}/gu) ?? []).filter((w) => !STOP.has(w));
  return [...new Set([...tags, ...words])].slice(0, 40);
}

const ocrOf = (spotId: string) => imagesFor(spotId).map((i) => i.ocr_text ?? "").join("\n");

/** Remember what the user changed (or confirmed) so the AI and the local sorter can learn from it. */
export function recordCorrection(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  kind: "edit" | "move" | "confirm" | "instruction",
  instruction?: string,
) {
  const changed = LEARNED_FIELDS.filter((f) => f in after && after[f] !== before[f]);
  if (kind !== "confirm" && kind !== "instruction" && !changed.length) return;
  const pick = (o: Record<string, unknown>) => Object.fromEntries(LEARNED_FIELDS.map((f) => [f, o[f] ?? null]));
  const b = pick(before);
  const a = { ...b, ...Object.fromEntries(changed.map((f) => [f, after[f]])) };
  const ocr = ocrOf(String(before.id)).replace(/\s+/g, " ").slice(0, 500);
  db.prepare("INSERT INTO corrections (id, spot_id, created_at, kind, before, after, instruction, ocr) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(newId(), String(before.id), now(), kind, JSON.stringify(b), JSON.stringify(a), instruction ?? null, ocr);

  // Teach the on-device sorter: these words point to the chosen category (and away from the wrong one).
  const finalCat = String(a.category ?? "");
  if (!finalCat || !getCategory(finalCat)) return;
  const bump = db.prepare("INSERT INTO learned_terms (term, category, weight) VALUES (?, ?, ?) ON CONFLICT(term, category) DO UPDATE SET weight = MAX(-3, MIN(20, weight + excluded.weight))");
  const terms = termsOf(ocr);
  for (const t of terms) bump.run(t, finalCat, kind === "confirm" ? 0.5 : 1);
  if (b.category && b.category !== finalCat) for (const t of terms) bump.run(t, String(b.category), -0.5);
}

/** Learned category scores for a screenshot's text (used by the local classifier). */
export function learnedScores(text: string): Map<string, number> {
  const terms = termsOf(text);
  const out = new Map<string, number>();
  if (!terms.length) return out;
  const rows = db.prepare(`SELECT category, SUM(weight) s FROM learned_terms WHERE term IN (${terms.map(() => "?").join(",")}) GROUP BY category`).all(...terms) as { category: string; s: number }[];
  for (const r of rows) if (r.s > 0) out.set(r.category, Math.min(8, r.s / 2));
  return out;
}

interface Correction { kind: string; before: Record<string, unknown>; after: Record<string, unknown>; instruction: string | null; ocr: string; created_at: string }

function allCorrections(limit = 400): Correction[] {
  return (db.prepare("SELECT * FROM corrections ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, string>[]).map((r) => ({
    kind: r.kind, before: JSON.parse(r.before), after: JSON.parse(r.after), instruction: r.instruction, ocr: r.ocr, created_at: r.created_at,
  }));
}

/** The past corrections most similar to this screenshot, formatted for the prompt. */
export function relevantExamples(text: string, n = 8): string[] {
  const mine = new Set(termsOf(text));
  if (!mine.size) return [];
  const scored = allCorrections()
    .filter((c) => c.kind !== "confirm" || c.instruction)
    .map((c, i) => {
      const theirs = termsOf(c.ocr);
      const overlap = theirs.filter((t) => mine.has(t)).length / Math.max(1, Math.min(mine.size, theirs.length));
      return { c, score: overlap + (c.instruction ? 0.15 : 0) - i * 0.0005 };
    })
    .filter((x) => x.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  return scored.map(({ c }) => {
    const diff = Object.keys(c.after).filter((k) => c.after[k] !== c.before[k]).map((k) => `${k}: ${JSON.stringify(c.before[k])} → ${JSON.stringify(c.after[k])}`).join(", ");
    return `- Screenshot text: "${c.ocr.slice(0, 160)}"${c.instruction ? ` · user said: "${c.instruction}"` : ""}${diff ? ` · corrected ${diff}` : ""}`;
  });
}

/** Recent corrections, for the organizer to distil into rules. */
export function correctionDigest(limit = 60): string {
  return allCorrections(limit)
    .filter((c) => c.kind !== "confirm" || c.instruction)
    .map((c) => {
      const diff = Object.keys(c.after).filter((k) => c.after[k] !== c.before[k]).map((k) => `${k} ${JSON.stringify(c.before[k])}→${JSON.stringify(c.after[k])}`).join("; ");
      return `- "${c.ocr.slice(0, 120)}"${c.instruction ? ` | said: ${c.instruction}` : ""}${diff ? ` | ${diff}` : ""}`;
    })
    .join("\n");
}

// ---- house rules ---------------------------------------------------------------------
export interface Rule { text: string; source: "ai" | "user" }

export function getRules(): Rule[] {
  try {
    return JSON.parse(getMeta("learned_rules") ?? "[]");
  } catch {
    return [];
  }
}

export function setRules(rules: Rule[]) {
  const clean = rules
    .map((r) => ({ text: String(r.text ?? "").trim().slice(0, 200), source: r.source === "user" ? "user" : "ai" }) as Rule)
    .filter((r) => r.text);
  setMeta("learned_rules", JSON.stringify(clean.slice(0, 30)));
}

export const learningStats = () => ({
  corrections: Number((db.prepare("SELECT COUNT(*) n FROM corrections").get() as { n: number }).n),
  terms: Number((db.prepare("SELECT COUNT(*) n FROM learned_terms WHERE weight > 0").get() as { n: number }).n),
});
