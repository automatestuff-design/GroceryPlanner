import type { Allergen, Diet, MealType, Recipe, RecipeQuery } from "@mealplan/core";
import { buildRecipe, hasUsableNutrition, toIngredient } from "../normalize";
import type { RecipeSource } from "../types";

/**
 * Edamam Recipe Search API v2 (https://developer.edamam.com). Millions of recipes
 * from public sites with full nutrition analysis. Edamam returns ingredients and
 * nutrition but not instructions: we link to the publisher's page for the steps,
 * and show "Powered by Edamam". Its terms do not allow storing recipe data, so this
 * source is "cache" policy with a short TTL.
 */
const BASE = "https://api.edamam.com/api/recipes/v2";

const HEALTH: Partial<Record<Diet, string>> = { vegan: "vegan", vegetarian: "vegetarian", pescatarian: "pescatarian", keto: "keto-friendly", paleo: "paleo", mediterranean: "Mediterranean" };
const ALLERGEN_FREE: Record<Allergen, string> = {
  gluten: "gluten-free", dairy: "dairy-free", egg: "egg-free", peanut: "peanut-free", "tree-nut": "tree-nut-free",
  soy: "soy-free", fish: "fish-free", shellfish: "shellfish-free", sesame: "sesame-free",
};
const MEAL: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

interface Nutrient { quantity: number }
interface EdRecipe {
  uri: string; label: string; image?: string; source?: string; url?: string; yield?: number; totalTime?: number;
  healthLabels?: string[]; dietLabels?: string[]; mealType?: string[]; dishType?: string[]; cuisineType?: string[];
  ingredientLines?: string[];
  ingredients?: { text: string; quantity?: number; measure?: string | null; food?: string }[];
  totalNutrients?: Record<string, Nutrient>;
}

export class EdamamSource implements RecipeSource {
  constructor(
    private appId = process.env.EDAMAM_APP_ID,
    private appKey = process.env.EDAMAM_APP_KEY,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  info() {
    return {
      provider: "edamam", name: "Edamam", storage: "cache" as const, cacheTtlSeconds: 3600,
      attribution: "Powered by Edamam", configured: !!(this.appId && this.appKey),
    };
  }

  async search(q: RecipeQuery): Promise<Recipe[]> {
    if (!this.info().configured) return [];
    const p = new URLSearchParams({ type: "public", app_id: this.appId!, app_key: this.appKey! });
    if (q.text) p.set("q", q.text);
    q.mealTypes.forEach((m) => p.append("mealType", MEAL[m]));
    const health = HEALTH[q.diet];
    if (health) p.append("health", health);
    q.excludeAllergens.forEach((a) => p.append("health", ALLERGEN_FREE[a]));
    if (q.maxCookMinutes) p.set("time", `1-${q.maxCookMinutes}`);
    p.set("random", q.text ? "false" : "true");
    const res = await this.get<{ hits: { recipe: EdRecipe }[] }>(`${BASE}?${p}`);
    return res.hits.map((h) => toRecipe(h.recipe)).filter((r): r is Recipe => !!r).slice(0, q.limit ?? 40);
  }

  async getMany(ids: string[]): Promise<Recipe[]> {
    if (!this.info().configured || !ids.length) return [];
    const out: Recipe[] = [];
    // by-uri accepts up to 20 uris per call.
    for (let i = 0; i < ids.length; i += 20) {
      const p = new URLSearchParams({ type: "public", app_id: this.appId!, app_key: this.appKey! });
      ids.slice(i, i + 20).forEach((id) => p.append("uri", `http://www.edamam.com/ontologies/edamam.owl#recipe_${id.replace(/^edamam:/, "")}`));
      const res = await this.get<{ hits: { recipe: EdRecipe }[] }>(`${BASE}/by-uri?${p}`);
      out.push(...res.hits.map((h) => toRecipe(h.recipe)).filter((r): r is Recipe => !!r));
    }
    return out;
  }

  private async get<T>(url: string): Promise<T> {
    // Accounts with active-user tracking need Edamam-Account-User; we send an opaque id.
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json", "Edamam-Account-User": "mealplanner" } });
    if (!res.ok) throw new Error(`Edamam ${res.status}`);
    return res.json() as Promise<T>;
  }
}

export function toRecipe(r: EdRecipe): Recipe | null {
  const servings = r.yield && r.yield > 0 ? r.yield : 1;
  const per = (k: string) => (r.totalNutrients?.[k]?.quantity ?? NaN) / servings;
  const perServing = { calories: per("ENERC_KCAL"), proteinG: per("PROCNT"), carbsG: per("CHOCDF"), fatG: per("FAT"), fiberG: per("FIBTG") || 0 };
  if (!hasUsableNutrition(perServing) || Number.isNaN(perServing.calories)) return null;
  const id = r.uri.split("#recipe_")[1];
  if (!id) return null;
  const meals = (r.mealType ?? []).flatMap((m) => m.toLowerCase().split("/")).filter((m): m is MealType => ["breakfast", "lunch", "dinner", "snack"].includes(m));
  const labels = [...(r.healthLabels ?? []), ...(r.dietLabels ?? [])].map((l) => l.toLowerCase());
  const declared: Diet[] = labels.includes("vegan") ? ["vegan", "vegetarian"] : labels.includes("vegetarian") ? ["vegetarian"] : [];
  return buildRecipe({
    id: `edamam:${id}`,
    title: r.label,
    ingredients: (r.ingredients ?? []).map((i) => toIngredient(i.text, { name: i.food, quantity: i.quantity, unit: i.measure ?? undefined })),
    steps: [],
    servings,
    timeMinutes: r.totalTime,
    perServing,
    mealTypes: meals,
    cuisine: r.cuisineType?.[0],
    tags: [...(r.dishType ?? []), ...(r.dietLabels ?? [])],
    declaredDiets: declared,
    imageUrl: r.image,
    source: { provider: "edamam", name: r.source ?? "Edamam", url: r.url, attribution: "Powered by Edamam" },
  });
}
