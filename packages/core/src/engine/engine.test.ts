import { describe, expect, it } from "vitest";
import {
  SAMPLE_RECIPES, buildShoppingList, dailyTargets, defaultSlots, generateWeekPlan, servingsToCook,
  swapMeal, weeklyLongevityReport, type Household, type PlanRequest, type Recipe,
} from "../index";

const recipes = new Map<string, Recipe>(SAMPLE_RECIPES.map((r) => [r.id, r]));

const solo: Household = {
  id: "h1", name: "Me", mode: "personal", diet: "omnivore", pantry: [],
  members: [{ id: "a1", name: "Sam", ageGroup: "adult", age: 48, sex: "male", heightCm: 180, weightKg: 85, activity: "moderate", allergies: [], dislikes: [] }],
};

const family: Household = {
  id: "h2", name: "Rivera family", mode: "family", diet: "omnivore", pantry: ["olive oil", "garlic"],
  members: [
    { id: "p1", name: "Ana", ageGroup: "adult", allergies: [], dislikes: [] },
    { id: "p2", name: "Luis", ageGroup: "adult", allergies: [], dislikes: [] },
    { id: "k1", name: "Mia", ageGroup: "child", allergies: ["peanut"], dislikes: ["mushroom"] },
    { id: "k2", name: "Leo", ageGroup: "toddler", allergies: [], dislikes: [] },
  ],
};

const req = (h: Household, over: Partial<PlanRequest> = {}): PlanRequest => ({
  household: h, weekStart: "2026-11-16", strategy: "meal-type", track: "standard", slots: defaultSlots(h.mode), ...over,
});

describe("portions", () => {
  it("scales servings by age group and rounds up to half servings", () => {
    expect(servingsToCook(family.members)).toBe(3); // 1 + 1 + 0.6 + 0.35 = 2.95
  });
});

describe("macro targets", () => {
  it("raises protein on the longevity track", () => {
    const std = dailyTargets(solo.members[0]!, "standard")!;
    const lon = dailyTargets(solo.members[0]!, "longevity")!;
    expect(lon.proteinG).toBe(136);
    expect(lon.proteinG).toBeGreaterThan(std.proteinG);
    expect(lon.fiberG).toBe(30);
  });
  it("returns null without body stats", () => {
    expect(dailyTargets(family.members[0]!, "standard")).toBeNull();
  });
});

describe("planner", () => {
  it("plans 7 dinners for one person without repeats", () => {
    const plan = generateWeekPlan(req(solo), SAMPLE_RECIPES);
    expect(plan.meals).toHaveLength(7);
    expect(plan.meals.every((m) => m.slot === "dinner" && m.servings === 1)).toBe(true);
    expect(new Set(plan.meals.map((m) => m.recipeId)).size).toBe(7);
  });

  it("never schedules a recipe containing a member's allergen", () => {
    const plan = generateWeekPlan(req(family), SAMPLE_RECIPES);
    expect(plan.meals.length).toBeGreaterThan(0);
    for (const m of plan.meals) {
      expect(recipes.get(m.recipeId)!.ingredients.some((i) => i.allergens?.includes("peanut"))).toBe(false);
    }
  });

  it("respects a vegan household", () => {
    const plan = generateWeekPlan(req({ ...solo, diet: "vegan" }), SAMPLE_RECIPES);
    for (const m of plan.meals) expect(recipes.get(m.recipeId)!.diets).toContain("vegan");
  });

  it("is deterministic for a given seed", () => {
    const a = generateWeekPlan(req(family, { seed: 7 }), SAMPLE_RECIPES).meals.map((m) => m.recipeId);
    const b = generateWeekPlan(req(family, { seed: 7 }), SAMPLE_RECIPES).meals.map((m) => m.recipeId);
    expect(a).toEqual(b);
  });

  it("macro strategy prefers higher-protein meals on the longevity track", () => {
    const r = req(solo, { strategy: "macro", track: "longevity", slots: defaultSlots("personal", ["breakfast", "lunch", "dinner"]) });
    const plan = generateWeekPlan(r, SAMPLE_RECIPES);
    const avgProtein = plan.meals.reduce((s, m) => s + recipes.get(m.recipeId)!.nutritionPerServing.proteinG, 0) / plan.meals.length;
    expect(avgProtein).toBeGreaterThanOrEqual(30);
  });

  it("turns dinner into next day's lunch when leftovers are on", () => {
    const plan = generateWeekPlan(req(solo, { leftovers: true, slots: defaultSlots("personal", ["lunch", "dinner"]) }), SAMPLE_RECIPES);
    const tueLunch = plan.meals.find((m) => m.day === "tue" && m.slot === "lunch")!;
    const monDinner = plan.meals.find((m) => m.day === "mon" && m.slot === "dinner")!;
    expect(tueLunch.leftoverOf).toEqual({ day: "mon", slot: "dinner" });
    expect(tueLunch.recipeId).toBe(monDinner.recipeId);
  });

  it("swaps one meal for a recipe not already in the plan", () => {
    const r = req(solo);
    const plan = generateWeekPlan(r, SAMPLE_RECIPES.filter((x) => x.mealTypes.includes("dinner")));
    const before = plan.meals.find((m) => m.day === "wed")!.recipeId;
    const swapped = swapMeal(plan, "wed", "dinner", r, SAMPLE_RECIPES);
    const after = swapped.meals.find((m) => m.day === "wed")!.recipeId;
    expect(after).not.toBe(before);
    expect(plan.meals.map((m) => m.recipeId)).not.toContain(after);
  });
});

describe("shopping list", () => {
  it("scales, merges units, groups by aisle and skips pantry items", () => {
    const plan = generateWeekPlan(req(family), SAMPLE_RECIPES);
    const list = buildShoppingList(plan, recipes, family.pantry);
    expect(list.items.find((i) => i.name === "garlic")).toBeUndefined();
    expect(list.pantryExcluded).toContain("olive oil");
    const aisles = list.items.map((i) => i.aisle);
    expect(aisles[0]).toBe("produce");
    const keys = list.items.map((i) => `${i.name}|${i.unit}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("buys leftovers once, as part of the original meal", () => {
    const r = req(solo, { leftovers: true, slots: { mon: ["dinner"], tue: ["lunch"] } });
    const plan = generateWeekPlan(r, SAMPLE_RECIPES);
    const single = buildShoppingList({ ...plan, meals: plan.meals.slice(0, 1) }, recipes);
    const double = buildShoppingList(plan, recipes);
    const first = single.items[0]!;
    const same = double.items.find((x) => x.name === first.name && x.unit === first.unit)!;
    expect(same.quantity).toBeGreaterThan(first.quantity);
  });
});

describe("longevity report", () => {
  it("counts weekly goals", () => {
    const plan = generateWeekPlan(req(solo, { track: "longevity" }), SAMPLE_RECIPES);
    const report = weeklyLongevityReport(plan.meals, recipes);
    const fish = report.goals.find((g) => g.id === "oilyFishMealsPerWeek")!;
    expect(fish.actual).toBeGreaterThanOrEqual(2);
    expect(report.avgScore).toBeGreaterThan(50);
    expect(report.goals.find((g) => g.id === "fiberPerDayMinG")!.target).toBe(10); // dinners only → 1/3 of 30 g

  });
});

describe("recipe provider", () => {
  it("filters by meal type, diet and every eater's allergens", async () => {
    const { staticRecipeProvider, queryForPlan } = await import("../index");
    const provider = staticRecipeProvider(SAMPLE_RECIPES);
    const q = queryForPlan({ household: family, slots: defaultSlots("family", ["breakfast"]) });
    expect(q.excludeAllergens).toEqual(["peanut"]);
    const hits = await provider.search(q);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.find((r) => r.id === "overnight-oats")).toBeUndefined(); // peanut butter
    expect(hits.every((r) => r.mealTypes.includes("breakfast"))).toBe(true);
  });

  it("matches free text against title and ingredients", async () => {
    const { staticRecipeProvider } = await import("../index");
    const hits = await staticRecipeProvider(SAMPLE_RECIPES).search({ mealTypes: ["dinner"], diet: "omnivore", excludeAllergens: [], text: "salmon" });
    expect(hits.map((r) => r.id)).toEqual(["salmon-quinoa-bowl"]);
  });
});

describe("grocery list", () => {
  it("merges check-offs and extras, and shares as aisle-grouped text", async () => {
    const { toGroceryList, groceryListText, itemKey } = await import("../index");
    const plan = generateWeekPlan(req(solo, { slots: { mon: ["dinner"] } }), SAMPLE_RECIPES);
    const list = buildShoppingList(plan, recipes);
    const first = list.items[0]!;
    const g = toGroceryList(list, [itemKey(first)], [
      { id: "e1", name: "paper towels", quantity: "2 rolls", checked: false },
      { id: "e2", name: "coffee", checked: true },
    ]);
    expect(g.items.find((i) => i.key === itemKey(first))?.checked).toBe(true);
    expect(g.items.filter((i) => i.checked)).toHaveLength(1);

    const text = groceryListText(g, { title: "This week" });
    expect(text.startsWith("This week")).toBe(true);
    expect(text).not.toContain(`- ${first.name} (`); // checked items are left out
    expect(text).toContain("- paper towels (2 rolls)");
    expect(text).not.toContain("coffee");
    expect(groceryListText(g, { includeChecked: true })).toContain("coffee");
  });

  it("works with no plan, holding only the household's own items", async () => {
    const { toGroceryList, groceryListText } = await import("../index");
    const g = toGroceryList(null, [], [{ id: "e1", name: "milk", checked: false }]);
    expect(g.planId).toBeNull();
    expect(g.items).toEqual([]);
    expect(groceryListText(g)).toBe("Grocery list\n\nAlso\n- milk");
    expect(groceryListText(toGroceryList(null, [], []))).toContain("Nothing left to buy.");
  });
});

describe("shoppable quantities", () => {
  it("rounds counted items up to whole ones", () => {
    const plan = generateWeekPlan(req(solo, { slots: { mon: ["dinner"], tue: ["dinner"], wed: ["dinner"] } }), SAMPLE_RECIPES);
    const list = buildShoppingList(plan, recipes);
    const counted = list.items.filter((i) => ["each", "clove", "can", "bunch"].includes(i.unit));
    expect(counted.length).toBeGreaterThan(0);
    for (const i of counted) expect(Number.isInteger(i.quantity) && i.quantity >= 1).toBe(true);
  });
});
