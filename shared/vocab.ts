// Controlled vocabularies shared by the server (AI schema) and the web UI (filters, chips).

export const KINDS = {
  place: { label: "Spot", plural: "Spots", emoji: "📍", hint: "Restaurant, café, bar…" },
  food: { label: "Food post", plural: "Food posts", emoji: "🍜", hint: "A dish or food idea, no specific place" },
  activity: { label: "Activity", plural: "Activities", emoji: "🎟️", hint: "Sights, experiences, things to do" },
} as const;

export const MEALS = {
  breakfast: { label: "Breakfast", emoji: "🥐" },
  brunch: { label: "Brunch", emoji: "🍳" },
  lunch: { label: "Lunch", emoji: "🥗" },
  dinner: { label: "Dinner", emoji: "🍝" },
  snack: { label: "Snack", emoji: "🥨" },
  dessert: { label: "Dessert", emoji: "🍰" },
  late_night: { label: "Late night", emoji: "🌙" },
} as const;

export const VENUES = {
  restaurant: { label: "Restaurant", emoji: "🍽️" },
  fine_dining: { label: "Fine dining", emoji: "✨" },
  cafe: { label: "Café", emoji: "☕" },
  bakery: { label: "Bakery", emoji: "🥖" },
  bar: { label: "Bar", emoji: "🍸" },
  wine_bar: { label: "Wine bar", emoji: "🍷" },
  pub: { label: "Pub / brewery", emoji: "🍺" },
  street_food: { label: "Street food", emoji: "🌯" },
  food_truck: { label: "Food truck", emoji: "🚚" },
  market: { label: "Market / food hall", emoji: "🧺" },
  ice_cream: { label: "Ice cream", emoji: "🍦" },
  rooftop: { label: "Rooftop / view", emoji: "🌇" },
} as const;

export const DRINKS = {
  coffee: { label: "Coffee", emoji: "☕" },
  specialty_coffee: { label: "Specialty coffee", emoji: "🫘" },
  matcha: { label: "Matcha", emoji: "🍵" },
  tea: { label: "Tea", emoji: "🫖" },
  bubble_tea: { label: "Bubble tea", emoji: "🧋" },
  juice: { label: "Juice / smoothie", emoji: "🥤" },
  cocktails: { label: "Cocktails", emoji: "🍹" },
  wine: { label: "Wine", emoji: "🍷" },
  natural_wine: { label: "Natural wine", emoji: "🍇" },
  beer: { label: "Beer", emoji: "🍺" },
  craft_beer: { label: "Craft beer", emoji: "🍻" },
  sake: { label: "Sake", emoji: "🍶" },
  spirits: { label: "Spirits", emoji: "🥃" },
  zero_proof: { label: "Non-alcoholic", emoji: "🧃" },
} as const;

export const SERVICE = {
  dine_in: { label: "Sit down", emoji: "🪑" },
  takeaway: { label: "To go", emoji: "🥡" },
  delivery: { label: "Delivery", emoji: "🛵" },
} as const;

export const SPECIALNESS = {
  1: { label: "Nice to know", short: "Nice" },
  2: { label: "Good spot", short: "Good" },
  3: { label: "Worth a detour", short: "Detour" },
  4: { label: "Must go", short: "Must" },
  5: { label: "Once in a lifetime", short: "Legendary" },
} as const;

export const PRICE = ["Free", "$", "$$", "$$$", "$$$$"] as const;

export type Kind = keyof typeof KINDS;
export type Meal = keyof typeof MEALS;
export type Venue = keyof typeof VENUES;
export type Drink = keyof typeof DRINKS;
export type Service = keyof typeof SERVICE;

// ---- Library categories -------------------------------------------------------
// Every screenshot lives in exactly one category. The template decides which
// detail fields the UI shows and how the AI fills them in.

export const TEMPLATES = {
  food: { label: "Food & drink spot", hint: "Meals, drinks, sit-down / to-go, cuisine, location" },
  place: { label: "Place / activity", hint: "Activity type, location, price" },
  recipe: { label: "Recipe", hint: "Ingredients, steps, cuisine" },
  account: { label: "Account / person", hint: "Platform, handle, what they post about" },
  generic: { label: "General", hint: "Summary, key points, text, tags" },
} as const;
export type Template = keyof typeof TEMPLATES;

export interface CategoryDef {
  id: string;
  name: string;
  emoji: string;
  color: string;
  template: Template;
  description: string;
}

export const BUILTIN_CATEGORIES: CategoryDef[] = [
  { id: "food", name: "Food", emoji: "🍽️", color: "#ff5a36", template: "food", description: "Restaurants, street food, food trucks, markets and food halls, or a specific dish / food post. Places with a real kitchen, even if they also serve coffee or have a bar." },
  { id: "cafes", name: "Cafés & Bakeries", emoji: "☕", color: "#a16207", template: "food", description: "Cafés, coffee shops, bakeries, patisseries, ice cream and dessert spots: places you go mainly for coffee, cake, pastries or sweets." },
  { id: "drinks", name: "Bars & Drinks", emoji: "🍸", color: "#9333ea", template: "food", description: "Bars, cocktail bars, wine bars, pubs, breweries, beer gardens, rooftop bars, clubs: places you go mainly to drink." },
  { id: "places", name: "Places & Activities", emoji: "🗺️", color: "#2f9e8f", template: "place", description: "Sights, experiences, hikes, beaches, museums, hotels, viewpoints, events, things to do while travelling." },
  { id: "events", name: "Events & Dates", emoji: "📅", color: "#0891b2", template: "place", description: "Anything happening on a specific date: pop-ups, markets, concerts, festivals, exhibitions, openings, parties, sales, deadlines." },
  { id: "recipes", name: "Recipes", emoji: "🧑‍🍳", color: "#e8862a", template: "recipe", description: "Recipes or cooking instructions to make at home (ingredients, steps)." },
  { id: "accounts", name: "Accounts & People", emoji: "👤", color: "#7c5cff", template: "account", description: "A social-media profile, creator, brand or person worth following or remembering (the screenshot is mainly about the account itself)." },
  { id: "tech", name: "Tech & Learning", emoji: "💻", color: "#3b82f6", template: "generic", description: "Tech concepts, AI, programming, tools, apps, code snippets, diagrams, tutorials, explanations, things to learn." },
  { id: "shopping", name: "Shopping", emoji: "🛍️", color: "#db2777", template: "generic", description: "Products, gear, clothes, gadgets, gifts, things to buy." },
  { id: "ideas", name: "Ideas & Quotes", emoji: "💡", color: "#ca8a04", template: "generic", description: "Quotes, advice, life tips, inspiration, mental models, notes to self." },
  { id: "photos", name: "Photos & Memes", emoji: "📷", color: "#64748b", template: "generic", description: "Personal photos, selfies, memes, funny pictures — images that are not saved information about a place, product or topic." },
  { id: "misc", name: "Misc", emoji: "📦", color: "#78716c", template: "generic", description: "Anything that fits nowhere else." },
];

/** Which categories show location fields and appear on the map. */
export const LOCATED_TEMPLATES: Template[] = ["food", "place"];

export const RATING_LABEL: Record<Template, string> = {
  food: "How special",
  place: "How special",
  recipe: "Want to make it",
  account: "How interesting",
  generic: "How useful",
};

export const PLATFORMS = ["instagram", "tiktok", "youtube", "x", "threads", "linkedin", "reddit", "pinterest", "github", "website", "other"] as const;
