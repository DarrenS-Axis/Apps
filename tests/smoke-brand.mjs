// Each business's logo, everywhere: the app bar on every screen, the home
// page, the ITP screen and its PDF, the plant labels — with NZ as a business,
// the trading names matching the logos, a logo uploaded in Settings taking
// over, and national QA seeing every business's logo.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { onboard, tab } from './helpers.mjs'

const OUT = '/tmp/itp-shots-brand'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const errors = []
const check = (ok, message) => {
  if (!ok) errors.push(message)
}

// A plain green PNG to upload as a logo.
function png(w, h, [r, g, b]) {
  const CRC = new Int32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc32 = (buf) => {
    let c = -1
    for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const uploadPath = path.join(OUT, 'nsw-logo.png')
fs.writeFileSync(uploadPath, png(240, 120, [60, 170, 70]))

const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, acceptDownloads: true })
  // The yard's address lookup, answered here (no network in the harness).
  await ctx.route(/nominatim\.openstreetmap\.org/, (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`)
  })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  return page
}
const headerLogo = (page) => page.locator('.appbar .brandlogo img').getAttribute('src')

// ---- SA: the logo on every screen, the ITP and its PDF.
const sa = await device('SA')
const states = await sa.locator('label:has(span:text("State")) select option').allInnerTexts()
check(states.some((s) => /NZ — New Zealand/.test(s)), 'NZ is not offered as a business')
await sa.locator('label:has(span:text("State")) select').selectOption('SA')
await sa.locator('.logostrip img[alt="Axis Services SA logo"]').waitFor()
await onboard(sa, { name: 'Darren Shoobridge', state: 'SA' })
check(/\/sa-[^/]*\.png$/.test((await headerLogo(sa)) ?? ''), 'SA logo not in the app bar on the home page')
check((await sa.locator('.logostrip img[alt="Axis Services SA logo"]').count()) === 1, 'SA logo not on the home page')
check((await sa.locator('.section-title .brandlogo img').count()) >= 1, 'Business unit section has no logo')
await sa.screenshot({ path: path.join(OUT, '01-home-sa.png') })

await sa.getByRole('button', { name: 'New project' }).first().click()
await sa.getByPlaceholder('e.g. Liverpool Hospital').fill('Mt Barker Hospital')
await sa.getByRole('button', { name: 'Create project' }).click()
await sa.waitForTimeout(800)
check(/\/sa-[^/]*\.png$/.test((await headerLogo(sa)) ?? ''), 'SA logo not in the app bar on the project')
await tab(sa, 'Controldoc').click()
await sa.getByRole('button', { name: /ITP register/ }).click()
await sa.getByPlaceholder(/Search the \d+/).fill('023')
await sa.waitForTimeout(300)
await sa.locator('.listitem').first().click()
await sa.getByPlaceholder(/North East Corner/).fill('Level 2 cold water')
await sa.getByRole('button', { name: 'Raise ITP' }).click()
await sa.locator('.itpbrand img[alt="Axis Services SA logo"]').waitFor()
check(/Axis Services SA/.test(await sa.locator('.itpbrand').innerText()), 'ITP screen does not name the business')
await sa.screenshot({ path: path.join(OUT, '02-itp-sa.png') })
const dl = sa.waitForEvent('download', { timeout: 40000 })
await sa.getByRole('button', { name: 'Export PDF' }).click()
const pdfPath = path.join(OUT, 'itp-sa.pdf')
await (await dl).saveAs(pdfPath)
const pdf = fs.readFileSync(pdfPath).toString('latin1')
const images = (pdf.match(/\/Subtype\s*\/Image/g) ?? []).length
console.log('ITP PDF images:', images)
check(images >= 1, 'ITP PDF carries no logo image')

// Plant labels carry the logo too.
await sa.goto(`${BASE}/#/plant`)
await sa.getByRole('button', { name: 'Add item' }).click()
await sa.getByPlaceholder('e.g. Hammer Drill').fill('Hammer Drill')
await sa.getByRole('button', { name: 'Add to register' }).click()
const labelDl = sa.waitForEvent('download')
await sa.getByRole('button', { name: 'Label PDF' }).click()
const labelPath = path.join(OUT, 'label.pdf')
await (await labelDl).saveAs(labelPath)
check((fs.readFileSync(labelPath).toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length >= 1, 'Plant label carries no logo')

// ---- NSW: no built-in logo yet shows the AXIS tile; one uploaded in Settings takes over.
const nsw = await device('NSW')
await onboard(nsw, { name: 'Murtaza Bahloli', state: 'NSW' })
check((await nsw.locator('.appbar .brandlogo--text').count()) === 1, 'NSW without a logo should show the AXIS tile')
await nsw.getByRole('link', { name: 'Settings', exact: true }).click()
await nsw.locator('input[aria-label="Trading entity"]').first().waitFor()
const entities = await nsw.locator('input[aria-label="Trading entity"]').evaluateAll((els) => els.map((e) => e.value))
console.log('NSW entities:', entities.join(' | '))
check(entities.includes('Axis Plumbing NSW Group') && entities.includes('Axis Plumbing Small Works Group'), 'NSW trading names do not match the logos')
await nsw.locator('input[aria-label="Logo for NSW Major Works"]').setInputFiles(uploadPath)
await nsw.locator('.toast', { hasText: 'logo saved' }).waitFor()
await nsw.getByRole('link', { name: 'Projects', exact: true }).click()
await nsw.waitForTimeout(500)
check(((await headerLogo(nsw)) ?? '').startsWith('data:image/png'), 'Uploaded logo not in the app bar')
await nsw.screenshot({ path: path.join(OUT, '03-home-nsw-uploaded.png') })

// ---- National QA: every business's logo.
const nat = await device('National')
await onboard(nat, { name: 'Ben Kennedy', state: 'NSW', role: 'National QA' })
const alts = await nat.locator('.card .logostrip img').evaluateAll((els) => els.map((e) => e.alt))
console.log('national logos:', alts.join(' | '))
for (const name of ['Axis Plumbing ACT', 'Axis Plumbing NT', 'Axis Plumbing NZ', 'Axis Services SA', 'Axis Services VIC']) {
  check(alts.includes(`${name} logo`), `National home is missing the ${name} logo`)
}
check((await nat.locator('.section-title', { hasText: 'NZ' }).count()) >= 1, 'NZ business unit missing from the national home')
await nat.screenshot({ path: path.join(OUT, '04-home-national.png'), fullPage: true })

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Business logos check passed.')
process.exit(errors.length ? 1 : 0)
