import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM for grocer OAuth tokens at rest, and HMAC-signed OAuth `state`.
 * Key: 32 random bytes, base64 (`openssl rand -base64 32`), from APP_SECRET_KEY.
 */
function key(raw = process.env.APP_SECRET_KEY): Buffer {
  if (!raw) throw new Error("APP_SECRET_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("APP_SECRET_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encrypt(plain: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(token: string, rawKey?: string): string {
  const [v, iv, tag, body] = token.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

/** OAuth state that binds a callback to the user who started it, valid for 10 minutes. */
export function signState(userId: string, rawKey?: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: now, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${payload}.${createHmac("sha256", key(rawKey)).update(payload).digest("base64url")}`;
}

export function verifyState(state: string, rawKey?: string, now = Date.now()): string | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", key(rawKey)).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const { u, t } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; t: number };
  return now - t < 10 * 60_000 ? u : null;
}
