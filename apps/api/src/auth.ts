import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from "jose";
import type { Claims } from "@mealplan/db";

/** Either the verified user, or why the request isn't signed in (safe to show; never includes the token). */
export type AuthResult = { claims: Claims } | { error: string };

export type Authenticator = (authorizationHeader: string | undefined, devUserHeader: string | undefined) => Promise<AuthResult>;

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

  return async (authorization, devUser) => {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      return {
        error: devUser
          ? "The app isn't signed in to Supabase: it sent the dev-only user header. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/app/.env, then restart the app with `npm run dev:app -- --clear`."
          : "Sign in required",
      };
    }
    try {
      const options = { issuer, audience: "authenticated" };
      const { payload } = secret ? await jwtVerify(token, secret, options) : await jwtVerify(token, jwks, options);
      const claims = toClaims(payload);
      return claims ? { claims } : { error: "Your session isn't a signed-in user session. Sign out and sign in again." };
    } catch (err) {
      return { error: `The API rejected your session: ${explain(err, issuer, !!secret)}` };
    }
  };
}

/** Turn a jose verification error into the setting that most likely needs fixing. */
function explain(err: unknown, issuer: string, usingSecret: boolean): string {
  if (err instanceof errors.JWTExpired) return "it has expired. Sign out and sign in again.";
  if (err instanceof errors.JWTClaimValidationFailed) {
    if (err.claim === "iss") {
      return `it was issued by a different Supabase project or URL. The API expects ${issuer}; check SUPABASE_URL in the root .env matches EXPO_PUBLIC_SUPABASE_URL in apps/app/.env.`;
    }
    return `its "${err.claim}" claim is invalid (${err.reason}).`;
  }
  if (err instanceof errors.JOSEAlgNotAllowed || err instanceof errors.JWKSNoMatchingKey || err instanceof errors.JWSSignatureVerificationFailed) {
    return usingSecret
      ? "the signature doesn't match SUPABASE_JWT_SECRET. If the project uses the new JWT signing keys (Project Settings → JWT Keys), leave SUPABASE_JWT_SECRET blank."
      : "the signature doesn't match the project's signing keys. If the project still uses the legacy JWT secret, copy it into SUPABASE_JWT_SECRET in the root .env.";
  }
  if (err instanceof errors.JWKSTimeout || err instanceof errors.JWKSInvalid || (err instanceof Error && /fetch/i.test(err.message))) {
    return `the API couldn't download the project's signing keys from ${issuer}/.well-known/jwks.json. Check SUPABASE_URL and the API machine's internet access.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Local development only: trusts an x-user-id header. Never enabled when NODE_ENV=production. */
export function devAuthenticator(): Authenticator {
  if (process.env.NODE_ENV === "production") throw new Error("Dev auth cannot run in production");
  return async (_authorization, devUser) => (devUser ? { claims: { sub: devUser } } : { error: "Sign in required" });
}

function toClaims(p: JWTPayload): Claims | null {
  if (!p.sub || p.role !== "authenticated") return null;
  return { ...p, sub: p.sub };
}
