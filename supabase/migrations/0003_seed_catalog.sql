-- Catalogue seed. Keep in sync with src/config/*.ts — these rows are the
-- authoritative prices; the client copies exist only for rendering.

insert into public.vehicle_catalog (spec_id, name, category, price) values
  ('pico_hatch',    'Ravello Pico',        'hatchback', 0),
  ('rustbucket',    'Corso Ninety-Two',    'beater',    6500),
  ('packhorse_lt',  'Ridgeline Packhorse', 'pickup',    29000),
  ('vantail_gt',    'Kestrel Vantail GT',  'coupe',     32000),
  ('brutus_v8',     'Halloran Brutus',     'muscle',    41000),
  ('tundrak_4x4',   'Volkov Tundrak 4x4',  'suv',       47000),
  ('meridian_rs',   'Aldrin Meridian RS',  'sedan',     54000),
  ('aerith_x',      'Nocturne Aerith X',   'supercar',  168000)
on conflict (spec_id) do update
  set name = excluded.name, category = excluded.category, price = excluded.price;

insert into public.upgrade_catalog (upgrade_key, level, price) values
  ('engine', 1, 4000),  ('engine', 2, 11000), ('engine', 3, 26000),
  ('acceleration', 1, 3500), ('acceleration', 2, 9500), ('acceleration', 3, 22000),
  ('brakes', 1, 2500),  ('brakes', 2, 7000),  ('brakes', 3, 16000),
  ('handling', 1, 3000),('handling', 2, 8500),('handling', 3, 19000),
  ('durability', 1, 3000), ('durability', 2, 8000), ('durability', 3, 18000)
on conflict (upgrade_key, level) do update set price = excluded.price;

insert into public.cosmetic_catalog (kind, option_id, price) values
  ('paint', 'stock', 0), ('paint', 'ember', 1200), ('paint', 'voltage', 1200),
  ('paint', 'abyss', 1200), ('paint', 'cream', 1200), ('paint', 'tar', 1800),
  ('paint', 'sherbet', 2400), ('paint', 'chrome', 6000),
  ('wheel', 'stock', 0), ('wheel', 'mesh', 1500), ('wheel', 'blade', 2800), ('wheel', 'deep', 3400),
  ('accent', 'stock', 0), ('accent', 'carbon', 900), ('accent', 'gold', 2200), ('accent', 'white', 900)
on conflict (kind, option_id) do update set price = excluded.price;

insert into public.gadget_catalog (gadget_id, name, price) values
  ('oil_slick',   'Oil Slick',    0),
  ('smoke_screen','Smoke Screen', 9000),
  ('bounce_pad',  'Bounce Pad',   14000),
  ('spike_strip', 'Spike Strip',  21000)
on conflict (gadget_id) do update set name = excluded.name, price = excluded.price;

-- max_reward bounds what award_activity_reward can ever pay for one run.
insert into public.activity_catalog (activity_id, kind, base_reward, time_limit, max_reward) values
  ('delivery_docks',   'delivery',        2400, 95,  4800),
  ('delivery_suburbs', 'delivery',        2800, 105, 5600),
  ('delivery_flats',   'delivery',        3600, 120, 7200),
  ('race_downtown',    'race',            5000, 180, 10000),
  ('race_highway',     'race',            7500, 240, 15000),
  ('trial_suburbs',    'time_trial',      3200, 78,  6400),
  ('crash_arena',      'crash_challenge', 1000, 90,  30000)
on conflict (activity_id) do update
  set kind = excluded.kind,
      base_reward = excluded.base_reward,
      time_limit = excluded.time_limit,
      max_reward = excluded.max_reward;
