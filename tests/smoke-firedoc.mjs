// Firedoc: the consultants' register imported, Autopin placing each tag from
// a searchable penetration plan, a penetration added with its plan imported
// from inside the sheet and pinned, the pin moved, a profile allocated, and
// the device's position recorded — on add, and on completion when missing.
import { chromium } from 'playwright'
import { jsPDF } from 'jspdf'
import fs from 'node:fs'
import path from 'node:path'
import { createProject, onboard, tab } from './helpers.mjs'

const OUT = '/tmp/itp-shots-firedoc'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'

// --- Fixtures: a searchable plan with call-out tags, and the Autopin register.
// Tags carry size and type after a dash, as the consultants' requirements set
// out; the register carries the bare number.
const TAGS = [
  { number: 'F0001', tag: 'F0001-FW-100mm', x: 60, y: 60 },
  { number: 'F0002', tag: 'F0002-SS-100mm', x: 220, y: 90 },
  { number: 'F0003', tag: 'F0003-WC-100mm', x: 140, y: 200 },
]
const planPath = path.join(OUT, 'penetration-plan.pdf')
{
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  doc.setDrawColor(200, 0, 0)
  doc.setLineWidth(1.2)
  doc.rect(20, 20, 257, 170) // fire walls in red
  doc.setFontSize(9)
  for (const t of TAGS) {
    doc.circle(t.x, t.y, 2)
    doc.text(t.tag, t.x + 3, t.y + 1)
  }
  doc.setFontSize(12)
  doc.text('HP-L07-001 LEVEL 07 FLOOR PENETRATIONS  REV B', 20, 200)
  fs.writeFileSync(planPath, Buffer.from(doc.output('arraybuffer')))
}
// The drawing hydraulic consultants actually issue: no numbers, a size-and-type
// tag beside a filled purple crosshair symbol. It carries the traps that broke
// earlier versions: a dimension line through a symbol, two symbols close
// enough for their crosshairs to touch, a tag written type-first, room names
// and dimensions that must not read as tags, and a symbol whose tag is just
// "B" with no size.
const industryPath = path.join(OUT, 'industry-plan.pdf')
const INDUSTRY = [
  { tag: '100 FW', sym: [80, 60] },
  { tag: '40 B', sym: [140, 70] },
  { tag: 'ST 100', sym: [200, 60] },
  { tag: '50 SK', sym: [80, 120] }, // a dimension line runs through this one
  { tag: '40 IWTD', sym: [150, 120] }, // these two sit 3.5 mm apart,
  { tag: '40 B', sym: [150, 123.5], below: true }, // crosshairs touching
  { tag: '100 WC', sym: [220, 130] },
]
{
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const purple = [112, 0, 149]
  const symbol = (x, y) => {
    doc.setFillColor(...purple)
    doc.setDrawColor(...purple)
    doc.circle(x, y, 1.1, 'F')
    doc.setLineWidth(0.12)
    doc.line(x - 1.9, y, x + 1.9, y)
    doc.line(x, y - 1.9, x, y + 1.9)
  }
  doc.setFontSize(7)
  doc.setTextColor(0, 0, 0)
  for (const p of INDUSTRY) {
    symbol(...p.sym)
    doc.text(p.tag, p.sym[0] - 3, p.below ? p.sym[1] + 4.5 : p.sym[1] - 3)
  }
  // An incomplete tag.
  symbol(250, 60)
  doc.text('B', 247, 57)
  // Linework: a dimension line straight through the 50 SK symbol, walls in grey.
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.25)
  doc.line(40, 120, 120, 120)
  doc.line(80, 100, 80, 140)
  doc.setDrawColor(150, 150, 150)
  doc.rect(30, 40, 240, 120)
  // Things that must not be read as penetrations.
  doc.text('SPECT 01', 100, 90)
  doc.text('UPTAKE 03', 170, 95)
  doc.text('2925', 60, 150)
  doc.setFontSize(10)
  doc.text('HC-300 GROUND PENETRATION  REV A', 30, 195)
  fs.writeFileSync(industryPath, Buffer.from(doc.output('arraybuffer')))
}

const registerPath = path.join(OUT, 'autopin-register.csv')
fs.writeFileSync(
  registerPath,
  [
    'Penetration No,Pipe Size,Level,Penetration Reference,Material,FRL,Building Element',
    'F0001,100,L07,FW,PVC,120/120/120,Floor slab',
    'F0002,100,L07,SS,PVC,120/120/120,Floor slab',
    'F0003,100,L07,WC,PVC,120/120/120,Floor slab',
    'F0004,50,L07,BSN,PVC,120/120/120,Floor slab',
  ].join('\n'),
)

const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  geolocation: { latitude: -33.8688, longitude: 151.2093, accuracy: 5 },
  permissions: ['geolocation'],
})
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })

const stored = () =>
  page.evaluate(async () => {
    const req = indexedDB.open('hydraulic-itp')
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    return new Promise((res) => {
      const r = db.transaction('penetrations').objectStore('penetrations').getAll()
      r.onsuccess = () => res(Object.fromEntries(r.result.map((p) => [p.number, p])))
    })
  })

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await onboard(page)
await createProject(page, { name: 'Pitt Street OSD', client: 'CPB Contractors' })
await tab(page, 'Firedoc').click()
await page.waitForTimeout(500)

// --- 1. Import the register.
await page.getByRole('button', { name: 'Import register' }).click()
await page.locator('.sheet input[type=file]').setInputFiles(registerPath)
await page.getByRole('button', { name: /Import 4 penetrations/ }).waitFor({ timeout: 15000 })
await page.getByRole('button', { name: /Import 4 penetrations/ }).click()
await page.waitForTimeout(700)
let pens = await stored()
console.log('register imported:', Object.keys(pens).join(', '))
if (Object.keys(pens).length !== 4) errors.push(`Expected 4 penetrations from the register, got ${Object.keys(pens).length}`)

// --- 2. Autopin from the plan PDF, matching register numbers.
await page.getByRole('button', { name: /Autopin from penetration plan/ }).click()
await page.locator('.sheet input[type=file]').setInputFiles(planPath)
await page.getByText(/tagged penetrations found/).waitFor({ timeout: 60000 })
console.log('autopin preview:', (await page.locator('.sheet .banner').first().innerText()).replace(/\s+/g, ' '))
await page.locator('.sheet').getByRole('button', { name: /^Create|^pin/ }).click()
await page.waitForFunction(() => /register penetrations pinned/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 30000 })
const autopinToast = await page.locator('.toast').innerText()
console.log('autopin:', autopinToast)
pens = await stored()
const pinnedNumbers = Object.values(pens).filter((p) => p.autoPinned && p.x !== undefined).map((p) => p.number).sort()
console.log('autopinned:', pinnedNumbers.join(', '))
if (pinnedNumbers.join() !== 'F0001,F0002,F0003') errors.push(`Autopin should place F0001–F0003 and not F0004, got ${pinnedNumbers.join()}`)
// Positions should follow the plan: F0002 right of F0001, F0003 below both.
const [a, b, c] = ['F0001', 'F0002', 'F0003'].map((n) => pens[n])
if (!(b?.x > a?.x && c?.y > a?.y && c?.y > b?.y)) errors.push('Autopinned positions do not follow the tags on the plan')
await page.waitForTimeout(600)
const planPins = await page.locator('.planview .pin').count()
console.log('pins on the plan view:', planPins)
if (planPins !== 3) errors.push(`Plan view should show 3 autopinned penetrations, shows ${planPins}`)
await shot('01-autopinned')

// The schedule revision is generated into the app; a broken generator once
// printed its own placeholder here.
const footer = await page.getByText(/Passive Fire Rating Schedule/).innerText()
if (!/Rev \d+/.test(footer) || /REVISION/.test(footer)) errors.push(`Fire schedule revision is not printed: ${footer}`)

// --- 3. F0004 was not on the plan: place it by hand from its own sheet.
await page.getByRole('button', { name: 'List', exact: true }).click()
await page.waitForTimeout(300)
await page.locator('.listitem', { hasText: 'F0004' }).click()
await page.waitForTimeout(500)
const sheet = page.locator('.sheet').last()
if (!(await sheet.getByText(/Not located on a plan/).count())) errors.push('F0004 should read as not located on a plan')
await sheet.getByRole('button', { name: 'Choose plan' }).click()
await sheet.getByLabel('Plan').selectOption({ index: 1 })
await page.waitForTimeout(500)
const sbox = await sheet.locator('.planview').boundingBox()
await page.mouse.click(sbox.x + sbox.width * 0.5, sbox.y + sbox.height * 0.5)
await page.waitForTimeout(500)
pens = await stored()
console.log('F0004 placed by hand:', JSON.stringify({ x: pens.F0004?.x?.toFixed(2), auto: pens.F0004?.autoPinned }))
if (pens.F0004?.x === undefined || pens.F0004?.autoPinned) errors.push('Hand-placing F0004 did not store a manual pin')

// Moving an autopinned tag makes it a manual placement.
await sheet.locator('.sheet__head .iconbtn').click()
await page.waitForTimeout(300)
await page.locator('.listitem', { hasText: 'F0001' }).click()
await page.waitForTimeout(500)
const s1 = page.locator('.sheet').last()
await s1.getByRole('button', { name: 'Move pin' }).click()
const b1 = await s1.locator('.planview').boundingBox()
await page.mouse.click(b1.x + b1.width * 0.8, b1.y + b1.height * 0.8)
await page.waitForTimeout(500)
pens = await stored()
console.log('F0001 moved:', JSON.stringify({ x: pens.F0001.x.toFixed(2), auto: pens.F0001.autoPinned }))
if (pens.F0001.autoPinned) errors.push('Moving an autopinned penetration should mark it as placed by hand')

// --- 4. Completion stamps the device position when none was recorded.
if (pens.F0001.lat !== undefined) errors.push('Imported penetrations should not have a location until someone is there')
await s1.getByRole('button', { name: 'Allocate' }).click()
await page.waitForTimeout(400)
await page.locator('.sheet').last().locator('.listitem').first().click()
await page.waitForTimeout(400)
await s1.getByRole('button', { name: 'Completed by site' }).click()
await page.waitForTimeout(1200)
pens = await stored()
console.log('F0001 on completion:', JSON.stringify({ status: pens.F0001.status, lat: pens.F0001.lat, lng: pens.F0001.lng }))
if (pens.F0001.status !== 'completed_by_site') errors.push('F0001 did not complete')
if (pens.F0001.lat !== -33.8688) errors.push('Completion did not record where the penetration was signed')
await shot('02-completed')
await s1.locator('.sheet__head .iconbtn').click()
await page.waitForTimeout(300)

// --- 5. Add a new one, importing its plan from inside the sheet.
await page.getByRole('button', { name: 'Add', exact: true }).click()
await page.waitForTimeout(400)
const add = page.locator('.sheet').last()
await add.getByPlaceholder('F0001').fill('W0001')
await add.getByRole('button', { name: 'Import plan' }).click()
await add.locator('input[type=file]').setInputFiles(planPath)
await add.getByRole('button', { name: 'Use this plan' }).waitFor({ timeout: 30000 })
await add.getByRole('button', { name: 'Use this plan' }).click()
await page.waitForTimeout(800)
const abox = await add.locator('.planview').boundingBox()
await page.mouse.click(abox.x + abox.width * 0.3, abox.y + abox.height * 0.6)
await page.waitForTimeout(400)
await add.getByText(/^GPS -33\.8688/).waitFor({ timeout: 15000 }).catch(() => errors.push('Device location not captured on add'))
await shot('03-add')
await add.getByRole('button', { name: 'Add', exact: true }).click()
await page.waitForTimeout(800)
pens = await stored()
console.log('W0001 added:', JSON.stringify({ pinned: pens.W0001?.x !== undefined, drawing: Boolean(pens.W0001?.drawingId), lat: pens.W0001?.lat }))
if (!pens.W0001?.drawingId || pens.W0001.x === undefined) errors.push('W0001 was not pinned on its imported plan')
if (pens.W0001?.lat !== -33.8688) errors.push('W0001 did not record the device location')
await shot('04-detail')
await page.locator('.sheet__head .iconbtn').last().click().catch(() => undefined)
await page.waitForTimeout(300)

// --- 6. An industry drawing: size-and-type tags, no numbers, no register.
const before = Object.keys(await stored()).length
await page.getByRole('button', { name: /Autopin from penetration plan/ }).click()
await page.locator('.sheet input[type=file]').setInputFiles(industryPath)
await page.getByText(/tagged penetrations found/).waitFor({ timeout: 60000 })
const banners = (await page.locator('.sheet .banner').allInnerTexts()).map((b) => b.replace(/\s+/g, ' '))
console.log('industry preview:', banners.join(' || '))
if (!/7 tagged penetrations found .* 7 placed on their symbol/.test(banners[0])) errors.push(`Expected all 7 tags placed on their symbols: ${banners[0]}`)
if (!/1 more symbol with no complete tag — "B"/.test(banners[1] ?? '')) errors.push(`Expected the "B" symbol flagged as incompletely tagged: ${banners[1]}`)
const types = (await page.locator('.sheet .chip').allInnerTexts()).join(' | ')
console.log('types read:', types)
if (/SPECT|UPTAKE|2925/.test(types)) errors.push('Room names or dimensions were read as penetrations')
if (!/100 ST/.test(types)) errors.push('Type-first tag "ST 100" was not read')
await shot('05-industry-preview')
await page.locator('.sheet').getByRole('button', { name: /^Create/ }).click()
await page.waitForTimeout(1500)
pens = await stored()
const fresh = Object.values(pens).filter((p) => !['F0001', 'F0002', 'F0003', 'F0004', 'W0001'].includes(p.number))
console.log('created from the industry drawing:', fresh.length, fresh.map((p) => `${p.number} ${p.size || '?'} ${p.ref}`).join(', '))
if (fresh.length !== 8) errors.push(`Expected 8 penetrations from the industry drawing (7 tagged + 1 incomplete), got ${fresh.length}`)
if (Object.keys(pens).length - before !== 8) errors.push('Autopin changed penetrations it should not have')
// Positions: each tagged one within 1 mm of its symbol (297 x 210 mm page).
for (const spec of INDUSTRY) {
  const [sx, sy] = spec.sym
  const [size, ref] = spec.tag.startsWith('ST') ? ['100mm', 'ST'] : [`${spec.tag.split(' ')[0]}mm`, spec.tag.split(' ')[1]]
  const hit = fresh.find((p) => p.size === size && p.ref === ref && Math.hypot(p.x * 297 - sx, p.y * 210 - sy) < 1)
  if (!hit) errors.push(`${spec.tag} was not placed on its symbol at ${sx},${sy} mm`)
}
const incomplete = fresh.find((p) => !p.size)
if (!incomplete || incomplete.ref !== 'B' || !/confirm size and type/.test(incomplete.notes ?? '')) errors.push('The "B" symbol was not created and flagged for confirmation')
// New numbers continue after the ones in use.
if (!fresh.every((p) => /^F\d{4}$/.test(p.number) && Number(p.number.slice(1)) >= 5)) errors.push(`Unexpected numbering: ${fresh.map((p) => p.number).join(', ')}`)

// Running Autopin on the same sheet again must not duplicate anything.
await page.getByRole('button', { name: /Autopin from penetration plan/ }).click()
await page.locator('.sheet input[type=file]').setInputFiles(industryPath)
await page.getByText(/tagged penetrations found/).waitFor({ timeout: 60000 })
await page.locator('.sheet').getByRole('button', { name: /^Create/ }).click()
await page.waitForTimeout(1500)
const rerun = await page.locator('.toast').innerText().catch(() => '')
console.log('re-run:', rerun)
if (Object.keys(await stored()).length !== Object.keys(pens).length) errors.push('Re-running Autopin on the same sheet duplicated penetrations')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Firedoc check passed.')
process.exit(errors.length ? 1 : 0)
