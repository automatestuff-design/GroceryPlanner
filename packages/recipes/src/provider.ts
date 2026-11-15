import { matchesQuery, staticRecipeProvider, type Recipe, type RecipeProvider, type RecipeQuery } from "@mealplan/core";
import { providerOf, type RecipeCache, type RecipeCatalog, type RecipeSource } from "./types";

/** Providers whose recipes may only be cached, never served from the catalog, even when their keys aren't set. */
const LIVE_PROVIDERS = new Set(["spoonacular", "edamam"]);

export interface ProviderDeps {
  catalog: RecipeCatalog;
  sources?: RecipeSource[];
  cache?: RecipeCache;
  householdId?: string;
  /** Called when a live source fails; planning continues with what the others returned. */
  onSourceError?: (provider: string, err: unknown) => void;
}

/**
 * One RecipeProvider over everything we can plan from:
 *   catalog (Postgres: curated, licensed imports, this household's own imports)
 *   + every configured live source (Spoonacular, Edamam), cached within their terms.
 * Results are re-checked against the query, because each API's filters are coarser
 * than ours (e.g. allergen labels), and duplicates across sources are dropped.
 */
export function createRecipeProvider(deps: ProviderDeps): RecipeProvider {
  const cache = deps.cache ?? memoryRecipeCache();
  const sources = (deps.sources ?? []).filter((s) => s.info().configured);
  const byProvider = new Map(sources.map((s) => [s.info().provider, s]));

  return {
    async search(q: RecipeQuery) {
      const [own, ...live] = await Promise.all([
        deps.catalog.search(q, deps.householdId),
        ...sources.map(async (s) => {
          try {
            const found = await s.search(q);
            await cache.put(found, s.info().cacheTtlSeconds ?? 3600);
            return found;
          } catch (err) {
            deps.onSourceError?.(s.info().provider, err);
            return [];
          }
        }),
      ]);
      return dedupe([...own, ...live.flat()]).filter((r) => matchesQuery(r, { ...q, text: undefined }));
    },

    async getMany(ids: string[]) {
      const groups = groupBy([...new Set(ids)], providerOf);
      const out: Recipe[] = [];
      // Live sources own their ids ("spoonacular:…"); everything else lives in the catalog
      // (curated, licensed imports, and a household's own "import:"/"tiktok:"/"note:" recipes).
      const catalogIds = [...groups].filter(([provider]) => !byProvider.has(provider) && !LIVE_PROVIDERS.has(provider)).flatMap(([, pids]) => pids);
      if (catalogIds.length) out.push(...(await deps.catalog.getMany(catalogIds, deps.householdId)));

      for (const [provider, pids] of groups) {
        const source = byProvider.get(provider);
        if (!source) continue;
        const cached = await cache.get(pids);
        out.push(...cached);
        const missing = pids.filter((id) => !cached.some((r) => r.id === id));
        if (!missing.length) continue;
        try {
          const fresh = await source.getMany(missing);
          await cache.put(fresh, source.info().cacheTtlSeconds ?? 3600);
          out.push(...fresh);
        } catch (err) {
          deps.onSourceError?.(provider, err);
        }
      }
      return out;
    },
  };
}

/** Catalog backed by a fixed list (dev, tests, and the seed set). */
export function memoryCatalog(recipes: Recipe[]): RecipeCatalog {
  const p = staticRecipeProvider(recipes);
  return { search: (q) => p.search(q), getMany: (ids) => p.getMany(ids) };
}

export function memoryRecipeCache(now: () => number = Date.now): RecipeCache {
  const entries = new Map<string, { recipe: Recipe; expires: number }>();
  return {
    async get(ids) {
      const t = now();
      return ids.flatMap((id) => {
        const e = entries.get(id);
        if (!e) return [];
        if (e.expires <= t) { entries.delete(id); return []; }
        return [e.recipe];
      });
    },
    async put(recipes, ttl) {
      const expires = now() + ttl * 1000;
      for (const r of recipes) entries.set(r.id, { recipe: r, expires });
    },
  };
}

function dedupe(recipes: Recipe[]): Recipe[] {
  const seen = new Set<string>();
  return recipes.filter((r) => {
    const key = r.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(r.id) || seen.has(key)) return false;
    seen.add(r.id); seen.add(key);
    return true;
  });
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}
