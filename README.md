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

### Crash severity

Severity comes from how much velocity the solver removed from the car in a
single step, not from contact force. Contact force scales with mass and spikes on
ordinary resting contact, which makes it useless as a severity signal; it is used
only as a cheap gate for which contacts are worth examining. The resulting
measure is mass-independent, so one threshold works for a 980 kg hatchback and a
2250 kg SUV alike.

The damaged panel is derived from the direction the car was shoved, which is
robust regardless of which collider the solver put in slot 1.

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
city.

Remote cars are kinematic-position-based rigid bodies driven by an interpolation
buffer played back 120 ms behind real time, so packet jitter never shows. Because
they are real bodies rather than floating meshes, ramming another player produces
an actual collision — with damage, sparks and camera shake — on both machines.
Transforms go out 15 times a second, rounded to millimetres.

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

Adding a car means one entry in `src/config/vehicles.ts` (plus a row in
`vehicle_catalog` if you are using Supabase). Adding a gadget means one entry in
`src/config/gadgets.ts` plus a visual and an effect case in `GadgetSystem`.
Adding an activity means one entry in `src/config/activities.ts`. Roads, zones
and landmarks live in `src/config/world.ts`.

Vehicles are fictional. No real manufacturer's marks, models or branding are
used, and the vehicle data layer is deliberately shaped so licensed cars could be
added later if the rights existed.

---

## Scripts

```
npm run dev        Dev server
npm run build      Typecheck + production build
npm run lint       oxlint
npm run preview    Serve the production build
```
