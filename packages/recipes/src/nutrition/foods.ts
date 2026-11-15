import { readFileSync } from "node:fs";

/**
 * Canadian Nutrient File 2026 (Health Canada, Open Government Licence – Canada),
 * reduced by scripts/build-cnf.mjs. Values per 100 g edible portion; measures are
 * household measure weights in grams. See data/CNF-LICENCE.md.
 */
export interface Food {
  code: number;
  description: string;
  group: number;
  per100g: { calories: number; proteinG: number; fatG: number; carbsG: number; fiberG: number | null };
  measures: { name: string; grams: number }[];
}

export interface FoodDatabase {
  foods: Food[];
  byCode: Map<number, Food>;
  attribution: string;
}

type Row = [number, string, number, number, number, number, number, number | null, [string, number][]];

let cached: FoodDatabase | undefined;

/** Loads the bundled CNF data once (about 850 KB). */
export function loadCnf(): FoodDatabase {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(new URL("../../data/cnf-2026.json", import.meta.url), "utf8")) as {
    source: { attribution: string; name: string };
    foods: Row[];
  };
  const foods = raw.foods.map(([code, description, group, kcal, protein, fat, carbs, fibre, measures]): Food => ({
    code, description, group,
    per100g: { calories: kcal, proteinG: protein, fatG: fat, carbsG: carbs, fiberG: fibre },
    measures: measures.map(([name, grams]) => ({ name, grams })),
  }));
  cached = { foods, byCode: new Map(foods.map((f) => [f.code, f])), attribution: `${raw.source.name}, Health Canada. ${raw.source.attribution}` };
  return cached;
}
