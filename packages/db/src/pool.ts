import pg from "pg";

/**
 * Two ways in:
 *  - asUser(): a transaction running as Supabase's `authenticated` role with the
 *    caller's JWT claims, so every query is filtered by row-level security exactly
 *    as it would be through Supabase's own API.
 *  - asServer(): the connection's own role. Only for data with no per-user rows
 *    (the live-recipe cache) and the catalog ingest job.
 */
export interface Claims {
  sub: string;
  email?: string;
  [k: string]: unknown;
}

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new pg.Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
}

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export async function asUser<T>(pool: Db, claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query(
      "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
      [JSON.stringify({ ...claims, role: "authenticated" }), claims.sub],
    );
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function asServer<T>(pool: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
