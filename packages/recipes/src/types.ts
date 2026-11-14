import type { Recipe, RecipeQuery } from "@mealplan/core";

/**
 * What a source's terms let us do with its data:
 * - "catalog": we may store recipes in our own database (public-domain, openly licensed,
 *   our own, or a partner who licensed them to us).
 * - "cache":   we may only cache for `cacheTtlSeconds` and must re-fetch after. We keep
 *   just the id in plans (allowed by both Spoonacular and Edamam).
 */
export type StoragePolicy = "catalog" | "cache";

export interface SourceInfo {
  provider: string;
  name: string;
  storage: StoragePolicy;
  cacheTtlSeconds?: number;
  /** Shown wherever the source's recipes appear. */
  attribution: string;
  configured: boolean;
}

/** A live recipe API. Catalog imports go through the ingest CLI instead (see ingest.ts). */
export interface RecipeSource {
  info(): SourceInfo;
  search(q: RecipeQuery): Promise<Recipe[]>;
  /** ids are namespaced, e.g. "spoonacular:715538". Only ids for this provider are passed. */
  getMany(ids: string[]): Promise<Recipe[]>;
}

/** Short-lived storage for "cache"-policy recipes. Postgres table in production, Map in dev. */
export interface RecipeCache {
  get(ids: string[]): Promise<Recipe[]>;
  put(recipes: Recipe[], ttlSeconds: number): Promise<void>;
}

/** Recipes we're allowed to keep: our curated set, licensed imports, and household-private imports. */
export interface RecipeCatalog {
  search(q: RecipeQuery, householdId?: string): Promise<Recipe[]>;
  getMany(ids: string[], householdId?: string): Promise<Recipe[]>;
}

export const providerOf = (id: string) => (id.includes(":") ? id.slice(0, id.indexOf(":")) : "catalog");
