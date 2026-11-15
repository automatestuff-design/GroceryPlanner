import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_RECIPES, defaultSlots, generateWeekPlan, type PlanRequest } from "@mealplan/core";
import { createRecipeProvider } from "@mealplan/recipes";
import { createPool, PostgresStore, postgresCatalog, postgresCatalogWriter, postgresRecipeCache, type Db } from "./index";

// Integration tests need a database with the migrations applied: eval "$(scripts/test-db.sh)"
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("Postgres store (RLS)", () => {
  let pool: Db;
  const alice = { sub: randomUUID(), email: "alice@example.com" };
  const bob = { sub: randomUUID(), email: "bob@example.com" };

  beforeAll(async () => {
    pool = createPool(url);
    await pool.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [alice.sub, alice.email, bob.sub, bob.email]);
    await postgresCatalogWriter(pool).upsert(SAMPLE_RECIPES);
  });
  afterAll(async () => {
    await pool.query("delete from households where id in (select household_id from household_users where user_id = any($1))", [[alice.sub, bob.sub]]);
    await pool.end();
  });

  it("creates a household on first use and keeps returning it", async () => {
    const store = new PostgresStore(pool, alice);
    const h1 = await store.getHousehold(alice.sub);
    const h2 = await new PostgresStore(pool, alice).getHousehold(alice.sub);
    expect(h1.id).toBe(h2.id);
    expect(h1.mode).toBe("personal");
    expect(h1.members).toHaveLength(1);
  });

  it("saves family members, plans and conversations", async () => {
    const store = new PostgresStore(pool, alice);
    const h = await store.getHousehold(alice.sub);
    await store.saveHousehold(alice.sub, {
      ...h, mode: "family", diet: "omnivore", pantry: ["garlic"],
      members: [...h.members, { id: "new", name: "Mia", ageGroup: "child", allergies: ["peanut"], dislikes: ["mushroom"] }],
    });
    const saved = await store.getHousehold(alice.sub);
    expect(saved.mode).toBe("family");
    expect(saved.members.map((m) => m.name)).toEqual(["Me", "Mia"]);
    expect(saved.members[1]).toMatchObject({ allergies: ["peanut"], dislikes: ["mushroom"] });

    const req: PlanRequest = { household: saved, weekStart: "2026-11-16", strategy: "meal-type", track: "standard", slots: defaultSlots("family", ["dinner"]), seed: 1 };
    const plan = generateWeekPlan(req, SAMPLE_RECIPES);
    await store.savePlan(plan, req);
    const second = generateWeekPlan({ ...req, seed: 2 }, SAMPLE_RECIPES);
    await store.savePlan(second, { ...req, seed: 2 });

    const current = await store.getCurrentPlan(saved.id);
    expect(current?.plan.id).toBe(second.id);
    expect(current?.plan.meals).toEqual(second.meals);
    expect(current?.request.seed).toBe(2);
    expect(current?.request.household.members).toHaveLength(2);

    await store.saveConversation(alice.sub, "default", [{ role: "user", content: "hi" }]);
    expect(await store.getConversation(alice.sub, "default")).toEqual([{ role: "user", content: "hi" }]);
  });

  it("isolates households between users", async () => {
    const aliceHousehold = await new PostgresStore(pool, alice).getHousehold(alice.sub);
    const bobStore = new PostgresStore(pool, bob);
    const bobHousehold = await bobStore.getHousehold(bob.sub);
    expect(bobHousehold.id).not.toBe(aliceHousehold.id);
    expect(await bobStore.getCurrentPlan(aliceHousehold.id)).toBeNull();
    expect(await bobStore.getConversation(bob.sub, "default")).toEqual([]);

    // Bob can't save a plan into Alice's household...
    const plan = { ...generateWeekPlan({ household: bobHousehold, weekStart: "2026-11-16", strategy: "meal-type", track: "standard", slots: { mon: ["dinner"] } }, SAMPLE_RECIPES), id: "evil", householdId: aliceHousehold.id };
    await expect(bobStore.savePlan(plan, { household: bobHousehold, weekStart: "2026-11-16", strategy: "meal-type", track: "standard", slots: {} })).rejects.toThrow(/row-level security/);
    // ...or take over one of her members by id.
    const mia = aliceHousehold.members.find((m) => m.name === "Mia")!;
    await expect(bobStore.saveHousehold(bob.sub, { ...bobHousehold, members: [...bobHousehold.members, { ...mia, name: "Stolen" }] })).rejects.toThrow();
    expect((await new PostgresStore(pool, alice).getHousehold(alice.sub)).members.map((m) => m.name)).toContain("Mia");
  });

  it("refuses to act for a different user than the token", async () => {
    await expect(new PostgresStore(pool, alice).getHousehold(bob.sub)).rejects.toThrow(/different user/);
  });

  describe("grocery list", () => {
    it("remembers check-offs per plan", async () => {
      const store = new PostgresStore(pool, alice);
      const h = await store.getHousehold(alice.sub);
      const current = (await store.getCurrentPlan(h.id))!;
      await store.setChecked(current.plan.id, "garlic|clove", true);
      await store.setChecked(current.plan.id, "lemon|each", true);
      await store.setChecked(current.plan.id, "lemon|each", true); // idempotent
      await store.setChecked(current.plan.id, "garlic|clove", false);
      expect(await store.getCheckedKeys(current.plan.id)).toEqual(["lemon|each"]);

      // Bob can neither read nor write Alice's check-offs.
      const bobStore = new PostgresStore(pool, bob);
      expect(await bobStore.getCheckedKeys(current.plan.id)).toEqual([]);
      await expect(bobStore.setChecked(current.plan.id, "eggs|each", true)).rejects.toThrow(/row-level security/);
    });

    it("adds, updates and removes the household's own items", async () => {
      const store = new PostgresStore(pool, alice);
      const h = await store.getHousehold(alice.sub);
      const [towels, milk] = await store.addExtras(h.id, [{ name: " paper towels ", quantity: "2 rolls" }, { name: "milk" }]);
      expect(towels).toMatchObject({ name: "paper towels", quantity: "2 rolls", checked: false });
      expect(milk!.quantity).toBeUndefined();

      expect(await store.updateExtra(h.id, milk!.id, { checked: true })).toMatchObject({ name: "milk", checked: true });
      expect(await store.updateExtra(h.id, towels!.id, { quantity: null })).toMatchObject({ quantity: undefined, checked: false });
      expect(await store.updateExtra(h.id, "not-a-uuid", { checked: true })).toBeNull();
      expect((await store.listExtras(h.id)).map((e) => e.name)).toEqual(["paper towels", "milk"]);

      expect(await store.removeExtras(h.id, [milk!.id, "junk"])).toBe(1);
      expect((await store.listExtras(h.id)).map((e) => e.name)).toEqual(["paper towels"]);
    });

    it("keeps households' own items private", async () => {
      const aliceStore = new PostgresStore(pool, alice);
      const h = await aliceStore.getHousehold(alice.sub);
      const [item] = await aliceStore.addExtras(h.id, [{ name: "secret snack" }]);
      const bobStore = new PostgresStore(pool, bob);
      expect(await bobStore.listExtras(h.id)).toEqual([]);
      expect(await bobStore.updateExtra(h.id, item!.id, { checked: true })).toBeNull();
      expect(await bobStore.removeExtras(h.id, [item!.id])).toBe(0);
      await expect(bobStore.addExtras(h.id, [{ name: "planted" }])).rejects.toThrow(/row-level security/);
      expect((await aliceStore.listExtras(h.id)).map((e) => e.name)).toContain("secret snack");
    });
  });

  describe("recipe catalog", () => {
    it("searches by meal type, diet, allergens, time and text", async () => {
      const catalog = postgresCatalog(pool, alice);
      const breakfasts = await catalog.search({ mealTypes: ["breakfast"], diet: "omnivore", excludeAllergens: ["peanut"] });
      expect(breakfasts.length).toBeGreaterThan(0);
      expect(breakfasts.map((r) => r.id)).not.toContain("overnight-oats");
      const vegan = await catalog.search({ mealTypes: ["dinner", "lunch"], diet: "vegan", excludeAllergens: [] });
      expect(vegan.every((r) => r.diets.includes("vegan"))).toBe(true);
      const salmon = await catalog.search({ mealTypes: ["dinner"], diet: "omnivore", excludeAllergens: [], text: "salmon" });
      expect(salmon.map((r) => r.id)).toEqual(["salmon-quinoa-bowl"]);
      const quick = await catalog.search({ mealTypes: ["dinner"], diet: "omnivore", excludeAllergens: [], maxCookMinutes: 20 });
      expect(quick.every((r) => r.timeMinutes <= 20)).toBe(true);
    });

    it("returns the same candidates for the same seed", async () => {
      const catalog = postgresCatalog(pool, alice);
      const q = { mealTypes: ["dinner" as const], diet: "omnivore" as const, excludeAllergens: [], limit: 3 };
      const a = await catalog.search({ ...q, seed: 7 });
      const b = await catalog.search({ ...q, seed: 7 });
      expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    });

    it("round-trips a recipe exactly", async () => {
      const [r] = await postgresCatalog(pool, alice).getMany(["salmon-quinoa-bowl"]);
      expect(r).toEqual(SAMPLE_RECIPES.find((x) => x.id === "salmon-quinoa-bowl"));
    });

    it("keeps household imports private", async () => {
      const aliceHousehold = await new PostgresStore(pool, alice).getHousehold(alice.sub);
      const source = SAMPLE_RECIPES.find((r) => r.id === "lentil-curry")!;
      const basis = { method: "calculated" as const, database: "Canadian Nutrient File 2026", missing: ["a pinch of love"], uncertain: [], servingsEstimated: true };
      const imported = await postgresCatalog(pool, alice).importForHousehold(
        { ...source, id: "tiktok:grandmas-dal", title: "Grandma's Dal", nutritionBasis: basis, source: { provider: "tiktok", name: "@grandma on TikTok", url: "https://www.tiktok.com/@grandma/video/123456789" } },
        aliceHousehold.id,
      );
      expect(imported.id).toMatch(/^import:/);
      const [saved] = await postgresCatalog(pool, alice).getMany([imported.id]);
      expect(saved?.title).toBe("Grandma's Dal");
      expect(saved?.nutritionBasis).toEqual(basis);
      expect(saved?.source).toMatchObject({ provider: "import", name: "@grandma on TikTok" });
      expect(await postgresCatalog(pool, bob).getMany([imported.id])).toEqual([]);

      // Bob can't import into Alice's household.
      await expect(postgresCatalog(pool, bob).importForHousehold({ ...source, id: "x:y", nutritionBasis: basis }, aliceHousehold.id)).rejects.toThrow(/row-level security/);
      // A household import must say how its nutrition was obtained.
      await expect(postgresCatalog(pool, alice).importForHousehold({ ...source, id: "x:no-basis" }, aliceHousehold.id)).rejects.toThrow(/recipes_import_has_basis/);
    });
  });

  it("serves cached live recipes until they expire", async () => {
    const cache = postgresRecipeCache(pool);
    const live = { ...SAMPLE_RECIPES[0]!, id: "spoonacular:42" };
    await cache.put([live], 60);
    expect(await cache.get(["spoonacular:42"])).toEqual([live]);
    await cache.put([{ ...live, id: "spoonacular:43" }], 0);
    expect(await cache.get(["spoonacular:43"])).toEqual([]);
  });

  it("plugs into the recipe provider", async () => {
    const provider = createRecipeProvider({ catalog: postgresCatalog(pool, alice), cache: postgresRecipeCache(pool) });
    const hits = await provider.search({ mealTypes: ["dinner"], diet: "pescatarian", excludeAllergens: ["gluten"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.diets.includes("pescatarian"))).toBe(true);
  });
});
