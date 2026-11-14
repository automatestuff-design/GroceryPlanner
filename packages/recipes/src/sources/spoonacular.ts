import type { Allergen, Diet, Recipe, RecipeQuery } from "@mealplan/core";
import { buildRecipe, deriveMealTypes, hasUsableNutrition, toIngredient } from "../normalize";
import type { RecipeSource } from "../types";

/**
 * Spoonacular Food API (https://spoonacular.com/food-api). Search with nutrition,
 * ingredients and steps in one call. Its terms allow caching responses for up to
 * one hour (recipe ids may be stored indefinitely), so this source is "cache" policy.
 */
const BASE = "https://api.spoonacular.com";

const DIET: Partial<Record<Diet, string>> = { vegan: "vegan", vegetarian: "vegetarian", pescatarian: "pescetarian", keto: "ketogenic", paleo: "paleo" };
const INTOLERANCE: Record<Allergen, string> = {
  gluten: "gluten", dairy: "dairy", egg: "egg", peanut: "peanut", "tree-nut": "tree nut", soy: "soy", fish: "seafood", shellfish: "shellfish", sesame: "sesame",
};
const TYPE: Record<string, string> = { breakfast: "breakfast", lunch: "main course", dinner: "main course", snack: "snack" };

interface SpNutrient { name: string; amount: number; unit: string }
interface SpRecipe {
  id: number; title: string; image?: string; readyInMinutes?: number; servings?: number;
  sourceUrl?: string; sourceName?: string; creditsText?: string; license?: string;
  cuisines?: string[]; dishTypes?: string[]; diets?: string[];
  vegan?: boolean; vegetarian?: boolean;
  extendedIngredients?: { name?: string; original?: string; amount?: number; unit?: string }[];
  analyzedInstructions?: { steps?: { step: string }[] }[];
  nutrition?: { nutrients?: SpNutrient[] };
}

export class SpoonacularSource implements RecipeSource {
  constructor(private apiKey = process.env.SPOONACULAR_API_KEY, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  info() {
    return {
      provider: "spoonacular", name: "Spoonacular", storage: "cache" as const, cacheTtlSeconds: 3600,
      attribution: "Recipe data from spoonacular", configured: !!this.apiKey,
    };
  }

  async search(q: RecipeQuery): Promise<Recipe[]> {
    if (!this.apiKey) return [];
    const types = [...new Set(q.mealTypes.map((t) => TYPE[t]))];
    const pages = await Promise.all(types.map((type) => this.call<{ results: SpRecipe[] }>("/recipes/complexSearch", {
      type: type!,
      query: q.text ?? "",
      diet: DIET[q.diet] ?? "",
      intolerances: q.excludeAllergens.map((a) => INTOLERANCE[a]).join(","),
      maxReadyTime: q.maxCookMinutes ? String(q.maxCookMinutes) : "",
      addRecipeInformation: "true", addRecipeNutrition: "true", fillIngredients: "true", instructionsRequired: "true",
      sort: "popularity", number: String(Math.min(q.limit ?? 40, 100)),
    })));
    return pages.flatMap((p) => p.results).map(toRecipe).filter((r): r is Recipe => !!r);
  }

  async getMany(ids: string[]): Promise<Recipe[]> {
    if (!this.apiKey || !ids.length) return [];
    const raw = ids.map((id) => id.replace(/^spoonacular:/, "")).join(",");
    const list = await this.call<SpRecipe[]>("/recipes/informationBulk", { ids: raw, includeNutrition: "true" });
    return list.map(toRecipe).filter((r): r is Recipe => !!r);
  }

  private async call<T>(path: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== ""));
    const res = await this.fetchImpl(`${BASE}${path}?${qs}`, { headers: { "x-api-key": this.apiKey! } });
    if (!res.ok) throw new Error(`Spoonacular ${res.status}`);
    return res.json() as Promise<T>;
  }
}

export function toRecipe(r: SpRecipe): Recipe | null {
  const n = (name: string) => r.nutrition?.nutrients?.find((x) => x.name === name)?.amount;
  const perServing = { calories: n("Calories"), proteinG: n("Protein"), carbsG: n("Carbohydrates"), fatG: n("Fat"), fiberG: n("Fiber") ?? 0 };
  if (!hasUsableNutrition(perServing) || !r.extendedIngredients?.length) return null;
  const declared: Diet[] = [...(r.vegan ? ["vegan" as const] : []), ...(r.vegetarian ? ["vegetarian" as const] : [])];
  return buildRecipe({
    id: `spoonacular:${r.id}`,
    title: r.title,
    ingredients: r.extendedIngredients.map((i) => toIngredient(i.original ?? i.name ?? "", { name: i.name, quantity: i.amount, unit: i.unit })),
    steps: (r.analyzedInstructions ?? []).flatMap((s) => s.steps ?? []).map((s) => s.step),
    servings: r.servings ?? 1,
    timeMinutes: r.readyInMinutes,
    perServing,
    mealTypes: deriveMealTypes(r.dishTypes ?? []),
    cuisine: r.cuisines?.[0],
    tags: [...(r.dishTypes ?? []), ...(r.diets ?? [])],
    declaredDiets: declared,
    imageUrl: r.image,
    source: {
      provider: "spoonacular",
      name: r.sourceName || r.creditsText || "Spoonacular",
      url: r.sourceUrl,
      attribution: r.creditsText ? `${r.creditsText} · via spoonacular` : "via spoonacular",
      license: r.license,
    },
  });
}
