import type Anthropic from "@anthropic-ai/sdk";
import { MemoryStore, type PlannerStore } from "@mealplan/assistant";
import { SAMPLE_RECIPES, type Recipe, type RecipeProvider } from "@mealplan/core";
import { createPool, PostgresStore, postgresCatalog, postgresRecipeCache, type Claims, type Db } from "@mealplan/db";
import {
  createRecipeProvider, EdamamSource, fetchJsonLdRecipe, importRecipe, memoryCatalog, memoryRecipeCache, SpoonacularSource,
  type ImportedRecipe, type ImportRequest, type RecipeCache, type RecipeSource,
} from "@mealplan/recipes";
import { devAuthenticator, supabaseAuthenticator, type Authenticator } from "./auth";

/** Everything a request needs, bound to the signed-in user. */
export interface RequestServices {
  store: PlannerStore;
  recipes: RecipeProvider;
  /**
   * Save a shared recipe to the user's household library: a TikTok link with the recipe
   * as text or screenshots, a recipe web page, or pasted text / photos.
   */
  importRecipe(req: ImportRequest): Promise<ImportedRecipe>;
}

export interface BackendOptions {
  sources?: RecipeSource[];
  /** Claude client for reading pasted recipes and screenshots. Created on first use if absent. */
  anthropic?: Anthropic;
  /** Test seam: fetch and parse a recipe web page. */
  fetchPage?: (url: string) => Promise<Recipe>;
}

/** A Claude client, created only when an import actually needs one (so the API starts without a key). */
function lazyClient(given?: Anthropic): () => Promise<Anthropic> {
  let client = given;
  return async () => {
    if (!client) {
      const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
      client = new AnthropicSdk();
    }
    return client;
  };
}

const defaultFetchPage = (url: string) => fetchJsonLdRecipe(url, { provider: "import" });

export interface Backend {
  mode: "supabase" | "dev";
  authenticate: Authenticator;
  servicesFor(claims: Claims): RequestServices;
}

/** Live recipe APIs that have keys configured. */
export function liveSources(): RecipeSource[] {
  return [new SpoonacularSource(), new EdamamSource()].filter((s) => s.info().configured);
}

const logSourceError = (provider: string, err: unknown) => console.warn(`[recipes] ${provider} failed:`, err instanceof Error ? err.message : err);

/** Production: Supabase Auth tokens, Supabase Postgres with RLS, Postgres-backed recipe cache. */
export function supabaseBackend(opts: BackendOptions & { pool: Db; supabaseUrl: string; jwtSecret?: string }): Backend {
  const cache = postgresRecipeCache(opts.pool);
  const sources = opts.sources ?? liveSources();
  const client = lazyClient(opts.anthropic);
  return {
    mode: "supabase",
    authenticate: supabaseAuthenticator({ url: opts.supabaseUrl, jwtSecret: opts.jwtSecret }),
    servicesFor(claims) {
      const store = new PostgresStore(opts.pool, claims);
      const catalog = postgresCatalog(opts.pool, claims);
      return {
        store,
        recipes: createRecipeProvider({ catalog, sources, cache, onSourceError: logSourceError }),
        async importRecipe(req) {
          const household = await store.getHousehold(claims.sub);
          const imported = await importRecipe(req, { client: await client(), fetchPage: opts.fetchPage ?? defaultFetchPage });
          return { ...imported, recipe: await catalog.importForHousehold(imported.recipe, household.id) };
        },
      };
    },
  };
}

/**
 * Local development without Supabase: x-user-id header, in-memory data, the seed
 * recipes plus any live sources with keys. Refuses to run with NODE_ENV=production.
 */
export function devBackend(opts: BackendOptions & { recipes?: Recipe[]; cache?: RecipeCache } = {}): Backend {
  const store = new MemoryStore();
  const client = lazyClient(opts.anthropic);
  const cache = opts.cache ?? memoryRecipeCache();
  const sources = opts.sources ?? liveSources();
  const imports = new Map<string, Recipe[]>();
  const base = opts.recipes ?? SAMPLE_RECIPES;
  return {
    mode: "dev",
    authenticate: devAuthenticator(),
    servicesFor(claims) {
      const own = imports.get(claims.sub) ?? [];
      return {
        store,
        recipes: createRecipeProvider({ catalog: memoryCatalog([...own, ...base]), sources, cache, onSourceError: logSourceError }),
        async importRecipe(req) {
          const imported = await importRecipe(req, { client: await client(), fetchPage: opts.fetchPage ?? defaultFetchPage });
          imports.set(claims.sub, [...(imports.get(claims.sub) ?? []), imported.recipe]);
          return imported;
        },
      };
    },
  };
}

/** Picks the backend from the environment. Production must have Supabase configured. */
export function backendFromEnv(): Backend {
  const { SUPABASE_URL, DATABASE_URL, SUPABASE_JWT_SECRET, NODE_ENV } = process.env;
  if (SUPABASE_URL && DATABASE_URL) {
    return supabaseBackend({ pool: createPool(DATABASE_URL), supabaseUrl: SUPABASE_URL, jwtSecret: SUPABASE_JWT_SECRET });
  }
  if (NODE_ENV === "production") throw new Error("Set SUPABASE_URL and DATABASE_URL: production requires Supabase.");
  console.warn("[api] SUPABASE_URL/DATABASE_URL not set: running the in-memory dev backend with x-user-id auth.");
  return devBackend();
}

