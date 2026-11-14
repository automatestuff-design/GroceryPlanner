import { describe, expect, it, vi } from "vitest";
import type { ShoppingList } from "@mealplan/core";
import { InstacartAdapter, createGrocerRegistry, KrogerAdapter, walmart, toStoreQuantity } from "./index";

const list: ShoppingList = {
  planId: "p1", pantryExcluded: [],
  items: [
    { name: "salmon fillets", quantity: 600, unit: "g", aisle: "meat-seafood", recipeIds: ["r1"] },
    { name: "olive oil", quantity: 30, unit: "ml", aisle: "pantry", recipeIds: ["r1"] },
  ],
};

describe("store quantities", () => {
  it("rounds small pantry amounts up to one package", () => {
    expect(toStoreQuantity(list.items[1]!)).toEqual({ quantity: 1, unit: "package" });
  });
});

describe("registry", () => {
  it("falls back to a configured live grocer", () => {
    const reg = createGrocerRegistry([new InstacartAdapter("key"), new KrogerAdapter(undefined, undefined), walmart]);
    expect(reg.pick("walmart")?.info().id).toBe("instacart");
    expect(reg.list().find((g) => g.id === "walmart")?.status).toBe("partner");
  });
});

describe("instacart", () => {
  it("posts line items and returns the hosted link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ products_link_url: "https://instacart.com/store/list/abc" })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new InstacartAdapter("key").createCart(list, {});
    expect(result.checkoutUrl).toBe("https://instacart.com/store/list/abc");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.line_items).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
