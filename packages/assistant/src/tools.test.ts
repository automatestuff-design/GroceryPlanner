import { describe, expect, it } from "vitest";
import { SAMPLE_RECIPES, staticRecipeProvider } from "@mealplan/core";
import { MemoryStore } from "./memoryStore";
import { runTool, toolDefinitions, type ToolContext } from "./tools";
import { quickReplies } from "./cards";

const ctx = (): ToolContext => ({
  userId: "u1", store: new MemoryStore(), recipes: staticRecipeProvider(SAMPLE_RECIPES), cards: [],
});

describe("assistant tools", () => {
  it("exposes JSON-schema tool definitions", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toContain("create_week_plan");
    expect(defs.every((d) => d.input_schema.type === "object")).toBe(true);
  });

  it("switches to family mode, plans the week and builds the list", async () => {
    const c = ctx();
    const upd = await runTool("update_household", {
      mode: "family",
      upsertMembers: [{ name: "Partner", ageGroup: "adult" }, { name: "Mia", ageGroup: "child", allergies: ["peanut"] }],
    }, c);
    expect(upd.isError).toBe(false);

    const plan = await runTool("create_week_plan", { strategy: "meal-type", track: "standard", mealTypes: ["dinner"] }, c);
    expect(plan.isError).toBe(false);
    expect(JSON.parse(plan.content).meals).toHaveLength(7);

    const list = await runTool("get_shopping_list", {}, c);
    expect(JSON.parse(list.content).toBuy.length).toBeGreaterThan(5);
    expect(c.cards.map((x) => x.type)).toEqual(["household", "plan", "shopping-list"]);
    expect(quickReplies(c.cards)).toContain("Add paper towels");
  });

  it("rejects invalid input instead of guessing", async () => {
    const r = await runTool("create_week_plan", { strategy: "keto-magic", track: "standard" }, ctx());
    expect(r.isError).toBe(true);
  });

  it("reports a missing plan as a tool error", async () => {
    const r = await runTool("get_longevity_report", {}, ctx());
    expect(r).toMatchObject({ isError: true });
  });

  it("leans the plan towards a focus ingredient", async () => {
    const c = ctx();
    const r = await runTool("create_week_plan", { strategy: "meal-type", track: "standard", focus: "salmon" }, c);
    expect(JSON.parse(r.content).meals.map((m: { title: string }) => m.title)).toContain("Sheet-Pan Salmon & Quinoa Bowls");
  });

  it("imports a recipe through the household importer", async () => {
    const c = ctx();
    const calls: unknown[] = [];
    c.importRecipe = async (req) => {
      calls.push(req);
      return { ...SAMPLE_RECIPES[0]!, source: { provider: "tiktok", name: "@cook on TikTok" }, nutritionBasis: { method: "calculated", database: "Canadian Nutrient File 2026", missing: ["1 scoop mystery powder"], uncertain: [], servingsEstimated: true } };
    };
    const r = JSON.parse((await runTool("save_recipe", { url: "https://www.tiktok.com/@cook/video/123456", recipeText: "2 eggs, 1 cup oats" }, c)).content);
    expect(calls).toEqual([{ url: "https://www.tiktok.com/@cook/video/123456", text: "2 eggs, 1 cup oats" }]);
    expect(r.title).toBe(SAMPLE_RECIPES[0]!.title);
    expect(r.nutrition).toEqual({ how: "calculated from the ingredients (Canadian Nutrient File 2026)", notCounted: ["1 scoop mystery powder"], approximate: [], servingsEstimated: true });
    expect((await runTool("save_recipe", {}, c)).isError).toBe(true);
  });

  it("has no grocer-ordering tools", () => {
    const names = toolDefinitions().map((d) => d.name);
    expect(names).not.toContain("send_to_grocer");
    expect(names).not.toContain("list_grocers");
  });

  it("keeps a list of the user's own items without a plan", async () => {
    const c = ctx();
    const r = await runTool("add_to_shopping_list", { items: [{ name: "paper towels", quantity: "2 rolls" }, { name: "coffee" }] }, c);
    expect(JSON.parse(r.content).added).toEqual(["paper towels", "coffee"]);
    const list = JSON.parse((await runTool("get_shopping_list", {}, c)).content);
    expect(list.hasPlan).toBe(false);
    expect(list.ownItems.map((i: { name: string }) => i.name)).toEqual(["paper towels", "coffee"]);
  });

  it("checks off plan ingredients and removes own items by name", async () => {
    const c = ctx();
    await runTool("create_week_plan", { strategy: "meal-type", track: "standard", mealTypes: ["dinner"], focus: "salmon" }, c);
    await runTool("add_to_shopping_list", { items: [{ name: "Paper Towels" }] }, c);
    const before = JSON.parse((await runTool("get_shopping_list", {}, c)).content);
    expect(before.toBuy.some((t: string) => t.startsWith("broccoli"))).toBe(true);

    const r = JSON.parse((await runTool("update_shopping_list", { checkOff: ["the broccoli"], remove: ["paper towels", "broccoli", "unicorn"] }, c)).content);
    expect(r.list.checkedOff).toContain("broccoli");
    expect(r.list.toBuy.some((t: string) => t.startsWith("broccoli"))).toBe(false);
    expect(r.list.ownItems).toEqual([]);
    expect(r.cantRemoveBecauseFromPlan).toEqual(["broccoli"]);
    expect(r.notFound).toEqual(["unicorn"]);

    // Check-offs survive reloading the list, and can be undone.
    const again = JSON.parse((await runTool("update_shopping_list", { uncheck: ["broccoli"] }, c)).content);
    expect(again.list.checkedOff).not.toContain("broccoli");
    expect(c.cards.at(-1)?.type).toBe("shopping-list");
  });

  it("rejects an empty add", async () => {
    expect((await runTool("add_to_shopping_list", { items: [] }, ctx())).isError).toBe(true);
  });
});
