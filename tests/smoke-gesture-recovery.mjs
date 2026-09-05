// Dragging after a pinch.
//
// Reported from site: the plan dragged fine until it was pinched, and never
// again afterwards. Pinching spreads the fingers well beyond a 420 px-tall
// plan, so a finger is routinely released *outside* it. While pointer tracking
// lived on the element, that release was never heard: the pointer stayed in the
// tracked map for good, the next one-finger drag counted as two pointers, was
// taken for a pinch, and did nothing.
//
// Every gesture here therefore ends outside the viewer on purpose.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/tmp/itp-shots-gesture-recovery'
fs.mkdirSync(OUT, { recursive: true })

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const PLAN = process.env.ITP_PLAN_FIXTURE ?? '/tmp/itp-fixtures/plan.png'

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'New job' }).click()
await page.getByPlaceholder('e.g. Minus 1 — Adelaide').fill('Gesture Job')
await page.getByRole('button', { name: 'Create job' }).click()
await page.waitForTimeout(700)
await page.getByRole('link', { name: 'Plans' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Add drawing' }).click()
await page.getByPlaceholder('e.g. HC-001').fill('HC-001')
await page.locator('input[type=file]').setInputFiles(PLAN)
await page.waitForTimeout(1400)
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
const touch = (type, pts) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ ...p, id: i + 1 })) })

const view = () => page.evaluate(() => ({ scale: window.__planScale ?? 0, x: window.__planX ?? 0, y: window.__planY ?? 0 }))

async function drag(dx, dy) {
  const before = await view()
  await touch('touchStart', [{ x: cx, y: cy }])
  for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: cx + (dx * i) / 10, y: cy + (dy * i) / 10 }])
  await touch('touchEnd', [])
  await page.waitForTimeout(250)
  const after = await view()
  return Math.hypot(after.x - before.x, after.y - before.y)
}

// --- Dragging before any pinch. This always worked.
const first = await drag(70, 50)
console.log('drag before pinch moved:', first.toFixed(0), 'px')
if (first < 20) errors.push(`Dragging did not pan the plan before pinching (${first.toFixed(0)} px)`)

// --- A pinch whose fingers END OUTSIDE the plan, which is what happens on a
//     phone: spreading two fingers takes them past a 420 px-tall viewer.
const beforeZoom = await view()
await touch('touchStart', [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }])
for (let i = 1; i <= 8; i++) {
  await touch('touchMove', [{ x: cx - 30 - i * 26, y: cy - i * 26 }, { x: cx + 30 + i * 26, y: cy + i * 26 }])
}
// Release both fingers well clear of the viewer.
await touch('touchEnd', [])
await page.waitForTimeout(300)
const afterZoom = await view()
console.log('pinch zoomed:', beforeZoom.scale.toFixed(2), '->', afterZoom.scale.toFixed(2))
if (afterZoom.scale <= beforeZoom.scale * 1.2) {
  errors.push(`Pinching did not zoom (${beforeZoom.scale.toFixed(2)} -> ${afterZoom.scale.toFixed(2)})`)
}

// --- The regression: dragging again after that pinch.
const second = await drag(-70, -50)
console.log('drag after pinch moved:', second.toFixed(0), 'px')
if (second < 20) {
  errors.push(`Dragging stopped working after a pinch (${second.toFixed(0)} px) — stale pointers`)
}

// --- Repeat the cycle; one recovery is not enough if state leaks each time.
for (let round = 0; round < 3; round++) {
  await touch('touchStart', [{ x: cx - 20, y: cy }, { x: cx + 20, y: cy }])
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [{ x: cx - 20 - i * 30, y: cy - i * 30 }, { x: cx + 20 + i * 30, y: cy + i * 30 }])
  }
  await touch('touchEnd', [])
  await page.waitForTimeout(200)
  const moved = await drag(60, 40)
  console.log(`drag after pinch cycle ${round + 1} moved:`, moved.toFixed(0), 'px')
  if (moved < 20) errors.push(`Dragging died on pinch cycle ${round + 1} (${moved.toFixed(0)} px)`)
}

// --- A finger lifted while the other stays down, released off the viewer.
await touch('touchStart', [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }])
await touch('touchMove', [{ x: cx - 60, y: cy }, { x: cx + 60, y: cy }])
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: cx + 60, y: cy, id: 2 }] })
await page.waitForTimeout(60)
await touch('touchEnd', [])
await page.waitForTimeout(300)
const afterMixed = await drag(50, 60)
console.log('drag after a staggered release moved:', afterMixed.toFixed(0), 'px')
if (afterMixed < 20) errors.push(`Dragging died after a staggered two-finger release (${afterMixed.toFixed(0)} px)`)

// --- Dragging a long way while zoomed in must not lose the plan. Panning was
//     unbounded, so a couple of firm drags at zoom pushed the drawing clean out
//     of the viewport and left a blank panel behind.
await page.getByRole('button', { name: 'Fit to view' }).click()
await page.waitForTimeout(300)
await touch('touchStart', [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }])
for (let i = 1; i <= 8; i++) {
  await touch('touchMove', [{ x: cx - 30 - i * 24, y: cy }, { x: cx + 30 + i * 24, y: cy }])
}
await touch('touchEnd', [])
await page.waitForTimeout(300)

for (let i = 0; i < 6; i++) await drag(300, 300)
const flung = await view()
const planPx = await page.evaluate(() => {
  const el = document.querySelector('.planview')
  return el ? { w: el.clientWidth, h: el.clientHeight } : null
})
console.log('after flinging:', `x ${flung.x.toFixed(0)} y ${flung.y.toFixed(0)} scale ${flung.scale.toFixed(2)}`)
if (flung.x > planPx.w || flung.y > planPx.h) {
  errors.push(`Dragging pushed the plan out of the viewport (x ${flung.x.toFixed(0)}, y ${flung.y.toFixed(0)})`)
}
const blank = await page.evaluate(() => {
  const canvas = document.querySelector('.planview__canvas')
  if (!canvas) return true
  const ctx = canvas.getContext('2d')
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let seen = null
  for (let i = 0; i < d.length; i += 4 * 997) {
    const key = `${d[i]},${d[i + 1]},${d[i + 2]}`
    if (seen === null) seen = key
    else if (seen !== key) return false
  }
  return true
})
console.log('plan still painted after flinging:', blank ? 'NO — blank canvas' : 'yes')
if (blank) errors.push('The plan panned entirely out of view and left a blank canvas')

// And it must still be draggable back afterwards.
const recovered = await drag(-120, -90)
console.log('drag back after flinging moved:', recovered.toFixed(0), 'px')
if (recovered < 20) errors.push(`Dragging died after being panned to the edge (${recovered.toFixed(0)} px)`)

await page.screenshot({ path: path.join(OUT, '01-final.png') })
await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Gesture recovery check passed.')
process.exit(errors.length ? 1 : 0)
