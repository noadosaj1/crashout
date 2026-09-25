-- ============================================================================
-- Server-side economy. Every credit that enters or leaves a balance does so
-- here, where the amount is recomputed from catalogue rows. The client can ask
-- to be paid for a delivery; it cannot say how much.
-- ============================================================================

-- Creates the profile row (and a starter car) the first time a user signs in.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_username text;
  starter_id   uuid;
begin
  new_username := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    'Driver' || substr(replace(new.id::text, '-', ''), 1, 6)
  );

  insert into public.profiles (id, username)
  values (new.id, new_username)
  on conflict (id) do nothing;

  insert into public.player_stats (player_id)
  values (new.id)
  on conflict (player_id) do nothing;

  -- Everyone starts with the free hatchback so they can drive immediately.
  insert into public.player_vehicles (owner_id, spec_id)
  select new.id, 'pico_hatch'
  where exists (select 1 from public.vehicle_catalog where spec_id = 'pico_hatch')
  returning id into starter_id;

  if starter_id is not null then
    insert into public.vehicle_upgrades (player_vehicle_id) values (starter_id)
    on conflict do nothing;
    update public.profiles set active_vehicle_id = starter_id where id = new.id;
  end if;

  -- And with the starter gadget.
  insert into public.player_inventory (owner_id, gadget_id, quantity)
  select new.id, 'oil_slick', 1
  where exists (select 1 from public.gadget_catalog where gadget_id = 'oil_slick')
  on conflict (owner_id, gadget_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Internal helper: move credits and write the ledger row in one transaction.
create or replace function public.apply_credits(p_player uuid, p_amount integer, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance bigint;
begin
  update public.profiles
     set credits = credits + p_amount,
         updated_at = now()
   where id = p_player
  returning credits into new_balance;

  if new_balance is null then
    raise exception 'profile not found';
  end if;

  insert into public.transactions (player_id, amount, reason)
  values (p_player, p_amount, p_reason);

  if p_amount > 0 then
    update public.player_stats
       set credits_earned = credits_earned + p_amount,
           updated_at = now()
     where player_id = p_player;
  end if;

  return new_balance;
end;
$$;

revoke execute on function public.apply_credits(uuid, integer, text) from public, anon, authenticated;

-- ----------------------------------------------------------------- purchases

create or replace function public.purchase_vehicle(p_spec_id text)
returns public.player_vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price   integer;
  v_credits bigint;
  v_vehicle public.player_vehicles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select price into v_price from public.vehicle_catalog where spec_id = p_spec_id;
  if v_price is null then
    raise exception 'unknown vehicle %', p_spec_id;
  end if;

  select credits into v_credits from public.profiles where id = auth.uid() for update;
  if v_credits < v_price then
    raise exception 'insufficient credits';
  end if;

  perform public.apply_credits(auth.uid(), -v_price, 'purchase_vehicle:' || p_spec_id);

  insert into public.player_vehicles (owner_id, spec_id)
  values (auth.uid(), p_spec_id)
  returning * into v_vehicle;

  insert into public.vehicle_upgrades (player_vehicle_id) values (v_vehicle.id);

  return v_vehicle;
end;
$$;

create or replace function public.purchase_upgrade(p_vehicle_id uuid, p_key text)
returns public.vehicle_upgrades
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_price   integer;
  v_credits bigint;
  v_row     public.vehicle_upgrades;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_key not in ('engine', 'brakes', 'handling', 'acceleration', 'durability') then
    raise exception 'unknown upgrade %', p_key;
  end if;
  if not exists (select 1 from public.player_vehicles where id = p_vehicle_id and owner_id = auth.uid()) then
    raise exception 'vehicle not owned';
  end if;

  execute format('select %I from public.vehicle_upgrades where player_vehicle_id = $1', p_key)
    into v_current using p_vehicle_id;

  if v_current is null then
    insert into public.vehicle_upgrades (player_vehicle_id) values (p_vehicle_id)
    on conflict do nothing;
    v_current := 0;
  end if;

  if v_current >= 3 then
    raise exception 'upgrade already maxed';
  end if;

  select price into v_price from public.upgrade_catalog where upgrade_key = p_key and level = v_current + 1;
  if v_price is null then
    raise exception 'no price for % level %', p_key, v_current + 1;
  end if;

  select credits into v_credits from public.profiles where id = auth.uid() for update;
  if v_credits < v_price then
    raise exception 'insufficient credits';
  end if;

  perform public.apply_credits(auth.uid(), -v_price, 'purchase_upgrade:' || p_key);

  execute format(
    'update public.vehicle_upgrades set %I = %I + 1 where player_vehicle_id = $1 returning *', p_key, p_key)
    into v_row using p_vehicle_id;

  return v_row;
end;
$$;

create or replace function public.purchase_customization(p_vehicle_id uuid, p_kind text, p_option_id text)
returns public.player_vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price   integer;
  v_credits bigint;
  v_row     public.player_vehicles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_kind not in ('paint', 'wheel', 'accent') then
    raise exception 'unknown customization kind %', p_kind;
  end if;
  if not exists (select 1 from public.player_vehicles where id = p_vehicle_id and owner_id = auth.uid()) then
    raise exception 'vehicle not owned';
  end if;

  select price into v_price from public.cosmetic_catalog where kind = p_kind and option_id = p_option_id;
  if v_price is null then
    raise exception 'unknown option % %', p_kind, p_option_id;
  end if;

  if v_price > 0 then
    select credits into v_credits from public.profiles where id = auth.uid() for update;
    if v_credits < v_price then
      raise exception 'insufficient credits';
    end if;
    perform public.apply_credits(auth.uid(), -v_price, 'purchase_cosmetic:' || p_kind || ':' || p_option_id);
  end if;

  if p_kind = 'paint' then
    update public.player_vehicles set paint = p_option_id where id = p_vehicle_id returning * into v_row;
  elsif p_kind = 'wheel' then
    update public.player_vehicles set wheel_style = p_option_id where id = p_vehicle_id returning * into v_row;
  else
    update public.player_vehicles set accent = p_option_id where id = p_vehicle_id returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.purchase_gadget(p_gadget_id text)
returns public.player_inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price   integer;
  v_credits bigint;
  v_row     public.player_inventory;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select price into v_price from public.gadget_catalog where gadget_id = p_gadget_id;
  if v_price is null then
    raise exception 'unknown gadget %', p_gadget_id;
  end if;
  if exists (select 1 from public.player_inventory where owner_id = auth.uid() and gadget_id = p_gadget_id) then
    raise exception 'already owned';
  end if;

  select credits into v_credits from public.profiles where id = auth.uid() for update;
  if v_credits < v_price then
    raise exception 'insufficient credits';
  end if;

  perform public.apply_credits(auth.uid(), -v_price, 'purchase_gadget:' || p_gadget_id);

  insert into public.player_inventory (owner_id, gadget_id, quantity)
  values (auth.uid(), p_gadget_id, 1)
  returning * into v_row;

  return v_row;
end;
$$;

-- Repair cost scales with how wrecked the car is, capped so it is never a trap.
create or replace function public.repair_vehicle(p_vehicle_id uuid, p_damage numeric)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price   integer;
  v_credits bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.player_vehicles where id = p_vehicle_id and owner_id = auth.uid()) then
    raise exception 'vehicle not owned';
  end if;

  v_price := greatest(0, least(1, coalesce(p_damage, 0)) * 2500)::integer;
  if v_price = 0 then
    select credits into v_credits from public.profiles where id = auth.uid();
    return v_credits;
  end if;

  select credits into v_credits from public.profiles where id = auth.uid() for update;
  if v_credits < v_price then
    raise exception 'insufficient credits';
  end if;

  return public.apply_credits(auth.uid(), -v_price, 'repair');
end;
$$;

-- ------------------------------------------------------------------- rewards

-- The only way credits are created. The client reports how it did; the server
-- decides what that is worth, and caps it at the catalogue's max_reward.
create or replace function public.award_activity_reward(
  p_activity_id text,
  p_elapsed_seconds numeric,
  p_damage numeric,
  p_score numeric
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity   public.activity_catalog;
  v_reward     integer;
  v_time_ratio numeric;
  v_recent     integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_activity from public.activity_catalog where activity_id = p_activity_id;
  if v_activity is null then
    raise exception 'unknown activity %', p_activity_id;
  end if;

  -- Rate limit: a legitimate player cannot finish more than a handful of runs
  -- a minute, and this bounds the damage from a replayed request.
  select count(*) into v_recent
    from public.challenge_results
   where player_id = auth.uid()
     and created_at > now() - interval '60 seconds';
  if v_recent >= 6 then
    raise exception 'reward rate limit exceeded';
  end if;

  if p_elapsed_seconds is null or p_elapsed_seconds <= 0 then
    raise exception 'invalid elapsed time';
  end if;
  if p_elapsed_seconds > v_activity.time_limit then
    -- Ran out of time: no payout, but still record the attempt.
    insert into public.challenge_results (player_id, activity_id, score, time_ms, reward)
    values (auth.uid(), p_activity_id, 0, (p_elapsed_seconds * 1000)::integer, 0);
    return (select credits from public.profiles where id = auth.uid());
  end if;

  if v_activity.kind = 'crash_challenge' then
    -- Score-driven payout, hard-capped.
    v_reward := least(v_activity.max_reward, v_activity.base_reward + floor(greatest(0, coalesce(p_score, 0)) * 1.4)::integer);
  else
    v_time_ratio := 1 - (p_elapsed_seconds / v_activity.time_limit);
    v_reward := v_activity.base_reward
              + floor(v_activity.base_reward * 0.6 * greatest(0, least(1, v_time_ratio)))::integer
              + floor(v_activity.base_reward * 0.4 * greatest(0, 1 - least(1, coalesce(p_damage, 0))))::integer;
    v_reward := least(v_activity.max_reward, v_reward);
  end if;

  insert into public.challenge_results (player_id, activity_id, score, time_ms, reward)
  values (auth.uid(), p_activity_id, coalesce(p_score, 0)::integer, (p_elapsed_seconds * 1000)::integer, v_reward);

  if v_activity.kind = 'delivery' then
    update public.player_stats set deliveries_completed = deliveries_completed + 1 where player_id = auth.uid();
  elsif v_activity.kind = 'race' then
    update public.player_stats set races_won = races_won + 1 where player_id = auth.uid();
  end if;

  return public.apply_credits(auth.uid(), v_reward, 'activity:' || p_activity_id);
end;
$$;

grant execute on function public.purchase_vehicle(text)                        to authenticated;
grant execute on function public.purchase_upgrade(uuid, text)                  to authenticated;
grant execute on function public.purchase_customization(uuid, text, text)      to authenticated;
grant execute on function public.purchase_gadget(text)                         to authenticated;
grant execute on function public.repair_vehicle(uuid, numeric)                 to authenticated;
grant execute on function public.award_activity_reward(text, numeric, numeric, numeric) to authenticated;
