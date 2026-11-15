import type { GroceryList, Household, LongevityReport, Recipe, WeekPlan } from "@mealplan/core";

/**
 * Structured UI the chat renders under the assistant's text. Cards are built from
 * tool results (engine output), so what the user taps on is never model-written.
 */
export type Card =
  | { type: "household"; household: Household }
  | { type: "plan"; plan: WeekPlan; recipes: Pick<Recipe, "id" | "title" | "timeMinutes" | "nutritionPerServing" | "imageUrl" | "source">[] }
  | { type: "shopping-list"; list: GroceryList }
  | { type: "longevity"; report: LongevityReport };

/** Tappable follow-ups shown as chips. Deterministic, based on what just happened. */
export function quickReplies(cards: Card[], household?: Household): string[] {
  const last = cards.at(-1);
  switch (last?.type) {
    case "plan":
      return ["Swap a meal", "Show my grocery list", ...(last.plan.track === "longevity" ? ["How does this week score?"] : ["Make it higher protein"])];
    case "shopping-list":
      return ["Add paper towels", "I already have garlic", "Show this week's plan"];
    case "longevity":
      return ["Fix the low-protein meals", "Add more fish this week"];
    default:
      return household?.mode === "family"
        ? ["Plan dinners for the family", "Switch to just me", "Add a family member"]
        : ["Plan my week", "Plan by macros", "Try the Longevity plan", "Switch to family"];
  }
}
