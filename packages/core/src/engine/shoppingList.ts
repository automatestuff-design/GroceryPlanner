import type { Aisle, Recipe, ShoppingItem, ShoppingList, Unit, WeekPlan } from "../types";

/** Units that convert to a common base so "200 g + 0.5 kg" becomes one line. */
const TO_BASE: Partial<Record<Unit, { base: Unit; factor: number }>> = {
  g: { base: "g", factor: 1 }, kg: { base: "g", factor: 1000 }, oz: { base: "g", factor: 28.35 }, lb: { base: "g", factor: 453.6 },
  ml: { base: "ml", factor: 1 }, l: { base: "ml", factor: 1000 }, tsp: { base: "ml", factor: 4.93 }, tbsp: { base: "ml", factor: 14.79 }, cup: { base: "ml", factor: 236.6 },
};

export const AISLE_ORDER: Aisle[] = ["produce", "meat-seafood", "dairy-eggs", "bakery", "grains-pasta", "canned", "pantry", "spices", "frozen", "other"];

/**
 * Aggregate every planned meal's ingredients, scaled to servings cooked.
 * Leftover meals are skipped: they were cooked as part of the original meal,
 * whose servings already include them (see `withLeftoverServings`).
 */
export function buildShoppingList(plan: WeekPlan, recipes: Map<string, Recipe>, pantry: string[] = []): ShoppingList {
  const pantrySet = new Set(pantry.map((p) => p.toLowerCase()));
  const lines = new Map<string, ShoppingItem>();
  const excluded = new Set<string>();

  for (const meal of withLeftoverServings(plan).meals) {
    if (meal.leftoverOf) continue;
    const r = recipes.get(meal.recipeId);
    if (!r) continue;
    const factor = meal.servings / r.servings;
    for (const ing of r.ingredients) {
      const key = ing.name.toLowerCase();
      if (pantrySet.has(key)) { excluded.add(ing.name); continue; }
      const conv = TO_BASE[ing.unit];
      const unit = conv?.base ?? ing.unit;
      const qty = ing.quantity * factor * (conv?.factor ?? 1);
      const id = `${key}|${unit}`;
      const line = lines.get(id);
      if (line) {
        line.quantity += qty;
        if (!line.recipeIds.includes(r.id)) line.recipeIds.push(r.id);
      } else {
        lines.set(id, { name: ing.name, quantity: qty, unit, aisle: ing.aisle, recipeIds: [r.id] });
      }
    }
  }

  const items = [...lines.values()]
    .map((i) => ({ ...i, quantity: roundForShopping(i.quantity, i.unit) }))
    .sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));

  return { planId: plan.id, items, pantryExcluded: [...excluded].sort() };
}

/** Fold each leftover meal's servings into the meal it came from (cook once, eat twice). */
export function withLeftoverServings(plan: WeekPlan): WeekPlan {
  const extra = new Map<string, number>();
  for (const m of plan.meals) {
    if (m.leftoverOf) {
      const k = `${m.leftoverOf.day}|${m.leftoverOf.slot}`;
      extra.set(k, (extra.get(k) ?? 0) + m.servings);
    }
  }
  return {
    ...plan,
    meals: plan.meals.map((m) => (m.leftoverOf ? m : { ...m, servings: m.servings + (extra.get(`${m.day}|${m.slot}`) ?? 0) })),
  };
}

function roundForShopping(q: number, unit: Unit): number {
  if (unit === "g" || unit === "ml") return Math.ceil(q / 5) * 5;
  return Math.ceil(q * 4) / 4;
}
