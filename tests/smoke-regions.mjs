// Highlighting the section of a drawing an ITP covers: trace a run, box an
// area, and prove both survive into the exported PDF.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/tmp/itp-shots-regions'
fs.mkdirSync(OUT, { recursive: true })

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const PLAN = process.env.ITP_PLAN_FIXTURE ?? '/tmp/itp-fixtures/plan.png'

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
const shot = async (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })

/**
 * Drags across the plan in the plan's own coordinate space.
 *
 * Centres the viewer first: page.mouse works in viewport coordinates, so a plan
 * sitting below the fold (or under the fixed tab bar) would receive nothing.
 */
async function dragOnPlan(points) {
  const plan = page.locator('.planview')
  await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  const box = await plan.boundingBox()
  const at = (p) => ({ x: box.x + box.width * p[0], y: box.y + box.height * p[1] })
  const first = at(points[0])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const p of points.slice(1)) {
    const q = at(p)
    await page.mouse.move(q.x, q.y, { steps: 12 })
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

await page.getByRole('button', { name: 'New job' }).click()
await page.getByPlaceholder('e.g. Minus 1 — Adelaide').fill('Region Job')
await page.getByRole('button', { name: 'Create job' }).click()
await page.waitForTimeout(700)

// A drawing to mark up.
await page.getByRole('link', { name: 'Plans' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Add drawing' }).click()
await page.getByPlaceholder('e.g. HC-001').fill('HC-001')
await page.locator('input[type=file]').setInputFiles(PLAN)
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Save drawing' }).click()
await page.waitForTimeout(700)

// Raise an ITP against it.
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
await shot('01-plans-tab')

// --- Highlight a run, as you would with a highlighter along the pipe.
await page.getByRole('button', { name: 'Highlight run' }).click()
await page.waitForTimeout(300)
await shot('02-highlight-mode')
await dragOnPlan([
  [0.25, 0.45],
  [0.4, 0.48],
  [0.55, 0.52],
  [0.7, 0.5],
])
await page.waitForTimeout(500)
await page.locator('textarea').fill('110 HDPE run, IO at grid 3 to boundary trap')
await shot('03-highlight-sheet')
await page.getByRole('button', { name: 'Save highlight' }).click()
await page.waitForTimeout(800)
await shot('04-run-highlighted')

// --- Box an area.
await page.getByRole('button', { name: 'Box area' }).click()
await page.waitForTimeout(300)
await dragOnPlan([
  [0.2, 0.62],
  [0.6, 0.8],
])
await page.waitForTimeout(500)
await page.locator('textarea').fill('Southern driveway, grid 10-12')
await page.getByRole('button', { name: 'Save highlight' }).click()
await page.waitForTimeout(800)
await shot('05-area-boxed')

// Regions are painted onto the canvas rather than being SVG nodes, so this
// samples the pixels: a highlighted plan must carry visibly coloured marks.
const painted = await page.evaluate(() => {
  const canvas = document.querySelector('.planview__canvas')
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let yellowish = 0
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    // The highlighter is yellow: strong red and green, markedly less blue.
    if (r > 180 && g > 150 && b < r - 60) yellowish++
  }
  return { yellowish, total: data.length / 4 }
})
console.log('highlighted pixels on the plan:', painted?.yellowish ?? 'canvas missing')
if (!painted) errors.push('The plan canvas was not found')
else if (painted.yellowish < 500) {
  errors.push(`Expected the highlights to be visible on the plan, found ${painted.yellowish} coloured pixels`)
}

const rows = await page.locator('table.data tbody tr').count()
console.log('rows in the extents table:', rows)
if (rows < 2) errors.push(`Expected 2 highlighted extents listed, got ${rows}`)

// Tapping a highlight must still select it, now that hit-testing is done
// against the painted path rather than an SVG node.
await page.getByRole('button', { name: 'Pan / zoom' }).click()
await page.waitForTimeout(300)
{
  const planEl = page.locator('.planview')
  await planEl.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  const b = await planEl.boundingBox()
  await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.71)
  await page.waitForTimeout(500)
  const selected = await page.locator('table.data tbody tr[style*="surface-2"]').count()
  console.log('region selected by tapping the plan:', selected > 0)
  if (selected === 0) errors.push('Tapping a highlighted area on the plan did not select it')
}

// Pan/zoom must not draw. Switching back to view mode and dragging should move
// the plan, not leave a stray mark.
await page.getByRole('button', { name: 'Pan / zoom' }).click()
await page.waitForTimeout(300)
await dragOnPlan([
  [0.5, 0.3],
  [0.6, 0.35],
])
await page.waitForTimeout(400)
const rowsAfterPan = await page.locator('table.data tbody tr').count()
console.log('rows after panning:', rowsAfterPan)
if (rowsAfterPan !== rows) errors.push('Panning in view mode created or removed a region')

// --- The markup has to reach the PDF, which is what the inspector sees.
const dl = page.waitForEvent('download', { timeout: 40000 })
await page.getByRole('button', { name: /Export PDF/ }).click()
const download = await dl
const pdfPath = path.join(OUT, 'export.pdf')
await download.saveAs(pdfPath)
const size = fs.statSync(pdfPath).size
console.log('pdf bytes:', size)
if (size < 20000) errors.push('Exported PDF is too small to contain a marked-up plan')

// --- Highlights must survive a reload, i.e. actually be persisted.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByRole('button', { name: /^Plans \(/ }).click()
await page.waitForTimeout(900)
const rowsAfterReload = await page.locator('table.data tbody tr').count()
console.log('rows after reload:', rowsAfterReload)
if (rowsAfterReload !== rows) {
  errors.push(`Highlights did not persist: ${rows} before reload, ${rowsAfterReload} after`)
}
await shot('06-after-reload')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Region highlighting check passed.')
process.exit(errors.length ? 1 : 0)
