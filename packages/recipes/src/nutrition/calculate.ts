import type { Macros, Unit } from "@mealplan/core";
import { ALIASES } from "./aliases";
import { loadCnf, type Food, type FoodDatabase } from "./foods";

/**
 * Computes recipe nutrition from its ingredients using the Canadian Nutrient File.
 * Deterministic: the same ingredients always give the same numbers, and every
 * number traces back to a CNF food and a gram weight. Nothing here is estimated by
 * a language model; when an ingredient can't be matched or weighed, it is reported
 * rather than guessed.
 */

export interface IngredientInput {
  /** What the recipe said, for display ("2 cloves garlic, minced"). */
  text: string;
  /** Generic food name ("garlic"). */
  name: string;
  /** Null when the recipe gives no amount ("salt to taste"). */
  quantity: number | null;
  unit: Unit | null;
}

export type LineStatus = "ok" | "no-match" | "no-amount";

export interface NutritionLine {
  text: string;
  status: LineStatus;
  food?: { code: number; description: string };
  grams?: number;
  /** "low" when the food was found by word matching or the weight by a fallback. */
  confidence: "high" | "low";
  calories?: number;
}

export interface NutritionResult {
  total: Macros;
  perServing: Macros;
  lines: NutritionLine[];
  /** Ingredients that likely matter but couldn't be counted (unmatched, or no amount). */
  missing: string[];
  /** Ingredients counted with a fallback that may be off. */
  uncertain: string[];
  source: string;
}

const ZERO: Macros = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };

// ---------- name normalisation ----------

/** Words describing preparation, size or quality: they don't change which food it is. */
const NOISE = new Set([
  "fresh", "freshly", "chopped", "diced", "minced", "sliced", "thinly", "finely", "roughly", "coarsely", "large", "small",
  "medium", "boneless", "skinless", "organic", "peeled", "packed", "grated", "shredded", "ripe", "crushed", "ground",
  "cubed", "halved", "quartered", "trimmed", "rinsed", "drained", "softened", "melted", "room", "temperature", "cold",
  "warm", "hot", "optional", "divided", "taste", "to", "for", "serving", "garnish", "and", "or", "of", "a", "the", "into",
  "cut", "pieces", "piece", "inch", "cm", "about", "heaping", "level", "lightly", "well", "plus", "more", "extra",
  "low-sodium", "reduced-sodium", "unsalted", "salted", "sodium", "free", "raw", "uncooked", "dry", "dried", "frozen",
  "canned", "can", "jar", "bag", "box", "package", "pkg", "your", "favourite", "favorite", "any", "brand", "store", "bought",
]);
// "ground", "crushed", "dried", "frozen", "canned" are noise for word matching but still steer aliases
// ("ground beef", "crushed tomato", "frozen pea", "canned tuna"), so aliases see the raw words.

/**
 * Words that narrow a food without changing what it is. Anything else left over after an
 * alias matches ("vinegar" in "rice vinegar", "cauliflower" in "cauliflower rice") means
 * the alias is probably the wrong food.
 */
const MODIFIERS = new Set([
  "red", "green", "yellow", "white", "orange", "purple", "golden", "lean", "plain", "natural", "unsweetened", "sweetened",
  "vanilla", "chocolate", "unflavoured", "unflavored", "light", "lite", "low", "fat", "nonfat", "non-fat", "reduced",
  "smooth", "crunchy", "creamy", "baby", "wild", "english", "mini", "jumbo", "whole", "regular", "firm", "soft", "hard",
  "mild", "sharp", "aged", "old", "grass-fed", "fed", "free-range", "range", "pasture", "raised", "kosher", "sea", "flaky",
  "boneless", "skin-on", "bone-in", "skin", "on", "in", "boxed", "homemade", "store-bought", "seedless", "pitted", "fillet",
  "breast", "thin", "thick", "cooking", "fine", "coarse", "day-old", "hass",
  "roma", "vine", "heirloom", "russet", "yukon", "gold", "medjool", "italian", "mexican", "greek", "large", "x",
  // Counting words: "garlic cloves", "basil leaves", "celery stalks" are still garlic, basil, celery.
  "clove", "leaf", "sprig", "stalk", "stem", "head", "bulb", "piece", "strip", "slice", "wedge", "rib", "ear", "handful",
]);

function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|oes)$/.test(w)) return w.slice(0, -2);
  const vesToF: Record<string, string> = { leaves: "leaf", halves: "half", loaves: "loaf", shelves: "shelf" };
  if (vesToF[w]) return vesToF[w]!;
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9&\-éèàç ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singular);
}

// ---------- matching ----------

interface Index {
  aliases: { words: string[]; code: number }[];
  docFreq: Map<string, number>;
  foodWords: Map<number, Set<string>>;
  headWords: Map<number, Set<string>>;
}

let index: Index | undefined;

function buildIndex(db: FoodDatabase): Index {
  const docFreq = new Map<string, number>();
  const foodWords = new Map<number, Set<string>>();
  const headWords = new Map<number, Set<string>>();
  for (const f of db.foods) {
    const ws = new Set(words(f.description.replace(/yogourt/gi, "yogurt")));
    foodWords.set(f.code, ws);
    headWords.set(f.code, new Set(words(mainNoun(f.description).replace(/yogourt/gi, "yogurt"))));
    for (const w of ws) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
  }
  const aliases = ALIASES.map(([phrase, code]) => ({ words: words(phrase), code }))
    // Longest phrase first, so "peanut butter" is tried before "butter".
    .sort((a, b) => b.words.length - a.words.length);
  return { aliases, docFreq, foodWords, headWords };
}

/** CNF names that start with a category ("Grains, rice, ...", "Nuts, almonds, ..."): the food is in the next part. */
const CATEGORY_PREFIXES = new Set([
  "fish", "grains", "nuts", "seeds", "sweets", "spices", "sauce", "salad dressing", "plant-based beverage", "vegetable oil",
  "mollusks", "crustaceans", "dessert", "candies", "snacks", "deli-meat", "indian", "frozen entree", "alcohol", "tea",
  "soup", "beverage", "game meat", "leavening agent", "candied foods", "tomato products", "cereal",
]);

/** The category words themselves, as singular tokens ("grain", "nut", "spice", ...). */
const CATEGORY_WORDS = new Set([...CATEGORY_PREFIXES].flatMap((c) => words(c)));

function mainNoun(description: string): string {
  const parts = description.split(",").map((p) => p.trim());
  return CATEGORY_PREFIXES.has(parts[0]!.toLowerCase()) && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0]!;
}

/** Food groups that are dishes or snacks, not ingredients: only matched when nothing else fits. */
const DISH_GROUPS = new Set([6, 22, 25]); // Soups/sauces/gravies, Mixed Dishes, Snacks

export function matchFood(name: string, db: FoodDatabase = loadCnf()): { food: Food; confidence: "high" | "low" } | null {
  index ??= buildIndex(db);
  const whole = matchOne(name, db);
  // "salt and pepper", "oil & vinegar": two foods in one line. Unless the whole phrase is a
  // known food ("half and half"), count the first one.
  const parts = name.split(/\s+(?:and|&)\s+/i);
  if (parts.length > 1 && whole?.confidence !== "high") {
    const first = matchOne(parts[0]!, db);
    if (first) return { food: first.food, confidence: "low" };
  }
  return whole;
}

function matchOne(name: string, db: FoodDatabase): { food: Food; confidence: "high" | "low" } | null {
  const raw = words(name);
  if (!raw.length) return null;
  const rawSet = new Set(raw);

  // 1. Curated aliases: every word of the alias must appear in the name, longest alias wins.
  //    If a word that changes the food is left over, check word matching for a better fit.
  for (const a of index!.aliases) {
    if (!a.words.every((w) => rawSet.has(w))) continue;
    const food = db.byCode.get(a.code);
    if (!food) continue;
    const leftover = raw.filter((w) => !a.words.includes(w) && !NOISE.has(w) && !MODIFIERS.has(w));
    if (!leftover.length) return { food, confidence: "high" };

    // a. A food whose description has every word: "cooked quinoa" → "Grains, quinoa, cooked".
    //    Its main noun must be one of those words and it may add at most two other words,
    //    so "roasted red peppers" can't land on "Sausage, spicy beef and roasted red pepper".
    const all = new Set([...a.words, ...leftover]);
    const exact = db.foods
      .filter((f) => {
        const fw = index!.foodWords.get(f.code)!;
        if (![...all].every((w) => fw.has(w))) return false;
        const head = [...index!.headWords.get(f.code)!].filter((w) => !CATEGORY_WORDS.has(w));
        if (!head.length || !head.every((w) => all.has(w))) return false;
        if (fw.has("with") && !rawSet.has("with")) return false; // "... with salt", "... with cheese": dishes
        const extra = [...fw].filter((w) => !all.has(w) && !NOISE.has(w) && !MODIFIERS.has(w) && !CATEGORY_WORDS.has(w));
        return extra.length <= 2;
      })
      .map((f) => ({ f, rank: formRank(index!.foodWords.get(f.code)!, rawSet) }))
      .sort((x, y) => x.rank - y.rank || x.f.description.length - y.f.description.length)[0]?.f;
    if (exact) return { food: exact, confidence: "high" };
    // b. The leftover word names the food itself: "cauliflower rice" → cauliflower, "garlic butter" → butter.
    const named = matchByWords(raw, rawSet, db, { headFrom: new Set(leftover), minCover: 0.45 });
    if (named) return { food: named, confidence: "low" };
    // c. Keep the alias, but flag it: "cooked ground beef" → raw ground beef.
    return { food, confidence: "low" };
  }

  // 2. Word matching, weighted by rarity. The food's main noun must be in the name,
  //    so "chicken broth" can't match "Chicken, broiler, ...".
  const lexical = matchByWords(raw, rawSet, db);
  return lexical ? { food: lexical, confidence: "low" } : null;
}

/** Concentrated forms change the numbers a lot (dried egg yolk is twice raw): only pick them when asked for. */
const CONCENTRATED = ["dried", "dehydrated", "powder", "flake", "freeze-dried", "concentrate"];

/** Lower is better: raw first, concentrated forms last unless the name asks for them. */
function formRank(foodWords: Set<string>, rawSet: Set<string>): number {
  let rank = 1;
  if (foodWords.has("raw")) rank = 0;
  if (CONCENTRATED.some((w) => foodWords.has(w) && !rawSet.has(w))) rank = 2;
  return rank;
}

function matchByWords(raw: string[], rawSet: Set<string>, db: FoodDatabase, opts:{ headFrom?: Set<string>; minCover?: number } = {}): Food | null {
  const meaningful = raw.filter((w) => !NOISE.has(w));
  if (!meaningful.length) return null;
  const idf = (w: string) => Math.log(1 + db.foods.length / (1 + (index!.docFreq.get(w) ?? 0)));
  const totalWeight = meaningful.reduce((s, w) => s + idf(w), 0);
  let best: { food: Food; score: number } | undefined;
  for (const food of db.foods) {
    const fw = index!.foodWords.get(food.code)!;
    if (fw.has("with") && !rawSet.has("with")) continue; // "... with salt" is a dish, not the ingredient
    const head = index!.headWords.get(food.code)!;
    const headSource = opts.headFrom ?? rawSet;
    if (![...head].some((w) => headSource.has(w))) continue;
    const covered = meaningful.filter((w) => fw.has(w)).reduce((s, w) => s + idf(w), 0) / totalWeight;
    if (covered < (opts.minCover ?? 0.6)) continue;
    let score = covered;
    if (fw.has("raw")) score += 0.08;
    if (DISH_GROUPS.has(food.group)) score -= 0.25;
    score -= Math.max(0, fw.size - meaningful.length) * 0.012; // prefer plainer descriptions
    if (!best || score > best.score) best = { food, score };
  }
  return best?.food ?? null;
}

// ---------- amounts to grams ----------

const ML_PER: Partial<Record<Unit, number>> = { ml: 1, l: 1000, tsp: 4.93, tbsp: 14.79, cup: 236.6 };
const GRAMS_PER: Partial<Record<Unit, number>> = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 };

/** Grams per ml for this food, from its household measures ("250 ml" → 143.7 g). */
function density(food: Food, name: string): { gPerMl: number; confidence: "high" | "low" } {
  const nameWords = new Set(words(name));
  const byVolume = food.measures
    .map((m) => ({ m, ml: Number(m.name.match(/^(\d+(?:\.\d+)?)\s*ml\b/)?.[1]) }))
    .filter((x) => x.ml > 0);
  const plain = byVolume.find((x) => /^\d+(?:\.\d+)?\s*ml$/.test(x.m.name));
  const described = byVolume.find((x) => words(x.m.name).some((w) => nameWords.has(w)));
  const pick = described ?? plain ?? byVolume[0];
  if (pick) return { gPerMl: pick.m.grams / pick.ml, confidence: "high" };
  return { gPerMl: food.group === 4 ? 0.92 : 1, confidence: "low" }; // oils ~0.92 g/ml, else water
}

const COUNT_RANK = [/medium/, /large/, /^1 (fruit|egg|clove|stalk|leaf|slice|tortilla|pita|bagel|potato|pepper|onion|breast|thigh|drumstick|wing|sausage|link|date|patty)/, /small/];

/** Grams of one "each" of this food ("1 medium" → 119 g). */
function eachWeight(food: Food, unit: Unit): { grams: number; confidence: "high" | "low" } | null {
  const want = unit === "clove" ? /clove/ : unit === "bunch" ? /bunch/ : unit === "can" ? /\bcan\b/ : null;
  const singles = food.measures
    .map((m) => {
      const lead = m.name.match(/^(\d+)(?:\/(\d+))?\s+(.*)$/);
      if (!lead) return null;
      const count = lead[2] ? Number(lead[1]) / Number(lead[2]) : Number(lead[1]);
      const rest = lead[3]!;
      if (/^(ml|g|mg|kg)\b|serving|food guide|package|scoop|^\d/.test(rest)) return null;
      return { name: rest, grams: m.grams / count, full: m.name };
    })
    .filter((x): x is { name: string; grams: number; full: string } => !!x);
  if (want) {
    const hit = singles.find((s) => want.test(s.full));
    if (hit) return { grams: hit.grams, confidence: "high" };
    if (unit === "can") return { grams: 400, confidence: "low" }; // a typical 398–400 ml can
    return null;
  }
  for (const re of COUNT_RANK) {
    const hit = singles.find((s) => re.test(s.full));
    if (hit) return { grams: hit.grams, confidence: "high" };
  }
  return singles[0] ? { grams: singles[0].grams, confidence: "low" } : null;
}

export function toGrams(food: Food, quantity: number, unit: Unit, name: string): { grams: number; confidence: "high" | "low" } | null {
  const g = GRAMS_PER[unit];
  if (g) return { grams: quantity * g, confidence: "high" };
  const ml = ML_PER[unit];
  if (ml) {
    const d = density(food, name);
    return { grams: quantity * ml * d.gPerMl, confidence: d.confidence };
  }
  const each = eachWeight(food, unit);
  return each ? { grams: quantity * each.grams, confidence: each.confidence } : null;
}

// ---------- recipe totals ----------

/** Foods this light per 100 g don't change a recipe's numbers when their amount is unknown (salt, water, herbs). */
const NEGLIGIBLE_KCAL_PER_100G = 50;

export function calculateNutrition(ingredients: IngredientInput[], servings: number, db: FoodDatabase = loadCnf()): NutritionResult {
  const lines: NutritionLine[] = [];
  const total = { ...ZERO };
  let fiberKnown = true;
  const missing: string[] = [];
  const uncertain: string[] = [];

  for (const ing of ingredients) {
    const match = matchFood(ing.name, db);
    if (!match) {
      lines.push({ text: ing.text, status: "no-match", confidence: "low" });
      missing.push(ing.text);
      continue;
    }
    const { food } = match;
    const weighed = ing.quantity && ing.quantity > 0 && ing.unit ? toGrams(food, ing.quantity, ing.unit, ing.name) : null;
    if (!weighed) {
      lines.push({ text: ing.text, status: "no-amount", food: { code: food.code, description: food.description }, confidence: match.confidence });
      if (food.per100g.calories >= NEGLIGIBLE_KCAL_PER_100G) missing.push(ing.text);
      continue;
    }
    const f = weighed.grams / 100;
    const kcal = food.per100g.calories * f;
    total.calories += kcal;
    total.proteinG += food.per100g.proteinG * f;
    total.fatG += food.per100g.fatG * f;
    total.carbsG += food.per100g.carbsG * f;
    if (food.per100g.fiberG === null) fiberKnown = fiberKnown && kcal < 20;
    else total.fiberG += food.per100g.fiberG * f;
    const confidence = match.confidence === "high" && weighed.confidence === "high" ? "high" : "low";
    if (confidence === "low" && kcal >= 20) uncertain.push(ing.text);
    lines.push({ text: ing.text, status: "ok", food: { code: food.code, description: food.description }, grams: round(weighed.grams, 1), confidence, calories: Math.round(kcal) });
  }

  const s = Math.max(1, servings);
  const perServing: Macros = {
    calories: Math.round(total.calories / s),
    proteinG: round(total.proteinG / s, 1),
    carbsG: round(total.carbsG / s, 1),
    fatG: round(total.fatG / s, 1),
    fiberG: round(total.fiberG / s, 1),
  };
  if (!fiberKnown) uncertain.push("fiber (not measured for some ingredients)");
  return {
    total: { calories: Math.round(total.calories), proteinG: round(total.proteinG, 1), carbsG: round(total.carbsG, 1), fatG: round(total.fatG, 1), fiberG: round(total.fiberG, 1) },
    perServing,
    lines,
    missing,
    uncertain,
    source: db.attribution,
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
