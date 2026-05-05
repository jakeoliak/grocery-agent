-- Enable UUID generation
create extension if not exists "pgcrypto";

-- stores
create table stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  chain       text not null,
  location    text,
  external_id text,
  created_at  timestamptz not null default now()
);

-- foods
create table foods (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  brand                text,
  category             text not null check (category in (
                         'protein','carb','fat','vegetable','fruit',
                         'dairy','snack','beverage','other'
                       )),
  serving_size_g       numeric,
  calories_per_serving numeric,
  protein_g            numeric,
  carbs_g              numeric,
  fat_g                numeric,
  fiber_g              numeric,
  micros               jsonb not null default '{}',
  source               text not null check (source in ('tj','kroger','nutritionix')),
  external_id          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- prices
create table prices (
  id           uuid primary key default gen_random_uuid(),
  food_id      uuid not null references foods(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  price_cents  int not null,
  unit         text,
  package_size text,
  fetched_at   timestamptz not null default now()
);

create index prices_food_store_fetched_idx
  on prices (food_id, store_id, fetched_at desc);

-- baskets
create table baskets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid,
  store_id         uuid references stores(id),
  budget_cents     int,
  goal             text,
  days             int,
  items            jsonb,
  totals           jsonb,
  agent_decisions  jsonb,
  created_at       timestamptz not null default now()
);

-- Row-Level Security
alter table baskets enable row level security;

-- Baskets are readable and writable only by their owner
create policy "Baskets: owner read"
  on baskets for select
  using (auth.uid() = user_id);

create policy "Baskets: owner insert"
  on baskets for insert
  with check (auth.uid() = user_id);

create policy "Baskets: owner update"
  on baskets for update
  using (auth.uid() = user_id);

create policy "Baskets: owner delete"
  on baskets for delete
  using (auth.uid() = user_id);

-- Foods and prices are publicly readable
alter table foods enable row level security;
create policy "Foods: public read" on foods for select using (true);

alter table prices enable row level security;
create policy "Prices: public read" on prices for select using (true);
