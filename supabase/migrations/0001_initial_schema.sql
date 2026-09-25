-- ============================================================================
-- CRASHOUT — initial schema
--
-- Design rule: this database stores PERSISTENT state only (accounts, money,
-- garage, progression). Live game state (positions, velocities, physics) never
-- touches Postgres — it goes over Realtime broadcast, see
-- src/lib/networking/SupabaseRealtimeTransport.ts.
--
-- Security rule: the client can never write its own balance. `credits` is not
-- granted to `authenticated`; every change goes through a SECURITY DEFINER
-- function that re-derives the amount from server-side catalogue tables.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- catalogues
-- Server-side source of truth for prices and payouts. The client has a copy in
-- src/config for rendering, but money decisions are made from these rows.

create table if not exists public.vehicle_catalog (
  spec_id     text primary key,
  name        text        not null,
  category    text        not null,
  price       integer     not null check (price >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.upgrade_catalog (
  upgrade_key text    not null,
  level       integer not null check (level between 1 and 3),
  price       integer not null check (price >= 0),
  primary key (upgrade_key, level)
);

create table if not exists public.cosmetic_catalog (
  kind      text    not null check (kind in ('paint', 'wheel', 'accent')),
  option_id text    not null,
  price     integer not null check (price >= 0),
  primary key (kind, option_id)
);

create table if not exists public.activity_catalog (
  activity_id  text    primary key,
  kind         text    not null,
  base_reward  integer not null check (base_reward >= 0),
  time_limit   integer not null check (time_limit > 0),
  -- Hard ceiling per completion. Bounds any client-side exaggeration.
  max_reward   integer not null check (max_reward >= 0)
);

create table if not exists public.gadget_catalog (
  gadget_id text    primary key,
  name      text    not null,
  price     integer not null check (price >= 0)
);

-- ------------------------------------------------------------------ profiles

create table if not exists public.profiles (
  id                uuid        primary key references auth.users (id) on delete cascade,
  username          text        not null check (char_length(username) between 2 and 24),
  avatar            text,
  credits           bigint      not null default 15000 check (credits >= 0),
  level             integer     not null default 1 check (level >= 1),
  experience        integer     not null default 0 check (experience >= 0),
  active_vehicle_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- ------------------------------------------------------------------- garage

create table if not exists public.player_vehicles (
  id           uuid        primary key default gen_random_uuid(),
  owner_id     uuid        not null references public.profiles (id) on delete cascade,
  spec_id      text        not null references public.vehicle_catalog (spec_id),
  nickname     text        check (nickname is null or char_length(nickname) <= 32),
  paint        text        not null default 'stock',
  wheel_style  text        not null default 'stock',
  accent       text        not null default 'stock',
  created_at   timestamptz not null default now()
);

create index if not exists player_vehicles_owner_idx on public.player_vehicles (owner_id);

alter table public.profiles
  drop constraint if exists profiles_active_vehicle_fk;
alter table public.profiles
  add constraint profiles_active_vehicle_fk
  foreign key (active_vehicle_id) references public.player_vehicles (id) on delete set null;

create table if not exists public.vehicle_upgrades (
  player_vehicle_id uuid    primary key references public.player_vehicles (id) on delete cascade,
  engine            integer not null default 0 check (engine between 0 and 3),
  brakes            integer not null default 0 check (brakes between 0 and 3),
  handling          integer not null default 0 check (handling between 0 and 3),
  acceleration      integer not null default 0 check (acceleration between 0 and 3),
  durability        integer not null default 0 check (durability between 0 and 3)
);

create table if not exists public.player_inventory (
  id         uuid        primary key default gen_random_uuid(),
  owner_id   uuid        not null references public.profiles (id) on delete cascade,
  gadget_id  text        not null references public.gadget_catalog (gadget_id),
  quantity   integer     not null default 1 check (quantity >= 0),
  created_at timestamptz not null default now(),
  unique (owner_id, gadget_id)
);

create index if not exists player_inventory_owner_idx on public.player_inventory (owner_id);

-- -------------------------------------------------------------------- stats

create table if not exists public.player_stats (
  player_id            uuid   primary key references public.profiles (id) on delete cascade,
  distance_driven      bigint not null default 0 check (distance_driven >= 0),
  crashes              integer not null default 0 check (crashes >= 0),
  biggest_crash        integer not null default 0 check (biggest_crash >= 0),
  races_won            integer not null default 0 check (races_won >= 0),
  deliveries_completed integer not null default 0 check (deliveries_completed >= 0),
  credits_earned       bigint not null default 0 check (credits_earned >= 0),
  updated_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------- sessions
-- Session rows are metadata only (who is hosting which code). Gameplay traffic
-- is never written here.

create table if not exists public.sessions (
  id         uuid        primary key default gen_random_uuid(),
  code       text        not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id    uuid        not null references public.profiles (id) on delete cascade,
  is_open    boolean     not null default true,
  max_players integer    not null default 8 check (max_players between 2 and 16),
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);

create index if not exists sessions_open_idx on public.sessions (is_open, created_at desc);

create table if not exists public.session_members (
  session_id uuid        not null references public.sessions (id) on delete cascade,
  player_id  uuid        not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (session_id, player_id)
);

create index if not exists session_members_player_idx on public.session_members (player_id);

-- ------------------------------------------------------------- transactions

create table if not exists public.transactions (
  id         uuid        primary key default gen_random_uuid(),
  player_id  uuid        not null references public.profiles (id) on delete cascade,
  amount     integer     not null,
  reason     text        not null,
  created_at timestamptz not null default now()
);

create index if not exists transactions_player_idx on public.transactions (player_id, created_at desc);

create table if not exists public.challenge_results (
  id          uuid        primary key default gen_random_uuid(),
  player_id   uuid        not null references public.profiles (id) on delete cascade,
  activity_id text        not null references public.activity_catalog (activity_id),
  score       integer     not null default 0,
  time_ms     integer     not null default 0,
  reward      integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists challenge_results_player_idx on public.challenge_results (player_id, created_at desc);
create index if not exists challenge_results_activity_idx on public.challenge_results (activity_id, score desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.player_vehicles   enable row level security;
alter table public.vehicle_upgrades  enable row level security;
alter table public.player_inventory  enable row level security;
alter table public.player_stats      enable row level security;
alter table public.sessions          enable row level security;
alter table public.session_members   enable row level security;
alter table public.transactions      enable row level security;
alter table public.challenge_results enable row level security;
alter table public.vehicle_catalog   enable row level security;
alter table public.upgrade_catalog   enable row level security;
alter table public.cosmetic_catalog  enable row level security;
alter table public.activity_catalog  enable row level security;
alter table public.gadget_catalog    enable row level security;

-- Catalogues are public read-only reference data.
do $$
declare t text;
begin
  foreach t in array array['vehicle_catalog','upgrade_catalog','cosmetic_catalog','activity_catalog','gadget_catalog']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_read', t);
  end loop;
end $$;

-- Profiles: everyone can read (names on other players' cars, leaderboards).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Column-level grants are what actually stop a client setting its own balance.
-- The RLS policy above allows the row; these grants restrict which columns.
revoke update on public.profiles from authenticated;
grant update (username, avatar, active_vehicle_id, updated_at) on public.profiles to authenticated;

-- Garage rows are owner-scoped. Reads are open so other players can see what
-- someone is driving; writes are restricted and prices go through RPCs.
drop policy if exists player_vehicles_read on public.player_vehicles;
create policy player_vehicles_read on public.player_vehicles for select using (true);

drop policy if exists player_vehicles_update_own on public.player_vehicles;
create policy player_vehicles_update_own on public.player_vehicles
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- No direct insert/delete: acquiring a car costs money, so it goes through
-- purchase_vehicle(). Only cosmetic/nickname columns are updatable directly,
-- and paid cosmetics are still applied through purchase_customization().
revoke insert, delete on public.player_vehicles from authenticated;
revoke update on public.player_vehicles from authenticated;
grant update (nickname) on public.player_vehicles to authenticated;

drop policy if exists vehicle_upgrades_read on public.vehicle_upgrades;
create policy vehicle_upgrades_read on public.vehicle_upgrades for select using (true);
revoke insert, update, delete on public.vehicle_upgrades from authenticated;

drop policy if exists inventory_read_own on public.player_inventory;
create policy inventory_read_own on public.player_inventory
  for select using (auth.uid() = owner_id);
revoke insert, update, delete on public.player_inventory from authenticated;

drop policy if exists stats_read on public.player_stats;
create policy stats_read on public.player_stats for select using (true);

drop policy if exists stats_upsert_own on public.player_stats;
create policy stats_upsert_own on public.player_stats
  for insert with check (auth.uid() = player_id);

drop policy if exists stats_update_own on public.player_stats;
create policy stats_update_own on public.player_stats
  for update using (auth.uid() = player_id) with check (auth.uid() = player_id);

-- Stats are cosmetic bragging rights, not currency, so the client may write
-- them directly. Nothing in the economy reads from this table.

drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions for select using (true);

drop policy if exists sessions_insert_host on public.sessions;
create policy sessions_insert_host on public.sessions
  for insert with check (auth.uid() = host_id);

drop policy if exists sessions_update_host on public.sessions;
create policy sessions_update_host on public.sessions
  for update using (auth.uid() = host_id) with check (auth.uid() = host_id);

drop policy if exists session_members_read on public.session_members;
create policy session_members_read on public.session_members for select using (true);

drop policy if exists session_members_join on public.session_members;
create policy session_members_join on public.session_members
  for insert with check (auth.uid() = player_id);

drop policy if exists session_members_leave on public.session_members;
create policy session_members_leave on public.session_members
  for delete using (auth.uid() = player_id);

drop policy if exists transactions_read_own on public.transactions;
create policy transactions_read_own on public.transactions
  for select using (auth.uid() = player_id);
revoke insert, update, delete on public.transactions from authenticated;

drop policy if exists challenge_results_read on public.challenge_results;
create policy challenge_results_read on public.challenge_results for select using (true);
revoke insert, update, delete on public.challenge_results from authenticated;
