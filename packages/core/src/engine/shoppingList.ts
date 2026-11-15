import type { Aisle, ExtraItem, GroceryList, Recipe, ShoppingItem, ShoppingList, Unit, WeekPlan } from "../types";

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

/** Things sold whole: you can't buy half an avocado or a quarter bunch of cilantro. */
const COUNTED: Unit[] = ["each", "clove", "can", "bunch"];

function roundForShopping(q: number, unit: Unit): number {
  if (unit === "g" || unit === "ml") return Math.ceil(q / 5) * 5;
  if (COUNTED.includes(unit)) return Math.max(1, Math.ceil(q - 1e-9));
  return Math.ceil(q * 4) / 4;
}

/** Stable id for a generated item, used to remember check-offs. Same name+unit merge into one line. */
export function itemKey(item: Pick<ShoppingItem, "name" | "unit">): string {
  return `${item.name.toLowerCase()}|${item.unit}`;
}

/** Combine a plan's list with saved check-offs and the household's own items. */
export function toGroceryList(list: ShoppingList | null, checkedKeys: Iterable<string>, extras: ExtraItem[]): GroceryList {
  const checked = new Set(checkedKeys);
  return {
    planId: list?.planId ?? null,
    items: (list?.items ?? []).map((i) => ({ ...i, key: itemKey(i), checked: checked.has(itemKey(i)) })),
    extras,
    pantryExcluded: list?.pantryExcluded ?? [],
  };
}

export const AISLE_NAMES: Record<Aisle, string> = {
  produce: "Produce", "meat-seafood": "Meat & seafood", "dairy-eggs": "Dairy, eggs & fridge", bakery: "Bakery",
  "grains-pasta": "Grains & pasta", canned: "Canned & jarred", pantry: "Pantry", spices: "Spices", frozen: "Frozen", other: "Other",
};

export function formatQuantity(q: number, unit: Unit): string {
  const n = Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/\.?0+$/, "");
  return unit === "each" ? n : `${n} ${unit}`;
}

/**
 * Plain-text list for sharing (messages, notes, email). Grouped by aisle in store
 * order; checked items are left out unless `includeChecked`.
 */
export function groceryListText(list: GroceryList, opts: { title?: string; includeChecked?: boolean } = {}): string {
  const keep = <T extends { checked: boolean }>(xs: T[]) => (opts.includeChecked ? xs : xs.filter((x) => !x.checked));
  const lines: string[] = [opts.title ?? "Grocery list"];
  for (const aisle of AISLE_ORDER) {
    const items = keep(list.items).filter((i) => i.aisle === aisle);
    if (!items.length) continue;
    lines.push("", AISLE_NAMES[aisle]);
    for (const i of items) lines.push(`- ${i.name} (${formatQuantity(i.quantity, i.unit)})`);
  }
  const extras = keep(list.extras);
  if (extras.length) {
    lines.push("", "Also");
    for (const e of extras) lines.push(`- ${e.name}${e.quantity ? ` (${e.quantity})` : ""}`);
  }
  if (lines.length === 1) lines.push("", "Nothing left to buy.");
  return lines.join("\n");
}
