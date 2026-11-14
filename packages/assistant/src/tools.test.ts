import { describe, expect, it } from "vitest";
import { createGrocerRegistry, InstacartAdapter } from "@mealplan/grocers";
import { SAMPLE_RECIPES, staticRecipeProvider } from "@mealplan/core";
import { MemoryStore } from "./memoryStore";
import { runTool, toolDefinitions, type ToolContext } from "./tools";
import { quickReplies } from "./cards";

const ctx = (): ToolContext => ({
  userId: "u1", store: new MemoryStore(), recipes: staticRecipeProvider(SAMPLE_RECIPES),
  grocers: createGrocerRegistry([new InstacartAdapter(undefined)]), cards: [],
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
    expect(JSON.parse(list.content).itemCount).toBeGreaterThan(5);
    expect(c.cards.map((x) => x.type)).toEqual(["household", "plan", "shopping-list"]);
    expect(quickReplies(c.cards)).toContain("Order with Instacart");
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
    c.importRecipe = async () => SAMPLE_RECIPES[0]!;
    const r = await runTool("import_recipe_from_url", { url: "https://example.org/r" }, c);
    expect(JSON.parse(r.content).title).toBe(SAMPLE_RECIPES[0]!.title);
  });

  it("reports an unconfigured grocer as a tool error", async () => {
    const c = ctx();
    await runTool("create_week_plan", { strategy: "meal-type", track: "longevity" }, c);
    const r = await runTool("send_to_grocer", { grocer: "instacart" }, c);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not configured/);
  });
});
