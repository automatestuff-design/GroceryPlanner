-- Product pivot: recipes and grocery lists only, no grocer ordering.
-- Grocer integrations (Instacart, Kroger, ...) are removed, so their tables and the
-- household columns that only served them go. Both tables held only linked-account
-- tokens and cart records; nothing else references them.

drop table if exists grocer_orders;
drop table if exists grocer_accounts;
alter table households
  drop column if exists preferred_grocer,
  drop column if exists postal_code;

-- Items a household adds by hand ("paper towels"). They belong to the household,
-- not a plan, so they survive regenerating the week. Plan ingredients are computed
-- from the plan; their check-offs live in shopping_checks.
create table shopping_extras (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  quantity text check (quantity is null or length(quantity) <= 40),
  checked boolean not null default false,
  -- clock_timestamp, not now(): items added together in one transaction must keep their order.
  created_at timestamptz not null default clock_timestamp()
);
create index shopping_extras_household on shopping_extras (household_id, created_at);

alter table shopping_extras enable row level security;
create policy "own extras" on shopping_extras for all using (is_household_user(household_id));
grant select, insert, update, delete on shopping_extras to authenticated;
