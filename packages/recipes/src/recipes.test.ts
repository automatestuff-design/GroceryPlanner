import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_RECIPES } from "@mealplan/core";
import {
  classifyAisle, createRecipeProvider, detectAllergens, EdamamSource, extractRecipeJsonLd, fetchJsonLdRecipe, ingestSource,
  isoMinutes, isPrivateAddress, memoryCatalog, memoryRecipeCache, parseIngredientLine, recipeFromJsonLd, SpoonacularSource,
  type RecipeSource,
} from "./index";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const jsonResponse = (body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
const PUBLIC = async () => ["93.184.216.34"];

describe("normalize", () => {
  it("parses ingredient lines", () => {
    expect(parseIngredientLine("1 1/2 lb salmon fillets")).toEqual({ quantity: 1.5, unit: "lb", name: "salmon fillets" });
    expect(parseIngredientLine("½ cup plain greek yogurt")).toEqual({ quantity: 0.5, unit: "cup", name: "plain greek yogurt" });
    expect(parseIngredientLine("3 cloves garlic, minced")).toEqual({ quantity: 3, unit: "clove", name: "garlic" });
    expect(parseIngredientLine("2 (15 oz) cans chickpeas")).toEqual({ quantity: 2, unit: "can", name: "chickpeas" });
    expect(parseIngredientLine("Salt to taste")).toEqual({ quantity: 1, unit: "each", name: "salt" });
  });

  it("classifies aisles and allergens", () => {
    expect(classifyAisle("salmon fillets")).toBe("meat-seafood");
    expect(classifyAisle("peanut butter")).toBe("pantry");
    expect(classifyAisle("coconut milk")).toBe("canned");
    expect(classifyAisle("dried oregano")).toBe("spices");
    expect(detectAllergens("soy milk")).toEqual(["soy"]);
    expect(detectAllergens("almond milk")).toEqual(["tree-nut"]);
    expect(detectAllergens("whole wheat penne")).toEqual(["gluten"]);
    expect(detectAllergens("corn tortillas")).toEqual([]);
    expect(detectAllergens("eggplant")).toEqual([]);
  });

  it("reads ISO 8601 durations", () => {
    expect(isoMinutes("PT1H15M")).toBe(75);
    expect(isoMinutes("P0DT35M")).toBe(35);
    expect(isoMinutes("soon")).toBeUndefined();
  });
});

describe("schema.org JSON-LD", () => {
  it("finds the Recipe inside @graph and normalizes it", () => {
    const ld = extractRecipeJsonLd(fixture("recipe-page.html"))!;
    const r = recipeFromJsonLd(ld, { url: "https://example.org/salmon", license: "CC-BY-4.0", attribution: "Example Kitchen, CC BY 4.0" });
    expect(r.title).toBe("Lemon Garlic Salmon & Lentils");
    expect(r.servings).toBe(4);
    expect(r.timeMinutes).toBe(35);
    expect(r.mealTypes).toContain("dinner");
    expect(r.steps).toEqual(["Simmer lentils 20 minutes.", "Roast salmon with garlic and lemon at 425°F for 12 minutes."]);
    expect(r.nutritionPerServing).toEqual({ calories: 520, proteinG: 44, carbsG: 32, fatG: 22, fiberG: 9 });
    expect(r.diets).toEqual(expect.arrayContaining(["omnivore", "pescatarian"]));
    expect(r.diets).not.toContain("vegetarian");
    expect(r.longevity).toMatchObject({ omega3G: 1.5, legumes: true, fermented: true, wholeFood: true });
    expect(r.ingredients.find((i) => i.name === "salmon fillets")?.allergens).toContain("fish");
    expect(r.source).toMatchObject({ name: "Example Kitchen", license: "CC-BY-4.0" });
  });

  it("uses published nutrition when the page has it", () => {
    const r = recipeFromJsonLd(extractRecipeJsonLd(fixture("recipe-page.html"))!, { url: "https://example.org/salmon" });
    expect(r.nutritionBasis).toEqual({ method: "published", missing: [], uncertain: [] });
  });

  it("calculates nutrition from the ingredients when the page doesn't publish it", () => {
    const html = fixture("recipe-page.html").replace(/"nutrition":\{[^}]*\}/, '"nutrition":null');
    const r = recipeFromJsonLd(extractRecipeJsonLd(html)!, { url: "https://example.org/x" });
    expect(r.nutritionBasis?.method).toBe("calculated");
    expect(r.nutritionBasis?.database).toBe("Canadian Nutrient File 2026");
    // 1.5 lb salmon + 1 cup dry lentils + oil, yogurt... over 4 servings: a hearty, high-protein dinner.
    expect(r.nutritionPerServing.calories).toBeGreaterThan(450);
    expect(r.nutritionPerServing.calories).toBeLessThan(800);
    expect(r.nutritionPerServing.proteinG).toBeGreaterThan(40);
    expect(r.nutritionBasis?.missing).toEqual([]);
  });

  it("still rejects a page whose amounts can't be read", () => {
    const html = fixture("recipe-page.html")
      .replace(/"nutrition":\{[^}]*\}/, '"nutrition":null')
      .replace(/"recipeIngredient":\[[^\]]*\]/, '"recipeIngredient":["salmon","lentils","olive oil"]');
    expect(() => recipeFromJsonLd(extractRecipeJsonLd(html)!, { url: "https://example.org/x" })).toThrow(/nutrition/);
  });

  it("refuses private addresses, including after a redirect", async () => {
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    await expect(fetchJsonLdRecipe("http://internal.example/", {}, { resolve: async () => ["192.168.1.10"] })).rejects.toThrow(/can't be imported/);

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://metadata.internal/" } }));
    const resolve = vi.fn(async (h: string) => (h === "metadata.internal" ? ["169.254.169.254"] : ["93.184.216.34"]));
    await expect(fetchJsonLdRecipe("https://example.org/r", {}, { fetch: fetchMock, resolve })).rejects.toThrow(/can't be imported/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("live sources", () => {
  it("maps Spoonacular results and drops ones without nutrition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture("spoonacular-search.json")));
    const src = new SpoonacularSource("key", fetchMock);
    const out = await src.search({ mealTypes: ["dinner"], diet: "omnivore", excludeAllergens: ["peanut"], maxCookMinutes: 40 });
    expect(out).toHaveLength(1);
    const r = out[0]!;
    expect(r.id).toBe("spoonacular:715538");
    expect(r.nutritionPerServing.proteinG).toBe(35.6);
    expect(r.ingredients[0]).toMatchObject({ name: "pork tenderloin", unit: "lb", aisle: "meat-seafood" });
    expect(r.source?.attribution).toBe("Foodista.com · via spoonacular");
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.searchParams.get("intolerances")).toBe("peanut");
    expect(url.searchParams.get("maxReadyTime")).toBe("40");
    expect(fetchMock.mock.calls[0]![1].headers["x-api-key"]).toBe("key");
  });

  it("maps Edamam results to per-serving nutrition and links out for steps", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture("edamam-search.json")));
    const out = await new EdamamSource("id", "key", fetchMock).search({ mealTypes: ["dinner"], diet: "vegan", excludeAllergens: ["peanut"] });
    const r = out[0]!;
    expect(r.id).toBe("edamam:b79327d05b8e5b838ad6cfd9576b30b6");
    expect(r.nutritionPerServing).toEqual({ calories: 450, proteinG: 15, carbsG: 50, fatG: 20, fiberG: 14 });
    expect(r.mealTypes).toEqual(["lunch", "dinner"]);
    expect(r.diets).toContain("vegan");
    expect(r.steps).toEqual([]);
    expect(r.source?.url).toBe("https://exampleblog.com/chickpea-curry");
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.searchParams.getAll("health")).toEqual(["vegan", "peanut-free"]);
  });
});

describe("provider", () => {
  const live = (recipes = SAMPLE_RECIPES.slice(0, 2).map((r) => ({ ...r, id: `fake:${r.id}`, title: `${r.title} (web)` }))): RecipeSource & { getMany: ReturnType<typeof vi.fn> } => ({
    info: () => ({ provider: "fake", name: "Fake", storage: "cache", cacheTtlSeconds: 60, attribution: "", configured: true }),
    search: vi.fn(async () => recipes),
    getMany: vi.fn(async (ids: string[]) => recipes.filter((r) => ids.includes(r.id))),
  });

  it("merges catalog and live results, re-checking allergens", async () => {
    const peanutWeb = { ...SAMPLE_RECIPES.find((r) => r.id === "overnight-oats")!, id: "fake:oats", title: "Web oats" };
    const p = createRecipeProvider({ catalog: memoryCatalog(SAMPLE_RECIPES), sources: [live([peanutWeb])] });
    const hits = await p.search({ mealTypes: ["breakfast"], diet: "omnivore", excludeAllergens: ["peanut"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((r) => r.id === "fake:oats" || r.id === "overnight-oats")).toBe(false);
  });

  it("serves live recipes from cache, then re-fetches after the TTL", async () => {
    let t = 0;
    const src = live();
    const p = createRecipeProvider({ catalog: memoryCatalog([]), sources: [src], cache: memoryRecipeCache(() => t) });
    await p.search({ mealTypes: ["breakfast", "dinner", "lunch"], diet: "omnivore", excludeAllergens: [] });
    const id = `fake:${SAMPLE_RECIPES[0]!.id}`;
    expect(await p.getMany([id])).toHaveLength(1);
    expect(src.getMany).not.toHaveBeenCalled();
    t = 61_000;
    expect(await p.getMany([id])).toHaveLength(1);
    expect(src.getMany).toHaveBeenCalledWith([id]);
  });

  it("keeps planning when a live source fails", async () => {
    const broken: RecipeSource = { ...live(), search: async () => { throw new Error("503"); } };
    const errors: string[] = [];
    const p = createRecipeProvider({ catalog: memoryCatalog(SAMPLE_RECIPES), sources: [broken], onSourceError: (s) => errors.push(s) });
    expect((await p.search({ mealTypes: ["dinner"], diet: "omnivore", excludeAllergens: [] })).length).toBeGreaterThan(0);
    expect(errors).toEqual(["fake"]);
  });
});

describe("ingest", () => {
  it("refuses sources without a storage license", async () => {
    await expect(ingestSource({ name: "Some blog", license: "all rights reserved", attribution: "", urls: [] }, { upsert: async () => {} })).rejects.toThrow(/doesn't permit/);
  });

  it("expands sitemaps, imports pages with nutrition and reports the rest", async () => {
    const pages: Record<string, string> = {
      "https://ex.org/sitemap.xml": "<urlset><url><loc>https://ex.org/recipes/a</loc></url><url><loc>https://ex.org/recipes/b</loc></url><url><loc>https://ex.org/about</loc></url></urlset>",
      "https://ex.org/recipes/a": fixture("recipe-page.html"),
      "https://ex.org/recipes/b": "<html>no recipe</html>",
    };
    const fetchMock = vi.fn(async (u: string | URL) => jsonResponse(pages[String(u)] ?? ""));
    const upsert = vi.fn(async () => {});
    const report = await ingestSource(
      { name: "Ex", license: "public-domain", attribution: "Ex (public domain)", urls: ["https://ex.org/sitemap.xml"], include: "/recipes/" },
      { upsert }, { fetch: fetchMock as typeof fetch, resolve: PUBLIC },
    );
    expect(report.imported).toBe(1);
    expect(report.skipped).toEqual([{ url: "https://ex.org/recipes/b", reason: "No recipe data found on that page." }]);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
