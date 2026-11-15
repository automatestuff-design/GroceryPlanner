import type { Aisle, Allergen, Diet, Ingredient, LongevityProfile, Macros, MealType, Recipe, Unit } from "@mealplan/core";

/**
 * Turns recipes from any source into the engine's Recipe shape. Sources give us
 * ingredient text and nutrition; aisles, allergens, diets and the Longevity
 * profile are derived here with keyword rules. They are deliberately conservative:
 * an allergen we can't rule out is flagged, and "vegan" is only set when no
 * animal ingredient is found.
 */

// ---------- ingredient lines ----------

const UNIT_WORDS: [RegExp, Unit][] = [
  [/^(g|gr|gram|grams)\b/i, "g"], [/^(kg|kilograms?)\b/i, "kg"],
  [/^(ml|milliliters?|millilitres?)\b/i, "ml"], [/^(l|liters?|litres?)\b/i, "l"],
  [/^(tsp|teaspoons?|t)\b\.?/, "tsp"], [/^(tbsp|tbs|tablespoons?|T)\b\.?/, "tbsp"],
  [/^(cups?|c)\b\.?/i, "cup"], [/^(oz|ounces?)\b\.?/i, "oz"], [/^(lbs?|pounds?)\b\.?/i, "lb"],
  [/^(cloves?)\b/i, "clove"], [/^(cans?|tins?)\b/i, "can"], [/^(bunch(es)?)\b/i, "bunch"],
];

const FRACTIONS: Record<string, number> = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125 };

export function parseIngredientLine(line: string): { quantity: number; unit: Unit; name: string } {
  let s = line.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/(\d)?\s*([½⅓⅔¼¾⅛])/g, (_, d, f) => ` ${(d ? Number(d) : 0) + FRACTIONS[f]!} `).trim();
  const num = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?/);
  let quantity = 1;
  if (num) {
    quantity = parseQuantity(num[1]!);
    s = s.slice(num[0].length).trim();
  }
  let unit: Unit = "each";
  for (const [re, u] of UNIT_WORDS) {
    const m = s.match(re);
    if (m) { unit = u; s = s.slice(m[0].length).trim(); break; }
  }
  const name = s.replace(/^of\s+/i, "").split(",")[0]!.replace(/\b(to taste|optional|for serving|divided)\b/gi, "").trim().toLowerCase();
  return { quantity: round(quantity), unit, name: name || line.trim().toLowerCase() };
}

function parseQuantity(s: string): number {
  return s.split(/\s+/).reduce((sum, part) => {
    const [a, b] = part.split("/");
    return sum + (b ? Number(a) / Number(b) : Number(a));
  }, 0);
}

/** Map a free-form unit string (from an API's `unit`/`measure`) to ours. */
export function mapUnit(u: string | undefined | null): Unit {
  if (!u || u === "<unit>") return "each";
  for (const [re, unit] of UNIT_WORDS) if (re.test(u.trim())) return unit;
  return "each";
}

// ---------- keyword classifiers ----------

const has = (name: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(name));

const MEAT = ["beef", "steak", "pork", "bacon", "ham", "sausage", "chicken", "turkey", "lamb", "veal", "duck", "prosciutto", "salami", "chorizo", "pepperoni", "ground meat", "meatball", "venison", "gelatin"];
const FISH = ["salmon", "tuna", "cod", "trout", "sardine", "anchov", "mackerel", "halibut", "tilapia", "herring", "fish", "haddock", "snapper", "sea bass", "pollock", "catfish"];
const SHELLFISH = ["shrimp", "prawn", "crab", "lobster", "scallop", "clam", "mussel", "oyster", "squid", "calamari"];
const DAIRY = ["milk", "butter", "cheese", "cream", "yogurt", "yoghurt", "parmesan", "feta", "mozzarella", "cheddar", "ricotta", "ghee", "whey", "kefir", "buttermilk", "cottage cheese"];
const PLANT_MILK = ["soy milk", "almond milk", "oat milk", "coconut milk", "rice milk", "cashew milk", "peanut butter", "almond butter", "coconut cream", "cream of tartar", "vegan"];
const EGG = ["egg", "mayonnaise", "mayo", "meringue"];
const OTHER_ANIMAL = ["honey", "fish sauce", "oyster sauce", "worcestershire"];
const GLUTEN = ["flour", "bread", "pasta", "spaghetti", "noodle", "tortilla", "couscous", "barley", "rye", "wheat", "breadcrumb", "panko", "cracker", "bun", "pita", "farro", "bulgur", "seitan", "soy sauce", "beer"];
const GLUTEN_FREE_MARKERS = ["gluten-free", "gluten free", "corn tortilla", "rice noodle", "almond flour", "coconut flour", "rice flour", "tamari"];
const TREE_NUT = ["almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut", "macadamia", "pine nut", "brazil nut"];
const OILY_FISH = ["salmon", "sardine", "mackerel", "herring", "trout", "anchov", "tuna"];
const LEGUMES = ["bean", "lentil", "chickpea", "garbanzo", "edamame", "pea", "hummus", "tofu", "tempeh", "dal"];
const FERMENTED = ["yogurt", "yoghurt", "kefir", "kimchi", "sauerkraut", "miso", "tempeh", "kombucha", "natto"];
const ULTRA_PROCESSED = ["cake mix", "hot dog", "processed cheese", "american cheese", "soda", "candy", "frozen pizza", "instant noodle", "ramen packet", "bouillon cube", "margarine", "cool whip", "marshmallow", "frosting", "velveeta", "spam", "chicken nugget", "cream of mushroom soup", "cream of chicken soup"];
const SPICY = ["chili", "chile", "jalapeño", "jalapeno", "cayenne", "sriracha", "habanero", "chipotle", "gochujang", "harissa", "hot sauce", "red pepper flakes", "chili flakes", "curry paste"];
const NON_PLANT = [...MEAT, ...FISH, ...SHELLFISH, ...DAIRY, ...EGG, "salt", "water", "oil", "sugar", "baking powder", "baking soda", "stock", "broth", "gelatin", "honey", "vinegar"];

const AISLE_RULES: [Aisle, string[]][] = [
  ["meat-seafood", [...MEAT, ...FISH, ...SHELLFISH]],
  ["dairy-eggs", [...DAIRY, ...EGG, "tofu", "hummus", "kimchi", "tempeh"]],
  ["frozen", ["frozen", "edamame", "ice cream"]],
  ["bakery", ["bread", "tortilla", "bun", "pita", "bagel", "naan", "roll"]],
  ["grains-pasta", ["rice", "pasta", "spaghetti", "noodle", "quinoa", "oat", "couscous", "farro", "barley", "bulgur", "lentil", "flour"]],
  ["canned", ["canned", "can ", "tomato paste", "crushed tomatoes", "diced tomatoes", "coconut milk", "broth", "stock", "marinara", "beans"]],
  ["spices", ["cumin", "paprika", "oregano", "thyme", "cinnamon", "turmeric", "coriander", "chili powder", "curry powder", "seasoning", "pepper flakes", "nutmeg", "cayenne", "black pepper", "salt", "bay lea", "garam masala", "dried"]],
  ["produce", ["onion", "garlic", "tomato", "pepper", "carrot", "celery", "spinach", "kale", "lettuce", "broccoli", "zucchini", "potato", "lemon", "lime", "apple", "banana", "berr", "avocado", "cucumber", "mushroom", "ginger", "cilantro", "parsley", "basil", "mint", "scallion", "leek", "cabbage", "squash", "cauliflower", "asparagus", "bean sprout", "green bean", "pear", "orange", "herb", "arugula", "chard", "beet", "corn", "eggplant", "radish", "shallot", "jalape"]],
  ["pantry", ["oil", "vinegar", "sauce", "sugar", "honey", "syrup", "nut", "seed", "butter", "stock", "mustard", "mayo", "ketchup", "jam", "cocoa", "chocolate", "baking", "vanilla", "yeast", "cornstarch", "tahini", "raisin", "date"]],
];

export function classifyAisle(name: string): Aisle {
  // Order matters: "peanut butter" is pantry, not dairy; "coconut milk" is canned.
  if (has(name, ["peanut butter", "almond butter", "coconut milk", "coconut cream"])) return has(name, ["coconut"]) ? "canned" : "pantry";
  if (has(name, ["dried", "ground "]) && !has(name, ["ground beef", "ground turkey", "ground pork", "ground chicken", "ground lamb"])) return "spices";
  for (const [aisle, words] of AISLE_RULES) if (has(name, words)) return aisle;
  return "other";
}

export function detectAllergens(name: string): Allergen[] {
  const out = new Set<Allergen>();
  const plantDairy = has(name, PLANT_MILK);
  if (has(name, DAIRY) && !plantDairy) out.add("dairy");
  if (has(name, EGG) && !has(name, ["eggplant", "vegan mayo"])) out.add("egg");
  if (has(name, ["peanut"])) out.add("peanut");
  if (has(name, TREE_NUT)) out.add("tree-nut");
  if (has(name, ["soy", "tofu", "edamame", "tempeh", "miso", "tamari"])) out.add("soy");
  if (has(name, FISH) || has(name, ["fish sauce", "worcestershire"])) out.add("fish");
  if (has(name, SHELLFISH) || has(name, ["oyster sauce"])) out.add("shellfish");
  if (has(name, ["sesame", "tahini", "hummus"])) out.add("sesame");
  if (has(name, GLUTEN) && !has(name, GLUTEN_FREE_MARKERS)) out.add("gluten");
  return [...out];
}

export function isPlant(name: string): boolean {
  return !has(name, NON_PLANT) || has(name, PLANT_MILK) || has(name, ["olive oil", "nut", "seed", "bean", "lentil"]);
}

export function toIngredient(line: string, parsed?: { quantity?: number; unit?: string; name?: string }): Ingredient {
  const p = parseIngredientLine(line);
  const name = (parsed?.name ?? p.name).toLowerCase().trim();
  return {
    name,
    quantity: parsed?.quantity && parsed.quantity > 0 ? round(parsed.quantity) : p.quantity,
    unit: parsed?.unit !== undefined ? mapUnit(parsed.unit) : p.unit,
    aisle: classifyAisle(name),
    allergens: detectAllergens(`${name} ${line}`.toLowerCase()),
    plant: isPlant(name),
    ...(line.trim() ? { original: line.trim() } : {}),
  };
}

// ---------- recipe-level derivations ----------

export function deriveDiets(ingredients: Ingredient[], perServing: Macros, declared: Diet[] = []): Diet[] {
  const names = ingredients.map((i) => i.name);
  const any = (words: string[]) => names.some((n) => has(n, words) && !has(n, PLANT_MILK));
  const meat = any(MEAT), fish = any([...FISH, ...SHELLFISH]), dairy = any(DAIRY), egg = names.some((n) => has(n, EGG) && !has(n, ["eggplant"])), other = any(OTHER_ANIMAL);
  const diets = new Set<Diet>(["omnivore", ...declared]);
  if (!meat) diets.add("pescatarian");
  if (!meat && !fish) diets.add("vegetarian");
  if (!meat && !fish && !dairy && !egg && !other) diets.add("vegan");
  const carbs = perServing.carbsG - perServing.fiberG;
  if (carbs <= 15 && perServing.fatG * 9 >= perServing.calories * 0.6) diets.add("keto");
  return [...diets];
}

export function deriveLongevity(ingredients: Ingredient[], perServing: Macros): LongevityProfile {
  const names = ingredients.map((i) => i.name);
  const animal = names.some((n) => has(n, [...MEAT, ...FISH, ...SHELLFISH, ...DAIRY, ...EGG]) && !has(n, PLANT_MILK));
  return {
    // Leucine is ~8–9% of animal protein and ~7% of plant protein: an estimate, not a lab value.
    leucineG: round(perServing.proteinG * (animal ? 0.085 : 0.07)),
    // A serving of oily fish typically carries 1–2 g EPA+DHA; flag it, don't pretend precision.
    omega3G: names.some((n) => has(n, OILY_FISH)) ? 1.5 : 0,
    wholeFood: !names.some((n) => has(n, ULTRA_PROCESSED)),
    legumes: names.some((n) => has(n, LEGUMES) && !has(n, ["peanut", "sweet pea"])),
    fermented: names.some((n) => has(n, FERMENTED)),
  };
}

const MEAL_TYPE_WORDS: [MealType, string[]][] = [
  ["breakfast", ["breakfast", "brunch", "morning meal"]],
  ["lunch", ["lunch", "salad", "sandwich", "soup", "main course", "main dish", "lunch/dinner"]],
  ["dinner", ["dinner", "main course", "main dish", "entree", "lunch/dinner"]],
  ["snack", ["snack", "appetizer", "fingerfood", "dip", "starter"]],
];

export function deriveMealTypes(labels: string[]): MealType[] {
  const text = labels.join(" ").toLowerCase();
  const out = MEAL_TYPE_WORDS.filter(([, words]) => words.some((w) => text.includes(w))).map(([t]) => t);
  return out.length ? out : [];
}

export function isKidFriendly(ingredients: Ingredient[], timeMinutes: number): boolean {
  return timeMinutes <= 60 && !ingredients.some((i) => has(i.name, SPICY));
}

/** Nutrition is required: recipes without calories and protein are rejected at import. */
export function hasUsableNutrition(n: Partial<Macros> | undefined): n is Macros {
  return !!n && (n.calories ?? 0) > 0 && typeof n.proteinG === "number" && typeof n.carbsG === "number" && typeof n.fatG === "number";
}

export function buildRecipe(args: {
  id: string;
  title: string;
  ingredients: Ingredient[];
  steps: string[];
  servings: number;
  timeMinutes?: number;
  perServing: Macros;
  mealTypes: MealType[];
  cuisine?: string;
  tags?: string[];
  declaredDiets?: Diet[];
  imageUrl?: string;
  source: Recipe["source"];
  nutritionBasis?: Recipe["nutritionBasis"];
}): Recipe {
  const timeMinutes = args.timeMinutes && args.timeMinutes > 0 ? args.timeMinutes : 45;
  const perServing = { ...args.perServing, fiberG: args.perServing.fiberG ?? 0 };
  return {
    id: args.id,
    title: args.title.trim(),
    mealTypes: args.mealTypes.length ? args.mealTypes : ["lunch", "dinner"],
    cuisine: (args.cuisine ?? "other").toLowerCase(),
    timeMinutes,
    servings: Math.max(1, Math.round(args.servings) || 1),
    diets: deriveDiets(args.ingredients, perServing, args.declaredDiets),
    tags: [...new Set((args.tags ?? []).map((t) => t.toLowerCase()))],
    kidFriendly: isKidFriendly(args.ingredients, timeMinutes),
    ingredients: args.ingredients,
    steps: args.steps,
    nutritionPerServing: roundMacros(perServing),
    longevity: deriveLongevity(args.ingredients, perServing),
    imageUrl: args.imageUrl,
    source: args.source,
    ...(args.nutritionBasis ? { nutritionBasis: args.nutritionBasis } : {}),
  };
}

export function roundMacros(m: Macros): Macros {
  return { calories: Math.round(m.calories), proteinG: round(m.proteinG), carbsG: round(m.carbsG), fatG: round(m.fatG), fiberG: round(m.fiberG) };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
