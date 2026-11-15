import type { Diet, Macros, Recipe } from "@mealplan/core";
import { buildRecipe, deriveMealTypes, hasUsableNutrition, parseIngredientLine, toIngredient } from "../normalize";
import { calculateNutrition } from "../nutrition/calculate";

/**
 * schema.org/Recipe JSON-LD, the markup most recipe sites publish for search engines.
 * Used two ways:
 *   1. The ingest CLI imports sites whose license lets us store recipes (sources.manifest.json).
 *   2. A household imports a single URL they choose; it is stored privately for that household.
 * Recipes without NutritionInformation are rejected: nutrition is required.
 */

type Json = Record<string, unknown>;

export class JsonLdError extends Error {}

export function extractRecipeJsonLd(html: string): Json | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    let data: unknown;
    try { data = JSON.parse(body!.trim()); } catch { continue; }
    const found = findRecipe(data);
    if (found) return found;
  }
  return null;
}

function findRecipe(node: unknown): Json | null {
  if (Array.isArray(node)) {
    for (const n of node) { const r = findRecipe(n); if (r) return r; }
    return null;
  }
  if (node && typeof node === "object") {
    const o = node as Json;
    const type = o["@type"];
    if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return o;
    if (o["@graph"]) return findRecipe(o["@graph"]);
  }
  return null;
}

export interface JsonLdContext {
  url: string;
  /** Catalog imports pass the manifest's license and credit line; household imports pass the site name. */
  sourceName?: string;
  license?: string;
  attribution?: string;
  /** "jsonld" for catalog, "import" for a household's private import. */
  provider?: string;
}

export function recipeFromJsonLd(ld: Json, ctx: JsonLdContext): Recipe {
  const published = parseNutrition(ld.nutrition as Json | undefined);
  const servings = parseYield(ld.recipeYield) ?? (published && parseServingSize(ld.nutrition as Json | undefined) ? 1 : undefined);
  if (!servings) throw new JsonLdError("The recipe doesn't say how many servings it makes.");

  const lines = asArray(ld.recipeIngredient ?? ld.ingredients).map(String).filter(Boolean).map(decodeEntities);
  if (!lines.length) throw new JsonLdError("No ingredients found.");
  const ingredients = lines.map((l) => toIngredient(l));

  // Use the publisher's nutrition when given; otherwise calculate it from the ingredients.
  let perServing = published;
  let nutritionBasis: Recipe["nutritionBasis"] = { method: "published", missing: [], uncertain: [] };
  if (!perServing) {
    const calc = calculateNutrition(
      lines.map((text) => {
        const p = parseIngredientLine(text);
        const hasAmount = /\d|[½⅓⅔¼¾⅛]/.test(text);
        return { text, name: p.name, quantity: hasAmount ? p.quantity : null, unit: hasAmount ? p.unit : null };
      }),
      servings,
    );
    if (!calc.lines.some((l) => l.status === "ok")) throw new JsonLdError("No nutrition information on this recipe, and the ingredient amounts couldn't be read to calculate it.");
    perServing = calc.perServing;
    nutritionBasis = { method: "calculated", database: "Canadian Nutrient File 2026", missing: calc.missing, uncertain: calc.uncertain };
  }

  const host = new URL(ctx.url).hostname.replace(/^www\./, "");
  const title = String(ld.name ?? "Untitled recipe");
  const labels = [...asArray(ld.recipeCategory), ...asArray(ld.keywords).flatMap((k) => String(k).split(","))].map(String);

  return buildRecipe({
    id: `${ctx.provider ?? "jsonld"}:${slug(host)}-${slug(title)}`.slice(0, 120),
    title: decodeEntities(title),
    ingredients,
    steps: parseInstructions(ld.recipeInstructions),
    servings,
    timeMinutes: isoMinutes(ld.totalTime) ?? sumDefined(isoMinutes(ld.prepTime), isoMinutes(ld.cookTime)),
    perServing,
    nutritionBasis,
    mealTypes: deriveMealTypes(labels),
    cuisine: asArray(ld.recipeCuisine)[0] as string | undefined,
    tags: labels.slice(0, 10).map((t) => t.trim()).filter(Boolean),
    declaredDiets: parseSuitableForDiet(ld.suitableForDiet),
    imageUrl: parseImage(ld.image),
    source: {
      provider: ctx.provider ?? "jsonld",
      name: ctx.sourceName ?? publisherName(ld) ?? host,
      url: ctx.url,
      attribution: ctx.attribution,
      license: ctx.license ?? (typeof ld.license === "string" ? ld.license : undefined),
    },
  });
}

/** schema.org NutritionInformation is per serving by definition. Values are strings like "320 calories" or "21 g". */
export function parseNutrition(n: Json | undefined): Macros | null {
  if (!n) return null;
  const num = (v: unknown) => {
    const m = String(v ?? "").replace(",", ".").match(/[\d.]+/);
    return m ? Number(m[0]) : undefined;
  };
  const macros = {
    calories: num(n.calories),
    proteinG: num(n.proteinContent),
    carbsG: num(n.carbohydrateContent),
    fatG: num(n.fatContent),
    fiberG: num(n.fiberContent) ?? 0,
  };
  return hasUsableNutrition(macros) ? macros : null;
}

function parseServingSize(n: Json | undefined) {
  return n?.servingSize;
}

export function parseYield(y: unknown): number | undefined {
  for (const v of asArray(y)) {
    const m = String(v).match(/\d+/);
    if (m) return Number(m[0]);
  }
  return undefined;
}

export function isoMinutes(d: unknown): number | undefined {
  const m = typeof d === "string" ? d.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/) : null;
  if (!m || !(m[1] || m[2] || m[3])) return undefined;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function parseInstructions(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === "string") out.push(...x.split(/\n+/).map((s) => s.trim()).filter(Boolean));
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      const o = x as Json;
      if (o.itemListElement) walk(o.itemListElement);
      else if (o.text) walk(String(o.text));
    }
  };
  walk(v);
  return out.map(decodeEntities);
}

const DIET_MAP: Record<string, Diet> = { VeganDiet: "vegan", VegetarianDiet: "vegetarian" };
function parseSuitableForDiet(v: unknown): Diet[] {
  return asArray(v).map((d) => DIET_MAP[String(d).split("/").pop()!]).filter((d): d is Diet => !!d);
}

function parseImage(v: unknown): string | undefined {
  const first = asArray(v)[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object") return (first as Json).url as string | undefined;
  return undefined;
}

function publisherName(ld: Json): string | undefined {
  const p = ld.publisher as Json | undefined;
  return typeof p?.name === "string" ? p.name : undefined;
}

const asArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const sumDefined = (...xs: (number | undefined)[]) => (xs.some((x) => x !== undefined) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : undefined);
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "").trim();
}

/**
 * Fetch a page and import its recipe. The URL comes from a user, so every hop
 * (including redirects) must resolve to a public address.
 */
export async function fetchJsonLdRecipe(
  url: string,
  ctx: Omit<JsonLdContext, "url"> = {},
  deps: { fetch?: typeof fetch; resolve?: (host: string) => Promise<string[]> } = {},
): Promise<Recipe> {
  const doFetch = deps.fetch ?? fetch;
  const resolve = deps.resolve ?? defaultResolve;
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current, resolve);
    const res = await doFetch(current, {
      headers: { Accept: "text/html", "User-Agent": "MealPlannerRecipeImport/0.1" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) { current = new URL(location, current); continue; }
    if (!res.ok) throw new JsonLdError(`The page returned ${res.status}.`);
    const html = (await res.text()).slice(0, 3_000_000);
    const ld = extractRecipeJsonLd(html);
    if (!ld) throw new JsonLdError("No recipe data found on that page.");
    return recipeFromJsonLd(ld, { ...ctx, url: current.toString() });
  }
  throw new JsonLdError("Too many redirects.");
}

async function assertPublicUrl(u: URL, resolve: (host: string) => Promise<string[]>) {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new JsonLdError("Only web links can be imported.");
  if (u.port && !["80", "443"].includes(u.port)) throw new JsonLdError("That address can't be imported.");
  const addresses = await resolve(u.hostname.replace(/^\[|\]$/g, "")).catch(() => []);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new JsonLdError("That address can't be imported.");
}

export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/i, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

async function defaultResolve(host: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  return (await lookup(host, { all: true })).map((r) => r.address);
}
