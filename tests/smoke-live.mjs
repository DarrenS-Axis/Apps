// Everyone sees the same data. The organisation config (axis-config.json,
// here pointing at the mock Graph server) ships with the app, so devices that
// have never been set up connect by themselves: a change on one phone reaches
// the others within seconds without anyone pressing Sync, a link opened on a
// brand-new device lands on the record after the welcome, the flow URL is
// set once for everyone, a device that has not said its state pulls nothing
// state-owned, another state sees none of it, and without the test token the
// app asks people to sign in before it opens.
import { chromium } from 'playwright'
import { startMockGraph } from './mock-graph.mjs'
import { onboard } from './helpers.mjs'

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const GRAPH_PORT = 4181
const errors = []
const check = (ok, message) => {
  if (!ok) errors.push(message)
}
const mock = await startMockGraph(GRAPH_PORT)
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const graphState = async () => (await fetch(`http://127.0.0.1:${GRAPH_PORT}/__state`)).json()

const CONFIG = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  clientId: '00000000-0000-0000-0000-000000000002',
  siteUrl: 'https://axisplumbing.sharepoint.com/sites/QA',
  graphBaseUrl: `http://127.0.0.1:${GRAPH_PORT}/v1.0`,
  devToken: 'test-token',
  pollSeconds: 3,
}

async function device(name, config = CONFIG) {
  // The service worker is kept out so the routed config is what the page sees.
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, serviceWorkers: 'block' })
  await ctx.route('**/axis-config.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) }))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`)
  })
  const db = (store) =>
    page.evaluate(
      (s) =>
        new Promise((res) => {
          const r = indexedDB.open('hydraulic-itp')
          r.onsuccess = () => {
            const q = r.result.transaction(s).objectStore(s).getAll()
            q.onsuccess = () => res(q.result)
          }
        }),
      store,
    )
  return { ctx, page, db }
}

/** Waits for a condition that another device's change should bring about, without pressing anything. */
async function arrives(label, fn, seconds = 20) {
  const t0 = Date.now()
  while (Date.now() - t0 < seconds * 1000) {
    if (await fn().catch(() => false)) {
      console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      return true
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  errors.push(`${label}: did not arrive within ${seconds} s`)
  return false
}

// ---- Device A: a site phone that has never been set up.
const a = await device('A')
await a.page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await a.page.waitForTimeout(800)
await onboard(a.page, { name: 'Murtaza Bahloli', state: 'NSW' })
await a.page.getByRole('link', { name: 'Settings', exact: true }).click()
await a.page.getByText('Connected for the whole organisation').waitFor({ timeout: 10000 })
check((await a.page.getByPlaceholder('00000000-0000-…').count()) === 0, 'A managed device still shows the tenant / client fields')
// The flow URL, set once for everyone.
await a.page.locator('label:has(span:text("Power Automate flow URL")) input').fill('https://prod-00.australiaeast.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=shared')
await a.page.getByRole('link', { name: 'Projects', exact: true }).click()
await a.page.waitForTimeout(400)
await a.page.getByRole('button', { name: 'New project' }).first().click()
await a.page.getByPlaceholder('e.g. Liverpool Hospital').fill('Liverpool Hospital')
await a.page.getByRole('button', { name: 'Create project' }).click()
await a.page.waitForTimeout(800)
await a.page.locator('.tabbar').getByRole('link', { name: 'Firedoc' }).click()
await a.page.getByRole('button', { name: 'Add' }).click()
await a.page.getByPlaceholder('F0001').fill('F0001')
await a.page.getByRole('button', { name: 'Add' }).last().click()
await a.page.waitForTimeout(400)
await a.page.locator('.sheet__head .iconbtn').last().click()
await a.page.goto(`${BASE}/#/plant`)
await a.page.getByRole('button', { name: 'Add item' }).click()
await a.page.getByPlaceholder('e.g. Hammer Drill').fill('Hammer Drill')
await a.page.getByRole('button', { name: 'Add to register' }).click()
await a.page.waitForTimeout(400)
await a.page.locator('.sheet__head .iconbtn').last().click()

// Nobody pressed Sync: the changes go up by themselves, lists made on the way.
const listCount = (g, name) => g.items.filter((i) => i.listId === g.lists.find((l) => l.displayName === name)?.id).length
await arrives('A → SharePoint', async () => {
  const g = await graphState()
  return listCount(g, 'QA Projects') === 1 && listCount(g, 'QA Penetrations') === 1 && listCount(g, 'QA Plant') === 1 && listCount(g, 'QA Settings') === 1
})
const g = await graphState()
const settingsItem = g.items.find((i) => i.listId === g.lists.find((l) => l.displayName === 'QA Settings')?.id)
check(/sig=shared/.test(settingsItem?.fields.Payload ?? ''), 'The flow URL did not go to SharePoint as an organisation setting')
const project = (await a.db('projects'))[0]
const pen = (await a.db('penetrations'))[0]

// ---- Device C: a brand-new phone opens a link from an email. Before it says
// which state it is in, it holds nothing state-owned.
const c = await device('C')
await c.page.goto(`${BASE}/#/project/${project.id}/firedoc?open=${pen.id}`, { waitUntil: 'networkidle' })
await c.page.getByPlaceholder('e.g. Murtaza Bahloli').waitFor()
await c.page.waitForTimeout(3000)
check((await c.db('projects')).length === 0 && (await c.db('penetrations')).length === 0, 'A device with no state yet pulled state-owned records')
check((await c.db('org'))[0]?.powerAutomateUrl?.includes('sig=shared'), 'The organisation settings did not reach a new device')
await onboard(c.page, { name: 'Ben Kennedy', state: 'NSW' })
await c.page.getByRole('heading', { name: 'Penetration F0001' }).waitFor({ timeout: 20000 })
console.log('C: email link opened Penetration F0001 after the welcome')
await c.page.locator('.sheet__head .iconbtn').last().click()
// A QR label scanned with the phone's own camera.
await c.page.goto(`${BASE}/#/plant/tag/NSW-0001`)
await c.page.getByRole('heading', { name: 'NSW-0001 · Hammer Drill' }).waitFor({ timeout: 20000 })
await c.page.locator('.sheet__head .iconbtn').last().click()

// ---- Device B: another NSW phone, set up normally, just watching.
const b = await device('B')
await b.page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await onboard(b.page, { name: 'Sam Ortiz', state: 'NSW' })
await arrives('B sees the project', async () => (await b.page.locator('.listitem', { hasText: 'Liverpool Hospital' }).count()) === 1)

// A change on C reaches A and B with nobody pressing anything.
await c.page.goto(`${BASE}/#/project/${project.id}/firedoc?open=${pen.id}`)
await c.page.getByRole('heading', { name: 'Penetration F0001' }).waitFor()
await c.page.locator('.sheet label:has(span:text("Level")) input').fill('L07')
await c.page.waitForTimeout(300)
await c.page.locator('.sheet__foot').getByRole('button', { name: 'Save' }).click()
await arrives('C → A (level L07)', async () => (await a.db('penetrations'))[0]?.level === 'L07')
await b.page.goto(`${BASE}/#/project/${project.id}/firedoc`)
await arrives('C → B (list shows L07)', async () => (await b.page.locator('.listitem', { hasText: 'L07' }).count()) === 1)

// ---- Device Q: Queensland sees none of NSW's records.
const q = await device('Q')
await q.page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await onboard(q.page, { name: 'Quinn Ortiz', state: 'QLD' })
await q.page.waitForTimeout(5000)
check((await q.db('projects')).length === 0 && (await q.db('plant')).length === 0, 'A QLD device received NSW records')
check((await q.db('org'))[0]?.powerAutomateUrl?.includes('sig=shared'), 'The organisation settings did not reach QLD')

// ---- Device S: the real thing, without the test token — sign in first.
const { devToken: _t, graphBaseUrl: _g, ...real } = CONFIG
const s = await device('S', real)
await s.page.goto(`${BASE}/#/project/${project.id}/firedoc`, { waitUntil: 'networkidle' })
await s.page.getByRole('heading', { name: 'Sign in to Axis QA' }).waitFor({ timeout: 10000 })
check(await s.page.getByRole('button', { name: 'Sign in with Microsoft' }).isVisible(), 'No sign-in button')
check((await s.page.locator('.tabbar').count()) === 0, 'The app opened past the sign-in screen')
await s.page.screenshot({ path: '/tmp/itp-shots-qa/live-sign-in.png' })

await browser.close()
mock.close()
// MSAL is never reached in this suite; anything else in the console is a fault.
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Live shared data check passed.')
process.exit(errors.length ? 1 : 0)
