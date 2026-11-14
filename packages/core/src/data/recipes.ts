import type { Aisle, Allergen, Diet, Ingredient, Recipe, Unit } from "../types";

/**
 * Seed recipes for development and tests. Production recipes live in the
 * database (supabase/migrations) and are curated by a nutrition editor.
 * Nutrition values are per serving and approximate.
 */
const i = (name: string, quantity: number, unit: Unit, aisle: Aisle, opts: { plant?: boolean; allergens?: Allergen[] } = {}): Ingredient => ({ name, quantity, unit, aisle, ...opts });
const P = { plant: true };
const OMNI: Diet[] = ["omnivore"];
const PESC: Diet[] = ["omnivore", "pescatarian", "mediterranean"];
const VEG: Diet[] = ["omnivore", "pescatarian", "vegetarian", "mediterranean"];
const VEGAN: Diet[] = ["omnivore", "pescatarian", "vegetarian", "vegan", "mediterranean"];

export const SAMPLE_RECIPES: Recipe[] = [
  {
    id: "greek-yogurt-bowl", title: "Greek Yogurt Berry Protein Bowl", mealTypes: ["breakfast", "snack"], cuisine: "american",
    timeMinutes: 5, servings: 1, diets: VEG, tags: ["no-cook", "quick"], kidFriendly: true,
    ingredients: [
      i("plain greek yogurt", 250, "g", "dairy-eggs", { allergens: ["dairy"] }), i("mixed berries", 100, "g", "produce", P),
      i("walnuts", 15, "g", "pantry", { plant: true, allergens: ["tree-nut"] }), i("chia seeds", 1, "tbsp", "pantry", P),
    ],
    steps: ["Spoon yogurt into a bowl.", "Top with berries, walnuts and chia."],
    nutritionPerServing: { calories: 380, proteinG: 28, carbsG: 26, fatG: 18, fiberG: 8 },
    longevity: { leucineG: 2.6, omega3G: 0.1, wholeFood: true, legumes: false, fermented: true },
  },
  {
    id: "veggie-egg-scramble", title: "Spinach & Feta Egg Scramble", mealTypes: ["breakfast"], cuisine: "mediterranean",
    timeMinutes: 12, servings: 2, diets: VEG, tags: ["quick", "low-carb"], kidFriendly: true,
    ingredients: [
      i("eggs", 6, "each", "dairy-eggs", { allergens: ["egg"] }), i("baby spinach", 100, "g", "produce", P),
      i("feta", 60, "g", "dairy-eggs", { allergens: ["dairy"] }), i("cherry tomatoes", 150, "g", "produce", P),
      i("whole grain toast", 2, "each", "bakery", { plant: true, allergens: ["gluten"] }),
    ],
    steps: ["Wilt spinach and tomatoes in a pan.", "Add beaten eggs and scramble gently.", "Crumble feta over; serve with toast."],
    nutritionPerServing: { calories: 420, proteinG: 29, carbsG: 22, fatG: 24, fiberG: 5 },
    longevity: { leucineG: 2.5, omega3G: 0.1, wholeFood: true, legumes: false, fermented: false },
  },
  {
    id: "overnight-oats", title: "Peanut Butter Overnight Oats", mealTypes: ["breakfast"], cuisine: "american",
    timeMinutes: 5, servings: 2, diets: VEGAN, tags: ["make-ahead", "budget"], kidFriendly: true,
    ingredients: [
      i("rolled oats", 100, "g", "grains-pasta", P), i("soy milk", 400, "ml", "dairy-eggs", { plant: true, allergens: ["soy"] }),
      i("peanut butter", 2, "tbsp", "pantry", { plant: true, allergens: ["peanut"] }), i("banana", 1, "each", "produce", P),
      i("ground flaxseed", 2, "tbsp", "pantry", P),
    ],
    steps: ["Mix everything in jars.", "Refrigerate overnight."],
    nutritionPerServing: { calories: 450, proteinG: 18, carbsG: 58, fatG: 16, fiberG: 10 },
    longevity: { leucineG: 1.3, omega3G: 0, wholeFood: true, legumes: true, fermented: false },
  },
  {
    id: "salmon-quinoa-bowl", title: "Sheet-Pan Salmon & Quinoa Bowls", mealTypes: ["lunch", "dinner"], cuisine: "mediterranean",
    timeMinutes: 30, servings: 2, diets: PESC, tags: ["sheet-pan", "omega-3"], kidFriendly: false,
    ingredients: [
      i("salmon fillets", 300, "g", "meat-seafood", { allergens: ["fish"] }), i("quinoa", 120, "g", "grains-pasta", P),
      i("broccoli", 250, "g", "produce", P), i("lemon", 1, "each", "produce", P), i("olive oil", 2, "tbsp", "pantry", P),
      i("garlic", 2, "clove", "produce", P),
    ],
    steps: ["Cook quinoa.", "Roast salmon and broccoli with oil, garlic and lemon at 220°C for 15 min.", "Assemble bowls."],
    nutritionPerServing: { calories: 610, proteinG: 40, carbsG: 45, fatG: 28, fiberG: 8 },
    longevity: { leucineG: 3.2, omega3G: 2.2, wholeFood: true, legumes: false, fermented: false },
  },
  {
    id: "chicken-tacos", title: "15-Minute Chicken Tacos", mealTypes: ["dinner"], cuisine: "mexican",
    timeMinutes: 15, servings: 4, diets: OMNI, tags: ["quick", "family"], kidFriendly: true,
    ingredients: [
      i("chicken thighs", 600, "g", "meat-seafood"), i("corn tortillas", 12, "each", "bakery", P),
      i("black beans", 1, "can", "canned", P), i("avocado", 2, "each", "produce", P), i("lime", 1, "each", "produce", P),
      i("cilantro", 1, "bunch", "produce", P), i("taco seasoning", 2, "tbsp", "spices"),
    ],
    steps: ["Season and sear chicken, then slice.", "Warm tortillas and beans.", "Build tacos with avocado, cilantro and lime."],
    nutritionPerServing: { calories: 560, proteinG: 38, carbsG: 50, fatG: 22, fiberG: 13 },
    longevity: { leucineG: 3.0, omega3G: 0, wholeFood: true, legumes: true, fermented: false },
  },
  {
    id: "turkey-meatballs", title: "Turkey Meatballs with Marinara & Zucchini", mealTypes: ["dinner"], cuisine: "italian",
    timeMinutes: 35, servings: 4, diets: OMNI, tags: ["family", "freezer-friendly"], kidFriendly: true,
    ingredients: [
      i("ground turkey", 700, "g", "meat-seafood"), i("eggs", 1, "each", "dairy-eggs", { allergens: ["egg"] }),
      i("parmesan", 40, "g", "dairy-eggs", { allergens: ["dairy"] }), i("marinara sauce", 700, "ml", "canned", P),
      i("zucchini", 2, "each", "produce", P), i("whole wheat spaghetti", 300, "g", "grains-pasta", { plant: true, allergens: ["gluten"] }),
    ],
    steps: ["Mix turkey, egg and parmesan; roll meatballs.", "Bake 18 min at 200°C.", "Simmer in marinara; serve over pasta and zucchini."],
    nutritionPerServing: { calories: 640, proteinG: 46, carbsG: 62, fatG: 20, fiberG: 9 },
    longevity: { leucineG: 3.6, omega3G: 0.1, wholeFood: true, legumes: false, fermented: false },
  },
  {
    id: "lentil-curry", title: "Red Lentil & Spinach Curry", mealTypes: ["lunch", "dinner"], cuisine: "indian",
    timeMinutes: 30, servings: 4, diets: VEGAN, tags: ["one-pot", "budget", "batch"], kidFriendly: false,
    ingredients: [
      i("red lentils", 300, "g", "grains-pasta", P), i("coconut milk", 1, "can", "canned", P), i("crushed tomatoes", 1, "can", "canned", P),
      i("baby spinach", 150, "g", "produce", P), i("onion", 1, "each", "produce", P), i("garlic", 3, "clove", "produce", P),
      i("curry powder", 2, "tbsp", "spices"), i("brown rice", 200, "g", "grains-pasta", P),
    ],
    steps: ["Soften onion and garlic.", "Add curry powder, lentils, tomatoes and coconut milk; simmer 20 min.", "Stir in spinach; serve with rice."],
    nutritionPerServing: { calories: 560, proteinG: 22, carbsG: 78, fatG: 18, fiberG: 16 },
    longevity: { leucineG: 1.7, omega3G: 0, wholeFood: true, legumes: true, fermented: false },
  },
  {
    id: "tofu-stir-fry", title: "Crispy Tofu & Edamame Stir-Fry", mealTypes: ["lunch", "dinner"], cuisine: "asian",
    timeMinutes: 25, servings: 2, diets: VEGAN, tags: ["high-protein-plant"], kidFriendly: false,
    ingredients: [
      i("extra-firm tofu", 400, "g", "dairy-eggs", { plant: true, allergens: ["soy"] }), i("edamame", 150, "g", "frozen", { plant: true, allergens: ["soy"] }),
      i("bell pepper", 2, "each", "produce", P), i("broccoli", 200, "g", "produce", P), i("soy sauce", 3, "tbsp", "pantry", { allergens: ["soy", "gluten"] }),
      i("ginger", 1, "tbsp", "produce", P), i("brown rice", 150, "g", "grains-pasta", P),
    ],
    steps: ["Press and cube tofu; pan-fry until crisp.", "Stir-fry vegetables and edamame with ginger.", "Toss with soy sauce; serve over rice."],
    nutritionPerServing: { calories: 590, proteinG: 36, carbsG: 60, fatG: 22, fiberG: 11 },
    longevity: { leucineG: 2.6, omega3G: 0.3, wholeFood: true, legumes: true, fermented: false },
  },
  {
    id: "sardine-pasta", title: "Lemony Sardine & White Bean Pasta", mealTypes: ["dinner"], cuisine: "italian",
    timeMinutes: 20, servings: 2, diets: PESC, tags: ["pantry", "omega-3"], kidFriendly: false,
    ingredients: [
      i("sardines in olive oil", 2, "can", "canned", { allergens: ["fish"] }), i("white beans", 1, "can", "canned", P),
      i("whole wheat spaghetti", 160, "g", "grains-pasta", { plant: true, allergens: ["gluten"] }), i("lemon", 1, "each", "produce", P),
      i("garlic", 2, "clove", "produce", P), i("kale", 100, "g", "produce", P), i("chili flakes", 1, "tsp", "spices"),
    ],
    steps: ["Cook pasta.", "Warm garlic, chili and sardines; add kale and beans.", "Toss with pasta and lemon."],
    nutritionPerServing: { calories: 640, proteinG: 38, carbsG: 72, fatG: 20, fiberG: 14 },
    longevity: { leucineG: 3.0, omega3G: 1.8, wholeFood: true, legumes: true, fermented: false },
  },
  {
    id: "steak-sweet-potato", title: "Steak, Sweet Potato & Greens", mealTypes: ["dinner"], cuisine: "american",
    timeMinutes: 30, servings: 2, diets: ["omnivore", "paleo"], tags: ["high-protein"], kidFriendly: true,
    ingredients: [
      i("sirloin steak", 400, "g", "meat-seafood"), i("sweet potatoes", 2, "each", "produce", P),
      i("green beans", 200, "g", "produce", P), i("olive oil", 1, "tbsp", "pantry", P), i("garlic", 2, "clove", "produce", P),
    ],
    steps: ["Roast sweet potato wedges 25 min.", "Sear steak to taste and rest.", "Sauté green beans with garlic."],
    nutritionPerServing: { calories: 620, proteinG: 48, carbsG: 45, fatG: 24, fiberG: 8 },
    longevity: { leucineG: 3.9, omega3G: 0.1, wholeFood: true, legumes: false, fermented: false },
  },
  {
    id: "chickpea-salad", title: "Mediterranean Chickpea & Chicken Salad", mealTypes: ["lunch"], cuisine: "mediterranean",
    timeMinutes: 15, servings: 2, diets: OMNI, tags: ["no-cook", "meal-prep"], kidFriendly: false,
    ingredients: [
      i("rotisserie chicken", 250, "g", "meat-seafood"), i("chickpeas", 1, "can", "canned", P), i("cucumber", 1, "each", "produce", P),
      i("cherry tomatoes", 200, "g", "produce", P), i("red onion", 0.5, "each", "produce", P), i("feta", 50, "g", "dairy-eggs", { allergens: ["dairy"] }),
      i("olive oil", 2, "tbsp", "pantry", P), i("lemon", 1, "each", "produce", P),
    ],
    steps: ["Chop vegetables.", "Toss everything with oil and lemon."],
    nutritionPerServing: { calories: 560, proteinG: 42, carbsG: 34, fatG: 28, fiberG: 11 },
    longevity: { leucineG: 3.3, omega3G: 0.1, wholeFood: true, legumes: true, fermented: false },
  },
  {
    id: "turkey-hummus-wrap", title: "Turkey & Hummus Veggie Wraps", mealTypes: ["lunch"], cuisine: "american",
    timeMinutes: 10, servings: 2, diets: OMNI, tags: ["lunchbox", "quick"], kidFriendly: true,
    ingredients: [
      i("whole wheat tortillas", 2, "each", "bakery", { plant: true, allergens: ["gluten"] }), i("sliced turkey", 200, "g", "meat-seafood"),
      i("hummus", 4, "tbsp", "dairy-eggs", { plant: true, allergens: ["sesame"] }), i("baby spinach", 60, "g", "produce", P),
      i("carrots", 2, "each", "produce", P),
    ],
    steps: ["Spread hummus on tortillas.", "Layer turkey, spinach and grated carrot; roll up."],
    nutritionPerServing: { calories: 430, proteinG: 32, carbsG: 40, fatG: 14, fiberG: 8 },
    longevity: { leucineG: 2.6, omega3G: 0, wholeFood: false, legumes: true, fermented: false },
  },
  {
    id: "kimchi-fried-rice", title: "Kimchi Fried Rice with Eggs", mealTypes: ["lunch", "dinner"], cuisine: "korean",
    timeMinutes: 20, servings: 2, diets: VEG, tags: ["fermented", "leftover-rice"], kidFriendly: false,
    ingredients: [
      i("cooked brown rice", 400, "g", "grains-pasta", P), i("kimchi", 150, "g", "dairy-eggs", P), i("eggs", 4, "each", "dairy-eggs", { allergens: ["egg"] }),
      i("edamame", 100, "g", "frozen", { plant: true, allergens: ["soy"] }), i("scallions", 1, "bunch", "produce", P),
      i("sesame oil", 1, "tbsp", "pantry", { allergens: ["sesame"] }),
    ],
    steps: ["Fry kimchi in sesame oil.", "Add rice and edamame; crisp.", "Top with fried eggs and scallions."],
    nutritionPerServing: { calories: 540, proteinG: 26, carbsG: 62, fatG: 20, fiberG: 8 },
    longevity: { leucineG: 2.2, omega3G: 0.1, wholeFood: true, legumes: true, fermented: true },
  },
  {
    id: "cottage-cheese-snack", title: "Cottage Cheese, Fruit & Pumpkin Seeds", mealTypes: ["snack"], cuisine: "american",
    timeMinutes: 2, servings: 1, diets: VEG, tags: ["no-cook"], kidFriendly: true,
    ingredients: [
      i("cottage cheese", 200, "g", "dairy-eggs", { allergens: ["dairy"] }), i("pear", 1, "each", "produce", P), i("pumpkin seeds", 15, "g", "pantry", P),
    ],
    steps: ["Top cottage cheese with sliced pear and seeds."],
    nutritionPerServing: { calories: 300, proteinG: 26, carbsG: 26, fatG: 10, fiberG: 5 },
    longevity: { leucineG: 2.6, omega3G: 0, wholeFood: true, legumes: false, fermented: true },
  },
];
