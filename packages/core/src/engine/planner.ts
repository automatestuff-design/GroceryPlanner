import type { Household, MealType, Member, PlanRequest, PlannedMeal, Recipe, Weekday, WeekPlan, Macros } from "../types";
import { WEEKDAYS } from "../types";
import { eatersFor, servingsToCook } from "./portions";
import { dailyTargets, macroDistance } from "./macros";
import { recipeLongevityScore } from "./longevity";

/** Share of daily energy per slot, normalised over the slots planned that day. */
const SLOT_SHARE: Record<MealType, number> = { breakfast: 0.25, lunch: 0.33, dinner: 0.37, snack: 0.1 };

/** Perishables worth reusing across the week (Mealime-style "use the whole bunch"). */
const PERISHABLE_AISLES = new Set(["produce", "meat-seafood", "dairy-eggs", "bakery"]);

export function isEligible(recipe: Recipe, household: Household, eaters: Member[], req: Pick<PlanRequest, "maxCookMinutes" | "excludeRecipeIds">): boolean {
  if (household.diet !== "omnivore" && !recipe.diets.includes(household.diet)) return false;
  if (req.maxCookMinutes && recipe.timeMinutes > req.maxCookMinutes) return false;
  if (req.excludeRecipeIds?.includes(recipe.id)) return false;
  const allergies = new Set(eaters.flatMap((m) => m.allergies));
  if (recipe.ingredients.some((i) => i.allergens?.some((a) => allergies.has(a)))) return false;
  const dislikes = eaters.flatMap((m) => m.dislikes.map((d) => d.toLowerCase()));
  if (recipe.ingredients.some((i) => dislikes.some((d) => i.name.toLowerCase().includes(d)))) return false;
  return true;
}

interface ScoreContext {
  req: PlanRequest;
  eaters: Member[];
  used: Map<string, number>;
  weekIngredients: Set<string>;
  dayCuisines: Set<string>;
  slotTarget: Macros | null;
  rand: () => number;
}

export function scoreRecipe(r: Recipe, ctx: ScoreContext): number {
  let s = 0;
  s -= (ctx.used.get(r.id) ?? 0) * 50; // variety across the week
  if (ctx.dayCuisines.has(r.cuisine)) s -= 8; // variety within a day
  const overlap = r.ingredients.filter((i) => PERISHABLE_AISLES.has(i.aisle) && ctx.weekIngredients.has(i.name.toLowerCase())).length;
  s += Math.min(overlap, 4) * 4; // fewer half-used bunches of cilantro
  if (ctx.eaters.some((m) => m.ageGroup === "child" || m.ageGroup === "toddler")) s += r.kidFriendly ? 12 : -12;
  if (ctx.req.track === "longevity") s += recipeLongevityScore(r) * 0.4;
  if (ctx.slotTarget) s -= macroDistance(r.nutritionPerServing, ctx.slotTarget) * 20;
  s += ctx.rand() * 3; // seeded tiebreak so "regenerate" gives a different but reproducible week
  return s;
}

export function generateWeekPlan(req: PlanRequest, recipes: Recipe[]): WeekPlan {
  const eaters = eatersFor(req.household);
  const servings = servingsToCook(eaters);
  const pool = recipes.filter((r) => isEligible(r, req.household, eaters, req));
  const rand = mulberry32(req.seed ?? 1);
  const primary = eaters.find((m) => m.ageGroup === "adult");
  const daily = req.strategy === "macro" && primary ? dailyTargets(primary, req.track) : null;

  const meals: PlannedMeal[] = [];
  const used = new Map<string, number>();
  const weekIngredients = new Set<string>();

  for (const day of WEEKDAYS) {
    const slots = req.slots[day] ?? [];
    const shareTotal = slots.reduce((s, sl) => s + SLOT_SHARE[sl], 0) || 1;
    const dayCuisines = new Set<string>();

    for (const slot of slots) {
      const prev = previousDay(day);
      const prevDinner = prev && meals.find((m) => m.day === prev && m.slot === "dinner");
      if (req.leftovers && slot === "lunch" && prevDinner && !prevDinner.leftoverOf) {
        meals.push({ ...prevDinner, day, slot, leftoverOf: { day: prevDinner.day, slot: "dinner" } });
        continue;
      }
      const slotTarget = daily ? scale(daily, SLOT_SHARE[slot] / shareTotal) : null;
      const ctx: ScoreContext = { req, eaters, used, weekIngredients, dayCuisines, slotTarget, rand };
      const best = pickBest(pool.filter((r) => r.mealTypes.includes(slot)), ctx);
      if (!best) continue;
      used.set(best.id, (used.get(best.id) ?? 0) + 1);
      dayCuisines.add(best.cuisine);
      best.ingredients.forEach((i) => weekIngredients.add(i.name.toLowerCase()));
      meals.push({ day, slot, recipeId: best.id, servings, eaterIds: eaters.map((m) => m.id) });
    }
  }

  return {
    id: `plan_${req.household.id}_${req.weekStart}_${req.seed ?? 1}`,
    householdId: req.household.id,
    weekStart: req.weekStart,
    strategy: req.strategy,
    track: req.track,
    meals,
    createdAt: new Date().toISOString(),
  };
}

/** Replace one meal with the next-best recipe that isn't already in the plan. */
export function swapMeal(plan: WeekPlan, day: Weekday, slot: MealType, req: PlanRequest, recipes: Recipe[]): WeekPlan {
  const target = plan.meals.find((m) => m.day === day && m.slot === slot);
  if (!target) return plan;
  const eaters = eatersFor(req.household);
  const inPlan = new Set(plan.meals.map((m) => m.recipeId));
  const pool = recipes.filter((r) => r.mealTypes.includes(slot) && !inPlan.has(r.id) && isEligible(r, req.household, eaters, req));
  const ctx: ScoreContext = {
    req, eaters, used: new Map(), weekIngredients: new Set(), dayCuisines: new Set(), slotTarget: null,
    rand: mulberry32((req.seed ?? 1) + plan.meals.length),
  };
  const next = pickBest(pool, ctx);
  if (!next) return plan;
  return {
    ...plan,
    meals: plan.meals.map((m) =>
      (m.day === day && m.slot === slot) || (m.leftoverOf?.day === day && m.leftoverOf.slot === slot)
        ? { ...m, recipeId: next.id }
        : m,
    ),
  };
}

function pickBest(candidates: Recipe[], ctx: ScoreContext): Recipe | undefined {
  let best: Recipe | undefined;
  let bestScore = -Infinity;
  for (const r of candidates) {
    const s = scoreRecipe(r, ctx);
    if (s > bestScore) [best, bestScore] = [r, s];
  }
  return best;
}

function previousDay(day: Weekday): Weekday | undefined {
  const i = WEEKDAYS.indexOf(day);
  return i > 0 ? WEEKDAYS[i - 1] : undefined;
}

function scale(m: Macros, f: number): Macros {
  return { calories: m.calories * f, proteinG: m.proteinG * f, carbsG: m.carbsG * f, fatG: m.fatG * f, fiberG: m.fiberG * f };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Default slots: dinners only (Mealime's default) for personal, all three meals for families. */
export function defaultSlots(mode: Household["mode"], mealTypes: MealType[] = mode === "family" ? ["breakfast", "lunch", "dinner"] : ["dinner"]): PlanRequest["slots"] {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, mealTypes])) as PlanRequest["slots"];
}
