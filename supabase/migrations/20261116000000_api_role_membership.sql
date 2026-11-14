-- The API connects as `postgres` (the server-only DATABASE_URL) and runs each request
-- as the signed-in user with `set local role authenticated`, so RLS applies
-- (packages/db/src/pool.ts). Supabase projects don't give `postgres` that membership
-- by default: without it every request fails with
-- "permission denied to set role authenticated".
-- Safe to run more than once: re-granting an existing membership is only a notice.
grant authenticated to postgres;
