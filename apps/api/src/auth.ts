import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Claims } from "@mealplan/db";

export type Authenticator = (authorizationHeader: string | undefined, devUserHeader: string | undefined) => Promise<Claims | null>;

/**
 * Verifies Supabase access tokens.
 * - Projects on asymmetric signing keys (the current default): checked against the
 *   project's JWKS, fetched once and cached by jose.
 * - Projects still on the legacy shared secret: set SUPABASE_JWT_SECRET (HS256).
 * Audience must be "authenticated" and the issuer this project's auth server.
 */
export function supabaseAuthenticator(opts: { url: string; jwtSecret?: string }): Authenticator {
  const issuer = `${opts.url.replace(/\/$/, "")}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : undefined;

  return async (authorization) => {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return null;
    try {
      const options = { issuer, audience: "authenticated" };
      const { payload } = secret ? await jwtVerify(token, secret, options) : await jwtVerify(token, jwks, options);
      return toClaims(payload);
    } catch {
      return null;
    }
  };
}

/** Local development only: trusts an x-user-id header. Never enabled when NODE_ENV=production. */
export function devAuthenticator(): Authenticator {
  if (process.env.NODE_ENV === "production") throw new Error("Dev auth cannot run in production");
  return async (_authorization, devUser) => (devUser ? { sub: devUser } : null);
}

function toClaims(p: JWTPayload): Claims | null {
  if (!p.sub || p.role !== "authenticated") return null;
  return { ...p, sub: p.sub };
}
