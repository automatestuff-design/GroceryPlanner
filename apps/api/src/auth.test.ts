import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { supabaseAuthenticator } from "./auth";

const URL = "https://test-project.supabase.co";
const SECRET = "test-secret-at-least-32-characters-long!!";

const token = (opts: { iss?: string; secret?: string; exp?: string; role?: string } = {}) =>
  new SignJWT({ role: opts.role ?? "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("11111111-1111-1111-1111-111111111111")
    .setAudience("authenticated")
    .setIssuer(opts.iss ?? `${URL}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));

const errorOf = async (authorization: string | undefined, devUser?: string) => {
  const r = await supabaseAuthenticator({ url: URL, jwtSecret: SECRET })(authorization, devUser);
  return "error" in r ? r.error : null;
};

describe("Supabase auth errors say what to fix", () => {
  it("accepts a valid session", async () => {
    expect(await errorOf(`Bearer ${await token()}`)).toBeNull();
  });

  it("spots an app running without Supabase settings", async () => {
    expect(await errorOf(undefined, "dev-user")).toMatch(/EXPO_PUBLIC_SUPABASE_URL/);
    expect(await errorOf(undefined)).toBe("Sign in required");
  });

  it("explains a wrong project URL, wrong secret and expiry", async () => {
    expect(await errorOf(`Bearer ${await token({ iss: "https://other.supabase.co/auth/v1" })}`)).toMatch(/different Supabase project.*SUPABASE_URL/);
    expect(await errorOf(`Bearer ${await token({ secret: "a-different-secret-that-is-32-chars-long" })}`)).toMatch(/SUPABASE_JWT_SECRET/);
    expect(await errorOf(`Bearer ${await token({ exp: "-1m" })}`)).toMatch(/expired/);
    expect(await errorOf(`Bearer ${await token({ role: "anon" })}`)).toMatch(/isn't a signed-in user session/);
  });

  it("never echoes the token", async () => {
    const t = await token({ secret: "a-different-secret-that-is-32-chars-long" });
    expect(await errorOf(`Bearer ${t}`)).not.toContain(t.split(".")[1]);
  });
});
