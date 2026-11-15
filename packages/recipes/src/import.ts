import type Anthropic from "@anthropic-ai/sdk";
import type { Recipe, RecipeSourceInfo } from "@mealplan/core";
import { extractRecipe, ExtractionError, type ExtractInput } from "./extract";
import { buildRecipe, toIngredient } from "./normalize";
import { calculateNutrition, type NutritionLine } from "./nutrition/calculate";
import { slug } from "./sources/jsonld";

/**
 * Turning what a user shares into a planner recipe:
 *   - a TikTok link plus the recipe as text or screenshots (TikTok's public embed lookup
 *     gives no caption, so the user supplies the recipe content),
 *   - or just text / photos (a cookbook page, a recipe card, a note).
 * Claude transcribes; nutrition is calculated from the Canadian Nutrient File.
 */

export class NeedsDetailsError extends Error {
  constructor(message: string, readonly video?: TikTokVideo) {
    super(message);
  }
}

// ---------- TikTok links ----------

export interface TikTokVideo {
  url: string;
  videoId: string | null;
  /** "@handle", from the link. */
  creator: string | null;
}

const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]);

export function isTikTokUrl(url: string): boolean {
  try {
    return TIKTOK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Reads the creator and video id from a full link: tiktok.com/@creator/video/123... */
export function parseTikTokUrl(url: string): TikTokVideo | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!TIKTOK_HOSTS.has(u.hostname.toLowerCase())) return null;
  const m = u.pathname.match(/^\/(@[\w.]{1,40})\/(?:video|photo)\/(\d{5,25})/);
  const clean = `https://www.tiktok.com${u.pathname}`;
  return m ? { url: clean, creator: m[1]!, videoId: m[2]! } : { url: clean, creator: null, videoId: null };
}

/**
 * Share links (vm.tiktok.com/abc) redirect to the full link. Follow at most three
 * redirects, and only between TikTok's own hosts.
 */
export async function resolveTikTok(url: string, fetchImpl: typeof fetch = fetch): Promise<TikTokVideo> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    const parsed = parseTikTokUrl(current);
    if (!parsed) throw new NeedsDetailsError("That isn't a TikTok link.");
    if (parsed.videoId) return parsed;
    const res = await fetchImpl(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
    const next = res.headers.get("location");
    if (!next) break;
    current = new URL(next, current).toString();
  }
  return parseTikTokUrl(current) ?? { url, creator: null, videoId: null };
}

// ---------- content → recipe ----------

export interface ImportedRecipe {
  recipe: Recipe;
  /** Per-ingredient breakdown, for showing how the numbers were reached. */
  lines: NutritionLine[];
}

export interface ContentImport extends Omit<ExtractInput, "context"> {
  source: RecipeSourceInfo;
  /** Short description for the reader ("a TikTok video by @creator"). */
  context?: string;
  /** Recipe id prefix, e.g. "tiktok" or "note". */
  provider: string;
}

export async function recipeFromContent(input: ContentImport, client?: Anthropic): Promise<ImportedRecipe> {
  let extracted;
  try {
    extracted = await extractRecipe({ text: input.text, images: input.images, context: input.context }, client);
  } catch (err) {
    if (err instanceof ExtractionError) throw new NeedsDetailsError(err.message);
    throw err;
  }
  if (!extracted.isRecipe || !extracted.ingredients.length) {
    throw new NeedsDetailsError(extracted.problem ?? "Couldn't find an ingredient list. Paste the ingredients, or add a screenshot where they're shown.");
  }

  const servings = Math.max(1, extracted.servings ?? 4);
  const nutrition = calculateNutrition(
    extracted.ingredients.map((i) => ({ text: i.text, name: i.name, quantity: i.quantity, unit: i.unit })),
    servings,
  );
  if (!nutrition.lines.some((l) => l.status === "ok")) {
    throw new NeedsDetailsError("Couldn't work out the nutrition: none of the ingredients had amounts that could be counted. Add the amounts and try again.");
  }

  const recipe = buildRecipe({
    id: `${input.provider}:${slug(extracted.title).slice(0, 60)}-${shortHash(`${input.source.url ?? ""}|${extracted.title}|${extracted.ingredients.map((i) => i.text).join(";")}`)}`,
    title: extracted.title || "Saved recipe",
    ingredients: extracted.ingredients.map((i) => toIngredient(i.text, { name: i.name, quantity: i.quantity ?? undefined, unit: i.unit ?? undefined })),
    steps: extracted.steps,
    servings,
    timeMinutes: extracted.totalMinutes ?? undefined,
    perServing: nutrition.perServing,
    mealTypes: extracted.mealTypes,
    source: input.source,
    nutritionBasis: {
      method: "calculated",
      database: "Canadian Nutrient File 2026",
      missing: nutrition.missing,
      uncertain: nutrition.uncertain,
      servingsEstimated: !extracted.servingsStated,
    },
  });
  return { recipe, lines: nutrition.lines };
}

/** TikTok link + the recipe as text or screenshots. */
export async function recipeFromTikTok(
  url: string,
  content: Pick<ExtractInput, "text" | "images">,
  deps: { client?: Anthropic; fetch?: typeof fetch } = {},
): Promise<ImportedRecipe> {
  const video = await resolveTikTok(url, deps.fetch);
  if (!content.text?.trim() && !content.images?.length) {
    throw new NeedsDetailsError(
      "TikTok doesn't share video captions with other apps. Paste the ingredients from the caption, or add a screenshot of the video where the recipe is shown.",
      video,
    );
  }
  const name = video.creator ? `${video.creator} on TikTok` : "TikTok";
  return recipeFromContent({
    ...content,
    provider: "tiktok",
    context: video.creator ? `a TikTok recipe video by ${video.creator}` : "a TikTok recipe video",
    source: { provider: "tiktok", name, url: video.url, attribution: `Recipe by ${name}` },
  }, deps.client);
}

function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// ---------- one entry point for everything a user shares ----------

export interface ImportRequest {
  url?: string;
  text?: string;
  images?: ExtractInput["images"];
}

/**
 * Routes a shared recipe:
 *   TikTok link        → needs text or screenshots (TikTok shares no captions) → Claude + CNF
 *   other web page     → schema.org data on the page (published or calculated nutrition);
 *                        if the page has none and the user pasted the recipe, read that instead
 *   no link            → pasted text / photos → Claude + CNF
 */
export async function importRecipe(
  req: ImportRequest,
  deps: { client?: Anthropic; fetchPage?: (url: string) => Promise<Recipe> },
): Promise<ImportedRecipe> {
  const hasContent = !!req.text?.trim() || !!req.images?.length;
  const url = req.url?.trim();
  if (url && isTikTokUrl(url)) return recipeFromTikTok(url, { text: req.text, images: req.images }, { client: deps.client });
  if (url && deps.fetchPage) {
    try {
      return { recipe: await deps.fetchPage(url), lines: [] };
    } catch (err) {
      if (!hasContent) throw err;
      // The page has no usable recipe data, but the user gave us the recipe: use that, credited to the page.
      const host = new URL(url).hostname.replace(/^www\./, "");
      return recipeFromContent({ text: req.text, images: req.images, provider: "web", context: `a recipe from ${host}`, source: { provider: "web", name: host, url } }, deps.client);
    }
  }
  if (!hasContent) throw new NeedsDetailsError("Share a recipe link, paste the recipe, or add a photo of it.");
  return recipeFromContent({ text: req.text, images: req.images, provider: "note", source: { provider: "note", name: "Your recipe" } }, deps.client);
}
