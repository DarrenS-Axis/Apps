import { db, now, uid } from '../data/db'
import { formatPlantNo, plantNoPattern } from '../data/plant'
import type { Depot, PlantItem, PlantStatus, Project, StateCode } from '../data/types'
import { PLANT_STATUS_LABEL } from '../data/types'
import type { Sheet } from './xlsx'

/**
 * Reads the AXIMSRG-03 Plant & Equipment Register — "Axis Services Plant
 * List": a title block, the job references, the site and calibration notes,
 * then a grid headed Equipment Type · Brand and Model · Serial # · Location ·
 * Date off site · Calibration test · Last service or Test/Tag · Axis No. ·
 * Date of Entry. The header row is found by its text, not its position, so
 * a re-issued register with an extra note above still reads. The app's own
 * CSV export reads back through the same path.
 */

export interface PlantRow {
  /** Spreadsheet row, 1-based, for messages. */
  row: number
  plantNo?: string
  type: string
  brandModel: string
  serial: string
  axisNo?: string
  /** Location column as written. */
  locationText: string
  status: PlantStatus
  location: string
  /** 'depot' when the register says Yard / Office. */
  place: 'depot' | 'site' | 'none'
  dateOffSite?: string
  calibration?: string
  calibratedAt?: string
  lastTestAt?: string
  lastTestNote?: string
  enteredAt?: string
  notes?: string
}

export interface ParsedRegister {
  sheet: string
  rows: PlantRow[]
  /** Location text → how many rows, as read. */
  locations: [string, number][]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()

const HEADERS: Record<string, RegExp> = {
  type: /^(equipment type|equipment|item|description|type)$/,
  brandModel: /^(brand and model|brand model|brand|make and model|model)$/,
  serial: /^(serial #|serial|serial no|serial number|s n)$/,
  location: /^(location|current location)$/,
  dateOffSite: /^(date off site|off site)$/,
  calibration: /^(calibration test|calibration|calibrated)$/,
  lastTest: /^(last service or test tag|last service|test tag|last test tag|last service or test)$/,
  axisNo: /^(axis no|axis number|axis #|asset no|asset number|tag no)$/,
  enteredAt: /^(date of entry|entered|date entered)$/,
  plantNo: /^(plant no|plant number|register no)$/,
  status: /^status$/,
  notes: /^(notes|comments)$/,
}

/** Excel stores dates as days since 1899-12-30; the export writes ISO. */
export function cellDate(v: string): string | undefined {
  const s = v.trim()
  if (!s) return undefined
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10)
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return undefined
}

/** The Location column says where an item is, or that it is broken or gone. */
export function readLocation(text: string): { status: PlantStatus; location: string; place: PlantRow['place']; note?: string } {
  const t = text.trim()
  const n = t.toLowerCase()
  if (!t) return { status: 'available', location: '', place: 'none' }
  if (/^(yard|depot|store|warehouse|workshop)\b/.test(n)) return { status: 'available', location: 'Yard', place: 'depot' }
  if (/\boffice\b/.test(n)) return { status: 'available', location: 'Office', place: 'depot' }
  if (/\b(broken|faulty|u\/s|unserviceable|repair|tagged out|out of service)\b/.test(n))
    return { status: 'out_of_service', location: '', place: 'none', note: `Register location: ${t}` }
  if (/\b(destroyed|disposed|scrapped|written off|write off|sold)\b/.test(n))
    return { status: 'disposed', location: '', place: 'none', note: `Register location: ${t}` }
  if (/\b(missing|lost|stolen)\b/.test(n)) return { status: 'missing', location: '', place: 'none', note: `Register location: ${t}` }
  return { status: 'on_site', location: t, place: 'site' }
}

export function parsePlantRegister(sheets: Sheet[]): ParsedRegister {
  for (const sheet of sheets) {
    const headerIndex = sheet.rows.findIndex((r) => r.some((c) => HEADERS.type.test(norm(c))) && r.some((c) => HEADERS.location.test(norm(c)) || HEADERS.serial.test(norm(c))))
    if (headerIndex < 0) continue
    const header = sheet.rows[headerIndex].map(norm)
    const col = (key: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[key].test(h))
    const c = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, col(k as keyof typeof HEADERS)])) as Record<keyof typeof HEADERS, number>
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')

    // Job names are written a few ways ("Edinburgh", "EDinburgh"); the most
    // common spelling wins so the register does not split one job in two.
    const spellings = new Map<string, Map<string, number>>()
    const rows: PlantRow[] = []
    for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i]
      const type = get(r, c.type)
      if (!type) continue
      const locationText = get(r, c.location)
      const statusText = get(r, c.status)
      let where = readLocation(locationText)
      // Our own export carries a Status column; it outranks the location wording.
      const status = (Object.entries(PLANT_STATUS_LABEL).find(([, label]) => label.toLowerCase() === statusText.toLowerCase())?.[0] ?? '') as PlantStatus | ''
      if (status) where = { ...where, status, place: status === 'available' ? 'depot' : where.place, location: status === 'available' || status === 'on_site' ? locationText : where.location }
      const calibrationRaw = get(r, c.calibration)
      const calibratedAt = cellDate(calibrationRaw)
      const testRaw = get(r, c.lastTest)
      const lastTestAt = cellDate(testRaw)
      const axisNo = get(r, c.axisNo)
      const row: PlantRow = {
        row: i + 1,
        plantNo: get(r, c.plantNo) || undefined,
        type,
        brandModel: get(r, c.brandModel),
        serial: get(r, c.serial),
        axisNo: axisNo || undefined,
        locationText,
        status: where.status,
        location: where.location,
        place: where.place,
        dateOffSite: cellDate(get(r, c.dateOffSite)),
        calibration: calibratedAt ? 'Yes' : calibrationRaw || undefined,
        calibratedAt,
        lastTestAt,
        lastTestNote: !lastTestAt && testRaw && !/^[`'.\s-]*$/.test(testRaw) ? testRaw : undefined,
        enteredAt: cellDate(get(r, c.enteredAt)),
        notes: [where.note, get(r, c.notes)].filter(Boolean).join(' · ') || undefined,
      }
      if (row.place === 'site') {
        const key = row.location.toLowerCase().replace(/\s+/g, ' ')
        const m = spellings.get(key) ?? new Map<string, number>()
        m.set(row.location, (m.get(row.location) ?? 0) + 1)
        spellings.set(key, m)
      }
      rows.push(row)
    }
    // Ties go to the tidier spelling: "Edinburgh" over "EDinburgh".
    const oddCaps = (s: string) => (s.match(/(?<=[A-Za-z])[A-Z]/g) ?? []).length
    const canonical = new Map([...spellings].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1] || oddCaps(a[0]) - oddCaps(b[0]))[0][0]]))
    for (const row of rows) {
      if (row.place === 'site') row.location = canonical.get(row.location.toLowerCase().replace(/\s+/g, ' ')) ?? row.location
    }
    const counts = new Map<string, number>()
    for (const row of rows) {
      const label = row.place === 'site' ? row.location : row.locationText || '(blank)'
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return { sheet: sheet.name, rows, locations: [...counts].sort((a, b) => b[1] - a[1]) }
  }
  throw new Error('No plant register found — expected a header row with "Equipment Type" and "Location".')
}

/** The same physical item on a re-issued register. */
const identity = (x: { type: string; brandModel: string; serial: string; axisNo?: string }) =>
  [x.type, x.brandModel, x.serial, x.axisNo ?? ''].map(norm).join('|')

/** A job named on the register, matched to a project in the app when one fits. */
export function matchProject(location: string, projects: Project[]): Project | undefined {
  const l = norm(location)
  if (l.length < 3) return undefined
  return (
    projects.find((p) => norm(p.name) === l) ??
    projects.find((p) => {
      const n = norm(p.name)
      return (l.length >= 4 && n.includes(l)) || (n.length >= 4 && l.includes(n)) || (p.projectNumber && norm(p.projectNumber) === l)
    })
  )
}

export interface ImportSummary {
  added: number
  updated: number
  /** Updated register details but kept the place, because the item has been seen since. */
  keptPlace: number
}

/**
 * Brings the register in. Items already on it — matched by type, brand,
 * serial and Axis No., one for one, so thirty-nine identical drinking
 * fountains land on the same thirty-nine records — are updated in place;
 * the rest are added and numbered in register order. An item that has been
 * photographed or scanned since keeps the place that sighting gave it: the
 * spreadsheet is older news than the phone.
 */
export async function importPlantRows(state: StateCode, rows: PlantRow[], by?: string): Promise<ImportSummary> {
  const summary: ImportSummary = { added: 0, updated: 0, keptPlace: 0 }
  const depots = (await db.depots.where('state').equals(state).toArray()) as Depot[]
  const depot = depots[0]
  const projects = (await db.projects.where('state').equals(state).toArray()).filter((p) => !p.archived)
  await db.transaction('rw', db.plant, async () => {
    const existing = await db.plant.where('state').equals(state).toArray()
    const pool = new Map<string, PlantItem[]>()
    for (const item of existing.sort((a, b) => a.plantNo.localeCompare(b.plantNo))) {
      const k = identity(item)
      pool.set(k, [...(pool.get(k) ?? []), item])
    }
    const byNo = new Map(existing.map((i) => [i.plantNo.toUpperCase(), i]))
    const re = plantNoPattern(state)
    let next = existing.reduce((m, i) => Math.max(m, Number(re.exec(i.plantNo)?.[1] ?? 0)), 0)
    const t = now()
    const adds: PlantItem[] = []
    for (const row of rows) {
      const project = row.place === 'site' ? matchProject(row.location, projects) : undefined
      const place = {
        status: row.status,
        location: row.place === 'depot' ? row.location : row.place === 'site' ? (project?.name ?? row.location) : '',
        depotId: row.place === 'depot' ? depot?.id : undefined,
        projectId: project?.id,
      }
      const details = {
        type: row.type,
        brandModel: row.brandModel,
        serial: row.serial,
        axisNo: row.axisNo,
        calibration: row.calibration,
        calibratedAt: row.calibratedAt,
        lastTestAt: row.lastTestAt,
        lastTestNote: row.lastTestNote,
        dateOffSite: row.dateOffSite,
        enteredAt: row.enteredAt,
      }
      const match = (row.plantNo && byNo.get(row.plantNo.toUpperCase())) || pool.get(identity(row))?.shift()
      if (match) {
        if (row.plantNo) {
          const list = pool.get(identity(match))
          if (list) pool.set(identity(match), list.filter((i) => i.id !== match.id))
        }
        const seen = Boolean(match.seenAt)
        const moved = !seen && (match.status !== place.status || match.location !== place.location)
        await db.plant.update(match.id, {
          ...details,
          notes: match.notes || row.notes,
          ...(seen ? {} : place),
          history: moved ? [...match.history, { at: t, by, ...place, via: 'import', note: 'Re-imported from the plant register' }] : match.history,
          updatedAt: t,
        })
        summary.updated++
        if (seen) summary.keptPlace++
        continue
      }
      next += 1
      const plantNo = row.plantNo && re.test(row.plantNo) && !byNo.has(row.plantNo.toUpperCase()) ? row.plantNo.toUpperCase() : formatPlantNo(state, next)
      const n = Number(re.exec(plantNo)?.[1] ?? next)
      next = Math.max(next, n)
      const item: PlantItem = {
        id: uid('plt'),
        state,
        plantNo,
        ...details,
        ...place,
        notes: row.notes,
        history: [{ at: t, by, ...place, via: 'import', note: `Imported from the plant register (row ${row.row})` }],
        createdAt: t,
        updatedAt: t,
      }
      byNo.set(plantNo.toUpperCase(), item)
      adds.push(item)
    }
    if (adds.length) await db.plant.bulkAdd(adds)
    summary.added = adds.length
  })
  return summary
}

/* --------------------------------------------------------------- export */

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The register as CSV, in the spreadsheet's own column order with the
 * tracking columns after — so it opens in Excel next to the old register and
 * imports straight back.
 */
export function plantCsv(items: PlantItem[], projectsById: Map<string, Project>): string {
  const head = [
    'Equipment Type',
    'Brand and Model',
    'Serial #',
    'Location',
    'Date off site',
    'Calibration test',
    'Last service or Test/ Tag',
    'Axis No.',
    'Date of Entry',
    'Plant No.',
    'Status',
    'Last seen',
    'Seen by',
    'Latitude',
    'Longitude',
    'Project',
    'Notes',
  ]
  const lines = [head.map(csvCell).join(',')]
  for (const i of items) {
    lines.push(
      [
        i.type,
        i.brandModel,
        i.serial,
        i.location,
        i.dateOffSite,
        i.calibratedAt ?? i.calibration,
        i.lastTestAt ?? i.lastTestNote,
        i.axisNo,
        i.enteredAt,
        i.plantNo,
        PLANT_STATUS_LABEL[i.status],
        i.seenAt ? new Date(i.seenAt).toISOString().replace('T', ' ').slice(0, 16) : '',
        i.seenBy,
        i.lat?.toFixed(6),
        i.lng?.toFixed(6),
        i.projectId ? (projectsById.get(i.projectId)?.name ?? '') : '',
        i.notes,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}
