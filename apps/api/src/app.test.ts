import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { SAMPLE_RECIPES } from "@mealplan/core";
import { createPool, postgresCatalogWriter, type Db } from "@mealplan/db";
import { createApp } from "./app";
import { devBackend, supabaseBackend } from "./backend";

const json = { "content-type": "application/json" };

describe("api (dev backend)", () => {
  const h = { "x-user-id": "u1", ...json };

  it("requires a user", async () => {
    expect((await createApp({ backend: devBackend({ sources: [] }) }).request("/household")).status).toBe(401);
  });

  it("allows the app's origin when CORS_ORIGINS is blank, unset or listed", async () => {
    const preflight = { method: "OPTIONS", headers: { Origin: "http://localhost:8081", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } };
    const allowed = async (value: string | undefined) => {
      if (value === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = value;
      const res = await createApp({ backend: devBackend({ sources: [] }) }).request("/chat", preflight);
      return res.headers.get("access-control-allow-origin");
    };
    try {
      expect(await allowed("")).toBe("*"); // the blank line from .env.example
      expect(await allowed(undefined)).toBe("*");
      expect(await allowed("http://localhost:8081, https://app.example.com")).toBe("http://localhost:8081");
      expect(await allowed("https://app.example.com")).toBeNull();
    } finally {
      delete process.env.CORS_ORIGINS;
    }
  });

  it("plans, swaps and lists groceries without the chat", async () => {
    const app = createApp({ backend: devBackend({ sources: [] }) });
    const created = await app.request("/plans", { method: "POST", headers: h, body: JSON.stringify({ strategy: "meal-type", track: "longevity", weekStart: "2026-11-16" }) });
    expect(created.status).toBe(201);
    expect((await app.request("/plans/current/swap", { method: "POST", headers: h, body: JSON.stringify({ day: "mon", slot: "dinner" }) })).status).toBe(200);
    const list = await (await app.request("/shopping-list", { headers: h })).json();
    expect(list.items.length).toBeGreaterThan(0);
    const current = await (await app.request("/plans/current", { headers: h })).json();
    expect(current.recipes.length).toBe(new Set(current.plan.meals.map((m: { recipeId: string }) => m.recipeId)).size);
  });

  it("only patches known household fields", async () => {
    const app = createApp({ backend: devBackend({ sources: [] }) });
    const res = await (await app.request("/household", { method: "PATCH", headers: h, body: JSON.stringify({ mode: "family", id: "someone-else" }) })).json();
    expect(res.mode).toBe("family");
    expect(res.id).toBe("hh_u1");
  });

  it("validates household patches", async () => {
    const app = createApp({ backend: devBackend({ sources: [] }) });
    const res = await app.request("/household", { method: "PATCH", headers: h, body: JSON.stringify({ diet: "carnivore-plus" }) });
    expect(res.status).toBe(400);
  });

  it("rejects unsafe import URLs with a 422", async () => {
    const app = createApp({ backend: devBackend({ sources: [] }) });
    const res = await app.request("/recipes/import", { method: "POST", headers: h, body: JSON.stringify({ url: "http://127.0.0.1:8787/health" }) });
    expect(res.status).toBe(422);
  });

  it("has no grocer routes", async () => {
    const app = createApp({ backend: devBackend({ sources: [] }) });
    expect((await app.request("/grocers", { headers: h })).status).toBe(404);
  });

  describe("grocery list", () => {
    type List = { planId: string | null; items: { key: string; name: string; checked: boolean }[]; extras: { id: string; name: string; quantity?: string; checked: boolean }[] };
    const call = async (app: ReturnType<typeof createApp>, path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, list: (await res.json()) as List };
    };

    it("holds your own items before there's a plan", async () => {
      const app = createApp({ backend: devBackend({ sources: [] }) });
      const { status, list } = await call(app, "/shopping-list/extras", "POST", { items: [{ name: " paper towels ", quantity: "2 rolls" }] });
      expect(status).toBe(201);
      expect(list.planId).toBeNull();
      expect(list.extras).toMatchObject([{ name: "paper towels", quantity: "2 rolls", checked: false }]);
      expect((await call(app, "/shopping-list/check", "POST", { key: "garlic|clove", checked: true })).status).toBe(409);
    });

    it("saves check-offs, keeps own items across a new plan, and clears checked ones", async () => {
      const app = createApp({ backend: devBackend({ sources: [] }) });
      await call(app, "/plans", "POST", { strategy: "meal-type", track: "standard", weekStart: "2026-11-16" });
      const { list } = await call(app, "/shopping-list");
      const first = list.items[0]!;
      const checked = await call(app, "/shopping-list/check", "POST", { key: first.key, checked: true });
      expect(checked.list.items.find((i) => i.key === first.key)?.checked).toBe(true);
      expect((await call(app, "/shopping-list")).list.items.find((i) => i.key === first.key)?.checked).toBe(true);

      const added = (await call(app, "/shopping-list/extras", "POST", { items: [{ name: "coffee" }, { name: "milk" }] })).list.extras;
      const coffee = added.find((e) => e.name === "coffee")!;
      expect((await call(app, `/shopping-list/extras/${coffee.id}`, "PATCH", { checked: true })).list.extras.find((e) => e.id === coffee.id)?.checked).toBe(true);

      // A new plan resets plan check-offs but keeps the household's own items.
      await call(app, "/plans", "POST", { strategy: "meal-type", track: "standard", weekStart: "2026-11-23" });
      const fresh = (await call(app, "/shopping-list")).list;
      expect(fresh.items.every((i) => !i.checked)).toBe(true);
      expect(fresh.extras.map((e) => e.name)).toEqual(["coffee", "milk"]);

      const cleared = (await call(app, "/shopping-list/clear-checked", "POST")).list;
      expect(cleared.extras.map((e) => e.name)).toEqual(["milk"]);
      const milk = cleared.extras[0]!;
      expect((await call(app, `/shopping-list/extras/${milk.id}`, "DELETE")).list.extras).toEqual([]);
      expect((await call(app, `/shopping-list/extras/${milk.id}`, "DELETE")).status).toBe(404);
    });

    it("validates list requests", async () => {
      const app = createApp({ backend: devBackend({ sources: [] }) });
      expect((await call(app, "/shopping-list/extras", "POST", { items: [] })).status).toBe(400);
      expect((await call(app, "/shopping-list/extras", "POST", { items: [{ name: "   " }] })).status).toBe(400);
      expect((await call(app, "/shopping-list/check", "POST", { key: "x" })).status).toBe(400);
    });
  });
});

// Full stack against Postgres with the migrations applied: eval "$(scripts/test-db.sh)"
const dbUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!dbUrl)("api (Supabase backend)", () => {
  const SUPABASE_URL = "https://test-project.supabase.co";
  const JWT_SECRET = "test-secret-at-least-32-characters-long!!";
  let pool: Db;
  const userId = randomUUID();

  const token = (sub: string, opts: { aud?: string; iss?: string; secret?: string; exp?: string } = {}) =>
    new SignJWT({ role: "authenticated", email: "cook@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setAudience(opts.aud ?? "authenticated")
      .setIssuer(opts.iss ?? `${SUPABASE_URL}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(new TextEncoder().encode(opts.secret ?? JWT_SECRET));

  beforeAll(async () => {
    pool = createPool(dbUrl);
    await pool.query("insert into auth.users (id, email) values ($1, 'cook@example.com')", [userId]);
    await postgresCatalogWriter(pool).upsert(SAMPLE_RECIPES);
  });
  afterAll(async () => {
    await pool.query("delete from households where id in (select household_id from household_users where user_id = $1)", [userId]);
    await pool.end();
  });

  const app = () => createApp({ backend: supabaseBackend({ pool, supabaseUrl: SUPABASE_URL, jwtSecret: JWT_SECRET, sources: [] }) });

  it("rejects missing, forged, wrong-audience and expired tokens", async () => {
    const a = app();
    expect((await a.request("/household")).status).toBe(401);
    expect((await a.request("/household", { headers: { "x-user-id": userId } })).status).toBe(401);
    for (const bad of [
      await token(userId, { secret: "another-secret-that-is-also-32-chars!!" }),
      await token(userId, { aud: "anon" }),
      await token(userId, { iss: "https://evil.example/auth/v1" }),
      await token(userId, { exp: "-1m" }),
    ]) {
      expect((await a.request("/household", { headers: { authorization: `Bearer ${bad}` } })).status).toBe(401);
    }
  });

  it("creates the household on first request and plans from the Postgres catalog", async () => {
    const a = app();
    const auth = { authorization: `Bearer ${await token(userId)}`, ...json };
    const me = await (await a.request("/me", { headers: auth })).json();
    expect(me).toEqual({ id: userId, email: "cook@example.com" });

    const household = await (await a.request("/household", { headers: auth })).json();
    expect(household.mode).toBe("personal");

    await a.request("/household", { method: "PATCH", headers: auth, body: JSON.stringify({ diet: "pescatarian" }) });
    const plan = await (await a.request("/plans", { method: "POST", headers: auth, body: JSON.stringify({ strategy: "macro", track: "longevity", weekStart: "2026-11-16", mealTypes: ["dinner"] }) })).json();
    expect(plan.meals).toHaveLength(7);

    const current = await (await a.request("/plans/current", { headers: auth })).json();
    expect(current.plan.id).toBe(plan.id);
    expect(current.recipes.every((r: { diets: string[] }) => r.diets.includes("pescatarian"))).toBe(true);

    const report = await (await a.request("/plans/current/longevity", { headers: auth })).json();
    expect(report.avgScore).toBeGreaterThan(0);
  });
});
