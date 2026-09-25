/**
 * End-to-end smoke test. Boots the real game in Chromium, drives it, crashes
 * it, runs an activity, buys a car and opens a two-player session.
 *
 *   npm run dev          # in one terminal
 *   npm run test:e2e     # in another
 *
 * Software rendering means the frame rate here is nothing like a real GPU; this
 * asserts on simulation state, not on frame timing. Set CRASHOUT_E2E_HEADED=1
 * to watch it, and CRASHOUT_E2E_CHROME=<path> to use a specific Chromium.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE_URL = process.env.CRASHOUT_E2E_URL ?? 'http://localhost:5173/'
const SHOTS = process.env.CRASHOUT_E2E_SHOTS ?? 'tests/e2e/screenshots'
mkdirSync(SHOTS, { recursive: true })

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const launchOptions = {
  headless: process.env.CRASHOUT_E2E_HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
}
if (process.env.CRASHOUT_E2E_CHROME) launchOptions.executablePath = process.env.CRASHOUT_E2E_CHROME

const browser = await chromium.launch(launchOptions)
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const pageErrors = []

async function boot(label) {
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(`[${label}] ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`[${label}] console.error: ${m.text()}`)
  })
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Play as guest' }).click()
  await page.waitForFunction(() => !document.querySelector('.loading'), { timeout: 120_000 })
  await page.waitForTimeout(2000)
  return page
}

const probe = (page) => page.evaluate(() => window.__CRASHOUT__.probe())
const settle = (page, ms = 2500) => page.waitForTimeout(ms)

/**
 * Polls the engine until `predicate` holds, then returns the last state.
 *
 * Software rendering runs the simulation well below real time and the rate
 * varies with machine load, so fixed waits make this suite flaky. Everything
 * timing-dependent waits on simulation state instead.
 */
async function waitForState(page, predicate, { timeout = 30_000, step = 250 } = {}) {
  const deadline = Date.now() + timeout
  let last = await probe(page)
  while (Date.now() < deadline) {
    if (predicate(last)) return last
    await page.waitForTimeout(step)
    last = await probe(page)
  }
  return last
}

console.log('\nboot')
const page = await boot('main')
{
  const state = await probe(page)
  check('world is built', state.rigidBodies > 300, `${state.rigidBodies} bodies`)
  check('car spawns on all four wheels', state.wheelsDown === 4, JSON.stringify(state.compression))
  check('car spawns undamaged', state.damage === 0)
  check('suspension holds the car up evenly', Math.max(...state.wheelLoads) / Math.min(...state.wheelLoads) < 1.3)
  await page.screenshot({ path: `${SHOTS}/01-spawn.png` })
}

console.log('\ndriving')
{
  await page.keyboard.down('KeyW')
  const moving = await waitForState(page, (s) => s.speedKmh > 20)
  check('throttle accelerates the car', moving.speedKmh > 20, `${moving.speedKmh} km/h`)

  await page.keyboard.down('KeyA')
  const turning = await waitForState(
    page,
    (s) => Math.max(...s.wheelLoads) > Math.min(...s.wheelLoads) * 2,
    { timeout: 12_000 },
  )
  const loads = turning.wheelLoads
  check(
    'cornering transfers weight to the outside wheels',
    Math.max(...loads) > Math.min(...loads) * 2,
    JSON.stringify(loads),
  )
  await page.keyboard.up('KeyA')

  await page.keyboard.down('Space')
  await settle(page, 1500)
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
  await page.screenshot({ path: `${SHOTS}/02-driving.png` })
}

console.log('\nstraight-line stability')
{
  // A raycast car has no self-centring of its own. Before the steering assist
  // existed, an untouched car at full throttle left a 200 m straight by 13 m and
  // ended up 37° off its heading; the muscle car spun outright. This is the
  // regression guard for that.
  await page.evaluate(() => {
    const e = window.__CRASHOUT__
    e.vehicle.repair()
    // Southern highway, heading +x: the longest straight in the world.
    e.vehicle.teleport({ x: -120, y: 1.4, z: -600 }, Math.PI / 2)
  })
  await settle(page, 1200)
  await page.evaluate(() => window.__CRASHOUT__.clearLastCrash())

  const startSim = (await probe(page)).simTime
  await page.keyboard.down('KeyW')
  let peakYawRate = 0
  let sim = startSim
  let state = null
  while (sim - startSim < 7) {
    state = await page.evaluate(() => {
      const e = window.__CRASHOUT__
      const q = e.vehicle.rotation
      return {
        sim: e.probe().simTime,
        crashed: e.probe().lastCrash !== null,
        z: e.vehicle.position.z,
        yawRate: Math.abs(e.vehicle.body.angvel().y),
        heading:
          (Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) * 180) / Math.PI,
      }
    })
    sim = state.sim
    if (state.crashed) break
    peakYawRate = Math.max(peakYawRate, state.yawRate)
    await page.waitForTimeout(150)
  }
  await page.keyboard.up('KeyW')

  check('the car does not spin under throttle', peakYawRate < 0.2, `peak ${peakYawRate.toFixed(3)} rad/s`)
  check(
    'it holds its heading with no steering input',
    Math.abs(state.heading - 90) < 12,
    `${(state.heading - 90).toFixed(1)}° off`,
  )
  check('it stays on the road', Math.abs(state.z + 600) < 15, `${(state.z + 600).toFixed(1)} m across`)
}

console.log('\ncrash physics')
{
  // A 120 km/h head-on into a downtown tower.
  await page.evaluate(() => {
    const e = window.__CRASHOUT__
    e.clearLastCrash()
    e.vehicle.repair()
    e.vehicle.teleport({ x: 44, y: 1.2, z: 6 }, 0)
    e.vehicle.body.setLinvel({ x: 0, y: 0, z: 33 }, true)
  })
  const wall = await waitForState(page, (s) => s.lastCrash !== null)
  check('a full-speed impact registers', wall.lastCrash !== null)
  check('it registers as maximum severity', wall.lastCrash?.severity > 0.9, JSON.stringify(wall.lastCrash))
  check('the front panel takes the hit', wall.lastCrash?.region === 'front', wall.lastCrash?.region)
  check('the car is visibly wrecked', wall.damage > 0.4, `${wall.damage}`)
  check('debris is thrown', wall.particles > 0, `${wall.particles}`)
  await page.screenshot({ path: `${SHOTS}/03-crash.png` })

  // A gentle nudge into the same wall must not count as a crash.
  await page.evaluate(() => {
    const e = window.__CRASHOUT__
    e.clearLastCrash()
    e.vehicle.repair()
    e.vehicle.teleport({ x: 44, y: 1.2, z: 12 }, 0)
    e.vehicle.body.setLinvel({ x: 0, y: 0, z: 3 }, true)
  })
  // Give it long enough to reach the wall, then assert nothing happened.
  await waitForState(page, (s) => s.lastCrash !== null, { timeout: 12_000 })
  const nudge = await probe(page)
  check('a gentle bump does not damage the car', nudge.damage === 0, `${nudge.damage}`)
}

console.log('\nrecovery')
{
  await page.evaluate(() => {
    const e = window.__CRASHOUT__
    e.vehicle.teleport({ x: 10, y: 3, z: 120 }, 0)
    e.vehicle.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true)
  })
  const upsideDown = await waitForState(page, (s) => s.wheelsDown === 0, { timeout: 10_000 })
  check('an inverted car has no wheels down', upsideDown.wheelsDown === 0)

  await page.keyboard.press('KeyR')
  const recovered = await waitForState(page, (s) => s.wheelsDown === 4 && s.speedKmh < 5)
  check('recover puts the car back on its wheels', recovered.wheelsDown === 4)
  check('recover does not launch the car', recovered.speedKmh < 5, `${recovered.speedKmh} km/h`)
  check(
    'recover lands at ride height, not bottomed out',
    Math.max(...recovered.compression) < 0.95,
    JSON.stringify(recovered.compression),
  )
}

console.log('\nramps')
{
  await page.evaluate(() => {
    const e = window.__CRASHOUT__
    e.vehicle.repair()
    e.vehicle.teleport({ x: -420, y: 1.2, z: -430 }, 0)
    e.vehicle.body.setLinvel({ x: 0, y: 0, z: 34 }, true)
  })
  let peak = 0
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && peak <= 3) {
    await page.waitForTimeout(200)
    peak = Math.max(peak, await page.evaluate(() => window.__CRASHOUT__.vehicle.position.y))
  }
  check('an arena ramp launches the car', peak > 3, `peak y ${peak.toFixed(2)}`)
  await page.screenshot({ path: `${SHOTS}/04-airborne.png` })
}

console.log('\ngadgets')
{
  const result = await page.evaluate(() => {
    const e = window.__CRASHOUT__
    e.vehicle.teleport({ x: 10, y: 1.2, z: 120 }, 0)
    const before = e.gadgets.object.children.length
    const first = e.gadgets.deploy('oil_slick', e.vehicle)
    const second = e.gadgets.deploy('oil_slick', e.vehicle)
    return { before, after: e.gadgets.object.children.length, first, second }
  })
  check('deploying a gadget spawns a hazard', result.after === result.before + 1)
  check('the gadget goes on cooldown', result.first === true && result.second === false)
}

console.log('\nactivities')
{
  const started = await page.evaluate(() => {
    const e = window.__CRASHOUT__
    e.vehicle.teleport({ x: 10, y: 1.2, z: 120 }, 0)
    return e.startActivity('delivery_docks')
  })
  check('an activity starts', started === true)
  await settle(page, 1200)
  const running = await page.evaluate(() => {
    const a = window.__CRASHOUT__.activities.current
    return a && { id: a.activityId, remaining: a.timeRemaining, distance: a.distance }
  })
  check('the timer counts down', running && running.remaining < 95, JSON.stringify(running))
  check('the objective is a real distance away', running && running.distance > 100)

  // Finish it by driving to the drop-off.
  await page.evaluate(() => {
    const e = window.__CRASHOUT__
    const target = e.activities.current.target
    e.vehicle.teleport({ x: target.x, y: 1.4, z: target.z - 6 }, 0)
    e.vehicle.body.setLinvel({ x: 0, y: 0, z: 6 }, true)
  })
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => window.__CRASHOUT__.activities.current === null)
    if (done) break
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(800)
  const finished = await page.evaluate(() => ({
    running: window.__CRASHOUT__.activities.current !== null,
    credits: document.querySelector('.hud__wallet-credits')?.textContent ?? null,
    overlay: document.querySelector('.overlay__title')?.textContent ?? null,
  }))
  check('reaching the drop-off ends the run', finished.running === false)
  check('the results screen appears', finished.overlay !== null, `${finished.overlay}`)
  await page.screenshot({ path: `${SHOTS}/05-results.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}

console.log('\ngarage')
{
  await page.evaluate(() => document.querySelector('.overlay') && window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })))
  await page.waitForTimeout(400)
  await page.keyboard.press('KeyG')
  await page.waitForTimeout(700)
  const open = await page.locator('.overlay__title').textContent()
  check('the garage opens', open === 'Garage', `${open}`)

  await page.getByRole('button', { name: 'Showroom' }).click()
  await page.waitForTimeout(300)
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('crashout.save.v1')).profile.credits,
  )
  await page.getByRole('button', { name: '6,500 ¢' }).click()
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('crashout.save.v1')))
  check('buying a car charges the catalogue price', before - after.profile.credits === 6500)
  check('the car lands in the garage', after.vehicles.some((v) => v.specId === 'rustbucket'))
  check('the purchase persists to storage', after.vehicles.length === 2)
  await page.screenshot({ path: `${SHOTS}/06-garage.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}

console.log('\nmultiplayer')
{
  const host = page
  const guest = await context.newPage()
  // The two tabs share a save (and therefore a garage), which is intended.
  // Network identity is per-tab, so they still see each other as two drivers.
  guest.on('pageerror', (e) => pageErrors.push(`[guest] ${e.message}`))
  await guest.goto(BASE_URL, { waitUntil: 'networkidle' })
  await guest.getByRole('button', { name: 'Play as guest' }).click()
  await guest.waitForFunction(() => !document.querySelector('.loading'), { timeout: 120_000 })
  await guest.waitForTimeout(2000)

  await host.keyboard.press('Escape')
  await host.waitForTimeout(400)
  await host.getByRole('button', { name: 'Friends & sessions' }).click()
  await host.waitForTimeout(400)
  await host.getByRole('button', { name: 'Create world' }).click()
  await host.waitForTimeout(2000)
  const code = (await host.locator('.code-display').textContent()).trim()
  check('hosting produces a six-character code', /^[A-Z0-9]{6}$/.test(code), code)

  await guest.keyboard.press('Escape')
  await guest.waitForTimeout(400)
  await guest.getByRole('button', { name: 'Friends & sessions' }).click()
  await guest.waitForTimeout(400)
  await guest.locator('input[placeholder="X7K2QP"]').fill(code)
  await guest.getByRole('button', { name: 'Join', exact: true }).click()
  await guest.waitForTimeout(3000)

  await host.keyboard.press('Escape')
  await guest.keyboard.press('Escape')
  await host.waitForTimeout(2500)

  const roster = (p) =>
    p.evaluate(() =>
      window.__CRASHOUT__.network.remoteVehicles.map((r) => ({
        name: r.username,
        hasData: r.hasData,
        z: r.position.z,
      })),
    )
  const hostSees = await roster(host)
  const guestSees = await roster(guest)
  check('the host sees the guest', hostSees.length === 1 && hostSees[0].hasData, JSON.stringify(hostSees))
  check('the guest sees the host', guestSees.length === 1 && guestSees[0].hasData, JSON.stringify(guestSees))
  check('players spawn apart, not on top of each other', Math.abs(hostSees[0].z - guestSees[0].z) > 1)
  await host.screenshot({ path: `${SHOTS}/07-multiplayer.png` })

  // Line them up and ram.
  await host.evaluate(() => {
    const e = window.__CRASHOUT__
    e.clearLastCrash()
    e.vehicle.repair()
    e.vehicle.teleport({ x: 0, y: 1.2, z: 60 }, 0)
  })
  await guest.evaluate(() => {
    const e = window.__CRASHOUT__
    e.clearLastCrash()
    e.vehicle.repair()
    e.vehicle.teleport({ x: 0, y: 1.2, z: 78 }, Math.PI)
  })
  await host.waitForTimeout(1600)
  await guest.evaluate(() => window.__CRASHOUT__.vehicle.body.setLinvel({ x: 0, y: 0, z: -28 }, true))
  const guestState = await waitForState(guest, (s) => s.lastCrash !== null)
  const hostState = await waitForState(host, (s) => s.lastCrash !== null, { timeout: 12_000 })
  check('the rammer registers the hit', guestState.lastCrash !== null, JSON.stringify(guestState.lastCrash))
  check('the victim registers the hit', hostState.lastCrash !== null, JSON.stringify(hostState.lastCrash))
  check('the victim takes damage', hostState.damage > 0.05, `${hostState.damage}`)
  await host.screenshot({ path: `${SHOTS}/08-rammed.png` })

  // Gadgets replicate.
  const hazards = await guest.evaluate(() => {
    const e = window.__CRASHOUT__
    e.gadgets.deploy('oil_slick', e.vehicle)
    return e.gadgets.object.children.length
  })
  await host.waitForTimeout(1500)
  const hostHazards = await host.evaluate(() => window.__CRASHOUT__.gadgets.object.children.length)
  check('a gadget dropped by one player appears for the other', hostHazards >= hazards)
}

console.log('\nconsole')
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '))

await browser.close()
console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`} — screenshots in ${SHOTS}\n`)
process.exit(failures === 0 ? 0 : 1)
