import type { ShoppingItem } from "@mealplan/core";

/**
 * Convert recipe quantities into what a store sells. Recipes say "2 tbsp olive oil";
 * stores sell bottles. Items measured in spoons/ml of pantry staples become one package.
 */
export function toStoreQuantity(item: ShoppingItem): { quantity: number; unit: string } {
  switch (item.unit) {
    case "g":
      return item.quantity >= 1000 ? { quantity: round(item.quantity / 453.6), unit: "lb" } : { quantity: item.quantity, unit: "g" };
    case "ml":
      return item.quantity < 120 ? { quantity: 1, unit: "package" } : { quantity: round(item.quantity / 1000), unit: "l" };
    case "tsp":
    case "tbsp":
      return { quantity: 1, unit: "package" };
    default:
      return { quantity: Math.ceil(item.quantity), unit: item.unit };
  }
}

const round = (n: number) => Math.ceil(n * 4) / 4;
