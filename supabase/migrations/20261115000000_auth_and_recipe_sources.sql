-- Auth wiring, recipe provenance, and the live-recipe cache.

-- ---------- functions run with definer rights: pin the search path ----------
alter function is_household_user(uuid) set search_path = public;

-- ---------- first sign-in ----------
-- RLS stops a user inserting a household they don't belong to yet, so the first
-- household (plus the "Me" member) is created here. Idempotent: returns the
-- user's existing household on later calls.
create function ensure_household(display_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select household_id into hid from household_users where user_id = uid order by household_id limit 1;
  if hid is not null then return hid; end if;

  insert into households (name, pantry) values ('My kitchen', array['salt', 'black pepper', 'olive oil']) returning id into hid;
  insert into household_users (household_id, user_id, role) values (hid, uid, 'owner');
  insert into members (household_id, name, age_group) values (hid, coalesce(nullif(trim(display_name), ''), 'Me'), 'adult');
  return hid;
end $$;
revoke all on function ensure_household(text) from public;
grant execute on function ensure_household(text) to authenticated;

-- ---------- recipe provenance ----------
-- array_to_string is only STABLE; generated columns need IMMUTABLE. Safe for text[].
create function immutable_join(text[]) returns text language sql immutable parallel safe
  as $$ select array_to_string($1, ' ') $$;

alter table recipes
  add column source_provider text not null default 'catalog',  -- catalog | jsonld | import
  add column source_name text,
  add column source_url text,
  add column attribution text,
  add column license text,
  add column allergens text[] not null default '{}',             -- union of ingredient allergens, for fast exclusion
  add column household_id uuid references households on delete cascade, -- set for a household's private imports
  add column imported_by uuid references auth.users on delete set null,
  add column imported_at timestamptz not null default now(),
  add column search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(cuisine, '') || ' ' || immutable_join(tags)), 'B')
  ) stored;

-- A stored recipe must carry the license or agreement that lets us keep it.
alter table recipes add constraint recipes_license_required
  check (source_provider in ('catalog', 'import') or license is not null);

create index recipes_search on recipes using gin (search);
create index recipes_meal_types on recipes using gin (meal_types);
create index recipes_diets on recipes using gin (diets);
create index recipes_household on recipes (household_id) where household_id is not null;
create unique index recipes_source_url on recipes (source_url, coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid)) where source_url is not null;

drop policy "read recipes" on recipes;
create policy "read shared or own recipes" on recipes for select
  using (published and (household_id is null or is_household_user(household_id)));
create policy "import own recipes" on recipes for insert
  with check (household_id is not null and source_provider = 'import' and is_household_user(household_id) and imported_by = auth.uid());
create policy "delete own imports" on recipes for delete
  using (household_id is not null and is_household_user(household_id));

-- ---------- live-source cache (Spoonacular, Edamam) ----------
-- Their terms allow short-lived caching only. Shared across users, and only the API
-- server's own role touches it: no grants to anon/authenticated.
create table recipe_cache (
  id text primary key,                -- "spoonacular:715538"
  recipe jsonb not null,
  expires_at timestamptz not null
);
create index recipe_cache_expiry on recipe_cache (expires_at);
alter table recipe_cache enable row level security;
revoke all on recipe_cache from anon, authenticated;

-- ---------- conversations: one thread per user and key ----------
alter table conversations add column key text not null default 'default';
create unique index conversations_user_key on conversations (user_id, key);

-- ---------- one current plan per household ----------
drop index plans_current;
create unique index plans_current on plans (household_id) where is_current;

-- ---------- grants (Supabase sets these by default; explicit for other Postgres hosts) ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on households, household_users, members, plans, shopping_checks, conversations, grocer_accounts to authenticated;
grant select, insert, delete on recipes to authenticated;
grant select on grocer_orders to authenticated;
