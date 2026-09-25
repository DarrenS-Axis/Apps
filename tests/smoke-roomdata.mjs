// Room data and tech data submissions: an FF&E schedule imported from Excel
// (the sanitary & tapware schedule plus a room data sheet), an architectural
// FF&E plan scanned for the schedule's tags — rooms read from their name and
// number, each tag put in the room it sits in, a tag between two rooms asked
// about, a small room labelled outside its walls, and a 1:50 enlargement of
// rooms already on the plan not counted twice — then the room data schedule
// (PDF and Excel) and a sample submission form with its tech data attached.
//
// Everything is generated here: the workbook, the drawing and the tech data.
import { chromium } from 'playwright'
import { jsPDF } from 'jspdf'
import fs from 'node:fs'
import path from 'node:path'
import { createProject, onboard, tab } from './helpers.mjs'

const OUT = '/tmp/itp-shots-roomdata'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const errors = []
const check = (ok, message) => {
  if (!ok) errors.push(message)
}

/* ----------------------------------------------------------- fixtures */

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** A zip with every entry stored — enough for an .xlsx. */
function zip(files) {
  const local = []
  const central = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const nameBuf = Buffer.from(name)
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuf.length, 26)
    local.push(head, nameBuf, data)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, cd, end])
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

function sheetXml(rows) {
  const col = (i) => String.fromCharCode(65 + i)
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells
          .map((v, i) => {
            if (v === null || v === undefined || v === '') return ''
            const ref = `${col(i)}${r + 1}`
            return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
          })
          .join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`
}

/** Laid out like the office's: a sanitary & tapware schedule and a room data sheet. */
function scheduleXlsx() {
  const sanitary = [
    ['SANITARY & TAPWARE SCHEDULE'],
    [],
    ['Sample Ref.', 'Sanitary Code', 'Tapware Code', 'Quantity', 'Selection / Description', 'Colour / Finish'],
    ['SAF-HYD100', 'WC1', '', 1, 'WC - Ambulant\nCaroma Care 660 Ambulant suite', 'White'],
    ['SAF-HYD102', 'HB1', '', 4, 'Hand Basin - Clinical\nCaroma Care 600 wall basin, no tap hole', 'White'],
    ['SAF-HYD103', '', 'HB1 - Basin Mixer', 4, 'Basin Mixer - Surgeon\nEnware Aquablend SQX Surgeon Mixer', 'Chrome'],
    ['SAF-HYD104', 'HB2', '', 1, 'Hand Basin - Small Wall Mounted\nCaroma Luna one tap hole wall basin', 'White'],
    ['SAF-HYD105', '', 'HB2 - Basin Mixer', 1, 'Basin Mixer - Thermostatic\nEnware Aquablend SQX Thermostatic Basin Mixer', 'Chrome'],
    ['SAF-HYD108', 'SK1', '', 1, 'Sink - Standard Inset\nOliveri Apollo inset stainless steel sink', '304 S/S'],
    ['SAF-HYD109', '', 'SK1 - Mixer', 1, 'Sink Mixer\nEnware Safira single lever sink mixer', 'Chrome'],
    ['', 'TMV A', '', '', 'Thermostatic Mixing Valve\nEnware Aquablend 1500 recessed TMV', 'S/S'],
  ]
  const roomData = [
    ['HYDRAULIC FIXTURE SCHEDULE - ROOM DATA'],
    ['Sample Ref.', 'Room Type / Area', 'Room No.', 'Fixture', 'Code', 'Tapware Code', 'Quantity', 'In wall Items', 'Description', 'Colour / Finish'],
    ['', 'PROJECT WIDE - NOT ROOM SPECIFIC'],
    ['', '', '', 'Thermostatic Mixing Valve', 'TMV A', '', 'TBC', 'Recessed cabinet', 'Enware Aquablend 1500', 'S/S'],
    ['', 'Ground Floor'],
    ['', 'WC 01', 'G.01'],
    ['SAF-HYD100', '', '', 'WC - Ambulant', 'WC1', '', 1, '', 'Caroma Care 660', 'White'],
    ['SAF-HYD104', '', '', 'Hand Basin - Small', 'HB2', '', 1, '', 'Caroma Luna', 'White'],
    ['SAF-HYD105', '', '', 'Basin Mixer', '', 'HB2 - Basin Mixer', 1, '', 'Enware SQX', 'Chrome'],
    ['', 'CLEAN UTILITY', 'G.02'],
    ['SAF-HYD102', '', '', 'Hand Basin - Clinical', 'HB1', '', 2, '', 'Caroma Care 600', 'White'],
    ['SAF-HYD108', '', '', 'Sink - Standard Inset', 'SK1', '', 1, '', 'Oliveri Apollo', '304 S/S'],
  ]
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sanitary tapware schedule" sheetId="1" r:id="rId1"/><sheet name="Room data" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml(sanitary),
    'xl/worksheets/sheet2.xml': sheetXml(roomData),
  })
}

/**
 * An A3 FF&E plan. Walls in black, each room labelled with its name over its
 * number, schedule tags in the rooms, another trade's tag (GR1), a cleaner's
 * room labelled just outside its door-less walls, a basin between WC 01's
 * label and CLEAN UTILITY's walls, and a 1:50 enlargement of WC 01 and CLEAN
 * UTILITY off to the right with a WC1 of its own.
 */
function planPdf() {
  const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' })
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.8)
  const room = (x0, y0, x1, y1) => doc.rect(x0, y0, x1 - x0, y1 - y0)
  const label = (name, no, x, y) => {
    doc.setFontSize(7)
    doc.text(name, x, y, { align: 'center' })
    doc.text(no, x, y + 3, { align: 'center' })
  }
  const tag = (code, x, y) => {
    doc.setFontSize(6)
    doc.text(code, x, y, { align: 'center' })
  }
  // Main 1:100 view.
  room(30, 30, 80, 70) // WC 01
  room(80, 30, 150, 70) // CLEAN UTILITY
  room(150, 30, 210, 70) // OFFICE
  room(30, 70, 210, 90) // CORRIDOR
  room(30, 90, 54, 114) // CLEANER — closed, labelled outside
  label('WC 01', 'G.01', 65, 54)
  label('CLEAN UTILITY', 'G.02', 125, 44)
  label('OFFICE', 'G.04', 180, 49)
  label('CORRIDOR', 'G.03', 120, 79)
  label('CLEANER', 'G.05', 42, 118)
  tag('WC1', 50, 45)
  tag('HB2', 72, 40)
  tag('HB1', 125, 60)
  tag('SK1', 140, 38)
  tag('HB1', 84, 56) // over the wall from WC 01's label, inside CLEAN UTILITY
  tag('HB1', 140, 81)
  tag('HB1', 42, 102)
  tag('GR1', 190, 60) // another trade's
  // 1:50 enlargement of WC 01 and CLEAN UTILITY.
  room(280, 30, 320, 80)
  room(320, 30, 370, 80)
  label('WC 01', 'G.01', 300, 59)
  label('CLEAN UTILITY', 'G.02', 335, 59)
  tag('WC1', 295, 45)
  doc.setFontSize(8)
  doc.text('1 : 50 ENLARGEMENT', 280, 90)
  // Title block.
  doc.setFontSize(9)
  doc.text('GROUND FLOOR PLAN - FF&E', 300, 270)
  doc.text('A-02.11', 300, 278)
  doc.text('REV C', 340, 278)
  return Buffer.from(doc.output('arraybuffer'))
}

/** A one-page manufacturer's data sheet. */
function techDataPdf() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFontSize(18)
  doc.text('CAROMA CARE 600 WALL BASIN', 20, 30)
  doc.setFontSize(10)
  doc.text('Product data sheet — dimensions, installation and compliance', 20, 40)
  doc.rect(20, 50, 170, 90)
  return Buffer.from(doc.output('arraybuffer'))
}

const xlsxPath = path.join(OUT, 'S035 Room Data Hydraulic Fixture Schedule.xlsx')
fs.writeFileSync(xlsxPath, scheduleXlsx())
const planPath = path.join(OUT, 'A-02.11 Ground Floor FF&E.pdf')
fs.writeFileSync(planPath, planPdf())
const techPath = path.join(OUT, 'HB1 data sheet.pdf')
fs.writeFileSync(techPath, techDataPdf())

/* -------------------------------------------------------------- run */

const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource|favicon/i.test(m.text())) errors.push(`console: ${m.text()}`)
})

/** The room data straight from the local database. */
const readDb = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('hydraulic-itp')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['rooms', 'roomItems', 'ffeTypes', 'submissions'], 'readonly')
          const out = {}
          let left = 4
          for (const name of ['rooms', 'roomItems', 'ffeTypes', 'submissions']) {
            const r = tx.objectStore(name).getAll()
            r.onsuccess = () => {
              out[name] = r.result
              if (--left === 0) resolve(out)
            }
          }
        }
      }),
  )

const download = async (trigger) => {
  const wait = page.waitForEvent('download')
  await trigger()
  const d = await wait
  const file = path.join(OUT, d.suggestedFilename())
  await d.saveAs(file)
  return file
}

try {
  await page.goto(BASE)
  await onboard(page, { state: 'SA' })
  await createProject(page, { name: 'Nuclear Medicine Upgrade', client: 'Built' })
  check(await page.getByRole('link', { name: /Room data/ }).isVisible(), 'Project hub has no Room data card')
  await tab(page, 'Rooms').click()
  await page.waitForTimeout(500)
  check(await page.getByRole('button', { name: 'Scan architectural plan' }).isDisabled(), 'Scan is allowed before there is a schedule to look for')

  // 1. The FF&E schedule, with its room data.
  await page.getByRole('button', { name: 'Import FF&E schedule' }).click()
  await page.getByLabel('FF&E schedule file').setInputFiles(xlsxPath)
  await page.waitForTimeout(600)
  const summary = await page.locator('.sheet .banner--info').innerText()
  console.log('import:', summary)
  check(/5 fixtures and 3 tapware lines/.test(summary), `Schedule read wrong: ${summary}`)
  check(/2 rooms holding 5 fixtures/.test(summary), `Room data read wrong: ${summary}`)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.waitForTimeout(700)
  let data = await readDb()
  const hb1Mixer = data.ffeTypes.find((t) => t.code === 'HB1 - Basin Mixer')
  check(hb1Mixer?.kind === 'tapware' && hb1Mixer.goesWith.includes('HB1'), 'HB1 - Basin Mixer is not tied to HB1')
  check(data.ffeTypes.find((t) => t.code === 'HB1')?.scheduledQty === 4, 'HB1 scheduled quantity not read')
  check(data.roomItems.find((i) => i.code === 'TMV A')?.note === 'TBC', 'TBC quantity not kept as a note')

  // Importing again adds nothing.
  await page.getByRole('button', { name: 'Import FF&E schedule' }).click()
  await page.getByLabel('FF&E schedule file').setInputFiles(xlsxPath)
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.waitForTimeout(600)
  const again = await readDb()
  check(again.ffeTypes.length === data.ffeTypes.length && again.roomItems.length === data.roomItems.length, 'Re-import duplicated schedule lines or room items')

  // 2. Scan the architectural plan.
  await page.getByRole('button', { name: 'Scan architectural plan' }).click()
  await page.getByLabel('Architectural plan PDF').setInputFiles(planPath)
  await page.waitForSelector('.sheet .banner--ok', { timeout: 60000 })
  const scanned = await page.locator('.sheet .banner--ok').innerText()
  console.log('scan:', scanned)
  check(/^7 schedule tags in 4 rooms, of 5 rooms/.test(scanned), `Scan found the wrong tags or rooms: ${scanned}`)
  check(/1 more in a repeated enlargement/.test(scanned), `The 1:50 enlargement was counted: ${scanned}`)
  check(await page.getByText(/Other trades.*GR1 × 1/).isVisible(), 'Other trades’ tags not listed')
  check((await page.getByLabel('Drawing number').inputValue()) === 'A-02.11', `Drawing number read as ${await page.getByLabel('Drawing number').inputValue()}`)
  const flagged = page.locator('.sheet .card', { hasText: 'HB1 —' })
  const flaggedCount = await flagged.count()
  console.log('to confirm:', flaggedCount, (await flagged.allInnerTexts()).map((t) => t.split('\n')[0]).join(' | '))
  check(flaggedCount === 1, `Expected one tag to confirm, got ${flaggedCount}`)
  check(await flagged.first().getByRole('button', { name: /CLEAN UTILITY G\.02/ }).isVisible(), 'The room the walls suggest is not offered')
  check(await flagged.first().getByRole('button', { name: /WC 01 G\.01/ }).isVisible(), 'The room with the nearest label is not offered')
  await page.screenshot({ path: path.join(OUT, '1-scan.png'), fullPage: true })
  await flagged.first().getByRole('button', { name: /CLEAN UTILITY G\.02/ }).click()
  await page.getByRole('button', { name: /^Place 7 fixtures/ }).click()
  await page.waitForTimeout(1500)

  data = await readDb()
  const roomNo = Object.fromEntries(data.rooms.map((r) => [r.id, r.number]))
  const inRoom = (no, code) => data.roomItems.filter((i) => roomNo[i.roomId] === no && i.code === code).reduce((n, i) => n + i.qty, 0)
  check(data.rooms.length === 5, `Expected 5 rooms, got ${data.rooms.map((r) => r.number).join(', ')}`)
  check(inRoom('G.01', 'WC1') === 1 && inRoom('G.01', 'HB2') === 1, 'WC 01 fixtures counted twice or lost')
  check(inRoom('G.02', 'HB1') === 2 && inRoom('G.02', 'SK1') === 1, `CLEAN UTILITY should hold 2 × HB1 and SK1, has ${inRoom('G.02', 'HB1')} × HB1`)
  check(inRoom('G.03', 'HB1') === 1, 'Corridor basin not placed')
  check(inRoom('G.05', 'HB1') === 1, 'Cleaner’s basin not put in the room labelled outside its walls')
  const placed = data.roomItems.filter((i) => i.x !== undefined)
  check(placed.length === 7, `Expected 7 pinned fixtures, got ${placed.length}`)
  check(!data.roomItems.some((i) => i.check), 'A confirmed room is still flagged')
  check(data.rooms.find((r) => r.number === 'G.05')?.name === 'CLEANER', 'Cleaner room name not read')

  // Scanning the same sheet again places nothing twice.
  await page.getByRole('button', { name: 'Scan architectural plan' }).click()
  await page.getByLabel('Architectural plan PDF').setInputFiles(planPath)
  await page.waitForSelector('.sheet .banner--ok', { timeout: 60000 })
  await page.getByRole('button', { name: /^Place 7 fixtures/ }).click()
  await page.waitForTimeout(1200)
  check((await readDb()).roomItems.length === data.roomItems.length, 'Re-scanning the same sheet added fixtures')

  // No discrepancies left but the TMV that is not in a room yet.
  const banner = await page.locator('.banner--hold, .banner--warn').first().innerText().catch(() => '')
  console.log('checks:', banner)
  check(/1 thing to check before issue — 1 schedule item not placed\./.test(banner), `Unexpected checks: ${banner}`)

  // 3. A room: fixtures and the tapware that goes with them.
  await page.locator('.segmented').getByRole('button', { name: 'Rooms' }).click()
  await page.waitForTimeout(300)
  await page.locator('.listitem', { hasText: 'CLEAN UTILITY' }).first().click()
  await page.waitForTimeout(400)
  const roomSheet = await page.locator('.sheet').innerText()
  check(/HB1 - Basin Mixer/.test(roomSheet) && /SK1 - Mixer/.test(roomSheet), 'Room sheet does not list the tapware with its fixtures')
  await page.screenshot({ path: path.join(OUT, '2-room.png'), fullPage: true })
  await page.getByRole('button', { name: 'Close' }).first().click()
  await page.waitForTimeout(300)

  // 4. The plan with its pins, then the schedule exports.
  await page.locator('.segmented').getByRole('button', { name: 'Plan' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(OUT, '3-plan.png') })
  const pdfFile = await download(() => page.getByRole('button', { name: /Room data schedule PDF/ }).click())
  const pdfText = fs.readFileSync(pdfFile, 'latin1')
  check(/%PDF/.test(pdfText.slice(0, 8)), 'Room data PDF is not a PDF')
  const xlsxFile = await download(() => page.getByRole('button', { name: /Excel/ }).click())
  const xbuf = fs.readFileSync(xlsxFile)
  check(xbuf.readUInt32LE(0) === 0x04034b50, 'Excel export is not a zip')
  const xs = xbuf.toString('latin1')
  check(/CLEAN UTILITY/.test(xs) && /HB1 - Basin Mixer/.test(xs) && /Sanitary tapware schedule/.test(xs), 'Excel export is missing the room data or the schedule')

  // 5. A tech data submission for the clinical basin and its mixer.
  await page.locator('.segmented').getByRole('button', { name: /Submissions/ }).click()
  await page.getByRole('button', { name: 'New submission' }).click()
  await page.waitForTimeout(400)
  await page.locator('.sheet .chip-toggle', { hasText: /^HB1$/ }).click()
  await page.locator('.sheet .chip-toggle', { hasText: /^HB1 - Basin Mixer$/ }).click()
  check((await page.getByLabel('SC / ALA sample no.').inputValue()) === 'HYD-AXIS-SMP-001', 'Submission not numbered HYD-AXIS-SMP-001')
  const location = await page.getByLabel('Location').inputValue()
  check(/G\.02/.test(location) && /G\.03/.test(location) && /G\.05/.test(location), `Location not filled from the rooms: ${location}`)
  await page.getByLabel('Tech data files').setInputFiles(techPath)
  await page.waitForTimeout(600)
  await page.getByLabel('Architect status').selectOption('approved_comments')
  await page.screenshot({ path: path.join(OUT, '4-submission.png'), fullPage: true })
  const subPdf = await download(() => page.getByRole('button', { name: /^PDF$/ }).click())
  const pages = (fs.readFileSync(subPdf, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  check(pages === 2, `Submission PDF should be the form and the data sheet, got ${pages} pages`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(600)
  data = await readDb()
  const sub = data.submissions[0]
  check(sub?.number === 'HYD-AXIS-SMP-001' && sub.ffeTypeIds.length === 2 && sub.attachments.length === 1, 'Submission not saved with its items and tech data')
  check(sub?.reviews?.architect?.status === 'approved_comments', 'Architect’s response not saved')
  check(await page.getByText('Approved with comments').first().isVisible(), 'Submission status not shown in the list')

  // Draft one per sample reference: every other line gets its own.
  await page.getByRole('button', { name: 'Draft one per sample ref' }).click()
  await page.waitForTimeout(800)
  data = await readDb()
  console.log('submissions:', data.submissions.map((s) => `${s.number} ${s.title}`).join(', '))
  check(data.submissions.length === 6, `Expected 6 submissions (one per remaining sample ref), got ${data.submissions.length}`)
  await page.screenshot({ path: path.join(OUT, '5-submissions.png'), fullPage: true })
} catch (e) {
  errors.push(`threw: ${e.message}`)
  await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {})
}

await browser.close()
if (errors.length) {
  console.error('ROOM DATA FAILURES:\n - ' + errors.join('\n - '))
  process.exit(1)
}
console.log('room data smoke passed')
