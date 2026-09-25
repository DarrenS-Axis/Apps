import { db, now, uid } from '../data/db'
import type { FfeType, Room, RoomItem, Submission } from '../data/types'
import type { Sheet } from './xlsx'

/**
 * Room data: the FF&E schedule (what each code is), the rooms (from the
 * architectural drawings), and what is in each room — turned into the
 * Hydraulic Fixture Schedule – Room Data the way the office lays it out:
 * room by room, each fixture followed by the tapware that goes with it.
 */

/* ------------------------------------------------------------- import */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export interface ParsedType {
  code: string
  kind: FfeType['kind']
  goesWith: string[]
  name: string
  description: string
  finish: string
  sampleRef: string
  scheduledQty?: number
  inWall?: string
}

export interface ParsedRoomData {
  rooms: { number: string; name: string; level?: string }[]
  /** Fixtures per room (tapware follows from the schedule). Room number empty for project-wide lines. */
  items: { roomNumber: string; code: string; qty: number; note?: string }[]
}

export interface ParsedWorkbook {
  types: ParsedType[]
  roomData?: ParsedRoomData
  sheets: string[]
}

/** "Hand Basin - Clinical\nCaroma Care 600 …" → name and description. */
function splitDescription(text: string): { name: string; description: string } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length <= 1) return { name: lines[0] ?? '', description: '' }
  return { name: lines[0], description: lines.slice(1).join('\n') }
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ')

/** A heading row: a code column and a description column. */
const CODE_HEAD = /code|^\s*(ref|mark|tag|type)\.?\s*$/i
const DESC_HEAD = /descr|selection|^\s*(item|product)\s*$/i
export const isFfeHeader = (cells: string[]): boolean => cells.some((c) => CODE_HEAD.test(c)) && cells.some((c) => DESC_HEAD.test(c))

/**
 * For a schedule read from a PDF: does this line start a row, or carry on the
 * one above? A row starts with a sample ref, a code, a room number or a
 * quantity. A line with only a room type / area is a heading ("Ground Floor")
 * after fixture rows, but the second line of a wrapped room name after a room.
 */
export function ffeStartsRow(cells: string[], header: string[], prev: string[] | undefined): boolean {
  if (!prev) return true
  const head = header.map(norm)
  const has = (row: string[], re: RegExp) => head.some((h, i) => re.test(h) && (row[i] ?? '').trim() !== '')
  if (has(cells, /^sample ref|code$|^code|^ref$|^mark$|^tag$|^room no|quantit|^qty/)) return true
  const area = /^room type|^area/
  const onlyArea = has(cells, area) && head.every((h, i) => area.test(h) || !(cells[i] ?? '').trim())
  if (onlyArea) return has(prev, /code/)
  return false
}

/** "HB1 - Basin Mixer" → "HB1". */
export const tapwareParent = (code: string): string => code.split(/\s[-–]\s/)[0].trim()

/**
 * Reads an FF&E schedule workbook. Two layouts are recognised by their
 * headings: the Sanitary & Tapware Schedule (Sample Ref · Sanitary Code ·
 * Tapware Code · Quantity · Selection / Description · Colour / Finish) and the
 * Room Data schedule (Sample Ref · Room Type / Area · Room No. · Fixture · Code
 * · Tapware Code · Quantity · In wall Items · Description · Colour / Finish).
 * A workbook with both — like the office's — gives the schedule and the rooms.
 */
export function parseFfeWorkbook(sheets: Sheet[]): ParsedWorkbook {
  const types = new Map<string, ParsedType>()
  let roomData: ParsedRoomData | undefined
  const used: string[] = []
  const add = (t: ParsedType) => {
    const key = t.code.toUpperCase()
    const had = types.get(key)
    // The sanitary schedule wins over a room-data line for the same code; a room-data line fills gaps.
    if (!had) types.set(key, t)
    else for (const k of Object.keys(t) as (keyof ParsedType)[]) if (!had[k] && t[k]) (had as unknown as Record<string, unknown>)[k] = t[k]
  }

  for (const sheet of sheets) {
    const headerAt = sheet.rows.findIndex(isFfeHeader)
    if (headerAt < 0) continue
    const head = sheet.rows[headerAt].map(norm)
    const col = (re: RegExp) => head.findIndex((h) => re.test(h))
    const c = {
      ref: col(/^sample ref/),
      sanitary: col(/^sanitary code|^fixture code/),
      code: col(/^(code|ref|mark|tag|type|item code|ffe code|type code)$/),
      tap: col(/^tapware code/),
      qty: col(/quantit|^qty|^scheduled?$/),
      desc: col(/descr|selection/),
      finish: col(/colour|finish/),
      room: col(/^room no/),
      area: col(/^room type|^area/),
      fixture: col(/^fixture$/),
      inWall: col(/in wall/),
      item: col(/^(item|name|product name|fixture type)$/),
      maker: col(/manufactur|^brand|^supplier/),
      model: col(/^model|product code|catalogue|^cat no/),
    }
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
    const isRoomData = c.room >= 0
    used.push(sheet.name)

    if (!isRoomData) {
      let order = types.size
      for (const r of sheet.rows.slice(headerAt + 1)) {
        let fixture = get(r, c.sanitary >= 0 ? c.sanitary : c.code).replace(/\n/g, ' ')
        let tap = get(r, c.tap).replace(/\n/g, ' ')
        const desc = get(r, c.desc)
        if (!fixture && !tap) continue
        if (/total/i.test(fixture + tap) && !desc) continue
        // Notes and headings under the table are not codes, nor are row numbers.
        if ((fixture || tap).length > 30 || !/[A-Za-z]/.test(fixture || tap) || /:$|^notes?\b|^general\b|^refer\b|^total\b/i.test(fixture || tap)) continue
        // One code column: "HB1 - Basin Mixer" is the tapware that goes with HB1.
        if (c.tap < 0 && /\s[-–]\s/.test(fixture)) {
          tap = fixture
          fixture = ''
        }
        const item = get(r, c.item).replace(/\n/g, ' ')
        const split = splitDescription(desc)
        const name = item || split.name
        const product = [get(r, c.maker), get(r, c.model)].filter(Boolean).join(' ').replace(/\n/g, ' ')
        const description = [item ? desc : split.description, product].filter(Boolean).join('\n')
        if (!name && !description) continue
        const qty = Number(get(r, c.qty))
        add({
          code: fixture || tap,
          kind: fixture ? 'fixture' : 'tapware',
          goesWith: fixture ? [] : [tapwareParent(tap)],
          name,
          description,
          finish: oneLine(get(r, c.finish)),
          sampleRef: oneLine(get(r, c.ref)),
          scheduledQty: Number.isFinite(qty) && qty > 0 ? qty : undefined,
        })
        order++
      }
      continue
    }

    // Room data: room headers, section headers, then item rows under each room.
    const rooms: ParsedRoomData['rooms'] = []
    const items: ParsedRoomData['items'] = []
    let room: string | null = null
    let level: string | undefined
    for (const r of sheet.rows.slice(headerAt + 1)) {
      // A PDF's wrapped cells come back with line breaks; names and codes are one line.
      const one = (i: number) => get(r, i).replace(/\s*\n\s*/g, ' ')
      const area = one(c.area)
      const no = one(c.room).replace(/\s+/g, '')
      const code = one(c.code)
      const tap = one(c.tap)
      const fixtureName = one(c.fixture)
      if (area && no) {
        room = no
        rooms.push({ number: no, name: area, level })
        continue
      }
      if (area && !code && !tap && !fixtureName) {
        // "Ground Floor" is a level; "PROJECT WIDE…" starts the project-wide lines.
        if (/project wide|not room/i.test(area)) room = ''
        else {
          level = area
          room = null
        }
        continue
      }
      if (!code && !tap) continue
      if (/^total\b/i.test(code || tap)) continue
      const { name, description } = splitDescription(get(r, c.desc))
      add({
        code: code || tap,
        kind: code ? 'fixture' : 'tapware',
        goesWith: code ? [] : [tapwareParent(tap)],
        name: fixtureName || name,
        description: fixtureName ? [name, description].filter(Boolean).join('\n') : description,
        finish: oneLine(get(r, c.finish)),
        sampleRef: oneLine(get(r, c.ref)),
        inWall: get(r, c.inWall) || undefined,
      })
      if (code && room !== null) {
        const q = Number(get(r, c.qty))
        // "TBC" and blanks stay as a note with no quantity, for someone to settle.
        const counted = Number.isFinite(q) && q > 0
        items.push({ roomNumber: room, code, qty: counted ? q : 0, note: counted ? undefined : get(r, c.qty) || 'TBC' })
      }
    }
    if (rooms.length || items.length) roomData = { rooms: [...(roomData?.rooms ?? []), ...rooms], items: [...(roomData?.items ?? []), ...items] }
  }
  if (!types.size) throw new Error('No FF&E schedule found — expected columns such as "Sanitary Code" or "Code", and "Description".')
  return { types: [...types.values()], roomData, sheets: used }
}

/** Brings a parsed schedule in: codes already there are updated, new ones added. */
export async function importFfe(projectId: string, parsed: ParsedWorkbook, withRooms: boolean): Promise<{ types: number; rooms: number; items: number }> {
  let roomsAdded = 0
  let itemsAdded = 0
  await db.transaction('rw', db.ffeTypes, db.rooms, db.roomItems, async () => {
    const existing = await db.ffeTypes.where('projectId').equals(projectId).toArray()
    const byCode = new Map(existing.map((t) => [t.code.toUpperCase(), t]))
    let order = existing.reduce((m, t) => Math.max(m, t.order), -1)
    for (const t of parsed.types) {
      const had = byCode.get(t.code.toUpperCase())
      if (had) await db.ffeTypes.update(had.id, { ...t, updatedAt: now() })
      else await db.ffeTypes.add({ ...t, id: uid('ffe'), projectId, order: ++order, createdAt: now(), updatedAt: now() })
    }
    if (!withRooms || !parsed.roomData) return
    const rooms = await db.rooms.where('projectId').equals(projectId).toArray()
    const roomByNo = new Map(rooms.map((r) => [r.number.toUpperCase(), r]))
    for (const r of parsed.roomData.rooms) {
      if (roomByNo.has(r.number.toUpperCase())) continue
      const room: Room = { id: uid('room'), projectId, number: r.number, name: r.name, level: r.level, createdAt: now(), updatedAt: now() }
      await db.rooms.add(room)
      roomByNo.set(r.number.toUpperCase(), room)
      roomsAdded++
    }
    // Items already imported for a room are not added twice, and fixtures
    // already pinned there from the plan count towards the room's quantity.
    const current = await db.roomItems.where('projectId').equals(projectId).toArray()
    const have = new Set(current.filter((i) => i.source === 'import').map((i) => `${i.roomId ?? ''}|${i.code.toUpperCase()}`))
    const placed = new Map<string, number>()
    for (const i of current) {
      if (i.source === 'import') continue
      const k = `${i.roomId ?? ''}|${i.code.toUpperCase()}`
      placed.set(k, (placed.get(k) ?? 0) + i.qty)
    }
    // The same fixture listed twice in a room (one line per basin) is one line with both counted.
    const lines = new Map<string, ParsedRoomData['items'][number]>()
    for (const it of parsed.roomData.items) {
      const k = `${it.roomNumber.toUpperCase()}|${it.code.toUpperCase()}`
      const had = lines.get(k)
      if (had) lines.set(k, { ...had, qty: had.qty + it.qty, note: had.note ?? it.note })
      else lines.set(k, { ...it })
    }
    for (const it of lines.values()) {
      const room = it.roomNumber ? roomByNo.get(it.roomNumber.toUpperCase()) : undefined
      const key = `${room?.id ?? ''}|${it.code.toUpperCase()}`
      if (have.has(key)) continue
      have.add(key)
      const onPlan = placed.get(key) ?? 0
      const qty = it.qty > 0 ? it.qty - onPlan : onPlan ? 0 : it.qty
      placed.set(key, Math.max(0, onPlan - it.qty))
      if (qty <= 0 && (it.qty > 0 || onPlan)) continue
      await db.roomItems.add({ id: uid('rit'), projectId, roomId: room?.id, code: it.code, qty, source: 'import', note: it.note, createdAt: now(), updatedAt: now() })
      itemsAdded++
    }
  })
  return { types: parsed.types.length, rooms: roomsAdded, items: itemsAdded }
}

/** An FF&E schedule from a PDF — printed from Excel, or the architect's. */
export async function readFfePdf(file: Blob): Promise<Sheet[]> {
  const { readPdfTables } = await import('./pdfTable')
  const sheets = await readPdfTables(file, { isHeader: (line) => isFfeHeader(line.split(' | ')), startsRow: ffeStartsRow })
  if (!sheets.length) throw new Error('No FF&E schedule table found in the PDF — expected a heading row with a code column and a description column. For the FF&E plan drawing itself, use Scan architectural plan.')
  return sheets
}

/* ------------------------------------------------------------ records */

export async function saveFfeType(projectId: string, t: Partial<FfeType> & { code: string }): Promise<void> {
  if (t.id) {
    await db.ffeTypes.update(t.id, { ...t, updatedAt: now() })
    return
  }
  const order = (await db.ffeTypes.where('projectId').equals(projectId).toArray()).reduce((m, x) => Math.max(m, x.order), -1) + 1
  await db.ffeTypes.add({
    kind: 'fixture',
    goesWith: [],
    name: '',
    description: '',
    finish: '',
    sampleRef: '',
    ...t,
    id: uid('ffe'),
    projectId,
    order,
    createdAt: now(),
    updatedAt: now(),
  })
}

export async function deleteFfeType(id: string): Promise<void> {
  await db.ffeTypes.delete(id)
}

export async function createRoom(projectId: string, r: { number: string; name: string; level?: string }): Promise<Room> {
  const room: Room = { id: uid('room'), projectId, number: r.number.trim(), name: r.name.trim(), level: r.level, createdAt: now(), updatedAt: now() }
  await db.rooms.add(room)
  return room
}

export async function updateRoom(id: string, patch: Partial<Room>): Promise<void> {
  await db.rooms.update(id, { ...patch, updatedAt: now() })
}

/** A room's items become unassigned rather than disappearing with it. */
export async function deleteRoom(id: string): Promise<void> {
  await db.transaction('rw', db.rooms, db.roomItems, async () => {
    await db.roomItems.where('roomId').equals(id).modify({ roomId: undefined, updatedAt: now() })
    await db.rooms.delete(id)
  })
}

export async function addRoomItem(projectId: string, item: Omit<RoomItem, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>): Promise<RoomItem> {
  const it: RoomItem = { ...item, id: uid('rit'), projectId, createdAt: now(), updatedAt: now() }
  await db.roomItems.add(it)
  return it
}

export async function updateRoomItem(id: string, patch: Partial<RoomItem>): Promise<void> {
  await db.roomItems.update(id, { ...patch, updatedAt: now() })
}

export async function deleteRoomItem(id: string): Promise<void> {
  await db.roomItems.delete(id)
}

/* ------------------------------------------------------------ schedule */

export interface ScheduleLine {
  sampleRef: string
  fixture: string
  code: string
  tapwareCode: string
  qty: number | string
  inWall: string
  description: string
  finish: string
  /** Line needs a look: not in the schedule, or placed with a doubt. */
  flag?: string
}

export interface ScheduleGroup {
  room?: Room
  /** "Ground Floor", or "PROJECT WIDE - NOT ROOM SPECIFIC". */
  heading: string
  lines: ScheduleLine[]
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Tapware and other lines that go with a fixture code, in schedule order. */
export function companions(types: FfeType[], code: string): FfeType[] {
  const c = code.toUpperCase()
  return types.filter((t) => t.goesWith.some((g) => g.toUpperCase() === c)).sort((a, b) => a.order - b.order)
}

/**
 * The room data schedule: project-wide lines first, then room by room in
 * number order; in each room every fixture, then the tapware that goes with
 * it, quantities summed.
 */
export function buildSchedule(types: FfeType[], rooms: Room[], items: RoomItem[]): ScheduleGroup[] {
  const byCode = new Map(types.map((t) => [t.code.toUpperCase(), t]))
  const lineFor = (t: FfeType | undefined, code: string, qty: number | string, flag?: string): ScheduleLine => ({
    sampleRef: t?.sampleRef ?? '',
    fixture: t?.name ?? '(not in the FF&E schedule)',
    code: t?.kind === 'tapware' ? '' : code,
    tapwareCode: t?.kind === 'tapware' ? t.code : '',
    qty,
    inWall: t?.inWall ?? '',
    description: t?.description ?? '',
    finish: t?.finish ?? '',
    flag: flag ?? (t ? undefined : 'Code not in the FF&E schedule'),
  })
  const linesFor = (list: RoomItem[]): ScheduleLine[] => {
    const qty = new Map<string, { qty: number; checks: string[]; notes: string[] }>()
    const order: string[] = []
    for (const it of list) {
      const key = it.code.toUpperCase()
      if (!qty.has(key)) {
        qty.set(key, { qty: 0, checks: [], notes: [] })
        order.push(it.code)
      }
      const q = qty.get(key)!
      q.qty += it.qty
      if (it.check) q.checks.push(it.check)
      if (it.note) q.notes.push(it.note)
    }
    order.sort((a, b) => (byCode.get(a.toUpperCase())?.order ?? 999) - (byCode.get(b.toUpperCase())?.order ?? 999))
    const out: ScheduleLine[] = []
    for (const code of order) {
      const q = qty.get(code.toUpperCase())!
      const t = byCode.get(code.toUpperCase())
      const shown = q.qty || q.notes[0] || 'TBC'
      out.push(lineFor(t, code, shown, q.checks[0]))
      for (const comp of companions(types, code)) out.push(lineFor(comp, comp.code, shown))
    }
    return out
  }
  const groups: ScheduleGroup[] = []
  const projectWide = items.filter((i) => !i.roomId)
  if (projectWide.length) groups.push({ heading: 'PROJECT WIDE - NOT ROOM SPECIFIC', lines: linesFor(projectWide) })
  const byRoom = new Map<string, RoomItem[]>()
  for (const it of items) if (it.roomId) byRoom.set(it.roomId, [...(byRoom.get(it.roomId) ?? []), it])
  for (const room of [...rooms].sort((a, b) => natural(a.number, b.number))) {
    const list = byRoom.get(room.id)
    if (!list?.length) continue
    groups.push({ room, heading: room.level ?? '', lines: linesFor(list) })
  }
  return groups
}

export interface TotalLine {
  type: FfeType
  placed: number
  scheduled?: number
}

/** How many of each schedule line the rooms hold, beside what the schedule says. */
export function totals(types: FfeType[], items: RoomItem[]): TotalLine[] {
  const placed = new Map<string, number>()
  for (const it of items) placed.set(it.code.toUpperCase(), (placed.get(it.code.toUpperCase()) ?? 0) + it.qty)
  return [...types]
    .sort((a, b) => a.order - b.order)
    .map((t) => ({
      type: t,
      placed: t.kind === 'fixture' || !t.goesWith.length ? (placed.get(t.code.toUpperCase()) ?? 0) : t.goesWith.reduce((n, g) => n + (placed.get(g.toUpperCase()) ?? 0), 0),
      scheduled: t.scheduledQty,
    }))
}

export interface Check {
  kind: 'room' | 'missing' | 'quantity' | 'unknown' | 'unassigned'
  text: string
  itemId?: string
}

/** What to look at before the schedule is issued. */
export function checks(types: FfeType[], rooms: Room[], items: RoomItem[]): Check[] {
  const out: Check[] = []
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const known = new Set(types.map((t) => t.code.toUpperCase()))
  for (const it of items) {
    if (it.check) {
      const r = it.roomId ? roomById.get(it.roomId) : undefined
      out.push({ kind: 'room', itemId: it.id, text: `${it.code} placed in ${r ? `${r.name} ${r.number}` : 'no room'} — ${it.check}` })
    }
    if (!known.has(it.code.toUpperCase())) out.push({ kind: 'unknown', itemId: it.id, text: `${it.code} is in a room but not in the FF&E schedule` })
  }
  for (const t of totals(types, items)) {
    if (t.type.kind !== 'fixture') continue
    if (t.placed === 0) out.push({ kind: 'missing', text: `${t.type.code} ${t.type.name} — in the schedule but not in any room` })
    else if (t.scheduled !== undefined && t.scheduled !== t.placed) out.push({ kind: 'quantity', text: `${t.type.code} ${t.type.name} — schedule says ${t.scheduled}, rooms hold ${t.placed}` })
  }
  return out
}

/** The rooms a schedule line is in, for a submission's Location. */
export function locationsOf(codes: string[], types: FfeType[], rooms: Room[], items: RoomItem[]): string {
  const want = new Set<string>()
  for (const code of codes) {
    const t = types.find((x) => x.code.toUpperCase() === code.toUpperCase())
    if (t?.kind === 'tapware') t.goesWith.forEach((g) => want.add(g.toUpperCase()))
    else want.add(code.toUpperCase())
  }
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const names = new Set<string>()
  let projectWide = false
  for (const it of items) {
    if (!want.has(it.code.toUpperCase())) continue
    const r = it.roomId ? roomById.get(it.roomId) : undefined
    if (r) names.add(`${r.name} ${r.number}`)
    else projectWide = true
  }
  const list = [...names].sort(natural)
  if (projectWide) list.push('Project wide')
  return list.join(', ')
}

/* -------------------------------------------------------- submissions */

/** Next sample number in the project's sequence: HYD-AXIS-SMP-001, -002 … */
export function nextSubmissionNo(existing: Submission[], prefix = 'HYD-AXIS-SMP-'): string {
  let max = 0
  for (const s of existing) {
    const m = /(\d+)$/.exec(s.number)
    if (m && s.number.startsWith(prefix)) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export async function saveSubmission(s: Submission): Promise<void> {
  await db.submissions.put({ ...s, updatedAt: now() })
}

export async function deleteSubmission(id: string): Promise<void> {
  await db.submissions.delete(id)
}
