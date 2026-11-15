/**
 * Domain model. Every number the user sees (portions, macros, quantities,
 * longevity scores) is computed by the engine from these types. The chat
 * assistant only reads and requests changes; it never invents numbers.
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Personal = one adult; family = several members with their own portions and restrictions. */
export type HouseholdMode = "personal" | "family";

/** How the week is built: pick meals per slot, or hit daily macro targets. */
export type PlanStrategy = "meal-type" | "macro";

/** Standard eating, or the Longevity track (muscle span / healthspan rules). */
export type PlanTrack = "standard" | "longevity";

export type Diet = "omnivore" | "pescatarian" | "vegetarian" | "vegan" | "keto" | "paleo" | "mediterranean";
export type Allergen = "gluten" | "dairy" | "egg" | "peanut" | "tree-nut" | "soy" | "fish" | "shellfish" | "sesame";

export type AgeGroup = "adult" | "teen" | "child" | "toddler";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very-active";

export interface Macros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

export interface Member {
  id: string;
  name: string;
  ageGroup: AgeGroup;
  age?: number;
  sex?: "female" | "male";
  heightCm?: number;
  weightKg?: number;
  activity?: ActivityLevel;
  allergies: Allergen[];
  dislikes: string[];
  /** Overrides the age-group default portion (1.0 = one adult serving). */
  portionOverride?: number;
  /** Explicit daily targets; otherwise computed from body stats. */
  macroTargets?: Partial<Macros>;
}

export interface Household {
  id: string;
  name: string;
  mode: HouseholdMode;
  diet: Diet;
  members: Member[];
  /** Ingredients already on hand; dropped from the shopping list. */
  pantry: string[];
}

export type Aisle =
  | "produce" | "meat-seafood" | "dairy-eggs" | "bakery" | "pantry"
  | "frozen" | "spices" | "canned" | "grains-pasta" | "other";

export type Unit = "g" | "kg" | "ml" | "l" | "tsp" | "tbsp" | "cup" | "oz" | "lb" | "each" | "clove" | "can" | "bunch";

export interface Ingredient {
  name: string;
  quantity: number;
  unit: Unit;
  aisle: Aisle;
  /** Allergens this ingredient carries. */
  allergens?: Allergen[];
  /** Counts toward the Longevity "plant diversity" goal. */
  plant?: boolean;
}

export interface LongevityProfile {
  /** Approximate leucine per serving, g. ~2.5–3 g per meal stimulates muscle protein synthesis in older adults. */
  leucineG: number;
  /** Long-chain omega-3 (EPA+DHA) per serving, g. */
  omega3G: number;
  /** Mostly whole foods (NOVA 1–3), not ultra-processed. */
  wholeFood: boolean;
  /** Contains legumes (beans, lentils, chickpeas). */
  legumes: boolean;
  /** Fermented food (yogurt, kefir, kimchi, miso). */
  fermented: boolean;
}

/** Where a recipe came from, and what its terms let us do with it. */
export interface RecipeSourceInfo {
  /** Provider key, e.g. "catalog", "spoonacular", "edamam", "jsonld". */
  provider: string;
  /** Publisher shown to the user, e.g. "Serious Eats" or "USDA MyPlate Kitchen". */
  name: string;
  url?: string;
  /** Credit line the source requires us to show. */
  attribution?: string;
  license?: string;
}

export interface Recipe {
  /** Namespaced for external sources: "spoonacular:715538", "edamam:abc123". Plain for catalog recipes. */
  id: string;
  title: string;
  mealTypes: MealType[];
  cuisine: string;
  timeMinutes: number;
  /** Base servings the ingredient quantities are written for. */
  servings: number;
  diets: Diet[];
  tags: string[];
  kidFriendly: boolean;
  ingredients: Ingredient[];
  /** Empty when the source only allows linking out to its instructions (e.g. Edamam). */
  steps: string[];
  nutritionPerServing: Macros;
  longevity: LongevityProfile;
  imageUrl?: string;
  source?: RecipeSourceInfo;
}

/** What the planner asks a recipe provider for. */
export interface RecipeQuery {
  mealTypes: MealType[];
  diet: Diet;
  excludeAllergens: Allergen[];
  maxCookMinutes?: number;
  /** Free text from chat, e.g. "salmon" or "sheet pan". */
  text?: string;
  /** Candidates wanted per meal type. */
  limit?: number;
  /** Stable shuffle: the same seed returns the same candidates, a new seed a fresh set. */
  seed?: number;
}

export interface PlanRequest {
  household: Household;
  weekStart: string; // ISO date (Monday)
  strategy: PlanStrategy;
  track: PlanTrack;
  /** Which meals to plan on each day. */
  slots: Partial<Record<Weekday, MealType[]>>;
  maxCookMinutes?: number;
  /** Prefer leftovers: cook dinner once, eat it again for next day's lunch. */
  leftovers?: boolean;
  /** Recipes to exclude (e.g. eaten recently). */
  excludeRecipeIds?: string[];
  seed?: number;
}

export interface PlannedMeal {
  day: Weekday;
  slot: MealType;
  recipeId: string;
  /** Adult-equivalent servings to cook, summed across eaters. */
  servings: number;
  eaterIds: string[];
  leftoverOf?: { day: Weekday; slot: MealType };
}

export interface WeekPlan {
  id: string;
  householdId: string;
  weekStart: string;
  strategy: PlanStrategy;
  track: PlanTrack;
  meals: PlannedMeal[];
  createdAt: string;
}

export interface ShoppingItem {
  name: string;
  quantity: number;
  unit: Unit;
  aisle: Aisle;
  recipeIds: string[];
}

export interface ShoppingList {
  planId: string;
  items: ShoppingItem[];
  pantryExcluded: string[];
}

/** Something the household added by hand ("paper towels"). Kept across plans until removed. */
export interface ExtraItem {
  id: string;
  name: string;
  /** Free text, e.g. "2 rolls". */
  quantity?: string;
  checked: boolean;
}

/** The list as the user sees it: plan ingredients with check state, plus their own items. */
export interface GroceryList {
  /** Null when there's no plan yet; the list can still hold extras. */
  planId: string | null;
  items: (ShoppingItem & { key: string; checked: boolean })[];
  extras: ExtraItem[];
  pantryExcluded: string[];
}
