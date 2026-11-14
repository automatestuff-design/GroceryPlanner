import type { Recipe, PlannedMeal, Macros } from "../types";

/**
 * Longevity track rules for middle-aged adults (muscle span + healthspan).
 * Starting values from the evidence summaries in docs/LONGEVITY.md; tune with users.
 * The app frames these as food goals, never as medical advice.
 */
export const LONGEVITY_RULES = {
  proteinPerMealMinG: 30,
  leucinePerMealMinG: 2.5,
  fiberPerDayMinG: 30,
  oilyFishMealsPerWeek: 2,
  legumeMealsPerWeek: 3,
  fermentedServingsPerWeek: 5,
  distinctPlantsPerWeek: 30,
} as const;

/** 0–100 score for one recipe serving, used to rank meals on the Longevity track. */
export function recipeLongevityScore(r: Recipe): number {
  const n = r.nutritionPerServing;
  let score = 0;
  score += Math.min(30, (n.proteinG / LONGEVITY_RULES.proteinPerMealMinG) * 30);
  score += Math.min(15, (r.longevity.leucineG / LONGEVITY_RULES.leucinePerMealMinG) * 15);
  score += Math.min(20, (n.fiberG / 10) * 20);
  score += r.longevity.omega3G >= 1 ? 10 : 0;
  score += r.longevity.legumes ? 8 : 0;
  score += r.longevity.fermented ? 5 : 0;
  score += r.longevity.wholeFood ? 7 : -10;
  score += Math.min(5, r.ingredients.filter((i) => i.plant).length);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface LongevityGoal {
  id: keyof typeof LONGEVITY_RULES;
  label: string;
  target: number;
  actual: number;
  met: boolean;
}

export interface LongevityReport {
  goals: LongevityGoal[];
  mealsUnderProtein: { day: string; slot: string; proteinG: number }[];
  avgScore: number;
}

/** Weekly report for one adult eating every planned meal (one serving each). */
export function weeklyLongevityReport(meals: PlannedMeal[], recipes: Map<string, Recipe>): LongevityReport {
  const eaten = meals.map((m) => ({ m, r: recipes.get(m.recipeId) })).filter((x): x is { m: PlannedMeal; r: Recipe } => !!x.r);
  const mains = eaten.filter(({ m }) => m.slot !== "snack");
  const days = new Set(eaten.map(({ m }) => m.day)).size || 1;

  const fiberPerDay = eaten.reduce((s, { r }) => s + r.nutritionPerServing.fiberG, 0) / days;
  // Scale the daily fiber target to the meals actually planned (dinner-only plans cover ~1/3 of the day).
  const mainsPerDay = Math.min(3, mains.length / days);
  const fiberTarget = Math.round(LONGEVITY_RULES.fiberPerDayMinG * (mainsPerDay / 3) + eaten.filter(({ m }) => m.slot === "snack").length / days * 3);
  const plants = new Set(eaten.flatMap(({ r }) => r.ingredients.filter((i) => i.plant).map((i) => i.name.toLowerCase())));
  const proteinMet = mains.filter(({ r }) => r.nutritionPerServing.proteinG >= LONGEVITY_RULES.proteinPerMealMinG).length;
  const leucineMet = mains.filter(({ r }) => r.longevity.leucineG >= LONGEVITY_RULES.leucinePerMealMinG).length;

  const goal = (id: keyof typeof LONGEVITY_RULES, label: string, actual: number, target: number = LONGEVITY_RULES[id]): LongevityGoal => ({
    id, label, target, actual: Math.round(actual * 10) / 10, met: actual >= target,
  });

  return {
    goals: [
      goal("proteinPerMealMinG", "Main meals with 30 g+ protein", proteinMet, mains.length),
      goal("leucinePerMealMinG", "Main meals with 2.5 g+ leucine", leucineMet, mains.length),
      goal("fiberPerDayMinG", mainsPerDay < 3 ? "Fiber per day from planned meals (g)" : "Fiber per day (g)", fiberPerDay, fiberTarget),
      goal("oilyFishMealsPerWeek", "Oily fish meals", eaten.filter(({ r }) => r.longevity.omega3G >= 1).length),
      goal("legumeMealsPerWeek", "Legume meals", eaten.filter(({ r }) => r.longevity.legumes).length),
      goal("fermentedServingsPerWeek", "Fermented servings", eaten.filter(({ r }) => r.longevity.fermented).length),
      goal("distinctPlantsPerWeek", "Different plants", plants.size),
    ],
    mealsUnderProtein: mains
      .filter(({ r }) => r.nutritionPerServing.proteinG < LONGEVITY_RULES.proteinPerMealMinG)
      .map(({ m, r }) => ({ day: m.day, slot: m.slot, proteinG: r.nutritionPerServing.proteinG })),
    avgScore: eaten.length ? Math.round(eaten.reduce((s, { r }) => s + recipeLongevityScore(r), 0) / eaten.length) : 0,
  };
}

export type { Macros };
