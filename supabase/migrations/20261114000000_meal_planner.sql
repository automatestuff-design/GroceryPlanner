-- Meal planner schema. Every table is row-level-secured to the household's members.

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My kitchen',
  mode text not null default 'personal' check (mode in ('personal', 'family')),
  diet text not null default 'omnivore',
  pantry text[] not null default '{}',
  preferred_grocer text,
  postal_code text,
  created_at timestamptz not null default now()
);

-- Login accounts that can edit a household (two parents can share one).
create table household_users (
  household_id uuid references households on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'editor')),
  primary key (household_id, user_id)
);

-- People being fed. Kids are members without logins.
create table members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  age_group text not null check (age_group in ('adult', 'teen', 'child', 'toddler')),
  age int, sex text, height_cm numeric, weight_kg numeric, activity text,
  allergies text[] not null default '{}',
  dislikes text[] not null default '{}',
  portion_override numeric,
  macro_targets jsonb
);

-- Curated recipe library (editor-managed; readable by everyone).
create table recipes (
  id text primary key,
  title text not null,
  meal_types text[] not null,
  cuisine text, time_minutes int not null, servings int not null,
  diets text[] not null, tags text[] not null default '{}', kid_friendly boolean not null default false,
  ingredients jsonb not null, steps jsonb not null,
  nutrition_per_serving jsonb not null, longevity jsonb not null,
  image_url text,
  published boolean not null default true
);

create table plans (
  id text primary key,
  household_id uuid not null references households on delete cascade,
  week_start date not null,
  strategy text not null check (strategy in ('meal-type', 'macro')),
  track text not null check (track in ('standard', 'longevity')),
  request jsonb not null,       -- PlanRequest minus the household snapshot (for regenerate/swap)
  meals jsonb not null,         -- PlannedMeal[]
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index plans_current on plans (household_id) where is_current;

create table shopping_checks (
  plan_id text references plans on delete cascade,
  item_key text not null,       -- "<name>|<unit>"
  checked boolean not null default true,
  primary key (plan_id, item_key)
);

-- Chat history (Messages API content blocks, append-only).
create table conversations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  messages jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Linked grocer accounts (Kroger OAuth etc.). Tokens are encrypted by the API before insert.
create table grocer_accounts (
  user_id uuid references auth.users on delete cascade,
  grocer text not null,
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  store_id text,
  primary key (user_id, grocer)
);

-- Carts we created, for order history and grocer analytics.
create table grocer_orders (
  id uuid primary key default gen_random_uuid(),
  plan_id text references plans on delete set null,
  grocer text not null,
  checkout_url text,
  item_count int not null,
  estimated_total_cents int,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table households enable row level security;
alter table household_users enable row level security;
alter table members enable row level security;
alter table recipes enable row level security;
alter table plans enable row level security;
alter table shopping_checks enable row level security;
alter table conversations enable row level security;
alter table grocer_accounts enable row level security;
alter table grocer_orders enable row level security;

create function is_household_user(h uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from household_users where household_id = h and user_id = auth.uid())
$$;

create policy "own households" on households for all using (is_household_user(id));
create policy "own household_users" on household_users for select using (user_id = auth.uid());
create policy "own members" on members for all using (is_household_user(household_id));
create policy "read recipes" on recipes for select using (published);
create policy "own plans" on plans for all using (is_household_user(household_id));
create policy "own checks" on shopping_checks for all using (exists (select 1 from plans p where p.id = plan_id and is_household_user(p.household_id)));
create policy "own conversations" on conversations for all using (user_id = auth.uid());
create policy "own grocer accounts" on grocer_accounts for all using (user_id = auth.uid());
create policy "own orders" on grocer_orders for select using (exists (select 1 from plans p where p.id = plan_id and is_household_user(p.household_id)));
