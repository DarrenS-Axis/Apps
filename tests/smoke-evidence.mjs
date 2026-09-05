// End-to-end check of the evidence path: drawing → pin → photo → PDF.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/tmp/itp-shots-evidence'
fs.mkdirSync(OUT, { recursive: true })

const PLAN = process.env.ITP_PLAN_FIXTURE ?? '/tmp/itp-fixtures/plan.png'
const PHOTO = process.env.ITP_PHOTO_FIXTURE ?? '/tmp/itp-fixtures/photo.jpg'

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  permissions: [],
})
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
const shot = async (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })

async function sign(locator) {
  // Centre the pad in the viewport — scrollIntoViewIfNeeded can leave it under
  // the fixed tab bar, and page.mouse works in viewport coordinates.
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  const b = await locator.boundingBox()
  await page.mouse.move(b.x + 30, b.y + b.height * 0.7)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.25, { steps: 8 })
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.8, { steps: 8 })
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.3, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

// Job
await page.getByRole('button', { name: 'New job' }).click()
await page.getByPlaceholder('e.g. Minus 1 — Adelaide').fill('Minus 1 — Adelaide')
await page.locator('label:has(span:text("Your company")) input').fill('Axis Services SA')
await page.locator('label:has(span:text("Approved for use by")) input').fill('Darren Shoobridge')
await page.getByRole('button', { name: 'Create job' }).click()
await page.waitForTimeout(600)

// Identity
await page.getByRole('link', { name: 'Settings' }).click()
await page.waitForTimeout(300)
await page.getByPlaceholder('e.g. Brett Patman').fill('Brett Patman')
await page.getByPlaceholder('e.g. BP').fill('BP')
await page.waitForTimeout(300)

// Drawing with a plan image
await page.getByRole('link', { name: 'Plans' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Add drawing' }).click()
await page.getByPlaceholder('e.g. HC-001').fill('HC-001')
await page.getByPlaceholder('e.g. ISSUE 4').fill('ISSUE 4')
await page.getByPlaceholder(/Below ground drainage/).fill('Below ground drainage — Minus 1')
await page.locator('input[type=file]').setInputFiles(PLAN)
await page.waitForTimeout(900)
await shot('01-drawing-form')
await page.getByRole('button', { name: 'Save drawing' }).click()
await page.waitForTimeout(700)
await shot('02-drawings')

// Raise an ITP with the drawing linked
await page.getByRole('link', { name: 'ITPs' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /ITP register/ }).click()
await page.getByPlaceholder(/Search the 42/).fill('Inground Sanitary')
await page.waitForTimeout(300)
await page.locator('.listitem').first().click()
await page.waitForTimeout(400)
await page.getByPlaceholder(/North East Corner/).fill('North East Corner — Grid 1-5')
await page.locator('label:has-text("HC-001") input[type=checkbox]').check()
await page.getByRole('button', { name: 'Raise ITP' }).click()
await page.waitForTimeout(800)

// Sign item 1 and attach a photo to it
await page.locator('.itpitem__head').first().click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Conforms' }).first().click()
await page.waitForTimeout(300)
await page.locator('.itpitem input[type=file]').nth(1).setInputFiles(PHOTO)
await page.waitForTimeout(1500)
await shot('03-item-photo')

const photoTiles = await page.locator('.photo').count()
console.log('photo tiles after capture:', photoTiles)
if (photoTiles === 0) errors.push('Photo did not attach to the item')

// Release the first hold point
const hold = page.locator('.itpitem', { has: page.locator('.chip--hold') }).first()
if (await hold.count()) {
  await hold.locator('.itpitem__head').click()
  await page.waitForTimeout(400)
  const releaseBtn = page.getByRole('button', { name: /Record release/ })
  if (await releaseBtn.count()) {
    await releaseBtn.first().click()
    await page.waitForTimeout(400)
    await page.getByPlaceholder('Name').fill('J. Reynolds')
    await page.locator('label:has(span:text("Company")) input').fill('SA Water')
    await sign(page.locator('.sigpad canvas'))
    await shot('04-release')
    await page.getByRole('button', { name: 'Record release' }).last().click()
    await page.waitForTimeout(700)
    await shot('05-released')
  }
}

// Drop a pin on the plan
await page.getByRole('button', { name: /^Plans \(/ }).click()
await page.waitForTimeout(700)
await shot('06-plans-tab')
await page.getByRole('button', { name: 'Drop pin' }).click()
await page.waitForTimeout(300)
const plan = page.locator('.planview')
// Centre the viewer: page.mouse works in viewport coordinates.
await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(300)
const pbox = await plan.boundingBox()
await page.mouse.click(pbox.x + pbox.width * 0.45, pbox.y + pbox.height * 0.5)
await page.waitForTimeout(500)
await page.locator('textarea').fill('IO at grid 3, IL 21.30')
await page.getByRole('button', { name: 'Place pin' }).click()
await page.waitForTimeout(800)
await shot('07-pin-placed')

const pins = await page.locator('.pin').count()
console.log('pins on plan:', pins)
if (pins === 0) errors.push('Pin was not placed on the plan')

// Sign off
await page.getByRole('button', { name: 'Sign-off' }).click()
await page.waitForTimeout(400)
await sign(page.locator('.sigpad canvas').first())
await shot('08-signoff')
await page.getByRole('button', { name: 'Sign off ITP' }).click()
await page.waitForTimeout(600)

// Export
const dl = page.waitForEvent('download', { timeout: 40000 })
await page.getByRole('button', { name: /Export PDF/ }).click()
const download = await dl
await download.saveAs(path.join(OUT, 'export.pdf'))
console.log('pdf bytes:', fs.statSync(path.join(OUT, 'export.pdf')).size)

// Photos tab
await page.getByRole('link', { name: 'Photos' }).click()
await page.waitForTimeout(700)
await shot('09-photos')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console/page errors.')
process.exit(errors.length ? 1 : 0)
