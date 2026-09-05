// Pinch-zoom on the plan, with real touch events.
//
// This exists because of a crash reported from site: the plan is one
// CSS-transformed <img>, so the browser composites it as a single layer, and an
// unbounded zoom ceiling turned a 2600 px plan into a 31200 px layer — roughly
// 690 megapixels. Desktop tiles its way through that; a phone GPU cannot, and
// the tab dies. Playwright's mouse never reproduced it because a pinch needs two
// pointers, so this drives CDP touch events directly.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/tmp/itp-shots-pinch'
fs.mkdirSync(OUT, { recursive: true })

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
// Deliberately a large plan: the bug only bites once the source image is big.
const PLAN = process.env.ITP_BIG_PLAN_FIXTURE ?? process.env.ITP_PLAN_FIXTURE ?? '/tmp/itp-fixtures/plan.png'

/** Mobile GPUs commonly cap textures at 4096-8192 px per side. */
const SAFE_LAYER_EDGE = 8192
const SAFE_LAYER_PIXELS = 48e6

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'New job' }).click()
await page.getByPlaceholder('e.g. Minus 1 — Adelaide').fill('Pinch Job')
await page.getByRole('button', { name: 'Create job' }).click()
await page.waitForTimeout(700)
await page.getByRole('link', { name: 'Plans' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Add drawing' }).click()
await page.getByPlaceholder('e.g. HC-001').fill('HC-001')
await page.locator('input[type=file]').setInputFiles(PLAN)
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Save drawing' }).click()
await page.waitForTimeout(700)
await page.getByRole('link', { name: 'ITPs' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /ITP register/ }).click()
await page.getByPlaceholder(/Search the 42/).fill('Inground Sanitary')
await page.waitForTimeout(300)
await page.locator('.listitem').first().click()
await page.waitForTimeout(400)
await page.getByPlaceholder(/North East Corner/).fill('Grid 1-5')
await page.locator('label:has-text("HC-001") input[type=checkbox]').check()
await page.getByRole('button', { name: 'Raise ITP' }).click()
await page.waitForTimeout(900)
await page.getByRole('button', { name: /^Plans \(/ }).click()
await page.waitForTimeout(900)

const plan = page.locator('.planview')
await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(400)
const box = await plan.boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2

const cdp = await ctx.newCDPSession(page)
const touch = (type, points) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ ...p, id: i + 1 })) })

/**
 * Size of the surface the browser actually composites for the plan, and the
 * current zoom. With the canvas viewer this must stay at one viewport however
 * far in the user zooms — that is the whole point of the change.
 */
const layer = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('.planview__canvas')
    if (!canvas) return null
    const scale = window.__planScale ?? 1
    return { w: canvas.width, h: canvas.height, scale }
  })

/** A cheap fingerprint of the painted plan, to tell whether panning moved it. */
const transform = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('.planview__canvas')
    if (!canvas) return 'none'
    return canvas.toDataURL('image/jpeg', 0.4).slice(-160)
  })

function check(label, l) {
  if (!l) {
    errors.push(`${label}: the plan disappeared`)
    return
  }
  const edge = Math.max(l.w, l.h)
  const mpx = (l.w * l.h) / 1e6
  console.log(`${label}: scale ${l.scale.toFixed(2)}, layer ${Math.round(l.w)}x${Math.round(l.h)} (${mpx.toFixed(0)} Mpx)`)
  if (edge > SAFE_LAYER_EDGE) errors.push(`${label}: layer edge ${Math.round(edge)}px exceeds the ${SAFE_LAYER_EDGE}px texture limit`)
  if (l.w * l.h > SAFE_LAYER_PIXELS) errors.push(`${label}: layer ${mpx.toFixed(0)} Mpx exceeds the budget`)
  if (!Number.isFinite(l.scale) || l.scale <= 0) errors.push(`${label}: scale is ${l.scale}`)
}

check('fitted        ', await layer())

// --- An ordinary pinch out.
await touch('touchStart', [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }])
for (let i = 1; i <= 6; i++) {
  await touch('touchMove', [{ x: cx - 40 - i * 12, y: cy }, { x: cx + 40 + i * 12, y: cy }])
  await page.waitForTimeout(25)
}
await touch('touchEnd', [])
await page.waitForTimeout(400)
check('after pinch   ', await layer())

// --- Two fingers landing on the same spot. The pinch baseline was zero here,
//     so the first move divided by zero and slammed the plan to maximum zoom.
const beforeZero = await layer()
await touch('touchStart', [{ x: cx, y: cy }, { x: cx, y: cy }])
await touch('touchMove', [{ x: cx - 3, y: cy }, { x: cx + 3, y: cy }])
await page.waitForTimeout(60)
const afterTinyMove = await layer()
if (afterTinyMove.scale > beforeZero.scale * 3) {
  errors.push(
    `a zero-separation touch jumped the zoom from ${beforeZero.scale.toFixed(2)} to ${afterTinyMove.scale.toFixed(2)}`,
  )
}
for (let i = 1; i <= 6; i++) {
  await touch('touchMove', [{ x: cx - i * 15, y: cy }, { x: cx + i * 15, y: cy }])
  await page.waitForTimeout(25)
}
await touch('touchEnd', [])
await page.waitForTimeout(400)
check('after zero-sep', await layer())

// --- Lift one finger mid-pinch: the remaining finger must still pan.
await touch('touchStart', [{ x: cx - 60, y: cy }, { x: cx + 60, y: cy }])
await touch('touchMove', [{ x: cx - 70, y: cy }, { x: cx + 70, y: cy }])
await page.waitForTimeout(50)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: cx + 70, y: cy, id: 2 }] })
await page.waitForTimeout(50)
const beforePan = await transform()
for (let i = 1; i <= 5; i++) {
  await touch('touchMove', [{ x: cx - 70 + i * 14, y: cy + i * 10 }])
  await page.waitForTimeout(25)
}
await touch('touchEnd', [])
await page.waitForTimeout(400)
const afterPan = await transform()
console.log('pan after lifting a finger:', beforePan === afterPan ? 'DEAD' : 'works')
if (beforePan === afterPan) errors.push('The plan stopped panning after one finger was lifted mid-pinch')

// --- Hammer it, the way someone does when the plan will not sit still.
for (let round = 0; round < 6; round++) {
  await touch('touchStart', [{ x: cx - 20, y: cy }, { x: cx + 20, y: cy }])
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [{ x: cx - 20 - i * 20, y: cy - i * 4 }, { x: cx + 20 + i * 20, y: cy + i * 4 }])
  }
  await touch('touchEnd', [])
  await page.waitForTimeout(80)
}
await page.waitForTimeout(500)
check('after hammer  ', await layer())

// --- Still usable afterwards.
await page.screenshot({ path: path.join(OUT, '01-after-pinching.png') })
await page.getByRole('button', { name: 'Fit to view' }).click()
await page.waitForTimeout(500)
check('after fit     ', await layer())

const stillThere = await page.locator('.planview').count()
if (stillThere !== 1) errors.push('The plan viewer did not survive the pinch sequence')
const errorScreen = await page.getByText('Something went wrong').count()
if (errorScreen > 0) errors.push('The error boundary caught a crash during pinching')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Pinch zoom check passed.')
process.exit(errors.length ? 1 : 0)
