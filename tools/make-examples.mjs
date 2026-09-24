// Produces worked example ITP PDFs by driving the built app, so what comes out
// is exactly what the app produces on site — not a mock-up of it.
//
//   npm run build
//   npx vite preview --port 4173 --host 127.0.0.1 &
//   node tools/make-examples.mjs
//
// Point ITP_CLIENT_LOGO at the head contractor's official logo file to use it;
// without one a plain typographic wordmark stands in.
import { chromium } from 'playwright'
import { createProject, onboard, tab } from '../tests/helpers.mjs'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const OUT = process.env.ITP_EXAMPLE_DIR ?? 'examples'
const SHOTS = '/tmp/itp-shots-examples'
const PLAN = process.env.ITP_PLAN_FIXTURE ?? '/tmp/itp-fixtures/plan.png'
const PHOTO = process.env.ITP_PHOTO_FIXTURE ?? '/tmp/itp-fixtures/photo.jpg'
const CLIENT_LOGO = process.env.ITP_CLIENT_LOGO ?? '/tmp/besix-watpac-wordmark.png'

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(SHOTS, { recursive: true })

const JOB = {
  name: 'Riverside Precinct — Building A',
  number: 'BW-24187',
  stage: 'LEVEL 3 — HYDRAULIC SERVICES',
  client: 'BESIX WATPAC',
  contractor: 'Axis Hydraulics',
  approvedBy: 'Darren Shoobridge',
  address: 'Example job — replace with the site address',
  marking: 'EXAMPLE ONLY',
}

const ME = { name: 'Darren Shoobridge', initials: 'DS', role: 'Hydraulic Supervisor', company: 'Axis Hydraulics' }

const SPECS = [
  {
    code: '016',
    file: 'ITP-016-Sanitary-Plumbing.pdf',
    area: 'Level 3 — Amenities and Riser',
    location: 'Level 3, Grid 4-7',
    documentNo: 'HYD-ITP-016-L3',
    materials: [
      'DWV PVC-U 100/65/50, WM-020458',
      'Solvent cement type P, Batch 24-0917',
      'Inspection openings, WM-020458',
      'Brackets and clips, Batch 24-0955',
      'Vent cowls, WM-021234',
    ],
    commentOn: /penetration|fire/i,
    comment: 'Fire collars installed by others to the tested system; penetrations witnessed and photographed before closing in.',
    release: { by: 'M. Hartley', company: 'BESIX WATPAC', role: 'Site Engineer', reference: 'INSP-3341' },
    region: 'Level 3 amenities — sanitary plumbing extent',
    pin: 'Stack SS-01 at grid 5, connection to Level 2 below',
  },
  {
    code: '023',
    file: 'ITP-023-Potable-Cold-Water.pdf',
    area: 'Level 3 — Cold Water Reticulation',
    location: 'Level 3, Grid 1-7',
    documentNo: 'HYD-ITP-023-L3',
    materials: [
      'Press copper Type B 40mm, WM-020017',
      'Press fittings, WM-020017',
      'PEX-b 25/20/16, WM-023119',
      'DZR isolation valves, WM-022118',
      'Insulation 25mm, Batch 24-1102',
    ],
    commentOn: /hydrostatic|pressure test/i,
    comment: 'Held with no measurable drop for the full period. Gauge calibration certificate on file with the test record.',
    release: { by: 'M. Hartley', company: 'BESIX WATPAC', role: 'Site Engineer', reference: 'INSP-3352' },
    region: 'Cold water reticulation, grid 1-7',
    pin: 'CW riser take-off, isolation valve CW-V03',
  },
  {
    code: '025',
    file: 'ITP-025-Hot-Water-Service.pdf',
    area: 'Roof Plant Room — HWU-01 and HWU-02',
    location: 'Roof level, Grid 6-8',
    documentNo: 'HYD-ITP-025-RPR',
    materials: [
      'Press copper Type B 50/40, WM-020017',
      'Tempering valves 50°C, WM-022640',
      'Expansion control valve, WM-022702',
      'Pipe insulation 25mm, Batch 24-0864',
      'Valves and unions, WM-022118',
    ],
    commentOn: /commission the heated water|delivery temperature/i,
    comment: 'Verified at the furthest ablution outlet after 60 seconds. Commissioning sheets attached to this ITP.',
    release: { by: 'M. Hartley', company: 'BESIX WATPAC', role: 'Site Engineer', reference: 'INSP-3368' },
    region: 'Roof plant room — hot water plant',
    pin: 'HWU-01 flow and return connections',
  },
  {
    code: '030',
    file: 'ITP-030-Sanitary-Fixtures-and-Tapware.pdf',
    area: 'Level 3 — Male and Female Amenities',
    location: 'Level 3, Grid 4-6',
    documentNo: 'HYD-ITP-030-L3',
    materials: [
      'WC pans 4 star, WM-024417',
      'Basin mixers 5 star, WM-024988',
      'Flexible connectors, WM-024102',
      'Fixture wastes and traps, WM-024310',
      'Sealant and fixings, Batch 24-1140',
    ],
    commentOn: /set.?out|fixture/i,
    comment: 'Set-out checked against architectural AR-3104 Rev C; accessible pan centreline confirmed at 450mm.',
    release: { by: 'M. Hartley', company: 'BESIX WATPAC', role: 'Site Engineer', reference: 'INSP-3390' },
    region: 'Level 3 amenities fixture zone',
    pin: 'WC pans 1-6 and vanity set out, female amenities',
  },
]

/**
 * A believable measured result for a record field, chosen from the unit the
 * template asks for. Identifier fields — serial numbers, certificate and permit
 * references — are deliberately left blank: inventing one would put a
 * credential that does not exist into a document that looks official.
 */
function recordValue(label) {
  const l = label.toLowerCase()
  if (/serial|certificate|agreement|job no|notification|reference|ref\.|consent|permit/.test(l)) return null
  if (/grade/.test(l)) return '1.65'
  if (/trap seal/.test(l)) return '50'
  if (/separation/.test(l)) return '100'
  if (/height/.test(l)) return '800'
  if (/deviation/.test(l)) return '3'
  // Hot water is the one place a single number has to respect two limits: 45 °C
  // at ablution fixtures, 60 °C stored for Legionella control.
  if (/stored.*return.*delivery/.test(l)) return '60 / 55 / 44.6'
  if (/delivery|ablution|point of connection/.test(l)) return '44.6'
  // The label is read from the rendered DOM, where CSS upper-cases it.
  const unit = ((label.match(/\(([^)]+)\)\s*$/) ?? [])[1] ?? '').toLowerCase()
  const byUnit = {
    kpa: '1500',
    hours: '24',
    minutes: '30',
    '°c': '60',
    'l/s': '2.5',
    'l/s @ kpa': '10 @ 350',
    l: '2000',
    '%': '100',
    mm: '100',
    'mm²': '20000',
    m: '1.2',
    'm ahd': '21.30',
    'mj/h': '250',
    'µs/cm': '15',
    ppm: '0.5',
  }
  // Nothing invented for a unit that is not understood — an empty cell is
  // honest, a made-up figure is not.
  return byUnit[unit] ?? null
}

const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') {
    problems.push(`console: ${m.text()}`)
    if (process.env.ITP_VERBOSE) console.log('  [console]', m.text())
  }
})

const pause = (ms) => page.waitForTimeout(ms)

/** Draws a plausible signature across a pad. */
async function sign(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await pause(250)
  const b = await locator.boundingBox()
  await page.mouse.move(b.x + 24, b.y + b.height * 0.72)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.22, b.y + b.height * 0.28, { steps: 8 })
  await page.mouse.move(b.x + b.width * 0.38, b.y + b.height * 0.78, { steps: 8 })
  await page.mouse.move(b.x + b.width * 0.54, b.y + b.height * 0.3, { steps: 8 })
  await page.mouse.move(b.x + b.width * 0.78, b.y + b.height * 0.6, { steps: 10 })
  await page.mouse.up()
  await pause(250)
}

/**
 * Adds a photo through the gallery button inside `scope`, the same way a file
 * arrives from the phone. Driving the hidden input directly does not reliably
 * fire the change handler here, and the file chooser is what a person uses.
 */
async function addPhoto(scope) {
  const before = await page.locator('.photo').count()
  const chooser = page.waitForEvent('filechooser')
  await scope.getByRole('button', { name: 'Add from gallery' }).first().click()
  await (await chooser).setFiles(PHOTO)
  await waitForPhoto(before)
}

/** Waits for a captured photo to actually land in the record. */
async function waitForPhoto(before) {
  try {
    await page.waitForFunction((n) => document.querySelectorAll('.photo').length > n, before, { timeout: 25000 })
  } catch (err) {
    await page.screenshot({ path: '/tmp/itp-shots-examples/photo-failed.png', fullPage: true })
    console.log('problems so far:', problems.slice(-5))
    const toast = await page.locator('.toast').allInnerTexts()
    console.log('photo did not land. toast:', JSON.stringify(toast), 'photos now:', await page.locator('.photo').count())
    throw err
  }
  await pause(300)
}

async function dragOnPlan(points) {
  const plan = page.locator('.planview')
  await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await pause(250)
  const box = await plan.boundingBox()
  const at = (p) => ({ x: box.x + box.width * p[0], y: box.y + box.height * p[1] })
  const first = at(points[0])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const p of points.slice(1)) {
    const q = at(p)
    await page.mouse.move(q.x, q.y, { steps: 10 })
  }
  await page.mouse.up()
  await pause(350)
}

/* ------------------------------------------------------------------ setup */

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await pause(600)

await onboard(page)
await createProject(page, { name: JOB.name, projectNumber: JOB.number, client: JOB.client, approvedBy: JOB.approvedBy, address: JOB.address })
await pause(800)

// Head contractor logo and the document marking.
await page.getByRole('button', { name: 'Edit' }).first().click()
await pause(500)
await page.locator('.sheet input[type=file]').first().setInputFiles(CLIENT_LOGO)
await pause(900)
await page.locator('label:has(span:text("Document marking")) input').fill(JOB.marking)
await page.screenshot({ path: path.join(SHOTS, '01-job-details.png'), fullPage: true })
await page.getByRole('button', { name: 'Save' }).last().click()
await pause(700)

// Who is signing.
await page.getByRole('link', { name: 'Settings', exact: true }).click()
await pause(400)
await page.getByPlaceholder('e.g. Murtaza Bahloli').fill(ME.name)
await page.getByPlaceholder('e.g. MB').fill(ME.initials)
await page.locator('label:has(span:text("Role")) input').fill(ME.role)
await page.locator('label:has(span:text("Company")) input').fill(ME.company)
await pause(400)
await sign(page.locator('.sigpad canvas').first())
await pause(500)

// One drawing, marked up per ITP.
await tab(page, 'Plans').click()
await pause(400)
await page.getByRole('button', { name: 'Add drawing' }).click()
await page.getByPlaceholder('e.g. HC-001').fill('HC-201')
await page.getByPlaceholder('e.g. ISSUE 4').fill('REV C')
await page.getByPlaceholder(/Below ground drainage/).fill('Level 3 hydraulic services — layout')
await page.locator('input[type=file]').setInputFiles(PLAN)
await pause(1400)
await page.getByRole('button', { name: 'Save drawing' }).click()
await pause(800)

/* ------------------------------------------------------------------- ITPs */

async function buildItp(spec) {
  console.log(`\n--- ITP ${spec.code}`)
  await tab(page, 'Controldoc').click()
  await pause(500)
  await page.getByRole('button', { name: /ITP register/ }).click()
  await page.getByPlaceholder(/Search the \d+/).fill(spec.code)
  await pause(400)
  await page
    .locator('.listitem')
    .filter({ has: page.locator('.listitem__num', { hasText: new RegExp(`^${spec.code}$`) }) })
    .first()
    .click()
  await pause(500)
  await page.getByPlaceholder(/North East Corner/).fill(spec.area)
  await page.getByPlaceholder(/Minus 1, Grid 10-12/).fill(spec.location)
  await page.locator('label:has(span:text("Document no.")) input').fill(spec.documentNo)
  await page.locator('label:has-text("HC-201") input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Raise ITP' }).click()
  await pause(1000)

  // --- Materials verified, with batch and WaterMark references.
  await page.getByRole('button', { name: /^Materials \(/ }).click()
  await pause(500)
  const cards = page.locator('.stack > .card:has(input[placeholder^="e.g. Batch"])')
  const materialCards = await cards.count()
  for (let i = 0; i < materialCards; i++) {
    const card = cards.nth(i)
    await card.getByRole('button', { name: 'Complies' }).click()
    await pause(120)
    await card.locator('input[placeholder^="e.g. Batch"]').fill(spec.materials[i] ?? spec.materials[spec.materials.length - 1])
    await pause(120)
  }
  console.log('materials verified:', materialCards)

  // --- Every schedule item signed, releasing hold points as they come up so
  //     the ones behind them are not blocked.
  await page.getByRole('button', { name: /^Schedule \(/ }).click()
  await pause(500)
  const itemCount = await page.locator('.itpitem').count()
  let released = 0
  let recorded = 0
  let commented = false
  for (let i = 0; i < itemCount; i++) {
    const item = page.locator('.itpitem').nth(i)
    await item.locator('.itpitem__head').click()
    await pause(260)

    const releaseBtn = item.getByRole('button', { name: /^Record (release|witness)$/ })
    if (await releaseBtn.count()) {
      await releaseBtn.first().click()
      await pause(450)
      await page.getByPlaceholder('Name').fill(spec.release.by)
      await page.locator('.sheet label:has(span:text("Company")) input').fill(spec.release.company)
      await page.locator('.sheet label:has(span:text("Role")) input').fill(spec.release.role)
      await page.locator('.sheet label:has(span:text("Reference no.")) input').fill(spec.release.reference)
      await sign(page.locator('.sheet .sigpad canvas'))
      await page.getByRole('button', { name: /^Record (release|witness)$/ }).last().click()
      await pause(600)
      released++
    }

    const record = item.locator('label:has(input[placeholder="Measured / recorded result"])')
    if (await record.count()) {
      const value = recordValue(await record.first().locator('span').first().innerText())
      if (value) {
        await record.first().locator('input').fill(value)
        recorded++
        await pause(120)
      }
    }

    // The comment belongs on the item it is about, not on a fixed row number.
    if (!commented && spec.commentOn.test(await item.locator('.itpitem__head').innerText())) {
      await item.locator('textarea').first().fill(spec.comment)
      commented = true
      await pause(200)
    }

    await item.getByRole('button', { name: 'Conforms' }).click()
    await pause(260)

    // Evidence on a couple of items, the way it is captured in the field.
    if (i === 0 || i === 2) await addPhoto(item)

    await item.locator('.itpitem__head').click()
    await pause(160)
  }
  console.log('items signed:', itemCount, '· hold/witness points released:', released, '· results recorded:', recorded)

  // --- The extent this ITP covers, and a located photo.
  await page.getByRole('button', { name: /^Plans \(/ }).click()
  await pause(900)
  await page.getByRole('button', { name: 'Box area' }).click()
  await pause(300)
  await dragOnPlan([[0.16, 0.24], [0.74, 0.66]])
  await page.locator('textarea').first().fill(spec.region)
  await page.getByRole('button', { name: 'Save highlight' }).click()
  await pause(800)

  await page.getByRole('button', { name: 'Drop pin' }).click()
  await pause(300)
  const plan = page.locator('.planview')
  await plan.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await pause(300)
  const pbox = await plan.boundingBox()
  await page.mouse.click(pbox.x + pbox.width * 0.42, pbox.y + pbox.height * 0.46)
  await pause(900)
  await page.locator('.sheet textarea').fill(spec.pin)
  await page.locator('.sheet textarea').blur()
  await pause(300)
  if (await page.locator('.sheet button:has-text("Add from gallery")').count()) {
    // The second input is the gallery one; the first carries `capture`, which a
    // headless browser has nothing to satisfy.
    await addPhoto(page.locator('.sheet'))
  }
  console.log('photos at pin:', await page.locator('.sheet .photo').count())
  await page.locator('.sheet__head .iconbtn').click()
  await pause(700)
  await page.screenshot({ path: path.join(SHOTS, `itp-${spec.code}-plan.png`), fullPage: true })

  // --- Signed off by the installer, then accepted by the head contractor.
  await page.getByRole('button', { name: 'Sign-off' }).click()
  await pause(600)
  await sign(page.locator('.sigpad canvas').first())
  await page.getByRole('button', { name: 'Sign off ITP' }).click()
  await pause(800)

  const clientName = page.locator('label:has(span:text("Name")) input').last()
  await clientName.fill(spec.release.by)
  await page.locator('label:has(span:text("Company")) input').last().fill(JOB.client)
  await sign(page.locator('.sigpad canvas').last())
  await page.getByRole('button', { name: 'Accept and close out' }).click()
  await pause(800)
  await page.screenshot({ path: path.join(SHOTS, `itp-${spec.code}-signoff.png`), fullPage: true })

  // --- Export.
  const dl = page.waitForEvent('download', { timeout: 60000 })
  await page.getByRole('button', { name: /Export PDF/ }).click()
  const download = await dl
  const target = path.join(OUT, spec.file)
  await download.saveAs(target)
  console.log('wrote', target, `${(fs.statSync(target).size / 1024).toFixed(0)} KB`)
}

const only = process.env.ITP_ONLY?.split(',')
for (const spec of SPECS) {
  if (only && !only.includes(spec.code)) continue
  await buildItp(spec)
}

await browser.close()
if (problems.length) {
  console.log('\nPROBLEMS:\n' + problems.join('\n'))
  process.exit(1)
}
console.log('\nAll example ITPs written to', OUT)
