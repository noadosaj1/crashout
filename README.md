# CRASHOUT

A browser-based multiplayer open-world driving sandbox. Arcade handling,
rigid-body crash physics, a fictional city to wreck, and a join code so friends
can wreck it with you.

```
npm install
npm run dev     # http://localhost:5173
```

The game runs with no backend configured. You get a local save and same-device
multiplayer between browser tabs. Adding Supabase turns on accounts, cloud
saves and multiplayer over the internet — see **Backend** below.

---

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Throttle, steer, brake / reverse |
| `Space` | Handbrake (locks the rears — this is how you drift) |
| `Shift` | Boost, on cars that have it |
| `R` | Recover vehicle |
| `Q` | Deploy equipped gadget |
| `V` | Look back |
| `C` | Re-centre camera |
| `T` | Chat (in a multiplayer world) |
| `Tab` | Challenges |
| `G` | Garage |
| `Esc` | Pause menu |

Gamepads work too (standard mapping): left stick steers, triggers drive, `A`
handbrake, `B` recover, `X` gadget, bumpers boost.

While airborne, throttle and brake pitch the car and steering rolls it. Landing
on your wheels is worth points; landing on your roof is worth watching.

---

## Architecture

The renderer, the physics world and every gameplay system live outside React.
React draws the HUD and the menus and nothing else — it is handed a snapshot
12 times a second (`Engine.publishHud`), so no gameplay value ever triggers a
component render.

```
src/
  game/
    core/        Engine (owns the frame loop), typed event bus
    physics/     Rapier world + fixed-timestep accumulator
    vehicles/    Raycast vehicle controller, procedural car meshes, damage model
    world/       City builder, surface map, sky
    crash/       Contact → damage → effects → score
    camera/      Third-person chase rig
    input/       Keyboard + gamepad
    effects/     Pooled particles, skid marks
    audio/       Procedural WebAudio (no sample files)
    gadgets/     Sabotage hazards
    missions/    Deliveries, races, time trials, crash challenges
    traffic/     Lane graph built from the roads, AI cars that drive it
    multiplayer/ Remote vehicles, interpolation, replication
  components/    HUD, garage, menus, session panel  (React)
  lib/
    supabase/    Client, auth, generated-ish DB types
    networking/  Transport interface + two implementations
    persistence/ Persistence interface + two implementations
  config/        All game content as data: vehicles, gadgets, activities, world
  store/         Zustand store for UI state only
```

### Fixed timestep

Physics runs at a fixed 60 Hz (`PHYSICS_DT`) with an accumulator, capped at five
steps per frame. Vehicle forces are applied in `PhysicsWorld.onStep` so handling
does not change with frame rate, and rendering interpolates between the last two
physics states.

### Vehicle model

One rigid-body chassis plus four raycast springs. Collisions are therefore fully
rigid-body — what you hit, and how hard, is real physics — while handling stays
arcade: no tire model, no gearbox, no engine map. Steering authority falls off
with speed, the handbrake cuts rear grip to 22%, and every wheel has a friction
budget proportional to its suspension load, which is what makes weight transfer,
drifting and wheelspin fall out for free.

Every car is defined entirely by data in `src/config/vehicles.ts`. There is no
per-vehicle code anywhere.

Two details are worth knowing because they are counter-intuitive and were both
found by measuring rather than by reading the code:

**Drive force is applied at the centre of mass**, with the pitch couple it earned
at the contact patches added separately. Applying it at the patches looks more
correct and is a trap: the moment the body rolls by a fraction of a degree the
two patches stop being symmetric about the centre of mass, equal drive forces no
longer cancel in yaw, the resulting yaw causes more roll, and the car winds
itself into a permanent turn with the wheels pointing dead ahead. Measured, an
untouched car left a 200 m straight by 13 metres and ended 37° off its heading;
the muscle car spun outright. The cost is that a genuine left/right traction
split no longer steers the car — a trade worth making.

**A yaw assist supplies the self-centring the model has none of.** It pulls the
car toward the yaw rate its steering geometry asks for, and it only ever *damps*:
it can slow a rotation the driver did not ask for, never add one. An assist that
adds rotation spins the body while the velocity carries straight on, and the car
crabs sideways at slip angles no tire could produce. Its authority falls away as
the car leaves the ground, slides, or pulls the handbrake, so drifts stay drifts.

Measured behaviour of the stock roster:

| Car | 0–100 km/h | Turn radius at full lock | Slip angle |
| --- | --- | --- | --- |
| Ravello Pico (hatch) | 5.2 s | 22 m at 69 km/h | 3.1° |
| Halloran Brutus (muscle) | 3.0 s | 99 m at 130 km/h | 0.8° |
| Volkov Tundrak (SUV) | 4.3 s | 64 m at 108 km/h | 1.4° |
| Nocturne Aerith X (supercar) | 2.4 s | 106 m at 169 km/h | 0.8° |
| Brutus, handbrake down | — | 4 m at 29 km/h | 47° |

That last row is the drift control: handbrake with throttle collapses rear
lateral grip but keeps the rears driving, so a slide can be held. Handbrake
alone locks them and the car slides to a stop.

### Crash severity

Severity comes from how much velocity the solver removed from the car in a
single step, not from contact force. Contact force scales with mass and spikes on
ordinary resting contact, which makes it useless as a severity signal; it is used
only as a cheap gate for which contacts are worth examining. The resulting
measure is mass-independent, so one threshold works for a 980 kg hatchback and a
2250 kg SUV alike.

The damaged panel is derived from the direction the car was shoved, which is
robust regardless of which collider the solver put in slot 1.

### AI traffic

The roads in `src/config/world.ts` are long strips that cross each other
mid-span, so they are not a graph. `TrafficNetwork` splits every road at each
crossing, offsets the two directions to opposite sides of the centreline and
links each lane to the lanes that leave its far end. U-turns are only offered
where a lane has no other exit, which is what keeps cars from bouncing back and
forth along a spur.

Cars follow their lane with pure pursuit — aim at a point a little way ahead,
turn towards it at a bounded rate — and brake for whatever is in front of them,
the player included. They drive as kinematic bodies: cheap, and they cannot be
shoved off their lane by a passing wing mirror. Like the vehicle forces, they
tick on the fixed physics clock rather than on rendered frames, so on a slow
machine the traffic and the player's car still share one notion of time.

A kinematic body has infinite mass, though, so hitting one is hitting a wall. A
car about to be hit is handed to the solver a moment early — closing speed,
time to closest approach and predicted miss distance decide — so the impact is
one car against another, and the car that was hit tumbles because the solver
made it, not because an impulse was faked. Anything hit hard enough goes
dynamic the same way and stays a wreck for `TRAFFIC_WRECK_LIFETIME`.

Traffic is local to each client and is not replicated: two players in a session
see their own cars, and a wreck one player causes does not appear on the other's
screen. Replicating it would mean an authoritative owner for every car, which is
the same problem the networking layer defers until there is a server.

Density, the spawn ring and the silhouettes are all in `src/config/traffic.ts`.
Cars are kept from appearing where you would see it happen: a spawn inside the
forward cone needs a building between it and the player, or a long distance.
Traffic can be turned off entirely in Settings.

---

## Backend

Supabase is optional and strictly separated from live gameplay:

- **Persistent state** (accounts, credits, garage, upgrades, stats) → Postgres.
- **Live game state** (position, rotation, velocity, physics events) → Realtime
  broadcast, a websocket fan-out. Positions are never written to a table.

### Setting it up

1. Create a Supabase project.
2. Run the migrations in order:
   ```
   supabase/migrations/0001_initial_schema.sql
   supabase/migrations/0002_economy_functions.sql
   supabase/migrations/0003_seed_catalog.sql
   ```
   Either paste them into the SQL editor or run `supabase db push`.
3. Copy `.env.example` to `.env` and fill in your project URL and anon key.

The anon key is meant to be public; Row Level Security is what protects the data.

### Economy security

The client cannot write its own balance. `UPDATE` on `profiles` is granted only
on `username`, `avatar` and `active_vehicle_id` — the `credits` column is not
grantable to `authenticated` at all. Every credit movement goes through a
`SECURITY DEFINER` function that re-derives the amount from server-side
catalogue tables:

| Function | Guarantees |
| --- | --- |
| `purchase_vehicle` | Price read from `vehicle_catalog`, balance checked under `FOR UPDATE` |
| `purchase_upgrade` | Level and price read from `upgrade_catalog`, capped at 3 |
| `purchase_customization` | Price read from `cosmetic_catalog` |
| `purchase_gadget` | Price read from `gadget_catalog` |
| `repair_vehicle` | Cost derived from damage, clamped |
| `award_activity_reward` | Reward recomputed from `activity_catalog`, clamped to `max_reward`, rate-limited to 6 payouts/minute |

A client can ask to be paid for a delivery. It cannot say how much.

Player stats (distance, crash count) are writable directly — they are bragging
rights, and nothing in the economy reads them.

---

## Multiplayer

Everything goes through `NetworkTransport` (`src/lib/networking/types.ts`). Two
implementations ship:

| Transport | When | Reach |
| --- | --- | --- |
| `SupabaseRealtimeTransport` | Supabase configured | Anywhere |
| `LocalBroadcastTransport` | No Supabase | Other tabs on the same machine |

Host a world to get a six-character code; anyone entering it spawns into the same
city. Network identity is per browser tab, not per profile — two tabs on one
machine share a save (so they share a garage) but still appear as two drivers.

With Supabase configured, hosting also writes a row to `sessions`, so joining a
code nobody is hosting fails cleanly instead of dropping you into an empty city.
That bookkeeping is best-effort: the Realtime channel is what actually carries
the session, and play works whether or not the row exists.

Remote cars are kinematic-position-based rigid bodies driven by an interpolation
buffer played back 120 ms behind real time, so packet jitter never shows. Because
they are real bodies rather than floating meshes, ramming another player produces
an actual collision — with damage, sparks and camera shake — on both machines.
Transforms go out 15 times a second, rounded to millimetres.

One thing does need explicit replication. Because each client simulates only its
own car, and its copy of the attacker is delayed, the victim of a ram barely
moved — the attacker bounced off a proxy while the victim felt almost nothing.
The attacker now names its victim in the crash packet and the victim applies the
hit, with a short window that stops an impact it also felt locally from counting
twice.

Each client is authoritative over its own car. That is the right trade for a
sandbox and the wrong one for a competitive game, which is why nothing about the
economy is decided client-side. Moving to an authoritative server means writing
one more `NetworkTransport` and changing one line in `createTransport`.

---

## Deploying

The app is a static bundle. On Vercel, import the repository, add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables if you
want the backend, and deploy — `vercel.json` already has the framework preset,
the SPA rewrite and asset caching.

---

## Content is data

Twelve cars, twelve activities, five gadgets and five districts, all of it
config. Adding a car means one entry in `src/config/vehicles.ts` (plus a row in
`vehicle_catalog` if you are using Supabase). Adding a gadget means one entry in
`src/config/gadgets.ts` plus a visual and an effect case in `GadgetSystem`, and
a case in `TrafficSystem.hazardHit` if traffic should care about it. Adding an
activity means one entry in `src/config/activities.ts` (plus a row in
`activity_catalog`, which is what caps its payout). Roads, zones and landmarks
live in `src/config/world.ts`.

Gadgets act on traffic as well as on other players, which is what makes them
worth carrying with nobody else online: a spike strip across a junction leaves
cars sideways in it, smoke drops everyone who drives in to a crawl, and a
thumper charge throws whatever passes it off the road.

Vehicles are fictional. No real manufacturer's marks, models or branding are
used, and the vehicle data layer is deliberately shaped so licensed cars could be
added later if the rights existed.

### Car models

Cars are built from Kenney's Car Kit (CC0, credited in
`public/models/cars/LICENSE.txt`) rather than from boxes. A spec points at one
by name:

```ts
visual: { model: 'sedan-sports', roofScale: 0.74, ... }
```

Anything in `public/models/cars` works, and dropping another CC0 pack in there
is the cheapest way to add variety. A spec without a `model`, or one whose file
fails to load, falls back to the procedural mesh — that path is still complete,
and it is what draws the car if the models are stripped out.

Three things happen to a model on the way in:

- **It is scaled to its collider**, per axis, so what you see is what you hit.
  The models are stubbier than real cars; the specs are in metres.
- **The body is cut into panels** — bumpers, nose, tail, flanks, roof — by where
  each triangle sits on the car, so the damage model crumples real geometry and
  a wrecked car tears along those seams.
- **It is repainted.** These models colour themselves by pointing their UVs at
  bands of one shared palette, so the paint is applied by rewriting the band the
  bodywork uses, leaving glass, lights and tyres alone. Note that glTF textures
  are stored top-down (`flipY` is false): reading the palette the other way up
  samples a different colour entirely.

The city is built from the same kits — Kenney's commercial and suburban city
kits, in `public/models/city`. Scenery works the other way round from cars:
the model decides the size and the collider is cut to fit it, because these
are modular pieces with windows and doors at a fixed scale and stretching one
to fill an arbitrary box makes a doll's house out of a tower. `CITY_SCALE` in
`src/config/world.ts` is how many metres a kit unit is worth, and downtown
lays each block out as a two-by-two of plots so the footprints stay off the
kerb. Buildings that fail to load fall back to the boxes with window bands.

Traffic is built the same way, but whole — body and wheels merged into one
geometry per vehicle type, one draw call each — and keeps the palette's own
colours, so the variety comes from there being seven kinds of vehicle on the
road rather than from tinting one.

---

## Scripts

```
npm run dev        Dev server
npm run build      Typecheck + production build
npm run lint       oxlint
npm run test       Unit tests (vitest)
npm run test:e2e   End-to-end smoke test (needs `npm run dev` running)
npm run check      lint + build + unit tests
npm run preview    Serve the production build
```

## Tests

`npm run test` covers the pure logic: the damage model and how it feeds back
into handling, the economy rules and their payout caps, upgrade maths, world
layout invariants (nothing outside the boundary walls, spawn points far enough
apart that cars do not overlap) and join-code generation.

`npm run test:e2e` boots the real game in Chromium and drives it: spawn, throttle
and weight transfer, a 120 km/h head-on that must register as a maximum-severity
front impact while a gentle bump registers as nothing, recovery from an inverted
car, an arena ramp launch, gadget cooldowns, a delivery run end to end, buying a
car from the showroom, and a two-player session that ends with one player ramming
the other. It waits on simulation state rather than wall time, because under
software rendering the simulation runs well below real time.

Both suites are also where several of the physics bugs in this repo were found —
`tests/e2e/smoke.mjs` asserts on wheel loads and impact severities precisely
because those are the numbers that go wrong silently.
