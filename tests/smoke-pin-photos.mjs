// Photos taken at a pin: capture from the pin, see the count on the plan, move
// a photo onto a pin after the fact, and keep the evidence when the pin goes.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/tmp/itp-shots-pin-photos'
fs.mkdirSync(OUT, { recursive: true })

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const PLAN = process.env.ITP_PLAN_FIXTURE ?? '/tmp/itp-fixtures/plan.png'
const PHOTO = process.env.ITP_PHOTO_FIXTURE ?? '/tmp/itp-fixtures/photo.jpg'

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
// Pin the device position: capture waits on a GPS fix (up to 8s) when location
// is allowed and undecided, which would otherwise just look like a slow test.
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: { latitude: -34.9285, longitude: 138.6007, accuracy: 8 },
})
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
const shot = async (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

await page.getByRole('button', { name: 'New job' }).click()
await page.getByPlaceholder('e.g. Minus 1 — Adelaide').fill('Pin Photo Job')
await page.getByRole('button', { name: 'Create job' }).click()
await page.waitForTimeout(700)

await page.getByRole('link', { name: 'Plans' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Add drawing' }).click()
await page.getByPlaceholder('e.g. HC-001').fill('HC-001')
await page.locator('input[type=file]').setInputFiles(PLAN)
await page.waitForTimeout(1200)
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

// --- Drop a pin. The detail sheet should open straight away, ready for photos.
await page.getByRole('button', { name: 'Drop pin' }).click()
await page.waitForTimeout(300)
const plan = page.locator('.planview')
await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(300)
const pbox = await plan.boundingBox()
await page.mouse.click(pbox.x + pbox.width * 0.45, pbox.y + pbox.height * 0.5)
await page.waitForTimeout(900)
await page.locator('.sheet textarea').fill('IO at grid 3, IL 21.30')
await page.locator('.sheet textarea').blur()
await page.waitForTimeout(400)
await shot('01-pin-detail-opened')

const detailOpen = await page.getByRole('button', { name: 'Take photo here' }).count()
console.log('pin detail opened after drop:', detailOpen > 0)
if (detailOpen === 0) errors.push('Dropping a pin did not open its detail sheet ready for photos')

// --- Capture two photos at the pin.
await page.locator('.sheet input[type=file]').first().setInputFiles(PHOTO)
await page.waitForTimeout(1800)
await page.locator('.sheet input[type=file]').first().setInputFiles(PHOTO)
await page.waitForTimeout(1800)
await shot('02-photos-at-pin')

const pinPhotos = await page.locator('.sheet .photo').count()
console.log('photos attached to the pin:', pinPhotos)
if (pinPhotos !== 2) errors.push(`Expected 2 photos on the pin, got ${pinPhotos}`)

await page.locator('.sheet__head .iconbtn').click()
await page.waitForTimeout(700)
await shot('03-plan-with-badge')

// --- The plan must show the pin carries evidence.
const badge = await page.locator('.planview .pin svg circle').count()
console.log('photo badges on plan pins:', badge)
if (badge === 0) errors.push('Pin carrying photos shows no badge on the plan')

const pinRowText = await page.locator('table.data tbody tr').last().innerText()
console.log('pin row:', JSON.stringify(pinRowText.replace(/\s+/g, ' ').trim()))
if (!/2 photos/.test(pinRowText)) errors.push('Pin row does not report its photo count')

// --- A photo taken elsewhere can be moved onto the pin afterwards. This is
// driven from the Photos tab rather than the schedule: same PhotoViewer code
// path, but a short page, so the full-screen lightbox is not competing with a
// 9000px scrolled document underneath it.
await page.getByRole('button', { name: /^Schedule/ }).click()
await page.waitForTimeout(400)
await page.locator('.itpitem__head').first().click()
await page.waitForTimeout(400)
await page.locator('.itpitem input[type=file]').nth(1).setInputFiles(PHOTO)
await page.waitForTimeout(2500)

const itemPhotos = await page.locator('.itpitem .photo').count()
console.log('photos on schedule item 1.0:', itemPhotos)
if (itemPhotos !== 1) errors.push(`Expected 1 photo on the item, got ${itemPhotos}`)

await page.getByRole('link', { name: 'Photos' }).click()
await page.waitForTimeout(900)
const unassigned = page.locator('.photo').filter({ hasNotText: '📍' })
await unassigned.first().click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: 'Edit details' }).click()
await page.waitForTimeout(600)
await page.locator('label:has(span:text("Taken at plan pin")) select').selectOption({ index: 1 })
await shot('04-assign-photo-to-pin')
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForTimeout(1000)

// Saving returns to the photo rather than dismissing it, so close the lightbox
// before touching anything behind it.
await page.locator('.lightbox__bar .iconbtn').click()
await page.waitForTimeout(600)

await page.getByRole('link', { name: 'ITPs' }).click()
await page.waitForTimeout(500)
await page.locator('.listitem').first().click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: /^Plans \(/ }).click()
await page.waitForTimeout(900)
const rowAfterAssign = await page.locator('table.data tbody tr').last().innerText()
console.log('pin row after assigning:', JSON.stringify(rowAfterAssign.replace(/\s+/g, ' ').trim()))
if (!/3 photos/.test(rowAfterAssign)) errors.push('Assigning an existing photo to a pin did not update the count')

// --- Export: the plan legend should credit the pin's photos.
const dl = page.waitForEvent('download', { timeout: 40000 })
await page.getByRole('button', { name: /Export PDF/ }).click()
const download = await dl
const pdfPath = path.join(OUT, 'export.pdf')
await download.saveAs(pdfPath)
console.log('pdf bytes:', fs.statSync(pdfPath).size)

// --- Removing a pin must not destroy the evidence taken at it.
await page.locator('table.data tbody tr').last().getByRole('button', { name: 'Open' }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: /Remove pin/ }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: /Tap again to remove/ }).click()
await page.waitForTimeout(1000)
await shot('05-pin-removed')

await page.getByRole('link', { name: 'Photos' }).click()
await page.waitForTimeout(900)
const survivingPhotos = await page.locator('.photo').count()
console.log('photos still in the record after removing the pin:', survivingPhotos)
if (survivingPhotos !== 3) {
  errors.push(`Removing a pin lost evidence: expected 3 photos to survive, found ${survivingPhotos}`)
}
await shot('06-photos-survived')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Pin photo check passed.')
process.exit(errors.length ? 1 : 0)
