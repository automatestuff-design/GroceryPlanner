import { describe, expect, it } from "vitest";
import { ALIASES } from "./aliases";
import { calculateNutrition, matchFood, toGrams, type IngredientInput } from "./calculate";
import { loadCnf } from "./foods";

const db = loadCnf();

describe("Canadian Nutrient File data", () => {
  it("loads the 2026 file with attribution", () => {
    expect(db.foods.length).toBeGreaterThan(5000);
    expect(db.attribution).toMatch(/Open Government Licence – Canada/);
    const garlic = db.byCode.get(2394)!;
    expect(garlic.description).toBe("Garlic, raw");
    expect(garlic.per100g.calories).toBe(149);
    expect(garlic.measures).toContainEqual({ name: "1 clove", grams: 3 });
  });

  it("every curated alias points at a food that exists", () => {
    const missing = ALIASES.filter(([, code]) => !db.byCode.has(code));
    expect(missing).toEqual([]);
  });
});

describe("matching ingredient names", () => {
  // Each row was a real mistake at some point, or a common TikTok ingredient.
  const cases: [string, number, "high" | "low"][] = [
    ["boneless skinless chicken thighs", 853, "high"],
    ["chicken breasts", 841, "high"],
    ["rotisserie chicken", 842, "high"],
    ["chicken broth", 6541, "high"],
    ["peanut butter", 3414, "high"],
    ["green onions", 2144, "high"],
    ["onion powder", 194, "high"],
    ["red onion", 2401, "high"],
    ["extra virgin olive oil", 422, "high"],
    ["plain greek yogurt", 7469, "high"],
    ["red pepper flakes", 177, "high"],
    ["red bell pepper", 2484, "high"],
    ["lean ground turkey", 815, "high"],
    ["egg whites", 126, "high"],
    ["egg yolks", 127, "high"],          // not the dried yolk
    ["cooked quinoa", 5917, "high"],      // not dry quinoa (3x the calories)
    ["cooked brown rice", 4497, "high"],
    ["ice cream", 4163, "high"],          // not cooking cream
    ["tortilla chips", 4127, "high"],     // not a flour tortilla
    ["garlic cloves", 2394, "high"],      // not the spice "cloves"
    ["ground cloves", 179, "low"],
    ["black olives", 1613, "high"],
    ["half and half", 150, "high"],
    ["vanilla protein powder", 7231, "high"],
    ["cauliflower rice", 2385, "low"],    // not white rice
    ["rice vinegar", 13, "low"],          // closest CNF vinegar, flagged
    ["roasted red peppers", 2484, "low"], // not a sausage with roasted red pepper
    ["salt and pepper", 214, "low"],
  ];
  it.each(cases)("%s", (name, code, confidence) => {
    const m = matchFood(name, db);
    expect(m?.food.code, `${name} matched ${m?.food.description}`).toBe(code);
    expect(m?.confidence).toBe(confidence);
  });

  it("reports what it can't find instead of guessing", () => {
    expect(matchFood("everything bagel seasoning", db)).toBeNull();
  });
});

describe("amounts to grams", () => {
  const grams = (code: number, q: number, unit: Parameters<typeof toGrams>[2], name = "") =>
    toGrams(db.byCode.get(code)!, q, unit, name);

  it("uses CNF household measures", () => {
    expect(grams(2394, 2, "clove")).toEqual({ grams: 6, confidence: "high" });        // 1 clove = 3 g
    expect(grams(1511, 1, "each")).toEqual({ grams: 201, confidence: "high" });      // 1 fruit = 201 g
    expect(grams(853, 1, "lb")).toEqual({ grams: 453.6, confidence: "high" });
  });

  it("turns volumes into grams with the food's own density", () => {
    const oil = grams(422, 2, "tbsp")!; // olive oil: 15 ml = 13.68 g
    expect(oil.grams).toBeCloseTo(2 * 14.79 * (13.68 / 15), 1);
    const rice = grams(4497, 1, "cup")!; // cooked brown rice: 250 ml = 213.44 g
    expect(rice.grams).toBeCloseTo(236.6 * (213.44 / 250), 1);
  });

  it("falls back to a typical can, flagged", () => {
    expect(grams(3254, 1, "can")).toEqual({ grams: 400, confidence: "low" });
  });
});

describe("recipe nutrition", () => {
  const line = (text: string, name: string, quantity: number | null, unit: IngredientInput["unit"]): IngredientInput => ({ text, name, quantity, unit });

  it("adds up ingredients and divides by servings", () => {
    const r = calculateNutrition([
      line("1 lb boneless skinless chicken thighs", "chicken thighs", 1, "lb"),
      line("1 cup dry jasmine rice", "jasmine rice", 1, "cup"),
      line("2 tbsp olive oil", "olive oil", 2, "tbsp"),
      line("3 cloves garlic", "garlic", 3, "clove"),
      line("salt to taste", "salt", null, null),
    ], 4, db);

    const chicken = db.byCode.get(853)!.per100g;
    expect(r.lines[0]).toMatchObject({ status: "ok", grams: 453.6, confidence: "high", food: { code: 853 } });
    expect(r.total.proteinG).toBeGreaterThan(chicken.proteinG * 4.5); // chicken alone gives ~4.5 × per-100 g protein
    expect(r.perServing.calories).toBe(Math.round(r.total.calories / 4));
    expect(r.lines[4]).toMatchObject({ status: "no-amount", food: { code: 214 } });
    expect(r.missing).toEqual([]); // salt with no amount doesn't matter
    expect(r.source).toMatch(/Canadian Nutrient File 2026/);
  });

  it("lists ingredients that matter but couldn't be counted", () => {
    const r = calculateNutrition([
      line("2 cups mystery granola", "everything bagel seasoning", 2, "cup"),
      line("some peanut butter", "peanut butter", null, null),
      line("1 cup cooked ground beef", "cooked ground beef", 1, "cup"),
    ], 2, db);
    expect(r.missing).toEqual(["2 cups mystery granola", "some peanut butter"]);
    expect(r.uncertain).toContain("1 cup cooked ground beef");
  });
});
