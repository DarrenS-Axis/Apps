// Checks the path plans actually arrive by: a PDF out of SharePoint / OneDrive,
// picked through the OS file browser, rendered on-device and pinned.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const OUT = '/tmp/itp-shots-plan-import'
fs.mkdirSync(OUT, { recursive: true })

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
// Any multi-page PDF works; the point is exercising the sheet picker. It is
// copied to a realistically-named file first, because a drawing coming out of
// SharePoint carries its number in the file name and that is what the title
// block guess reads.
const SOURCE_PDF = process.env.ITP_PLAN_PDF ?? '/tmp/itp-fixtures/plan.pdf'
const PDF = path.join(os.tmpdir(), 'HC-001 Below Ground Drainage Rev 4.pdf')
fs.copyFileSync(SOURCE_PDF, PDF)

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
const shot = async (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

await page.getByRole('button', { name: 'New job' }).click()
await page.getByPlaceholder('e.g. Minus 1 — Adelaide').fill('Plan Import Job')
await page.getByRole('button', { name: 'Create job' }).click()
await page.waitForTimeout(700)

// Add a drawing from a PDF.
await page.getByRole('link', { name: 'Plans' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Add drawing' }).click()
await page.waitForTimeout(300)
await shot('01-empty-sheet')

await page.locator('input[type=file]').setInputFiles(PDF)
// pdf.js loads lazily on first use, then renders every sheet.
await page.waitForSelector('.photo', { timeout: 45000 })
await page.waitForTimeout(1500)
await shot('02-pdf-imported')

const sheets = await page.locator('.photo').count()
console.log('sheets rendered from PDF:', sheets)
if (sheets < 2) errors.push(`Expected a multi-sheet picker, got ${sheets} sheet(s)`)

// The title-block guess should read the drawing number out of the file name,
// and must never offer a pipe or material spec (PM64, PE100, DN100) as one —
// a wrong number silently recorded against an ITP is worse than a blank field.
const guessedNumber = await page.locator('input[placeholder="e.g. HC-001"]').inputValue()
console.log('guessed drawing number:', JSON.stringify(guessedNumber))
if (guessedNumber !== 'HC-001') {
  errors.push(`Expected the drawing number guessed as HC-001, got ${JSON.stringify(guessedNumber)}`)
}
if (/^(PM|PN|SN|DN|PE|PVC)\d/i.test(guessedNumber)) {
  errors.push(`Guessed a material spec as the drawing number: ${guessedNumber}`)
}

// Pick the second sheet — the plan page, not the ITP form page.
await page.locator('.photo').nth(1).click()
await page.waitForTimeout(600)
await shot('03-second-sheet-selected')

await page.locator('input[placeholder="e.g. ISSUE 4"]').fill('ISSUE 4')
await page.getByRole('button', { name: 'Save drawing' }).click()
await page.waitForTimeout(1200)
await shot('04-drawing-saved')

const cards = await page.locator('.grid .card').count()
console.log('drawings in register:', cards)
if (cards !== 1) errors.push(`Expected 1 drawing in the register, got ${cards}`)

// The imported plan must be usable for pinning, which is the whole point.
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
await shot('05-plan-in-itp')

const planVisible = await page.locator('.planview img').count()
console.log('plan rendered in ITP:', planVisible)
if (planVisible === 0) errors.push('Imported PDF plan did not render in the ITP plans tab')

await page.getByRole('button', { name: 'Drop pin' }).click()
await page.waitForTimeout(300)
// Centre the viewer first: page.mouse works in viewport coordinates, so a plan
// below the fold would receive nothing.
await page.locator('.planview').evaluate((el) => el.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(300)
const pbox = await page.locator('.planview').boundingBox()
await page.mouse.click(pbox.x + pbox.width * 0.5, pbox.y + pbox.height * 0.5)
// The pin is created on tap and its detail sheet opens; close it to see the plan.
await page.waitForTimeout(800)
await page.locator('.sheet__head .iconbtn').click()
await page.waitForTimeout(700)
await shot('06-pinned')

const pins = await page.locator('.pin').count()
console.log('pins placed on imported plan:', pins)
if (pins === 0) errors.push('Could not pin the imported PDF plan')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Plan import check passed.')
process.exit(errors.length ? 1 : 0)
