import type { Household, MealType, PlanRequest, Recipe, RecipeQuery } from "../types";
import { eatersFor } from "./portions";

/** Anything that can supply recipes: the Postgres catalog, live APIs, or a fixed list in tests. */
export interface RecipeProvider {
  search(q: RecipeQuery): Promise<Recipe[]>;
  /** Fetch by id, in any order. Unknown or expired ids are simply missing from the result. */
  getMany(ids: string[]): Promise<Recipe[]>;
}

/** The query a plan request implies: every meal type in its slots, the household diet, and every eater's allergens. */
export function queryForPlan(req: Pick<PlanRequest, "household" | "slots" | "maxCookMinutes">, text?: string): RecipeQuery {
  const mealTypes = [...new Set(Object.values(req.slots).flat())] as MealType[];
  return {
    mealTypes,
    diet: req.household.diet,
    excludeAllergens: allergensOf(req.household),
    maxCookMinutes: req.maxCookMinutes,
    text,
    limit: 40,
  };
}

export function allergensOf(household: Household) {
  return [...new Set(eatersFor(household).flatMap((m) => m.allergies))];
}

export function matchesQuery(r: Recipe, q: RecipeQuery): boolean {
  if (!r.mealTypes.some((t) => q.mealTypes.includes(t))) return false;
  if (q.diet !== "omnivore" && !r.diets.includes(q.diet)) return false;
  if (q.maxCookMinutes && r.timeMinutes > q.maxCookMinutes) return false;
  if (r.ingredients.some((i) => i.allergens?.some((a) => q.excludeAllergens.includes(a)))) return false;
  if (q.text) {
    const t = q.text.toLowerCase();
    const hay = `${r.title} ${r.cuisine} ${r.tags.join(" ")} ${r.ingredients.map((i) => i.name).join(" ")}`.toLowerCase();
    if (!t.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** In-memory provider for dev and tests. */
export function staticRecipeProvider(recipes: Recipe[]): RecipeProvider {
  return {
    async search(q) {
      const hits = recipes.filter((r) => matchesQuery(r, q));
      const perType = q.limit ?? 40;
      return q.mealTypes.flatMap((t) => hits.filter((r) => r.mealTypes.includes(t)).slice(0, perType))
        .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
    },
    async getMany(ids) {
      const set = new Set(ids);
      return recipes.filter((r) => set.has(r.id));
    },
  };
}
