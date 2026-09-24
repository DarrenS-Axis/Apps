import Dexie, { type Table } from 'dexie'
import type {
  BusinessUnit,
  Defect,
  Drawing,
  Itp,
  ItpItem,
  ItpMaterial,
  OutboxEntry,
  Penetration,
  Photo,
  Project,
  QaStatus,
  Settings,
} from './types'
import { DEFAULT_SETTINGS, normalisePoint } from './types'
import { getTemplate } from './templates'
import { LEGACY_CODE_MAP } from './libraries/itpLibrary'
import { SEED_BUSINESS_UNITS } from './libraries/states'

/**
 * Every record lives in IndexedDB, so the app behaves identically with no
 * signal on site. SharePoint, when it is configured, is fed from the outbox
 * below rather than written to directly: a write here is the write, and the
 * sync layer catches up when it can.
 *
 * Photos are stored as data URLs on their own table, keeping the (frequently
 * read) module records small.
 */
class QaDatabase extends Dexie {
  businessUnits!: Table<BusinessUnit, string>
  projects!: Table<Project, string>
  drawings!: Table<Drawing, string>
  itps!: Table<Itp, string>
  penetrations!: Table<Penetration, string>
  defects!: Table<Defect, string>
  photos!: Table<Photo, string>
  settings!: Table<Settings, string>
  outbox!: Table<OutboxEntry, string>
  remoteIds!: Table<{ id: string; spId: string }, string>
  events!: Table<{ id: string; at: number; payload: unknown; attempts: number }, string>

  constructor() {
    // The database keeps its original name so a phone that ran the first
    // release upgrades in place rather than starting empty.
    super('hydraulic-itp')
    this.version(1).stores({
      projects: 'id, name, updatedAt, archived',
      drawings: 'id, projectId, number, updatedAt',
      itps: 'id, projectId, templateCode, status, updatedAt, area',
      photos: 'id, itpId, itemNo, takenAt',
      settings: 'id',
    })
    this.version(2)
      .stores({
        businessUnits: 'id, state, name',
        projects: 'id, businessUnitId, state, name, updatedAt, archived',
        drawings: 'id, projectId, number, updatedAt',
        itps: 'id, projectId, templateCode, status, updatedAt, area, itcNumber',
        penetrations: 'id, projectId, number, status, drawingId, updatedAt, [projectId+number]',
        defects: 'id, projectId, number, status, service, drawingId, updatedAt',
        photos: 'id, itpId, penetrationId, defectId, itemNo, takenAt',
        settings: 'id',
        outbox: 'id, table, at',
        // Which SharePoint list item holds which local record.
        remoteIds: 'id',
        // Power Automate events waiting for signal.
        events: 'id, at',
      })
      .upgrade(async (tx) => {
        const LEGACY_STATUS: Record<string, QaStatus> = {
          draft: 'setup',
          in_progress: 'in_progress',
          awaiting_hold: 'in_progress',
          complete: 'completed_by_site',
          closed: 'reviewed_approved',
        }
        // Everything raised so far belongs to the first business unit; the
        // person can move projects between units afterwards.
        await tx.table('projects').toCollection().modify((p: Project) => {
          p.businessUnitId ??= SEED_BUSINESS_UNITS[0].id
          p.state ??= SEED_BUSINESS_UNITS[0].state
          p.modules ??= { controldoc: true, firedoc: false, reviewdoc: false }
        })
        await tx.table('itps').toCollection().modify((i: Itp) => {
          i.templateCode = LEGACY_CODE_MAP[i.templateCode] ?? i.templateCode
          if (i.itpNumber in LEGACY_CODE_MAP) i.itpNumber = LEGACY_CODE_MAP[i.itpNumber]
          i.status = LEGACY_STATUS[i.status as string] ?? i.status
          for (const item of i.items) item.point = normalisePoint(item.point)
        })
        await tx.table('settings').toCollection().modify((s: Settings) => {
          s.role ??= 'site'
          s.businessUnitIds ??= []
          s.sync ??= { mode: 'local' }
        })
      })
  }
}

export const db = new QaDatabase()

export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const now = (): number => Date.now()

/* --------------------------------------------------------------- outbox */

/** Tables that reach SharePoint. Settings and the outbox itself never leave the device. */
export const SYNCED_TABLES = ['businessUnits', 'projects', 'drawings', 'itps', 'penetrations', 'defects', 'photos'] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

/**
 * Set while the sync layer is applying changes that came *from* SharePoint,
 * so they are not queued straight back to it.
 */
let applyingRemote = false

export async function withRemoteWrites<T>(fn: () => Promise<T>): Promise<T> {
  applyingRemote = true
  try {
    return await fn()
  } finally {
    applyingRemote = false
  }
}

function queue(table: SyncedTable, recordId: string, op: OutboxEntry['op']): void {
  if (applyingRemote) return
  // One pending entry per record: a second edit before the first has gone up
  // replaces it, so the outbox never grows faster than the records do.
  const id = `${table}:${recordId}`
  const entry: OutboxEntry = { id, table, recordId, op, at: now(), attempts: 0 }
  // A hook runs inside the write's own transaction, which does not include
  // the outbox, so the entry is written once that transaction has committed —
  // and only then, so a rolled-back write never leaves a phantom in the queue.
  const trans = Dexie.currentTransaction
  if (trans) trans.on('complete', () => void db.outbox.put(entry))
  else void db.outbox.put(entry)
}

for (const name of SYNCED_TABLES) {
  const table = db.table(name)
  table.hook('creating', (key) => queue(name, String(key), 'put'))
  table.hook('updating', (_mods, key) => queue(name, String(key), 'put'))
  table.hook('deleting', (key) => queue(name, String(key), 'delete'))
}

/* -------------------------------------------------------------- settings */

export async function loadSettings(): Promise<Settings> {
  const s = await db.settings.get('app')
  return s ? { ...DEFAULT_SETTINGS, ...s, sync: { ...DEFAULT_SETTINGS.sync, ...s.sync } } : DEFAULT_SETTINGS
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings()
  const next: Settings = { ...current, ...patch, id: 'app', updatedAt: now() }
  await db.settings.put(next)
  return next
}

/* -------------------------------------------------------- business units */

/**
 * Creates the national set of business units if none exist yet. Seeds are
 * stamped updatedAt 0 and never queued for SharePoint: a unit someone has
 * renamed there is newer than any seed, so it wins on every device, and a
 * fresh device cannot push the defaults back over it.
 */
export async function ensureBusinessUnits(): Promise<void> {
  if ((await db.businessUnits.count()) > 0) return
  await withRemoteWrites(() =>
    db.businessUnits.bulkAdd(SEED_BUSINESS_UNITS.map((u) => ({ ...u, createdAt: now(), updatedAt: 0 }))),
  )
}

export async function createBusinessUnit(input: Omit<BusinessUnit, 'id' | 'createdAt' | 'updatedAt'>): Promise<BusinessUnit> {
  const u: BusinessUnit = { ...input, id: uid('bu'), createdAt: now(), updatedAt: now() }
  await db.businessUnits.add(u)
  return u
}

export async function updateBusinessUnit(id: string, patch: Partial<BusinessUnit>): Promise<void> {
  await db.businessUnits.update(id, { ...patch, updatedAt: now() })
}

/* -------------------------------------------------------------- projects */

export async function createProject(input: Partial<Project> & { businessUnitId: string }): Promise<Project> {
  const unit = await db.businessUnits.get(input.businessUnitId)
  if (!unit) throw new Error('Choose the business unit the project reports under.')
  const p: Project = {
    id: uid('prj'),
    businessUnitId: unit.id,
    state: unit.state,
    name: input.name?.trim() || 'Untitled project',
    client: input.client ?? '',
    projectNumber: input.projectNumber ?? '',
    address: input.address ?? '',
    contractor: input.contractor ?? unit.entity,
    approvedBy: input.approvedBy ?? '',
    approvedByRole: input.approvedByRole ?? 'Project Manager',
    contractorLogo: input.contractorLogo,
    clientLogo: input.clientLogo,
    stage: input.stage ?? '',
    marking: input.marking ?? '',
    modules: input.modules ?? { controldoc: true, firedoc: true, reviewdoc: true },
    locRefScheme: input.locRefScheme,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.projects.add(p)
  return p
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  if (patch.businessUnitId) {
    const unit = await db.businessUnits.get(patch.businessUnitId)
    if (unit) patch = { ...patch, state: unit.state }
  }
  await db.projects.update(id, { ...patch, updatedAt: now() })
}

/** Removes a project together with every drawing, record and photo under it. */
export async function deleteProject(id: string): Promise<void> {
  const itps = await db.itps.where('projectId').equals(id).toArray()
  await db.transaction('rw', [db.projects, db.drawings, db.itps, db.penetrations, db.defects, db.photos], async () => {
    for (const itp of itps) await db.photos.where('itpId').equals(itp.id).delete()
    const pens = await db.penetrations.where('projectId').equals(id).primaryKeys()
    for (const pen of pens) await db.photos.where('penetrationId').equals(pen).delete()
    const defs = await db.defects.where('projectId').equals(id).primaryKeys()
    for (const def of defs) await db.photos.where('defectId').equals(def).delete()
    await db.itps.where('projectId').equals(id).delete()
    await db.penetrations.where('projectId').equals(id).delete()
    await db.defects.where('projectId').equals(id).delete()
    await db.drawings.where('projectId').equals(id).delete()
    await db.projects.delete(id)
  })
}

/* -------------------------------------------------------------- drawings */

export async function createDrawing(input: Partial<Drawing> & { projectId: string }): Promise<Drawing> {
  const d: Drawing = {
    id: uid('dwg'),
    projectId: input.projectId,
    number: input.number ?? '',
    title: input.title ?? '',
    revision: input.revision ?? '',
    discipline: input.discipline ?? 'Hydraulic',
    imageData: input.imageData,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    thumbData: input.thumbData,
    issuedDate: input.issuedDate,
    notes: input.notes,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.drawings.add(d)
  return d
}

export async function updateDrawing(id: string, patch: Partial<Drawing>): Promise<void> {
  await db.drawings.update(id, { ...patch, updatedAt: now() })
}

/**
 * Deletes a drawing and clears any references to it, so no record ever points
 * at a drawing that no longer exists. Penetrations and defects keep their
 * data and lose only their position.
 */
export async function deleteDrawing(id: string): Promise<void> {
  await db.transaction('rw', db.drawings, db.itps, db.penetrations, db.defects, db.photos, async () => {
    const affected = await db.itps
      .filter(
        (i) =>
          i.drawingIds.includes(id) ||
          i.pins.some((p) => p.drawingId === id) ||
          (i.regions ?? []).some((r) => r.drawingId === id),
      )
      .toArray()
    for (const itp of affected) {
      await db.itps.update(itp.id, {
        drawingIds: itp.drawingIds.filter((d) => d !== id),
        pins: itp.pins.filter((p) => p.drawingId !== id),
        regions: (itp.regions ?? []).filter((r) => r.drawingId !== id),
        updatedAt: now(),
      })
    }
    // Photos taken at a pin on this drawing keep their evidence but lose the
    // location, since the pin is going with the drawing.
    const removedPinIds = new Set(
      affected.flatMap((itp) => itp.pins.filter((p) => p.drawingId === id).map((p) => p.id)),
    )
    if (removedPinIds.size) {
      const photos = await db.photos.filter((p) => Boolean(p.pinId) && removedPinIds.has(p.pinId!)).toArray()
      for (const ph of photos) await db.photos.update(ph.id, { pinId: undefined })
    }
    await db.penetrations.where('drawingId').equals(id).modify({ drawingId: undefined, x: undefined, y: undefined, autoPinned: false })
    await db.defects.where('drawingId').equals(id).modify({ drawingId: undefined, x: undefined, y: undefined })
    await db.drawings.delete(id)
  })
}

/* ------------------------------------------------------------------ ITPs */

export interface NewItpInput {
  projectId: string
  templateCode: string
  itpNumber?: string
  area: string
  location?: string
  locationPath?: string
  locRef?: string
  revision?: string
  revisionDate?: string
  documentNo?: string
  drawingIds?: string[]
}

/**
 * The next ITC number for a business unit: Controldoc numbers ITPs in one
 * sequence across the unit, six digits, so "000299" reads the same on every
 * project in NSW Major Works.
 */
export async function nextItcNumber(businessUnitId: string): Promise<string> {
  const projectIds = new Set(
    (await db.projects.where('businessUnitId').equals(businessUnitId).primaryKeys()) as string[],
  )
  let max = 0
  await db.itps.each((i) => {
    if (!projectIds.has(i.projectId) || !i.itcNumber) return
    const n = parseInt(i.itcNumber, 10)
    if (Number.isFinite(n) && n > max) max = n
  })
  return String(max + 1).padStart(6, '0')
}

/** Instantiates an ITP by copying the template's materials and checklist. */
export async function createItp(input: NewItpInput): Promise<Itp> {
  const tpl = getTemplate(input.templateCode)
  if (!tpl) throw new Error(`Unknown ITP template: ${input.templateCode}`)
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('Project not found')

  const materials: ItpMaterial[] = tpl.materials.map((m) => ({ ...m, compliant: null }))
  const items: ItpItem[] = tpl.items.map((i) => ({ ...i, status: 'pending' }))
  const itcNumber = await nextItcNumber(project.businessUnitId)
  const locRef =
    input.locRef?.trim() || (project.locRefScheme ? project.locRefScheme.replace('{n}', itcNumber) : '')

  const itp: Itp = {
    id: uid('itp'),
    projectId: input.projectId,
    templateCode: tpl.code,
    itpNumber: input.itpNumber?.trim() || tpl.code,
    itcNumber,
    title: tpl.title,
    area: input.area.trim(),
    location: input.location ?? '',
    locationPath: input.locationPath ?? `CONTROLDOC > HYDRAULICS > ${tpl.title.toUpperCase()}`,
    locRef,
    revision: input.revision ?? tpl.revision,
    revisionDate: input.revisionDate ?? new Date().toISOString().slice(0, 10),
    documentNo: input.documentNo ?? '',
    drawingIds: input.drawingIds ?? [],
    pins: [],
    regions: [],
    materials,
    items,
    testRecord: { service: tpl.title, testType: tpl.test.type },
    attachments: [],
    progress: 0,
    status: 'setup',
    createdAt: now(),
    updatedAt: now(),
  }
  await db.itps.add(itp)
  return itp
}

export async function updateItp(id: string, patch: Partial<Itp>): Promise<void> {
  await db.itps.update(id, { ...patch, updatedAt: now() })
}

export async function deleteItp(id: string): Promise<void> {
  await db.transaction('rw', db.itps, db.photos, async () => {
    await db.photos.where('itpId').equals(id).delete()
    await db.itps.delete(id)
  })
}

/** Copies an ITP's checklist to a new area, leaving all results unsigned. */
export async function duplicateItp(id: string, area: string): Promise<Itp> {
  const src = await db.itps.get(id)
  if (!src) throw new Error('ITP not found')
  const project = await db.projects.get(src.projectId)
  const itcNumber = project ? await nextItcNumber(project.businessUnitId) : undefined
  const copy: Itp = {
    ...structuredClone(src),
    id: uid('itp'),
    itcNumber,
    locRef: project?.locRefScheme && itcNumber ? project.locRefScheme.replace('{n}', itcNumber) : '',
    area,
    status: 'setup',
    progress: 0,
    // Pins and highlights locate work in a specific area, so a copy raised for
    // a different area starts with none.
    pins: [],
    regions: [],
    attachments: [],
    testRecord: { service: src.testRecord?.service ?? src.title, testType: src.testRecord?.testType ?? 'VISUAL' },
    signOff: undefined,
    clientSignOff: undefined,
    axisSignOff: undefined,
    additionalSignOff: undefined,
    compliant: undefined,
    dateCompleted: undefined,
    dateClosed: undefined,
    materials: src.materials.map((m) => ({ item: m.item, requirement: m.requirement, compliant: null })),
    items: src.items.map((i) => ({
      no: i.no,
      installation: i.installation,
      acceptance: i.acceptance,
      point: i.point,
      releasedBy: i.releasedBy,
      recordLabel: i.recordLabel,
      recordUnit: i.recordUnit,
      photoHint: i.photoHint,
      status: 'pending',
    })),
    createdAt: now(),
    updatedAt: now(),
  }
  await db.itps.add(copy)
  return copy
}

/**
 * Removes a pin from an ITP and detaches any photos taken at it. Photos are
 * evidence in their own right, so they are kept — they simply stop claiming a
 * location that no longer exists.
 */
export async function deletePin(itpId: string, pinId: string): Promise<void> {
  await db.transaction('rw', db.itps, db.photos, async () => {
    const itp = await db.itps.get(itpId)
    if (!itp) return
    await db.itps.update(itpId, { pins: itp.pins.filter((p) => p.id !== pinId), updatedAt: now() })
    const photos = await db.photos.where('itpId').equals(itpId).filter((p) => p.pinId === pinId).toArray()
    for (const ph of photos) await db.photos.update(ph.id, { pinId: undefined })
  })
}

/* ---------------------------------------------------------- penetrations */

export type NewPenetration = Omit<Penetration, 'id' | 'status' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<Penetration, 'status'>>

export async function createPenetration(input: NewPenetration): Promise<Penetration> {
  const p: Penetration = { status: 'setup', ...input, id: uid('pen'), createdAt: now(), updatedAt: now() }
  await db.penetrations.add(p)
  return p
}

/**
 * Bulk import from the consultants' Autopin register. Numbers already on the
 * register are updated in place, because the requirements say a number can
 * never change once in use — a re-issued register must land on the same
 * records, not beside them.
 */
export async function importPenetrations(
  projectId: string,
  rows: Omit<NewPenetration, 'projectId'>[],
): Promise<{ added: number; updated: number }> {
  let added = 0
  let updated = 0
  await db.transaction('rw', db.penetrations, async () => {
    for (const row of rows) {
      const existing = await db.penetrations.where('[projectId+number]').equals([projectId, row.number]).first()
      if (existing) {
        await db.penetrations.update(existing.id, {
          ...row,
          // Position, status and evidence are site data; the register never overwrites them.
          drawingId: existing.drawingId,
          x: existing.x,
          y: existing.y,
          autoPinned: existing.autoPinned,
          status: existing.status,
          updatedAt: now(),
        })
        updated++
      } else {
        await db.penetrations.add({ status: 'setup', ...row, projectId, id: uid('pen'), createdAt: now(), updatedAt: now() })
        added++
      }
    }
  })
  return { added, updated }
}

export async function updatePenetration(id: string, patch: Partial<Penetration>): Promise<void> {
  await db.penetrations.update(id, { ...patch, updatedAt: now() })
}

export async function deletePenetration(id: string): Promise<void> {
  await db.transaction('rw', db.penetrations, db.photos, async () => {
    await db.photos.where('penetrationId').equals(id).delete()
    await db.penetrations.delete(id)
  })
}

/* --------------------------------------------------------------- defects */

/** Reviewdoc numbers defects per project, four digits: 0002, 0003, 0005. */
export async function nextDefectNumber(projectId: string): Promise<string> {
  let max = 0
  await db.defects.where('projectId').equals(projectId).each((d) => {
    const n = parseInt(d.number, 10)
    if (Number.isFinite(n) && n > max) max = n
  })
  return String(max + 1).padStart(4, '0')
}

export async function createDefect(
  input: Omit<Defect, 'id' | 'number' | 'status' | 'raisedAt' | 'createdAt' | 'updatedAt'> & Partial<Pick<Defect, 'number' | 'status'>>,
): Promise<Defect> {
  const d: Defect = {
    status: 'open',
    ...input,
    id: uid('def'),
    number: input.number ?? (await nextDefectNumber(input.projectId)),
    raisedAt: now(),
    createdAt: now(),
    updatedAt: now(),
  }
  await db.defects.add(d)
  return d
}

export async function updateDefect(id: string, patch: Partial<Defect>): Promise<void> {
  await db.defects.update(id, { ...patch, updatedAt: now() })
}

export async function deleteDefect(id: string): Promise<void> {
  await db.transaction('rw', db.defects, db.photos, async () => {
    await db.photos.where('defectId').equals(id).delete()
    await db.defects.delete(id)
  })
}

/* ---------------------------------------------------------------- photos */

export async function addPhoto(photo: Photo): Promise<void> {
  await db.photos.add(photo)
  if (photo.itpId) await db.itps.update(photo.itpId, { updatedAt: now() })
  if (photo.penetrationId) await db.penetrations.update(photo.penetrationId, { updatedAt: now() })
  if (photo.defectId) await db.defects.update(photo.defectId, { updatedAt: now() })
}

export async function deletePhoto(id: string): Promise<void> {
  await db.photos.delete(id)
}

export async function updatePhoto(id: string, patch: Partial<Photo>): Promise<void> {
  await db.photos.update(id, patch)
}

/* --------------------------------------------------------- backup / sync */

export interface Backup {
  format: 'hydraulic-itp-backup' | 'axis-qa-backup'
  version: 1 | 2
  exportedAt: string
  businessUnits?: BusinessUnit[]
  projects: Project[]
  drawings: Drawing[]
  itps: Itp[]
  penetrations?: Penetration[]
  defects?: Defect[]
  photos: Photo[]
}

/**
 * Full JSON export. `projectId` limits the backup to one project, which is the
 * usual way of handing a completed job to the document controller; a state
 * QA manager exports the lot to move a state between devices.
 */
export async function exportBackup(projectId?: string): Promise<Backup> {
  const projects = projectId
    ? ((await db.projects.get(projectId)) ? [(await db.projects.get(projectId))!] : [])
    : await db.projects.toArray()
  const ids = new Set(projects.map((p) => p.id))
  const drawings = (await db.drawings.toArray()).filter((d) => ids.has(d.projectId))
  const itps = (await db.itps.toArray()).filter((i) => ids.has(i.projectId))
  const penetrations = (await db.penetrations.toArray()).filter((p) => ids.has(p.projectId))
  const defects = (await db.defects.toArray()).filter((d) => ids.has(d.projectId))
  const itpIds = new Set(itps.map((i) => i.id))
  const penIds = new Set(penetrations.map((p) => p.id))
  const defIds = new Set(defects.map((d) => d.id))
  const photos = (await db.photos.toArray()).filter(
    (p) => itpIds.has(p.itpId) || (p.penetrationId ? penIds.has(p.penetrationId) : false) || (p.defectId ? defIds.has(p.defectId) : false),
  )
  return {
    format: 'axis-qa-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    businessUnits: await db.businessUnits.toArray(),
    projects,
    drawings,
    itps,
    penetrations,
    defects,
    photos,
  }
}

export interface ImportResult {
  projects: number
  drawings: number
  itps: number
  penetrations: number
  defects: number
  photos: number
}

/**
 * Restores a backup. Records are written with `put`, so re-importing a backup
 * over the top of the same device updates in place rather than duplicating.
 * First-release backups are accepted and brought up to the current shape.
 */
export async function importBackup(data: unknown): Promise<ImportResult> {
  const b = data as Backup
  if (!b || (b.format !== 'axis-qa-backup' && b.format !== 'hydraulic-itp-backup')) {
    throw new Error('Not an Axis QA backup file.')
  }
  const fallbackUnit = SEED_BUSINESS_UNITS[0]
  const projects = (b.projects ?? []).map((p) => ({
    ...p,
    businessUnitId: p.businessUnitId ?? fallbackUnit.id,
    state: p.state ?? fallbackUnit.state,
    modules: p.modules ?? { controldoc: true, firedoc: false, reviewdoc: false },
  }))
  const itps = (b.itps ?? []).map((i) => ({
    ...i,
    templateCode: b.version === 1 ? (LEGACY_CODE_MAP[i.templateCode] ?? i.templateCode) : i.templateCode,
    items: i.items.map((it) => ({ ...it, point: normalisePoint(it.point) })),
  }))
  await db.transaction(
    'rw',
    [db.businessUnits, db.projects, db.drawings, db.itps, db.penetrations, db.defects, db.photos],
    async () => {
      await ensureBusinessUnits()
      if (b.businessUnits?.length) await db.businessUnits.bulkPut(b.businessUnits)
      await db.projects.bulkPut(projects)
      await db.drawings.bulkPut(b.drawings ?? [])
      await db.itps.bulkPut(itps)
      await db.penetrations.bulkPut(b.penetrations ?? [])
      await db.defects.bulkPut(b.defects ?? [])
      await db.photos.bulkPut(b.photos ?? [])
    },
  )
  return {
    projects: projects.length,
    drawings: b.drawings?.length ?? 0,
    itps: itps.length,
    penetrations: b.penetrations?.length ?? 0,
    defects: b.defects?.length ?? 0,
    photos: b.photos?.length ?? 0,
  }
}

/** Rough on-device footprint, used by the settings screen. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
}
