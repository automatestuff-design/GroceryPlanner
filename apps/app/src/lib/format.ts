import type { MealType, Weekday } from "@mealplan/core";

export const DAY_LABEL: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const SLOT_LABEL: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
export const AISLE_LABEL: Record<string, string> = {
  produce: "Produce", "meat-seafood": "Meat & seafood", "dairy-eggs": "Dairy, eggs & fridge", bakery: "Bakery",
  "grains-pasta": "Grains & pasta", canned: "Canned & jarred", pantry: "Pantry", spices: "Spices", frozen: "Frozen", other: "Other",
};
export function qty(q: number, unit: string): string {
  const n = Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/\.?0+$/, "");
  return unit === "each" ? n : `${n} ${unit}`;
}
