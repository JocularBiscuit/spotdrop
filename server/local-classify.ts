// Offline, keyword-based first pass. Runs on every screenshot right after OCR so items are
// sorted and searchable even with no API key, no internet, or a failed AI call.
// The AI (when available) later refines and overrides these guesses.
import type { CategoryRow } from "./db.ts";
import type { OcrLine } from "./ocr.ts";

type Rule = [RegExp, string];

const w = (words: string) => new RegExp(`(?:^|[^\\p{L}])(?:${words})(?=$|[^\\p{L}])`, "iu");

// Category signals (English + German, since many local posts are German).
const CATEGORY_SIGNALS: Record<string, RegExp[]> = {
  food: [
    w("restaurant|restaurante|ristorante|trattoria|osteria|pizzeria|bistro|brasserie|brunch|breakfast|frühstück|lunch|mittag|dinner|abendessen|menu|speisekarte|foodie|food|essen|eat|eats|delicious|lecker|yummy|tasty|pizza|burger|ramen|sushi|tacos?|pasta|kebab|döner|street ?food|food ?truck|reservation|reservierung|michelin|chef|küche|kitchen|imbiss|gaststätte|wirtshaus|schmankerl"),
  ],
  cafes: [
    w("café|cafe|caffè|coffee|kaffee|espresso|flat white|cappuccino|matcha|bakery|bäckerei|backstube|konditorei|patisserie|pâtisserie|croissant|zimtschnecke|cinnamon roll|kuchen|cake|torte|gelato|eis|eisdiele|ice cream|dessert"),
  ],
  drinks: [
    w("bar|cocktails?|cocktailbar|drinks|wine bar|weinbar|natural wine|naturwein|beer|bier|biergarten|brauhaus|brewery|brauerei|pub|kneipe|taproom|spritz|aperitivo|gin|whisky|negroni|martini|happy hour|club|rooftop"),
  ],
  places: [
    w("museum|gallery|galerie|hike|hiking|wandern|wanderung|trail|beach|strand|viewpoint|aussicht|aussichtspunkt|sunset|sonnenuntergang|tour|tickets?|eintritt|hotel|hostel|unterkunft|castle|schloss|burg|park|lake|island|insel|waterfall|wasserfall|temple|tempel|travel|reise|trip|ausflug|sightseeing|sehenswürdigkeit|things to do|experience|festival|concert|konzert|exhibition|ausstellung|gallery weekend|jazz|library|bibliothek|bib|market|flohmarkt|wanderung|bergsee|alpen|alps"),
  ],
  recipes: [
    w("recipe|rezept|ingredients|zutaten|tbsp|tsp|preheat|vorheizen|bake|backen|minutes|minuten|stir|rühren|whisk|cups?|gramm?|prise|servings|portionen|cook|kochen|zubereitung|schritt"),
  ],
  accounts: [], // scored separately from profile-page stats, see profileScore()
  tech: [
    w("staging|lint|linting|engineer|engineering|production|devops|ci|cd|kubernetes|microservices?|api|code|coding|github|python|javascript|typescript|react|docker|kubernetes|ci\\/cd|pipeline|deploy|deployment|devops|llm|ai|ki|gpt|claude|openai|prompt|machine learning|neural|database|sql|server|cloud|aws|frontend|backend|programming|developer|software|algorithm|git|npm|terminal|linux|framework|open[- ]source|repo|startup|saas|tool|automation|workflow|agent|model|token"),
  ],
  shopping: [
    w("store|shop|laden|boutique|second ?hand|secondhand|vintage|concept store|serum|creme|cream|skincare|hautpflege|dm|rossmann|müller|spray|lotion|shampoo|parfum|perfume|outfit|dress|kleid|sneakers?|jacke|haul|produkt|product|buy|kaufen|shop now|add to cart|warenkorb|in den warenkorb|sale|rabatt|discount|price|preis|size|größe|order|bestellen|bestellung|link in bio|amazon|zalando|deal|gutschein|coupon|free shipping|versand"),
    /[€$£]\s?\d+[.,]?\d*|\d+[.,]\d{2}\s?[€$£]/,
  ],
  ideas: [
    /[“”"„«»].{20,}[“”"„«»]/s,
    w("quote|zitat|mindset|motivation|advice|tipp|tips|lesson|life|leben|habits?|gewohnheit|remember|reminder|happiness|glück|success|erfolg|inspiration|wisdom|weisheit|productivity|produktivität"),
  ],
};

const CUISINES: Rule[] = [
  [w("pizza|pizzeria|pasta|trattoria|osteria|ristorante|risotto|gnocchi|tiramisu|gelato|aperol|negroni|italian|italienisch|italia|vino"), "italian"],
  [w("ramen|sushi|izakaya|udon|tempura|matcha|japanese|japanisch|gyoza|onigiri|katsu|donburi|yakitori"), "japanese"],
  [w("tacos?|burrito|quesadilla|mezcal|mexican|mexikanisch|guacamole|nachos|al pastor"), "mexican"],
  [w("dim sum|dumplings?|baozi|bao|wok|szechuan|sichuan|chinese|chinesisch|peking|xiaolongbao|hot ?pot|noodles"), "chinese"],
  [w("pho|banh mi|vietnamese|vietnamesisch|bun bo"), "vietnamese"],
  [w("pad thai|thai|curry|tom yum|green curry"), "thai"],
  [w("korean|koreanisch|kimchi|bibimbap|bulgogi|korean bbq|tteokbokki"), "korean"],
  [w("indian|indisch|tandoori|masala|naan|biryani|dal|paneer"), "indian"],
  [w("döner|doner|kebab|kebap|lahmacun|turkish|türkisch|baklava|börek"), "turkish"],
  [w("falafel|hummus|shawarma|lebanese|libanesisch|levantine|mezze|tahini"), "middle eastern"],
  [w("burger|smash|bbq|barbecue|hot dog|wings|fried chicken|american|amerikanisch|diner|pancakes"), "american"],
  [w("croissant|boulangerie|patisserie|bistro|brasserie|french|französisch|crêpe|crepe|baguette|éclair"), "french"],
  [w("tapas|paella|spanish|spanisch|churros|sangria|jamón"), "spanish"],
  [w("pastel de nata|portuguese|portugiesisch|bifana|bacalhau"), "portuguese"],
  [w("greek|griechisch|gyros|souvlaki|tzatziki|feta"), "greek"],
  [w("wirtshaus|biergarten|brauhaus|schnitzel|weißwurst|brezn|brezel|schweinsbraten|knödel|schmalznudel|bavarian|bayerisch|german|deutsch|currywurst|spätzle|kaiserschmarrn|wiener"), "german"],
  [w("vegan|plant[- ]based|pflanzlich"), "vegan"],
  [w("vegetarian|vegetarisch|veggie"), "vegetarian"],
  [w("seafood|meeresfrüchte|fish|fisch|oyster|austern|lobster|hummer"), "seafood"],
  [w("steak|steakhouse|grill|dry aged"), "steakhouse"],
  [w("specialty coffee|third wave|roastery|rösterei|flat white|v60|pour over"), "coffee"],
  [w("bakery|bäckerei|konditorei|cake|kuchen|torte|pastry|gebäck|sourdough|sauerteig|cinnamon roll|zimtschnecke"), "bakery"],
];

const DISHES = /\b(pizza|pasta|ramen|sushi|tacos?|burgers?|smash ?burger|croissants?|pastel de nata|schnitzel|döner|kebab|falafel|pho|bao|dumplings?|gyoza|pancakes|waffles?|tiramisu|gelato|ice cream|eis|cheesecake|cinnamon rolls?|zimtschnecken?|schmalznudeln?|weißwurst|brezn|kaiserschmarrn|poke( bowl)?|bowls?|avocado toast|eggs benedict|shakshuka|bagels?|sandwich(es)?|focaccia|lasagne|carbonara|risotto|steak|curry|bibimbap|banh mi|nachos|wings|fried chicken|donuts?|krapfen|churros|crêpes?|crepes?)\b/giu;

const DRINK_RULES: Rule[] = [
  [w("specialty coffee|flat white|v60|pour over|roastery|rösterei|third wave"), "specialty_coffee"],
  [w("coffee|kaffee|espresso|cappuccino|latte|café|cafe"), "coffee"],
  [w("matcha"), "matcha"],
  [w("tea|tee|chai"), "tea"],
  [w("bubble tea|boba"), "bubble_tea"],
  [w("juice|saft|smoothie"), "juice"],
  [w("cocktails?|negroni|spritz|aperol|margarita|martini|mojito|gin tonic|old fashioned|mixology"), "cocktails"],
  [w("natural wine|naturwein|natural wines|vin nature"), "natural_wine"],
  [w("wine|wein|weinbar|vino|wines"), "wine"],
  [w("craft beer|craftbeer|brewery|brauerei|ipa"), "craft_beer"],
  [w("beer|bier|biergarten|brauhaus|pils|helles"), "beer"],
  [w("sake"), "sake"],
  [w("whisky|whiskey|rum|gin|mezcal|tequila|spirits"), "spirits"],
];

const MEAL_RULES: Rule[] = [
  [w("breakfast|frühstück|morning|morgens"), "breakfast"],
  [w("brunch"), "brunch"],
  [w("lunch|mittag|mittagessen|mittagstisch"), "lunch"],
  [w("dinner|abendessen|abends|date night"), "dinner"],
  [w("dessert|nachtisch|sweet|süß|cake|kuchen|gelato|ice cream|eis"), "dessert"],
  [w("snack|imbiss|street food"), "snack"],
  [w("late night|late-night|nachts|bis \\d|open till|open until|after hours"), "late_night"],
];

const VENUE_RULES: Rule[] = [
  [w("fine dining|michelin|tasting menu|degustation|sterne"), "fine_dining"],
  [w("café|cafe|coffee|kaffee|caffè|coffeeshop"), "cafe"],
  [w("bakery|bäckerei|konditorei|boulangerie|patisserie"), "bakery"],
  [w("wine bar|weinbar|vinothek|enoteca"), "wine_bar"],
  [w("cocktail bar|bar|speakeasy|lounge"), "bar"],
  [w("pub|brewery|brauerei|brauhaus|biergarten|taproom"), "pub"],
  [w("street food|imbiss|stand|stall"), "street_food"],
  [w("food truck|foodtruck"), "food_truck"],
  [w("market|markt|food hall|markthalle|viktualienmarkt"), "market"],
  [w("ice cream|gelato|gelateria|eisdiele|eiscafé"), "ice_cream"],
  [w("rooftop|dachterrasse|skybar|view"), "rooftop"],
  [w("restaurant|restaurante|ristorante|trattoria|osteria|pizzeria|bistro|brasserie|wirtshaus|gaststätte|izakaya|diner|steakhouse"), "restaurant"],
];

const SERVICE_RULES: Rule[] = [
  [w("to go|takeaway|take away|take-away|zum mitnehmen|mitnehmen|abholung|pickup"), "takeaway"],
  [w("delivery|lieferung|lieferando|wolt|uber eats|deliveroo"), "delivery"],
  [w("reservation|reservierung|reserve|tisch|table|sit down|terrace|terrasse|dine in|biergarten"), "dine_in"],
];

const PLATFORM_HINTS: Rule[] = [
  [/tiktok|for you|für dich|fyp/i, "tiktok"],
  [/instagram|reels?\b|igtv|story|highlights/i, "instagram"],
  [/youtube|subscribers|abonnenten|shorts\b/i, "youtube"],
  [/\breddit\b|r\/\w+|upvote/i, "reddit"],
  [/\bx\.com\b|twitter|retweet|repost|\btweet/i, "x"],
  [/threads/i, "threads"],
  [/linkedin|connections|vernetzen/i, "linkedin"],
  [/github|stars|fork|pull request|readme/i, "github"],
];

const UI_NOISE = /^(@\S+|follow(ing)?|followed by.*|for you|friends|inbox|profile|message|nachricht|live|shop|folgen|gefolgt|like[sd]?|gefällt|reply|antworten|share|teilen|send|senden|save|speichern|more|mehr|comments?|kommentare?|views?|aufrufe|sponsored|gesponsert|reels?|home|search|suche|explore|original audio|originalton|\d+[.,]?\d*\s*[kKmM]?|\d{1,2}:\d{2}.*|translate|übersetzen|see more|mehr anzeigen|…|\.\.\.)$/i;

/** Profile pages show stat labels as their own lines: "posts / followers / following". */
function profileScore(lines: string[]): number {
  const stats = [/^(posts|beiträge)$/i, /^(followers?|abonnenten|subscribers)$/i, /^(following|gefolgt|abonniert)$/i, /^(likes|gefällt mir-angaben)$/i];
  const hits = stats.filter((re) => lines.some((l) => re.test(l.trim()))).length;
  return hits >= 2 ? 10 + hits : 0;
}

/** Lines made only of app chrome words ("Shop For You", "Following For You", "+ Follow", "LIVE Nearby"). */
const CHROME_WORDS = new Set(["shop", "for", "you", "following", "follow", "followers", "friends", "inbox", "profile", "live", "explore", "nearby", "home", "+", "•", "reels", "search", "für", "dich", "folge", "ich", "folgen", "entdecken", "freunde", "posteingang", "profil", "add", "more", "see", "translation", "übersetzung", "anzeigen", "original", "audio", "sound"]);
const isChrome = (line: string) => line.toLowerCase().split(/\s+/).filter(Boolean).every((t) => CHROME_WORDS.has(t.replace(/[^\p{L}+•]/gu, "")) || !/\p{L}/u.test(t));

const unique = (xs: string[]) => [...new Set(xs)];
const matchAll = (rules: Rule[], text: string) => unique(rules.filter(([re]) => re.test(text)).map(([, v]) => v));

// ---- dates ------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, jänner: 1, feb: 2, februar: 2, february: 2, mär: 3, märz: 3, mar: 3, march: 3, apr: 4, april: 4,
  mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dez: 12, dec: 12, dezember: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const EVENT_WORDS = w("event|events|pop-?up|popup|markt|market|flohmarkt|festival|konzert|concert|party|opening|eröffnung|neueröffnung|ausstellung|exhibition|vernissage|workshop|tickets?|eintritt|einlass|sale|save the date|nur am|vom|bis zum|until|termin|tag der offenen|live music|livemusik|lesung|kino|screening|tasting|verkostung|brunch am");

const pad = (n: number) => String(n).padStart(2, "0");
function toIso(day: number, month: number, year: number | null, anchor: Date): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let y = year ?? anchor.getFullYear();
  if (y < 100) y += 2000;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  // No year given and the date lies well before the screenshot: it means next year.
  if (year === null && d.getTime() < anchor.getTime() - 60 * 86400000) d.setUTCFullYear(y + 1);
  return d.toISOString().slice(0, 10);
}

/** Finds the first date (or date range) in the text, e.g. "12.10.", "12.–14. Oktober", "Oct 12", "Sat, 12 October 2026". */
export function findDates(text: string, anchor: Date): { start: string; end: string | null; time: string | null } | null {
  const found: { start: string; end: string | null; idx: number }[] = [];
  let m: RegExpExecArray | null;
  // 12.–14.10.(2026)  /  12.10.(2026)  /  12.10.26
  const numeric = /(?<!\d)(\d{1,2})\.(?:\s?[–-]\s?(\d{1,2})\.)?\s?(\d{1,2})\.(\d{2,4})?(?!\d)/g;
  while ((m = numeric.exec(text))) {
    const start = toIso(+m[1], +m[3], m[4] ? +m[4] : null, anchor);
    const end = m[2] ? toIso(+m[2], +m[3], m[4] ? +m[4] : null, anchor) : null;
    if (start) found.push({ start, end, idx: m.index });
  }
  // 12.(–14.) Oktober (2026)  /  12 October  /  12th of Oct
  const dayMonth = new RegExp(`(?<!\\d)(\\d{1,2})(?:\\.|st|nd|rd|th)?(?:\\s?[–-]\\s?(\\d{1,2})\\.?)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?`, "giu");
  while ((m = dayMonth.exec(text))) {
    const month = MONTHS[m[3].toLowerCase()];
    const start = toIso(+m[1], month, m[4] ? +m[4] : null, anchor);
    const end = m[2] ? toIso(+m[2], month, m[4] ? +m[4] : null, anchor) : null;
    if (start) found.push({ start, end, idx: m.index });
  }
  // October 12(–14)(, 2026)
  const monthDay = new RegExp(`(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s?[–-]\\s?(\\d{1,2}))?(?:,?\\s+(\\d{4}))?(?!\\d)`, "giu");
  while ((m = monthDay.exec(text))) {
    const month = MONTHS[m[1].toLowerCase()];
    const start = toIso(+m[2], month, m[4] ? +m[4] : null, anchor);
    const end = m[3] ? toIso(+m[3], month, m[4] ? +m[4] : null, anchor) : null;
    if (start) found.push({ start, end, idx: m.index });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.idx - b.idx);
  const first = found[0];
  const time = text.match(/(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)\s?(?:[–-]\s?([01]?\d|2[0-3])[:.]([0-5]\d))?\s?(uhr|h|am|pm)?/i);
  // Ignore lone status-bar clocks like "21:46" (no "Uhr", no range) — they say nothing about the event.
  const eventTime = time && (time[3] || time[5]) ? time[0].trim() : (text.match(/(?<!\d)\d{1,2}\s?(?:[–-]\s?\d{1,2}\s?)?uhr\b/i)?.[0] ?? null);
  return { start: first.start, end: first.end && first.end > first.start ? first.end : null, time: eventTime };
}

// ---- home city (Munich) -------------------------------------------------------
const MUNICH = /\b(münchen|munich|muenchen|monaco di baviera)\b|\b8[01]\d{3}\s+m(ü|ue|u)nchen/i;
const MUNICH_HOODS = [
  "Altstadt", "Lehel", "Maxvorstadt", "Schwabing", "Schwabing-West", "Schwabing-Freimann", "Ludwigsvorstadt", "Isarvorstadt", "Glockenbachviertel",
  "Gärtnerplatzviertel", "Schlachthofviertel", "Haidhausen", "Au", "Obergiesing", "Untergiesing", "Giesing", "Sendling", "Westend", "Schwanthalerhöhe",
  "Neuhausen", "Nymphenburg", "Bogenhausen", "Berg am Laim", "Trudering", "Ramersdorf", "Perlach", "Thalkirchen", "Hadern", "Laim", "Pasing",
  "Moosach", "Milbertshofen", "Freimann", "Werksviertel", "Olympiapark", "Viktualienmarkt", "Englischer Garten", "Dachau", "Harlaching",
];
const HOOD_RE = new RegExp(`\\b(${MUNICH_HOODS.map((h) => h.replace(/[-]/g, "[- ]")).join("|")})\\b`, "i");

export interface LocalGuess {
  category: string;
  kind: "place" | "food" | "activity" | "other";
  name: string;
  description: string | null;
  tags: string[];
  cuisines: string[];
  dishes: string[];
  drinks: string[];
  meals: string[];
  venue_types: string[];
  service: string[];
  handle: string | null;
  platform: string | null;
  source_platform: string | null;
  source_handle: string | null;
  website: string | null;
  content: string | null;
  city: string | null;
  country: string | null;
  neighborhood: string | null;
  date_start: string | null;
  date_end: string | null;
  event_time: string | null;
  confidence: number;
}

function guessTitle(lines: OcrLine[]): string {
  const useful = lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text.length > 2 && l.text.length < 80 && !UI_NOISE.test(l.text) && !isChrome(l.text) && !/^#/.test(l.text) && /\p{L}{2}/u.test(l.text));
  if (!useful.length) return "";
  const hasHeights = useful.some((l) => l.h > 0);
  const best = hasHeights ? [...useful].sort((a, b) => b.h - a.h)[0] : useful[0];
  return cleanTitle(best.text);
}

/** Drop list numbers ("9 Golden Dragon"), stray single characters and trailing punctuation. */
const cleanTitle = (t: string) =>
  t.replace(/\s+/g, " ").replace(/^(\d{1,2}[.):]?|[•·\-–])\s+/, "").replace(/\s+\S$/, "").replace(/[,;:]+$/, "").trim().slice(0, 80);

/** On a profile page the display name sits just above the stats. */
function accountTitle(lines: string[]): string {
  let statIdx = lines.findIndex((l) => /^(posts|beiträge|followers?|abonnenten)$/i.test(l.trim()));
  // Skip back over the numbers that sit above the stat labels.
  while (statIdx > 0 && /^\d[\d.,]*\s*[kKmM]?$/.test(lines[statIdx - 1].trim())) statIdx--;
  const before = (statIdx > 0 ? lines.slice(0, statIdx) : lines).map((l) => l.trim());
  const name = [...before].reverse().find((l) => /\p{L}{2,}.*\s+.*\p{L}{2,}/u.test(l) && !UI_NOISE.test(l));
  return name ? cleanTitle(name) : "";
}

export function classifyLocally(lines: OcrLine[], categories: CategoryRow[], opts: { homeCity?: string; capturedAt?: string | null; learned?: Map<string, number> } = {}): LocalGuess {
  const text = lines.map((l) => l.text).join("\n");
  const anchor = opts.capturedAt ? new Date(opts.capturedAt) : new Date();
  const dates = EVENT_WORDS.test(text) ? findDates(text, anchor) : null;

  // Score built-in categories, plus custom ones by the words in their name/description.
  const scores = new Map<string, number>();
  for (const [id, signals] of Object.entries(CATEGORY_SIGNALS)) {
    let score = 0;
    for (const re of signals) {
      const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
      score += (text.match(new RegExp(re.source, flags)) ?? []).length;
    }
    scores.set(id, score);
  }
  for (const c of categories.filter((c) => !c.builtin)) {
    const words = `${c.name} ${c.description}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 3);
    const score = words.filter((word) => text.toLowerCase().includes(word)).length * 2;
    scores.set(c.id, score);
  }
  scores.set("accounts", profileScore(lines.map((l) => l.text)));
  // What the user taught us: words from corrected screenshots point to their category.
  for (const [cat, sc] of opts.learned ?? []) scores.set(cat, (scores.get(cat) ?? 0) + sc);
  // A date next to event words means it's something happening on that day.
  if (dates) scores.set("events", 3 + (scores.get("places") ?? 0) + (scores.get("food") ?? 0) / 2);

  const valid = new Set(categories.map((c) => c.id));
  const ranked = [...scores.entries()].filter(([id]) => valid.has(id)).sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = ranked[0] ?? ["misc", 0];
  const second = ranked[1]?.[1] ?? 0;
  const category = topScore >= 2 ? topId : "misc";
  const template = categories.find((c) => c.id === category)?.template ?? "generic";
  const located = template === "food" || template === "place";
  const hood = text.match(HOOD_RE)?.[1] ?? null;
  const home = (opts.homeCity ?? "").toLowerCase();
  const inMunich = MUNICH.test(text) || Boolean(hood);
  const city = located && inMunich && /munich|münchen/.test(home || "munich") ? opts.homeCity || "Munich" : null;

  const handles = unique([
    ...[...text.matchAll(/@([A-Za-z0-9._]{2,30})/g)].map((m) => m[1].replace(/\.$/, "")),
    // Bare handle lines like "some_creator" at the top of a profile.
    ...lines.map((l) => l.text.trim().replace(/\s+\S$/, "")).filter((t) => /^[a-z][a-z0-9._]{2,29}$/.test(t) && /[._\d]/.test(t) && !/\.(com|de|ee|io)$/.test(t)),
  ]);
  const hashtags = unique([...text.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)].map((m) => m[1].toLowerCase())).slice(0, 8);
  const url = text.match(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|de|io|dev|org|net|app|co|ai|at|ch|it|fr|es|eu|ee|me|ly|link|tv|page|bio)(?:\/[^\s]*)?)/i)?.[1] ?? null;
  const platform = matchAll(PLATFORM_HINTS, text)[0] ?? null;

  const isFoodish = template === "food" || template === "recipe";
  const dishes = isFoodish ? unique([...text.matchAll(DISHES)].map((m) => m[1].toLowerCase())).slice(0, 6) : [];
  const venue_types = template === "food" ? matchAll(VENUE_RULES, text) : [];
  // A food post with dishes but no venue words is probably a dish, not a place.
  const kind = template === "food" ? (venue_types.length === 0 && dishes.length > 0 ? "food" : "place") : template === "place" ? "activity" : "other";

  const title = (template === "account" && accountTitle(lines.map((l) => l.text))) || guessTitle(lines);
  const body = lines.map((l) => l.text.trim()).filter((t) => t.length > 2 && !UI_NOISE.test(t));
  const longText = body.join("\n");

  return {
    category,
    kind,
    name: (template === "account" && handles[0] && !title ? `@${handles[0]}` : title) || "Untitled screenshot",
    description: null,
    tags: hashtags,
    cuisines: isFoodish ? matchAll(CUISINES, text) : [],
    dishes,
    drinks: template === "food" ? matchAll(DRINK_RULES, text).filter((d, _, all) => !(d === "coffee" && all.includes("specialty_coffee"))) : [],
    meals: isFoodish ? matchAll(MEAL_RULES, text) : [],
    venue_types: venue_types.filter((v, _, all) => !(v === "bar" && all.includes("wine_bar"))),
    service: template === "food" ? matchAll(SERVICE_RULES, text) : [],
    handle: template === "account" ? handles[0] ?? null : null,
    platform: template === "account" ? platform : null,
    source_platform: platform,
    source_handle: template !== "account" ? handles[0] ?? null : null,
    website: url && !/instagram\.com|tiktok\.com|youtube\.com/i.test(url) ? (url.startsWith("http") ? url : `https://${url}`) : null,
    // Keep longer text verbatim for text-heavy categories (tech, ideas, recipes…).
    city,
    country: city ? "Germany" : null,
    neighborhood: located && hood ? MUNICH_HOODS.find((h) => h.toLowerCase() === hood.toLowerCase().replace(/ /g, "-")) ?? hood : null,
    date_start: dates?.start ?? null,
    date_end: dates?.end ?? null,
    event_time: dates?.time ?? null,
    content: !["food", "place", "account"].includes(template) && longText.length > 120 ? longText.slice(0, 4000) : null,
    confidence: topScore >= 2 ? Math.min(0.6, 0.3 + (topScore - second) * 0.05) : 0.1,
  };
}

// ---- list posts ("📍 Name / Street 12, 80331 München" × N) ---------------------------
const ADDRESS = /(\b\d{5}\s+\p{L}{3,})|((straße|strasse|str\.|platz|weg|gasse|allee|ring|damm|ufer|markt|street|st\.|avenue|ave\.?|road|rd\.)\s*\d+[a-z]?\b)/iu;

/** Name + address pairs in a list post. Returns [] unless there are at least two. */
export function findListedPlaces(lines: OcrLine[]): { name: string; address: string }[] {
  const texts = lines.map((l) => l.text.trim());
  const out: { name: string; address: string }[] = [];
  for (let i = 1; i < texts.length; i++) {
    if (!ADDRESS.test(texts[i])) continue;
    // The name is the closest useful line above the address.
    for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
      const name = texts[j].replace(/^[\p{Extended_Pictographic}\uFE0F•·\-–\d.)\s]+/u, "").trim();
      if (name.length < 2 || ADDRESS.test(name) || UI_NOISE.test(name) || isChrome(name)) continue;
      if (!out.some((p) => p.name === name)) out.push({ name: name.slice(0, 80), address: texts[i] });
      break;
    }
  }
  return out.length >= 2 ? out : [];
}
