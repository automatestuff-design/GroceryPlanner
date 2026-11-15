import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { extractRecipe, ExtractionError, type ExtractedRecipe } from "./extract";
import { NeedsDetailsError, parseTikTokUrl, recipeFromContent, recipeFromTikTok, resolveTikTok } from "./import";

/** Stand-in for the Claude API: returns a fixed parsed recipe and records the request. */
function fakeClient(output: Partial<ExtractedRecipe> | null, stop_reason = "end_turn") {
  const parse = vi.fn().mockResolvedValue({
    stop_reason,
    parsed_output: output === null ? null : {
      isRecipe: true, problem: null, title: "Salsa Chicken & Rice", servings: 4, servingsStated: true, totalMinutes: 240,
      mealTypes: ["dinner"], steps: ["Add everything to the slow cooker.", "Cook on low 4 hours, shred."],
      ingredients: [
        { text: "2 lb boneless skinless chicken breasts", name: "chicken breast", quantity: 2, unit: "lb" },
        { text: "1 jar (16 oz) salsa", name: "salsa", quantity: 16, unit: "oz" },
        { text: "1 can black beans, drained", name: "black bean", quantity: 1, unit: "can" },
        { text: "2 cups cooked white rice", name: "cooked white rice", quantity: 2, unit: "cup" },
        { text: "salt to taste", name: "salt", quantity: null, unit: null },
      ],
      ...output,
    },
  });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

const VIDEO = "https://www.tiktok.com/@jordos_world/video/7389268050421304619?is_from_webapp=1&sender_device=pc";

describe("TikTok links", () => {
  it("reads the creator and video id, dropping tracking parameters", () => {
    expect(parseTikTokUrl(VIDEO)).toEqual({ url: "https://www.tiktok.com/@jordos_world/video/7389268050421304619", creator: "@jordos_world", videoId: "7389268050421304619" });
    expect(parseTikTokUrl("https://evil.example/@a/video/123456")).toBeNull();
  });

  it("follows share links only between TikTok hosts", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: VIDEO } }));
    expect((await resolveTikTok("https://vm.tiktok.com/ZMabc123/", fetchMock)).creator).toBe("@jordos_world");

    const offsite = vi.fn().mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "http://169.254.169.254/" } }));
    await expect(resolveTikTok("https://vm.tiktok.com/ZMabc123/", offsite)).rejects.toThrow(NeedsDetailsError);
    expect(offsite).toHaveBeenCalledTimes(1);
  });
});

describe("importing a TikTok recipe", () => {
  it("asks for the recipe when only a link is given", async () => {
    const err = await recipeFromTikTok(VIDEO, {}).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsDetailsError);
    expect(err.message).toMatch(/Paste the ingredients|screenshot/);
    expect(err.video.creator).toBe("@jordos_world");
  });

  it("turns pasted caption text into a recipe with calculated nutrition and credit", async () => {
    const { client, parse } = fakeClient({});
    const { recipe, lines } = await recipeFromTikTok(VIDEO, { text: "Salsa chicken & rice! 2 lb chicken breasts, a jar of salsa..." }, { client });

    expect(recipe.id).toMatch(/^tiktok:salsa-chicken-rice-/);
    expect(recipe.source).toEqual({ provider: "tiktok", name: "@jordos_world on TikTok", url: "https://www.tiktok.com/@jordos_world/video/7389268050421304619", attribution: "Recipe by @jordos_world on TikTok" });
    expect(recipe.nutritionBasis).toMatchObject({ method: "calculated", database: "Canadian Nutrient File 2026", missing: [], servingsEstimated: false });
    // 2 lb chicken breast alone is ~200 g protein over 4 servings: the rest of the recipe only adds.
    expect(recipe.nutritionPerServing.proteinG).toBeGreaterThan(50);
    expect(recipe.mealTypes).toEqual(["dinner"]);
    expect(recipe.ingredients.find((i) => i.name === "chicken breast")).toMatchObject({ aisle: "meat-seafood", quantity: 2, unit: "lb" });
    expect(lines.find((l) => l.text.startsWith("1 can"))).toMatchObject({ grams: 400, confidence: "low" });

    const req = parse.mock.calls[0]![0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.messages[0].content.at(-1).text).toMatch(/by @jordos_world/);
  });

  it("sends screenshots to Claude as images", async () => {
    const { client, parse } = fakeClient({});
    await recipeFromTikTok(VIDEO, { images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }] }, { client });
    const content = parse.mock.calls[0]![0].messages[0].content;
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
    expect(content[1].text).toMatch(/in the image/);
  });

  it("passes on Claude's explanation when there's no recipe in the content", async () => {
    const { client } = fakeClient({ isRecipe: false, problem: "The caption only has hashtags.", ingredients: [] });
    await expect(recipeFromTikTok(VIDEO, { text: "#dinner #easyrecipe" }, { client })).rejects.toThrow("The caption only has hashtags.");
  });

  it("flags an estimated serving count", async () => {
    const { client } = fakeClient({ servings: 3, servingsStated: false });
    const { recipe } = await recipeFromContent({ text: "...", provider: "note", source: { provider: "note", name: "Your recipe" } }, client);
    expect(recipe.servings).toBe(3);
    expect(recipe.nutritionBasis?.servingsEstimated).toBe(true);
  });

  it("refuses when no ingredient can be counted", async () => {
    const { client } = fakeClient({ ingredients: [{ text: "some salsa", name: "salsa", quantity: null, unit: null }] });
    await expect(recipeFromContent({ text: "...", provider: "note", source: { provider: "note", name: "x" } }, client)).rejects.toThrow(/amounts/);
  });
});

describe("extraction errors", () => {
  it("needs some content", async () => {
    await expect(extractRecipe({}, fakeClient({}).client)).rejects.toThrow(ExtractionError);
  });
  it("handles a refusal", async () => {
    await expect(extractRecipe({ text: "x" }, fakeClient(null, "refusal").client)).rejects.toThrow(/couldn't be read/);
  });
});
