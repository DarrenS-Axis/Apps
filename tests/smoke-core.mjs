import { chromium } from 'playwright'
import fs from 'node:fs'

const OUT = '/tmp/itp-shots-core'
fs.mkdirSync(OUT, { recursive: true })

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log('shot', name) }

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await shot('01-projects')

// Create a job
await page.getByRole('button', { name: 'New job' }).click()
await page.getByPlaceholder('e.g. Minus 1 — Adelaide').fill('Minus 1 — Adelaide')
await page.locator('label:has(span:text("Job number")) input').fill('HYD-2026-014')
await page.locator('label:has(span:text("Stage / level")) input').fill('MINUS 1')
await page.locator('label:has(span:text("Client / head contractor")) input').fill('Space Frame')
await page.locator('label:has(span:text("Your company")) input').fill('Axis Services SA')
await page.locator('label:has(span:text("Approved for use by")) input').fill('Darren Shoobridge')
await page.getByRole('button', { name: 'Create job' }).click()
await page.waitForTimeout(700)
await shot('02-job')

// Settings: identity
await page.getByRole('link', { name: 'Settings' }).click()
await page.waitForTimeout(400)
await page.getByPlaceholder('e.g. Brett Patman').fill('Brett Patman')
await page.getByPlaceholder('e.g. BP').fill('BP')
await page.waitForTimeout(400)
await shot('03-settings')

// ITP register
await page.getByRole('link', { name: 'ITPs' }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: /ITP register/ }).click()
await page.waitForTimeout(400)
await shot('04-register')

const count = await page.locator('.listitem').count()
console.log('register rows:', count)

// Raise ITP 002
await page.getByPlaceholder(/Search the 42/).fill('Tradewaste')
await page.waitForTimeout(300)
await shot('05-search')
await page.locator('.listitem', { hasText: 'Inground Tradewaste Drainage' }).first().click()
await page.waitForTimeout(400)
await page.getByPlaceholder(/North East Corner/).fill('Southern Driveway — Plant Room')
await page.locator('label:has(span:text("Level / grid reference")) input').fill('Minus 1, Grid 10-12')
await shot('06-raise')
await page.getByRole('button', { name: 'Raise ITP' }).click()
await page.waitForTimeout(800)
await shot('07-itp')

// Sign the first item
await page.locator('.itpitem__head').first().click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Conforms' }).first().click()
await page.waitForTimeout(500)
await shot('08-signed')

// Open a hold point item to verify the banner
const holdItem = page.locator('.itpitem', { has: page.locator('.chip--hold') }).first()
if (await holdItem.count()) {
  await holdItem.locator('.itpitem__head').click()
  await page.waitForTimeout(400)
  await shot('09-holdpoint')
}

// Materials tab
await page.getByRole('button', { name: /^Materials/ }).click()
await page.waitForTimeout(400)
await shot('10-materials')

// Sign-off tab
await page.getByRole('button', { name: 'Sign-off' }).click()
await page.waitForTimeout(400)
await shot('11-signoff')

// PDF export — verify it produces a real file
const dl = page.waitForEvent('download', { timeout: 30000 })
await page.getByRole('button', { name: /Export PDF/ }).click()
const download = await dl
const pdfPath = `${OUT}/export.pdf`
await download.saveAs(pdfPath)
const size = fs.statSync(pdfPath).size
console.log('pdf bytes:', size, 'name:', download.suggestedFilename())
if (size < 3000) errors.push('PDF suspiciously small')

// Desktop pass
const wide = await ctx.newPage()
wide.on('pageerror', (e) => errors.push(`pageerror(wide): ${e.message}`))
await wide.setViewportSize({ width: 1280, height: 900 })
await wide.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await wide.waitForTimeout(900)
await wide.screenshot({ path: `${OUT}/12-desktop.png`, fullPage: true })

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console/page errors.')
process.exit(errors.length ? 1 : 0)
