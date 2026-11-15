import { buildShoppingList, toGroceryList, type GroceryList, type Household, type RecipeProvider } from "@mealplan/core";
import type { PlannerStore } from "./store";

/**
 * The household's grocery list as the user sees it: the current plan's ingredients
 * (scaled, aisle-grouped, pantry staples left off) with saved check-offs, plus their
 * own items. Works with no plan: the list then holds only their own items.
 * Shared by the chat tools and the API so both always show the same list.
 */
export async function loadGroceryList(store: PlannerStore, recipes: RecipeProvider, household: Household): Promise<GroceryList> {
  const [current, extras] = await Promise.all([store.getCurrentPlan(household.id), store.listExtras(household.id)]);
  if (!current) return toGroceryList(null, [], extras);
  const ids = [...new Set(current.plan.meals.map((m) => m.recipeId))];
  const [found, checked] = await Promise.all([recipes.getMany(ids), store.getCheckedKeys(current.plan.id)]);
  const list = buildShoppingList(current.plan, new Map(found.map((r) => [r.id, r])), household.pantry);
  return toGroceryList(list, checked, extras);
}

/** Case-insensitive lookup of list lines by what the user called them ("the lemons", "Paper Towels"). */
export function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const n = name.trim().toLowerCase().replace(/^the\s+/, "");
  const singular = (s: string) => s.replace(/(es|s)$/, "");
  return (
    items.find((i) => i.name.toLowerCase() === n) ??
    items.find((i) => singular(i.name.toLowerCase()) === singular(n)) ??
    items.find((i) => i.name.toLowerCase().includes(n) || n.includes(i.name.toLowerCase()))
  );
}
