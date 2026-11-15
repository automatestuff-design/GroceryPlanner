import type { Recipe, RecipeQuery } from "@mealplan/core";
import type { CatalogWriter, RecipeCache, RecipeCatalog } from "@mealplan/recipes";
import { asServer, asUser, type Claims, type Db } from "./pool";
import { RECIPE_COLUMNS, recipeToParams, rowToRecipe, UPSERT_COLUMNS, UPSERT_PLACEHOLDERS, type RecipeRow } from "./recipeRows";

export interface UserCatalog extends RecipeCatalog {
  /** Store a recipe the household imported from a link. RLS checks the user belongs to the household. */
  importForHousehold(recipe: Recipe, householdId: string): Promise<Recipe>;
}

const SEARCH_SQL = `select ${RECIPE_COLUMNS} from recipes
  where published and $1 = any(meal_types)
    and ($2 = 'omnivore' or $2 = any(diets))
    and not (allergens && $3::text[])
    and ($4::int is null or time_minutes <= $4)
    and ($5::text is null or search @@ websearch_to_tsquery('english', $5))
  order by (household_id is not null) desc, md5(id || $6::text)
  limit $7`;

/**
 * Recipes we store: curated, licensed imports (shared) and this household's own
 * imports (private, via RLS). Always queried as the user so private imports stay private.
 * Ordering by md5(id || seed) gives a stable shuffle: same seed, same candidates.
 */
export function postgresCatalog(pool: Db, claims: Claims): UserCatalog {
  return {
    async search(q: RecipeQuery) {
      return asUser(pool, claims, async (tx) => {
        const out = new Map<string, Recipe>();
        for (const mealType of q.mealTypes) {
          const { rows } = await tx.query<RecipeRow>(SEARCH_SQL, [
            mealType,
            q.diet,
            q.excludeAllergens,
            q.maxCookMinutes ?? null,
            q.text ?? null,
            String(q.seed ?? 0),
            q.limit ?? 40,
          ]);
          for (const row of rows) out.set(row.id, rowToRecipe(row));
        }
        return [...out.values()];
      });
    },

    async getMany(ids: string[]) {
      if (!ids.length) return [];
      return asUser(pool, claims, async (tx) => {
        const { rows } = await tx.query<RecipeRow>(`select ${RECIPE_COLUMNS} from recipes where id = any($1)`, [ids]);
        return rows.map(rowToRecipe);
      });
    },

    async importForHousehold(r: Recipe, householdId: string) {
      const bareId = r.id.replace(/^[a-z]+:/, "");
      const recipe: Recipe = {
        ...r,
        id: `import:${householdId.slice(0, 8)}-${bareId}`.slice(0, 120),
        source: { ...(r.source ?? { name: "" }), provider: "import" },
      };
      await asUser(pool, claims, (tx) =>
        tx.query(
          `insert into recipes (${UPSERT_COLUMNS}, household_id, imported_by)
           values (${UPSERT_PLACEHOLDERS}, $22, $23)
           on conflict (id) do nothing`,
          [...recipeToParams(recipe), householdId, claims.sub],
        ),
      );
      return recipe;
    },
  };
}

/** Writes licensed catalog recipes. Runs as the server role (ingest CLI and seeding only). */
export function postgresCatalogWriter(pool: Db): CatalogWriter {
  return {
    async upsert(recipes) {
      await asServer(pool, async (tx) => {
        for (const r of recipes) {
          await tx.query(
            `insert into recipes (${UPSERT_COLUMNS}) values (${UPSERT_PLACEHOLDERS})
             on conflict (id) do update set
               title = excluded.title, meal_types = excluded.meal_types, cuisine = excluded.cuisine,
               time_minutes = excluded.time_minutes, servings = excluded.servings, diets = excluded.diets,
               tags = excluded.tags, kid_friendly = excluded.kid_friendly, ingredients = excluded.ingredients,
               steps = excluded.steps, nutrition_per_serving = excluded.nutrition_per_serving,
               longevity = excluded.longevity, image_url = excluded.image_url, source_name = excluded.source_name,
               source_url = excluded.source_url, attribution = excluded.attribution, license = excluded.license,
               allergens = excluded.allergens, nutrition_basis = excluded.nutrition_basis`,
            recipeToParams(r),
          );
        }
      });
    },
  };
}

/** Short-lived cache for Spoonacular/Edamam results, shared across users, server role only. */
export function postgresRecipeCache(pool: Db): RecipeCache {
  return {
    async get(ids) {
      if (!ids.length) return [];
      return asServer(pool, async (tx) => {
        const { rows } = await tx.query<{ recipe: Recipe }>(
          "select recipe from recipe_cache where id = any($1) and expires_at > now()",
          [ids],
        );
        return rows.map((r) => r.recipe);
      });
    },
    async put(recipes, ttlSeconds) {
      if (!recipes.length) return;
      await asServer(pool, async (tx) => {
        await tx.query(
          `insert into recipe_cache (id, recipe, expires_at)
           select r->>'id', r, now() + make_interval(secs => $2) from jsonb_array_elements($1::jsonb) r
           on conflict (id) do update set recipe = excluded.recipe, expires_at = excluded.expires_at`,
          [JSON.stringify(recipes), ttlSeconds],
        );
        // Expired rows go right away: sources' terms cap how long we may hold their data.
        await tx.query("delete from recipe_cache where expires_at <= now()");
      });
    },
  };
}
