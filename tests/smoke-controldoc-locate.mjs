// Controldoc plans and location: a project with no plans at all, the plan
// imported from inside the ITP, a pin dropped (and the device's position
// stamped on it and on the ITP), the pin moved, a second ITP located by
// signing its first step, and the coordinates carried into the PDF.
import { chromium } from 'playwright'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { createProject, onboard, tab } from './helpers.mjs'

const OUT = '/tmp/itp-shots-controldoc-locate'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const PLAN_PDF = process.env.ITP_PLAN_PDF ?? '/tmp/itp-fixtures/plan.pdf'

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
// Westmead Children's Hospital.
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  geolocation: { latitude: -33.8025, longitude: 150.9876, accuracy: 4 },
  permissions: ['geolocation'],
})
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })

const itps = () =>
  page.evaluate(async () => {
    const req = indexedDB.open('hydraulic-itp')
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    return new Promise((res) => {
      const r = db.transaction('itps').objectStore('itps').getAll()
      r.onsuccess = () => res(r.result.sort((a, b) => a.createdAt - b.createdAt))
    })
  })

async function raise(code, area) {
  await tab(page, 'Controldoc').click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /ITP register/ }).click()
  await page.getByPlaceholder(/Search the \d+/).fill(code)
  await page.waitForTimeout(300)
  await page.locator('.listitem').filter({ has: page.locator('.listitem__num', { hasText: new RegExp(`^${code}$`) }) }).click()
  await page.getByPlaceholder(/North East Corner/).fill(area)
  await page.getByRole('button', { name: 'Raise ITP' }).click()
  await page.waitForTimeout(900)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await onboard(page)
await createProject(page, { name: "Westmead Children's Hospital", client: 'John Holland' })

// --- ITP 1: no plans on the project at all.
await raise('019', 'Level 3 stormwater')
await page.getByRole('button', { name: /^Plans \(/ }).click()
await page.waitForTimeout(500)
if (!(await page.getByText('No drawings on this project yet').count())) errors.push('Expected the no-drawings state with an import option')
await page.getByRole('button', { name: 'Import plan' }).click()
await page.locator('input[accept="application/pdf,.pdf,image/*"]').setInputFiles(PLAN_PDF)
await page.getByRole('button', { name: 'Use this plan' }).waitFor({ timeout: 30000 })
await page.getByRole('button', { name: 'Use this plan' }).click()
await page.waitForTimeout(900)
let rows = await itps()
console.log('plan linked to the ITP:', rows[0].drawingIds.length)
if (rows[0].drawingIds.length !== 1) errors.push('The imported plan was not linked to the ITP')
if (!(await page.locator('.planview').count())) errors.push('The imported plan is not shown on the Plans tab')
await shot('01-imported')

// Drop a pin: the device position lands on the pin and on the ITP.
await page.getByRole('button', { name: 'Drop pin' }).click()
const plan = page.locator('.planview')
await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(300)
let box = await plan.boundingBox()
await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.4)
await page.waitForTimeout(400)
await page.locator('.sheet').getByText(/^GPS -33\.8025/).waitFor({ timeout: 15000 }).catch(() => errors.push('Pin sheet does not show the device location'))
rows = await itps()
const pin0 = rows[0].pins[0]
console.log('pin:', JSON.stringify({ x: pin0?.x?.toFixed(2), lat: pin0?.lat }), '· ITP located:', rows[0].lat)
if (pin0?.lat !== -33.8025) errors.push('Dropped pin did not record the device location')
if (rows[0].lat !== -33.8025) errors.push('ITP did not take the location from its first pin')
await shot('02-pin')

// Move it.
await page.locator('.sheet').getByRole('button', { name: 'Move pin', exact: true }).click()
await page.waitForTimeout(400)
if (!(await page.getByText(/Tap the plan where pin/).count())) errors.push('No prompt while moving a pin')
await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(300)
box = await plan.boundingBox()
await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.7)
await page.waitForTimeout(600)
rows = await itps()
const moved = rows[0].pins[0]
console.log('moved pin:', JSON.stringify({ x: moved.x.toFixed(2), y: moved.y.toFixed(2), pins: rows[0].pins.length }))
if (rows[0].pins.length !== 1) errors.push('Moving created a second pin instead of moving the first')
if (!(moved.x > pin0.x + 0.2)) errors.push('Pin did not move')
if (!(await page.locator('.sheet').count())) errors.push('Pin sheet did not reopen after moving')
await page.locator('.sheet__head .iconbtn').last().click()
await page.waitForTimeout(300)

// Header shows where it was inspected.
if (!(await page.getByText(/GPS -33\.802500, 150\.987600/).first().count())) errors.push('ITP header does not show the inspection location')
await shot('03-moved')

// Export and read the PDF back.
const dl = page.waitForEvent('download', { timeout: 40000 })
await page.getByRole('button', { name: /Export PDF/ }).click()
const pdfPath = path.join(OUT, 'itp.pdf')
await (await dl).saveAs(pdfPath)
const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: true }).promise
let text = ''
for (let n = 1; n <= pdf.numPages; n++) text += (await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ') + '\n'
const gpsHits = (text.match(/GPS -33\.802500, 150\.987600/g) ?? []).length
console.log('GPS mentions in the PDF:', gpsHits)
if (gpsHits < 2) errors.push(`PDF should carry the ITP and pin coordinates (found ${gpsHits})`)

// --- ITP 2: located by signing its first step, with no pin.
await raise('023', 'Level 3 cold water')
await page.locator('.itpitem__head').first().click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Conforms' }).first().click()
await page.waitForFunction(async () => {
  const req = indexedDB.open('hydraulic-itp')
  const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
  const all = await new Promise((res) => { const r = db.transaction('itps').objectStore('itps').getAll(); r.onsuccess = () => res(r.result) })
  return all.some((i) => i.templateCode === '023' && i.lat !== undefined)
}, null, { timeout: 15000 }).catch(() => undefined)
rows = await itps()
const second = rows.find((i) => i.templateCode === '023')
console.log('second ITP located on first signed step:', second?.lat)
if (second?.lat !== -33.8025) errors.push('Signing the first step did not record where the ITP was inspected')
await shot('04-signed')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Controldoc plan and location check passed.')
process.exit(errors.length ? 1 : 0)
