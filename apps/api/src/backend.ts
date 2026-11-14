import { MemoryStore, type PlannerStore } from "@mealplan/assistant";
import { SAMPLE_RECIPES, type Recipe, type RecipeProvider } from "@mealplan/core";
import { createPool, PostgresStore, postgresCatalog, postgresRecipeCache, type Claims, type Db } from "@mealplan/db";
import {
  createRecipeProvider, EdamamSource, fetchJsonLdRecipe, memoryCatalog, memoryRecipeCache, SpoonacularSource,
  type RecipeCache, type RecipeSource,
} from "@mealplan/recipes";
import { devAuthenticator, supabaseAuthenticator, type Authenticator } from "./auth";

/** Everything a request needs, bound to the signed-in user. */
export interface RequestServices {
  store: PlannerStore;
  recipes: RecipeProvider;
  /** Fetch a recipe page and save it to the user's household library. */
  importRecipe(url: string): Promise<Recipe>;
}

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
export function supabaseBackend(opts: { pool: Db; supabaseUrl: string; jwtSecret?: string; sources?: RecipeSource[] }): Backend {
  const cache = postgresRecipeCache(opts.pool);
  const sources = opts.sources ?? liveSources();
  return {
    mode: "supabase",
    authenticate: supabaseAuthenticator({ url: opts.supabaseUrl, jwtSecret: opts.jwtSecret }),
    servicesFor(claims) {
      const store = new PostgresStore(opts.pool, claims);
      const catalog = postgresCatalog(opts.pool, claims);
      return {
        store,
        recipes: createRecipeProvider({ catalog, sources, cache, onSourceError: logSourceError }),
        async importRecipe(url) {
          const household = await store.getHousehold(claims.sub);
          const recipe = await fetchJsonLdRecipe(url, { provider: "import" });
          return catalog.importForHousehold(recipe, household.id);
        },
      };
    },
  };
}

/**
 * Local development without Supabase: x-user-id header, in-memory data, the seed
 * recipes plus any live sources with keys. Refuses to run with NODE_ENV=production.
 */
export function devBackend(opts: { sources?: RecipeSource[]; recipes?: Recipe[]; cache?: RecipeCache } = {}): Backend {
  const store = new MemoryStore();
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
        async importRecipe(url) {
          const recipe = await fetchJsonLdRecipe(url, { provider: "import" });
          imports.set(claims.sub, [...(imports.get(claims.sub) ?? []), recipe]);
          return recipe;
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

