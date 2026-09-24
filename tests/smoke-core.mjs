import { chromium } from 'playwright'
import { createProject, onboard, openPhotos, tab } from './helpers.mjs'
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
await onboard(page)
await createProject(page, { name: 'Minus 1 — Adelaide', projectNumber: 'HYD-2026-014', client: 'Space Frame', approvedBy: 'Darren Shoobridge' })
await page.waitForTimeout(700)
await shot('02-job')

// --- Getting back to the list of jobs. With one job there is no switcher in
//     the header, so this link is the only way back to it.
const backToJobs = page.getByRole('link', { name: 'All projects' })
if (!(await backToJobs.count())) errors.push('No link back to the jobs list from inside a job')
else {
  await backToJobs.click()
  await page.waitForTimeout(600)
  if (!page.url().includes('/state')) errors.push(`"All jobs" did not open the jobs list (${page.url()})`)
  const jobsListed = await page.locator('.listitem').count()
  console.log('jobs listed on the home page:', jobsListed)
  if (jobsListed < 1) errors.push('The jobs list showed no jobs')
  // It is the page you are already on, so it should not offer itself.
  if (await page.getByRole('link', { name: 'All projects' }).count()) {
    errors.push('The "All jobs" link is still shown on the jobs list itself')
  }
  await page.locator('.listitem').first().click()
  await page.waitForTimeout(600)
}

// Settings: identity
await page.getByRole('link', { name: 'Settings', exact: true }).click()
await page.waitForTimeout(400)
await page.getByPlaceholder('e.g. Murtaza Bahloli').fill('Brett Patman')
await page.getByPlaceholder('e.g. MB').fill('BP')
await page.waitForTimeout(400)
await shot('03-settings')

// ITP register
await tab(page, 'Controldoc').click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: /ITP register/ }).click()
await page.waitForTimeout(400)
await shot('04-register')

const count = await page.locator('.listitem').count()
console.log('register rows:', count)

// Raise ITP 002
await page.getByPlaceholder(/Search the \d+/).fill('Tradewaste')
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
