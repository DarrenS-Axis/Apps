// Plant register: the AXIMSRG-03 register imported (and re-imported without
// duplicates), items tracked by photo and GPS — back at the Beverley yard
// they are available, out on a job they are on site — QR labels read by the
// live camera, from a photo, by typing and by a phone-camera link, a
// stocktake at the yard, and the labels, plant list and CSV exported.
//
// Everything is generated here: a register laid out like the real one, the
// QR codes (drawn into a fake camera feed and a PNG), and the positions.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import qrcode from 'qrcode-generator'
import { onboard } from './helpers.mjs'

const OUT = '/tmp/itp-shots-plant'
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

const serial = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000) + 25569
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** The register as the SA office keeps it: title, job list, notes, then the grid. */
function registerXlsx() {
  const rows = [
    [1, ['Axis Services Plant List']],
    [3, [null, 'Site Reference ']],
    [5, [null, 'Job Name : Mt Barker Hospital ']],
    [8, [null, 'Job Name : Edinburgh']],
    [14, ['SITE: The plant listed below will be brought onto site and operated under our control.']],
    [15, ['CALIBRATED EQUIPMENT: Equipment that requires calibration will be listed and inspections carried out.']],
    [17, ['Equipment Type', 'Brand and Model', 'Serial #', 'Location', 'Date off site', 'Calibration test', 'Last service or Test/ Tag', 'Axis No.', 'Date of Entry ']],
    [18, ['Rehau Tool Battery', 'RothenBurgh', null, 'Broken', null, { d: '2025-08-03' }, { d: '2022-11-03' }, 'AXP 80', { d: '2026-04-10' }]],
    [19, ['Laser (Line)', 'CPI 3TG', { n: 1247502 }, 'DESTROYED', null, null, { d: '2023-01-01' }, 'AXP 66', { d: '2026-03-07' }]],
    [20, ['Air Compressor', 'Ozito ', null, 'Yard', null, null, { d: '2026-09-01' }, 'AXP 180', { d: '2026-08-04' }]],
    [21, ['Drinking Fountain', null, null, 'Yard', null, 'No', null, null, { d: '2026-08-04' }]],
    [22, ['Drinking Fountain', null, null, 'Yard', null, 'No', null, null, { d: '2026-08-04' }]],
    [23, ['Drinking Fountain', null, null, 'Yard', null, 'No', null, null, { d: '2026-08-04' }]],
    [24, ['Hammer Drill', 'Hilti TE 30', 'H30-5521', 'Yard', null, 'No', { d: '2026-06-03' }, 'AXP 7084', { d: '2026-08-04' }]],
    [25, ['Printer', 'Brother', 'BR-7788', 'Office Only', null, null, null, 'AXIS', { d: '2026-08-04' }]],
    [26, ['HDPE Welder', 'Ritmo', 'RT-100', 'NWCH', null, 'No', 'Lendlea', 'Axis 3', { d: '2026-05-01' }]],
    [27, ['Pump', 'Grundfos', null, 'NWCH', null, null, null, null, { d: '2026-05-01' }]],
    [28, ['Jack Hammer', 'Makita HM1812', 'MK-1812', 'EDinburgh', null, null, null, 'Axis JH3', { d: '2026-08-04' }]],
    [29, ['Generator', 'Honda EU22i', 'EU22-01', 'Edinburgh', null, null, { d: '2026-06-03' }, 'Axis Gen 2', { d: '2026-08-04' }]],
  ]
  const col = (i) => String.fromCharCode(65 + i)
  const sheet = rows
    .map(([r, cells]) => {
      const cs = cells
        .map((v, i) => {
          if (v === null || v === undefined) return ''
          const ref = `${col(i)}${r}`
          if (typeof v === 'object' && 'd' in v) return `<c r="${ref}"><v>${serial(v.d)}</v></c>`
          if (typeof v === 'object' && 'n' in v) return `<c r="${ref}"><v>${v.n}</v></c>`
          return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
        })
        .join('')
      return `<row r="${r}">${cs}</row>`
    })
    .join('')
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  })
}

/** A QR code as a grid of dark modules. */
function qrGrid(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  return { n, dark: (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c) }
}

/** Greyscale PNG of a QR label on white. */
function qrPng(text, scale = 10) {
  const { n, dark } = qrGrid(text)
  const size = (n + 8) * scale
  const raw = Buffer.alloc((size + 1) * size, 255)
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0
    for (let x = 0; x < size; x++) if (dark(Math.floor(y / scale) - 4, Math.floor(x / scale) - 4)) raw[y * (size + 1) + 1 + x] = 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** A fake camera feed (Y4M) filmed pointing at a QR label. */
function qrY4m(text) {
  const W = 640
  const H = 480
  const { n, dark } = qrGrid(text)
  const scale = Math.floor(360 / (n + 8))
  const x0 = Math.floor((W - (n + 8) * scale) / 2)
  const y0 = Math.floor((H - (n + 8) * scale) / 2)
  const y = Buffer.alloc(W * H, 200)
  for (let py = 0; py < (n + 8) * scale; py++) {
    for (let px = 0; px < (n + 8) * scale; px++) {
      y[(y0 + py) * W + x0 + px] = dark(Math.floor(py / scale) - 4, Math.floor(px / scale) - 4) ? 16 : 235
    }
  }
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128)
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv])
  return Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame, frame])
}

const xlsxPath = path.join(OUT, 'AXIMSRG-03 Plant register.xlsx')
fs.writeFileSync(xlsxPath, registerXlsx())
// Register order numbers the items: SA-0003 is the air compressor, SA-0007 the hammer drill.
const cameraFeed = path.join(OUT, 'camera.y4m')
fs.writeFileSync(cameraFeed, qrY4m(`https://darrens-axis.github.io/Apps/#/plant/tag/SA-0003`))
const labelPhoto = path.join(OUT, 'label-SA-0008.png')
fs.writeFileSync(labelPhoto, qrPng(`${BASE}/#/plant/tag/SA-0008`))

/* -------------------------------------------------------------- run */

// Where things are: the Beverley office (as the address lookup finds it),
// and a job at Mt Barker nothing has been located at yet.
const OFFICE = { latitude: -34.8931, longitude: 138.5462 }
const MT_BARKER = { latitude: -35.0716, longitude: 138.8566 }

const browser = await chromium.launch({
  executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cameraFeed}`],
})
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  geolocation: { ...OFFICE, accuracy: 12 },
  permissions: ['geolocation', 'camera'],
  acceptDownloads: true,
})
// Steps that read a label some other way switch the camera off, or the
// fake feed (always showing SA-0003) would answer first.
await ctx.addInitScript(() => {
  if (localStorage.getItem('test:no-camera') && navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Camera off for this step', 'NotAllowedError'))
  }
})
const camera = async (on) => {
  await page.evaluate((v) => (v ? localStorage.removeItem('test:no-camera') : localStorage.setItem('test:no-camera', '1')), on)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
// The depot's address, looked up on OpenStreetMap, answered here.
let lookups = 0
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  lookups++
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: String(OFFICE.latitude), lon: String(OFFICE.longitude) }]) })
})
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })
const db = (store) =>
  page.evaluate(
    (s) =>
      new Promise((res) => {
        const r = indexedDB.open('hydraulic-itp')
        r.onsuccess = () => {
          const q = r.result.transaction(s).objectStore(s).getAll()
          q.onsuccess = () => res(q.result)
        }
      }),
    store,
  )
const byNo = async (no) => (await db('plant')).find((p) => p.plantNo === no)
const closeSheet = async () => {
  await page.locator('.sheet__head .iconbtn').last().click()
  await page.waitForTimeout(300)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await onboard(page, { state: 'SA' })

// A project for the Edinburgh job, so the register's "Edinburgh" lands on it.
await page.getByRole('button', { name: 'New project' }).first().click()
await page.getByPlaceholder('e.g. Liverpool Hospital').fill('Edinburgh RAAF Base')
await page.getByRole('button', { name: 'Create project' }).click()
await page.waitForTimeout(800)

await page.goto(`${BASE}/#/plant`)
await page.waitForTimeout(800)
check(await page.locator('.tabbar').getByRole('link', { name: 'Plant' }).isVisible(), 'No Plant tab')

// --- The seeded yard looks its address up.
const depots = await db('depots')
const beverley = depots.find((d) => d.id === 'dep_sa_beverley')
console.log('depot:', beverley?.name, beverley?.source, beverley?.lat, 'lookups', lookups)
check(beverley?.address === 'Unit 2/21 Alfred Ave, Beverley SA 5009', 'Beverley depot not seeded with the office address')
check(beverley?.source === 'address' && Math.abs(beverley.lat - OFFICE.latitude) < 1e-6, 'Depot position was not taken from the address lookup')
const units = await db('businessUnits')
check(units.some((u) => u.state === 'SA' && u.entity === 'Axis Services SA'), 'No SA business unit')

// --- Import the register.
await page.getByRole('button', { name: /Import register/ }).click()
await page.locator('.sheet input[type=file]').setInputFiles(xlsxPath)
await page.getByText(/items read from/).waitFor()
const preview = await page.locator('.sheet .banner').innerText()
const mapping = await page.locator('.sheet table.data tbody tr').allInnerTexts()
console.log('preview:', preview)
console.log('mapping:', mapping.join(' | ').replace(/\t/g, ' → '))
check(/12 items read/.test(preview) && /6 available/.test(preview) && /4 on site/.test(preview) && /1 out of service/.test(preview) && /1 disposed/.test(preview), 'Register preview counts wrong')
check(mapping.some((r) => /^Edinburgh\t2\tOn site · project Edinburgh RAAF Base/.test(r)), 'Edinburgh spellings not merged onto the project')
check(mapping.some((r) => /^Yard\t5\tAvailable · Yard at Beverley office & yard/.test(r)), 'Yard not mapped to the Beverley depot')
await shot('01-import-preview')
await page.getByRole('button', { name: /^Import 12 items/ }).click()
await page.locator('.toast', { hasText: '12 added' }).waitFor()
await page.waitForTimeout(400)
await shot('02-register')

let plant = await db('plant')
const nos = plant.map((p) => p.plantNo).sort()
console.log('numbers:', nos[0], '…', nos.at(-1))
check(plant.length === 12 && nos[0] === 'SA-0001' && nos.at(-1) === 'SA-0012', 'Items not numbered SA-0001…SA-0012')
const battery = plant.find((p) => p.axisNo === 'AXP 80')
check(battery?.status === 'out_of_service' && battery.lastTestAt === '2022-11-03' && battery.calibratedAt === '2025-08-03', 'Broken battery or its dates read wrong')
const welder = plant.find((p) => p.type === 'HDPE Welder')
check(welder?.status === 'on_site' && welder.location === 'NWCH' && welder.lastTestNote === 'Lendlea', 'NWCH welder read wrong')
const jack = plant.find((p) => p.type === 'Jack Hammer')
check(jack?.projectId && jack.location === 'Edinburgh RAAF Base', 'Edinburgh item not linked to the project')
const laser = plant.find((p) => p.type === 'Laser (Line)')
check(laser?.status === 'disposed' && laser.serial === '1247502', 'Destroyed laser read wrong')
const printer = plant.find((p) => p.type === 'Printer')
check(printer?.status === 'available' && printer.location === 'Office' && printer.depotId === 'dep_sa_beverley', 'Office printer read wrong')

// --- Re-import: same records, nothing added.
await page.getByRole('button', { name: /Import register/ }).click()
await page.locator('.sheet input[type=file]').setInputFiles(xlsxPath)
await page.getByText(/items read from/).waitFor()
await page.getByRole('button', { name: /^Import 12 items/ }).click()
await page.locator('.toast', { hasText: '0 added · 12 updated' }).waitFor()
check((await db('plant')).length === 12, 'Re-import duplicated items')

// --- Out on a job nobody has located yet: the app asks which job.
await ctx.setGeolocation({ ...MT_BARKER, accuracy: 8 })
await page.getByPlaceholder(/Search plant no/).fill('Hammer Drill')
await page.locator('.listitem').first().click()
await page.waitForTimeout(400)
await page.locator('.sheet input[aria-label="Photograph item"]').setInputFiles(labelPhoto)
await page.getByText(/Which job is it on/).waitFor({ timeout: 20000 })
await page.locator('.sheet label:has(span:text("Job")) select').selectOption({ label: 'Edinburgh RAAF Base' })
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(600)
let drill = await byNo('SA-0007')
console.log('drill on the job:', drill.status, drill.location, drill.lat?.toFixed(4), drill.history.at(-1).via)
check(drill.status === 'on_site' && drill.location === 'Edinburgh RAAF Base' && Math.abs(drill.lat - MT_BARKER.latitude) < 1e-6, 'Photo on a job did not put the drill on site')
check(drill.history.at(-1).via === 'photo' && drill.history.at(-1).photoId, 'The sighting did not keep its photo')
check((await db('photos')).some((p) => p.plantId === drill.id && p.lat !== undefined), 'Plant photo not stored with its position')
await shot('03-on-site')
await closeSheet()

// Now the job has a known position: the next item seen there is placed without asking.
await page.getByPlaceholder(/Search plant no/).fill('Air Compressor')
await page.locator('.listitem').first().click()
await page.waitForTimeout(400)
await page.locator('.sheet input[aria-label="Photograph item"]').setInputFiles(labelPhoto)
await page.getByText(/On site at Edinburgh RAAF Base/).waitFor({ timeout: 20000 })
check((await byNo('SA-0003')).status === 'on_site', 'Second item at the job not placed there automatically')
await closeSheet()

// --- Back at the yard: photographed at Beverley, it is available again.
await ctx.setGeolocation({ ...OFFICE, accuracy: 12 })
await page.getByPlaceholder(/Search plant no/).fill('Hammer Drill')
await page.locator('.listitem').first().click()
await page.waitForTimeout(400)
await page.locator('.sheet input[aria-label="Photograph item"]').setInputFiles(labelPhoto)
await page.getByText(/At Beverley office & yard/).waitFor({ timeout: 20000 })
drill = await byNo('SA-0007')
console.log('drill back:', drill.status, drill.location, drill.depotId)
check(drill.status === 'available' && drill.location === 'Yard' && drill.depotId === 'dep_sa_beverley' && !drill.projectId, 'Photo at the yard did not make the drill available')
await shot('04-back-at-yard')
await closeSheet()
await page.getByPlaceholder(/Search plant no/).fill('')

// --- The live camera reads a label (SA-0003, the compressor still on the job).
await page.getByRole('button', { name: 'Scan QR' }).click()
await page.getByRole('heading', { name: 'SA-0003 · Air Compressor' }).waitFor({ timeout: 20000 })
await page.getByText(/At Beverley office & yard/).waitFor({ timeout: 20000 })
const compressor = await byNo('SA-0003')
console.log('camera scan:', compressor.status, compressor.location, compressor.history.at(-1).via)
check(compressor.status === 'available' && compressor.history.at(-1).via === 'scan', 'Camera scan did not record the compressor at the yard')
await closeSheet()

// --- A photo of a label, for a phone that will not share its camera.
await camera(false)
await page.getByRole('button', { name: 'Scan QR' }).click()
await page.getByText(/camera is blocked/).waitFor()
await page.locator('.sheet input[aria-label="Photo of a QR label"]').setInputFiles(labelPhoto)
await page.getByRole('heading', { name: /^SA-0008 · / }).waitFor({ timeout: 20000 })
console.log('label photo opened SA-0008')
await closeSheet()

// --- A label not on the register yet: add it under that number.
await page.getByRole('button', { name: 'Scan QR' }).click()
await page.getByLabel('Plant number').fill('sa-0100')
await page.getByRole('button', { name: 'Go' }).click()
await page.getByText(/is not on the SA register/).waitFor()
await page.getByRole('button', { name: 'Add SA-0100' }).click()
await page.getByPlaceholder('e.g. Hammer Drill').fill('Pipe Laser')
await page.getByPlaceholder('e.g. Hilti TE 30').fill('Spectra DG613')
await page.getByRole('button', { name: 'Add to register' }).click()
await page.getByRole('heading', { name: 'SA-0100 · Pipe Laser' }).waitFor()
check((await byNo('SA-0100'))?.depotId === 'dep_sa_beverley', 'New labelled item not added at the yard')
await closeSheet()

// --- A phone's own camera opens the link printed on the label.
await ctx.setGeolocation({ ...MT_BARKER, accuracy: 8 })
await page.goto(`${BASE}/#/plant/tag/SA-0005`)
await page.getByRole('heading', { name: 'SA-0005 · Drinking Fountain' }).waitFor({ timeout: 20000 })
await page.getByText(/On site at Edinburgh RAAF Base/).waitFor({ timeout: 20000 })
check((await byNo('SA-0005')).status === 'on_site', 'Opening the label link did not record the sighting')
await closeSheet()

// --- Stocktake at the yard: scan what is there, list what is not.
await ctx.setGeolocation({ ...OFFICE, accuracy: 12 })
await camera(true)
await page.getByRole('button', { name: 'Stocktake', exact: true }).click()
await page.locator('.stocklist li', { hasText: 'SA-0003' }).waitFor({ timeout: 20000 })
const notScanned = page.locator('.sheet .banner', { hasText: /not scanned yet/ })
await notScanned.waitFor({ timeout: 10000 })
const missingText = await notScanned.innerText()
console.log('stocktake:', missingText.replace(/\s+/g, ' '))
await shot('05-stocktake')
const expected = (await db('plant')).filter((p) => p.depotId === 'dep_sa_beverley' && p.status === 'available' && p.plantNo !== 'SA-0003').length
check(new RegExp(`^${expected} items? the register has at Beverley`).test(missingText), `Stocktake should list ${expected} unscanned yard items`)
await notScanned.getByRole('button', { name: 'Mark them missing' }).click()
await notScanned.getByRole('button', { name: /^Mark \d+ missing/ }).click()
await page.waitForTimeout(600)
plant = await db('plant')
check(plant.filter((p) => p.status === 'missing').length === expected, 'Unscanned yard items not marked missing')
check(plant.find((p) => p.plantNo === 'SA-0003').status === 'available', 'The scanned item was marked missing')
await closeSheet()

// --- Labels, plant list and CSV.
await page.getByRole('button', { name: 'QR labels' }).click()
const labelDl = page.waitForEvent('download')
await page.locator('.sheet .row--end .btn').last().click()
const labels = await labelDl
const labelsPath = path.join(OUT, 'labels.pdf')
await labels.saveAs(labelsPath)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const readPdf = async (file) => {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts') + '/' }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((t) => t.str).join(' ') + '\n'
  return { text, pages: doc.numPages }
}
const labelPdf = await readPdf(labelsPath)
// SA-0100 came with its label and SA-0002 is written off: neither is reprinted.
check(/SA-0001/.test(labelPdf.text) && /SA-0012/.test(labelPdf.text) && !/SA-0100|SA-0002/.test(labelPdf.text) && /Axis Services SA/.test(labelPdf.text), 'Label sheet has the wrong items or no owner')
plant = await db('plant')
check(plant.filter((p) => p.status !== 'disposed').every((p) => p.labelPrintedAt), 'Printed labels not recorded')
console.log('labels pdf:', labelPdf.pages, 'page(s)')

await page.locator('select[aria-label="Location"]').selectOption({ value: 'Edinburgh RAAF Base' })
const listDl = page.waitForEvent('download')
await page.getByRole('button', { name: 'Plant list PDF' }).click()
const listPath = path.join(OUT, 'plant-list.pdf')
await (await listDl).saveAs(listPath)
const list = await readPdf(listPath)
check(/Plant & Equipment Register/.test(list.text) && /Jack Hammer/.test(list.text) && !/Printer/.test(list.text), 'Plant list PDF not filtered to the job')
await page.locator('select[aria-label="Location"]').selectOption({ value: '' })
await page.locator('select[aria-label="Show"]').selectOption('all')

const csvDl = page.waitForEvent('download')
await page.getByRole('button', { name: /Excel \(CSV\)/ }).click()
const csvPath = path.join(OUT, 'plant.csv')
await (await csvDl).saveAs(csvPath)
const csv = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/)
console.log('csv:', csv.length - 1, 'rows;', csv[0].slice(0, 80))
check(csv[0].startsWith('Equipment Type,Brand and Model,Serial #,Location') && csv.length === 14, 'CSV export shape wrong')

// The CSV goes back in without adding anything, and keeps what was seen since.
const drillBefore = await byNo('SA-0007')
await page.getByRole('button', { name: /Import register/ }).click()
await page.locator('.sheet input[type=file]').setInputFiles(csvPath)
await page.getByText(/items read from/).waitFor()
await page.getByRole('button', { name: /^Import 13 items/ }).click()
await page.locator('.toast', { hasText: '0 added · 13 updated' }).waitFor()
const drillAfter = await byNo('SA-0007')
check(drillAfter.status === drillBefore.status && drillAfter.location === drillBefore.location && drillAfter.history.length === drillBefore.history.length, 'Re-importing the CSV moved a sighted item')

// --- Yards & offices: set the yard to where the phone is.
await page.getByRole('button', { name: 'Yards & offices' }).click()
await page.getByRole('button', { name: /use my location/ }).first().click()
await page.getByText(/set on site/).waitFor()
check((await db('depots')).find((d) => d.id === 'dep_sa_beverley').source === 'device', 'Depot not set from the device')
await shot('06-depots')

await browser.close()
// Only this suite's own noise: nothing expected.
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Plant register check passed.')
process.exit(errors.length ? 1 : 0)
