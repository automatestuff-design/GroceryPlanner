import type { Allergen, Recipe } from "@mealplan/core";

/** Column list shared by every recipe read. */
export const RECIPE_COLUMNS = `id, title, meal_types, cuisine, time_minutes, servings, diets, tags, kid_friendly,
  ingredients, steps, nutrition_per_serving, longevity, image_url,
  source_provider, source_name, source_url, attribution, license`;

export interface RecipeRow {
  id: string;
  title: string;
  meal_types: string[];
  cuisine: string | null;
  time_minutes: number;
  servings: number;
  diets: string[];
  tags: string[];
  kid_friendly: boolean;
  ingredients: Recipe["ingredients"];
  steps: string[];
  nutrition_per_serving: Recipe["nutritionPerServing"];
  longevity: Recipe["longevity"];
  image_url: string | null;
  source_provider: string;
  source_name: string | null;
  source_url: string | null;
  attribution: string | null;
  license: string | null;
}

export function rowToRecipe(r: RecipeRow): Recipe {
  return {
    id: r.id,
    title: r.title,
    mealTypes: r.meal_types as Recipe["mealTypes"],
    cuisine: r.cuisine ?? "other",
    timeMinutes: r.time_minutes,
    servings: r.servings,
    diets: r.diets as Recipe["diets"],
    tags: r.tags,
    kidFriendly: r.kid_friendly,
    ingredients: r.ingredients,
    steps: r.steps,
    nutritionPerServing: r.nutrition_per_serving,
    longevity: r.longevity,
    imageUrl: r.image_url ?? undefined,
    source:
      r.source_name || r.source_provider !== "catalog"
        ? {
            provider: r.source_provider,
            name: r.source_name ?? "",
            url: r.source_url ?? undefined,
            attribution: r.attribution ?? undefined,
            license: r.license ?? undefined,
          }
        : undefined,
  };
}

/** Columns written on insert/upsert, in the order `recipeToParams` returns them. */
export const UPSERT_COLUMNS = `id, title, meal_types, cuisine, time_minutes, servings, diets, tags, kid_friendly,
  ingredients, steps, nutrition_per_serving, longevity, image_url,
  source_provider, source_name, source_url, attribution, license, allergens`;

export const UPSERT_PLACEHOLDERS = Array.from({ length: 20 }, (_, i) => `$${i + 1}`).join(", ");

export function recipeToParams(r: Recipe): unknown[] {
  const allergens = [...new Set(r.ingredients.flatMap((i) => i.allergens ?? []))] as Allergen[];
  return [
    r.id,
    r.title,
    r.mealTypes,
    r.cuisine,
    r.timeMinutes,
    r.servings,
    r.diets,
    r.tags,
    r.kidFriendly,
    JSON.stringify(r.ingredients),
    JSON.stringify(r.steps),
    JSON.stringify(r.nutritionPerServing),
    JSON.stringify(r.longevity),
    r.imageUrl ?? null,
    r.source?.provider ?? "catalog",
    r.source?.name ?? null,
    r.source?.url ?? null,
    r.source?.attribution ?? null,
    r.source?.license ?? null,
    allergens,
  ];
}
