-- Content pass: four more vehicles. Prices here are authoritative; the client
-- copies in src/config/vehicles.ts exist only for rendering.

insert into public.vehicle_catalog (spec_id, name, category, price) values
  ('tempest_rt',  'Corso Tempest RT',   'coupe',     16500),
  ('hauler_box',  'Ridgeline Hauler',   'van',       24000),
  ('dune_rally',  'Ravello Dune RX',    'rally',     88000),
  ('sable_v12',   'Halloran Sable V12', 'supercar',  112000)
on conflict (spec_id) do update
  set name = excluded.name, category = excluded.category, price = excluded.price;

insert into public.gadget_catalog (gadget_id, name, price) values
  ('thumper', 'Thumper Charge', 28000)
on conflict (gadget_id) do update set name = excluded.name, price = excluded.price;

-- max_reward bounds what award_activity_reward can ever pay for one run.
insert into public.activity_catalog (activity_id, kind, base_reward, time_limit, max_reward) values
  ('delivery_arena',   'delivery',        3000, 100, 6000),
  ('race_industrial',  'race',            5500, 170, 11000),
  ('race_suburbs',     'race',            4800, 165, 9600),
  ('trial_highway',    'time_trial',      4200, 95,  8400),
  ('crash_docks',      'crash_challenge', 1400, 75,  30000)
on conflict (activity_id) do update
  set kind = excluded.kind,
      base_reward = excluded.base_reward,
      time_limit = excluded.time_limit,
      max_reward = excluded.max_reward;
