// Reviewdoc: a plan pulled in from inside the defect, the defect pinned on
// it and moved, the device's position recorded, all defects shown on the
// plan, and the QA report carrying the coordinates.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { createProject, onboard, tab } from './helpers.mjs'

const OUT = '/tmp/itp-shots-reviewdoc'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const PLAN_PDF = process.env.ITP_PLAN_PDF ?? '/tmp/itp-fixtures/plan.pdf'
const PHOTO = process.env.ITP_PHOTO_FIXTURE ?? '/tmp/itp-fixtures/photo.jpg'

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
// A phone standing at Liverpool Hospital.
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  geolocation: { latitude: -33.9245, longitude: 150.9245, accuracy: 6 },
  permissions: ['geolocation'],
})
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await onboard(page)
await createProject(page, { name: 'Liverpool Hospital', client: 'Lendlease' })
await tab(page, 'Reviewdoc').click()
await page.waitForTimeout(500)

// --- Raise: import the plan from inside the sheet.
await page.getByRole('button', { name: 'Raise' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Import plan' }).click()
await page.locator('.sheet input[type=file]').setInputFiles(PLAN_PDF)
await page.getByRole('button', { name: 'Use this plan' }).waitFor({ timeout: 30000 })
const sheets = await page.locator('.sheet button:has(img)').count()
console.log('sheets offered from the PDF:', sheets)
await page.getByRole('button', { name: 'Use this plan' }).click()
await page.waitForTimeout(900)
await shot('01-plan-imported')

const plan = page.locator('.sheet .planview')
await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(300)
const box = await plan.boundingBox()
await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5)
await page.waitForTimeout(400)
const pinned = await page.locator('.sheet .pin').count()
console.log('pin dropped on the imported plan:', pinned)
if (pinned !== 1) errors.push('Tapping the plan did not drop the defect pin')

await page.getByText(/^GPS -33\.9245/).waitFor({ timeout: 15000 }).catch(() => errors.push('Device location was not captured on raise'))
await page.getByPlaceholder(/High top installed/).fill('Fire Rating: High top installed incorrectly.')
await page.getByPlaceholder('500').fill('500')
await shot('02-raise')
await page.getByRole('button', { name: 'Raise defect' }).click()
await page.waitForTimeout(800)

// --- Detail: the defect carries plan, pin and coordinates; the pin can move.
const detail = page.locator('.sheet').last()
if (!(await detail.getByText(/GPS -33\.924500, 150\.924500/).count())) errors.push('Coordinates not shown on the defect')
if (!(await detail.locator('.pin').count())) errors.push('Defect pin not shown on its plan')
await detail.getByRole('button', { name: 'Move pin' }).click()
const dbox = await detail.locator('.planview').boundingBox()
await page.mouse.click(dbox.x + dbox.width * 0.7, dbox.y + dbox.height * 0.3)
await page.waitForTimeout(500)
const moved = await page.evaluate(async () => {
  const req = indexedDB.open('hydraulic-itp')
  const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
  const rows = await new Promise((res) => { const r = db.transaction('defects').objectStore('defects').getAll(); r.onsuccess = () => res(r.result) })
  return rows[0] ? { x: rows[0].x, y: rows[0].y, lat: rows[0].lat, drawing: Boolean(rows[0].drawingId) } : null
})
console.log('stored defect:', JSON.stringify(moved))
if (!moved || moved.x < 0.6) errors.push(`Moving the pin did not store the new position (${JSON.stringify(moved)})`)
if (!moved?.drawing) errors.push('Defect is not linked to the imported drawing')
await page.getByRole('button', { name: 'Add from gallery' }).last().click().catch(() => undefined)
await shot('03-detail')
await detail.locator('.sheet__head .iconbtn').click()
await page.waitForTimeout(400)

// --- Plan view lists every pinned defect on the sheet.
await page.getByRole('button', { name: 'Plan', exact: true }).click()
await page.waitForTimeout(700)
const onPlan = await page.locator('.planview .pin').count()
console.log('defects on the plan view:', onPlan)
if (onPlan !== 1) errors.push('Plan view did not show the defect pin')
await shot('04-plan-view')

// --- The QA report carries the coordinates.
const dl = page.waitForEvent('download', { timeout: 40000 })
await page.getByRole('button', { name: 'QA report' }).click()
const download = await dl
const pdfPath = path.join(OUT, 'qa-report.pdf')
await download.saveAs(pdfPath)
const size = fs.statSync(pdfPath).size
console.log('QA report bytes:', size)
if (size < 15000) errors.push('QA report PDF is too small to carry a mini map')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Reviewdoc check passed.')
process.exit(errors.length ? 1 : 0)
