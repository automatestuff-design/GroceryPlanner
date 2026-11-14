import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const h = { "x-user-id": "u1", "content-type": "application/json" };

describe("api", () => {
  it("requires a user", async () => {
    expect((await createApp().request("/household")).status).toBe(401);
  });

  it("plans, swaps and lists groceries without the chat", async () => {
    const app = createApp();
    await app.request("/household", { method: "PATCH", headers: h, body: JSON.stringify({ mode: "personal" }) });
    const created = await app.request("/plans", { method: "POST", headers: h, body: JSON.stringify({ strategy: "meal-type", track: "longevity", weekStart: "2026-11-16" }) });
    expect(created.status).toBe(201);
    const swap = await app.request("/plans/current/swap", { method: "POST", headers: h, body: JSON.stringify({ day: "mon", slot: "dinner" }) });
    expect(swap.status).toBe(200);
    const list = await (await app.request("/plans/current/shopping-list", { headers: h })).json();
    expect(list.items.length).toBeGreaterThan(0);
    const grocers = await (await app.request("/grocers", { headers: h })).json();
    expect(grocers.map((g: { id: string }) => g.id)).toEqual(["instacart", "kroger", "walmart", "amazon-fresh", "target"]);
  });
});
