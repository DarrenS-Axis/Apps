import Dexie, { type Table } from 'dexie'
import type { Drawing, Itp, ItpItem, ItpMaterial, Photo, Project, Settings } from './types'
import { DEFAULT_SETTINGS } from './types'
import { getTemplate } from './templates'

/**
 * All records live in IndexedDB so the app works with no signal on site.
 * Photos are stored as data URLs on their own table, keeping the (frequently
 * read) ITP records small.
 */
class ItpDatabase extends Dexie {
  projects!: Table<Project, string>
  drawings!: Table<Drawing, string>
  itps!: Table<Itp, string>
  photos!: Table<Photo, string>
  settings!: Table<Settings, string>

  constructor() {
    super('hydraulic-itp')
    this.version(1).stores({
      projects: 'id, name, updatedAt, archived',
      drawings: 'id, projectId, number, updatedAt',
      itps: 'id, projectId, templateCode, status, updatedAt, area',
      photos: 'id, itpId, itemNo, takenAt',
      settings: 'id',
    })
  }
}

export const db = new ItpDatabase()

export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const now = (): number => Date.now()

/* -------------------------------------------------------------- settings */

export async function loadSettings(): Promise<Settings> {
  const s = await db.settings.get('app')
  return s ?? DEFAULT_SETTINGS
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings()
  const next: Settings = { ...current, ...patch, id: 'app', updatedAt: now() }
  await db.settings.put(next)
  return next
}

/* -------------------------------------------------------------- projects */

export async function createProject(input: Partial<Project>): Promise<Project> {
  const p: Project = {
    id: uid('prj'),
    name: input.name?.trim() || 'Untitled project',
    client: input.client ?? '',
    projectNumber: input.projectNumber ?? '',
    address: input.address ?? '',
    contractor: input.contractor ?? '',
    approvedBy: input.approvedBy ?? '',
    approvedByRole: input.approvedByRole ?? 'Project Manager',
    contractorLogo: input.contractorLogo,
    clientLogo: input.clientLogo,
    stage: input.stage ?? '',
    marking: input.marking ?? 'OFFICIAL',
    createdAt: now(),
    updatedAt: now(),
  }
  await db.projects.add(p)
  return p
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await db.projects.update(id, { ...patch, updatedAt: now() })
}

/** Removes a project together with every drawing, ITP and photo under it. */
export async function deleteProject(id: string): Promise<void> {
  const itps = await db.itps.where('projectId').equals(id).toArray()
  await db.transaction('rw', db.projects, db.drawings, db.itps, db.photos, async () => {
    for (const itp of itps) await db.photos.where('itpId').equals(itp.id).delete()
    await db.itps.where('projectId').equals(id).delete()
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
 * Deletes a drawing and clears any references to it, so ITPs never point at a
 * drawing that no longer exists.
 */
export async function deleteDrawing(id: string): Promise<void> {
  await db.transaction('rw', db.drawings, db.itps, db.photos, async () => {
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
    const photos = await db.photos.filter((p) => p.drawingId === id).toArray()
    for (const ph of photos) {
      await db.photos.update(ph.id, { drawingId: undefined, pinX: undefined, pinY: undefined })
    }
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
  revision?: string
  revisionDate?: string
  documentNo?: string
  drawingIds?: string[]
}

/** Instantiates an ITP by copying the template's materials and schedule. */
export async function createItp(input: NewItpInput): Promise<Itp> {
  const tpl = getTemplate(input.templateCode)
  if (!tpl) throw new Error(`Unknown ITP template: ${input.templateCode}`)

  const materials: ItpMaterial[] = tpl.materials.map((m) => ({ ...m, compliant: null }))
  const items: ItpItem[] = tpl.items.map((i) => ({ ...i, status: 'pending' }))

  const itp: Itp = {
    id: uid('itp'),
    projectId: input.projectId,
    templateCode: tpl.code,
    itpNumber: input.itpNumber?.trim() || tpl.code,
    title: tpl.title,
    area: input.area.trim(),
    location: input.location ?? '',
    revision: input.revision ?? 'A',
    revisionDate: input.revisionDate ?? new Date().toISOString().slice(0, 10),
    documentNo: input.documentNo ?? '',
    drawingIds: input.drawingIds ?? [],
    pins: [],
    regions: [],
    materials,
    items,
    status: 'draft',
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

/** Copies an ITP's schedule to a new area, leaving all results unsigned. */
export async function duplicateItp(id: string, area: string): Promise<Itp> {
  const src = await db.itps.get(id)
  if (!src) throw new Error('ITP not found')
  const copy: Itp = {
    ...structuredClone(src),
    id: uid('itp'),
    area,
    status: 'draft',
    // Pins and highlights locate work in a specific area, so a copy raised for
    // a different area starts with none.
    pins: [],
    regions: [],
    signOff: undefined,
    clientSignOff: undefined,
    dateCompleted: undefined,
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

/* ---------------------------------------------------------------- photos */

export async function addPhoto(photo: Photo): Promise<void> {
  await db.photos.add(photo)
  await db.itps.update(photo.itpId, { updatedAt: now() })
}

export async function deletePhoto(id: string): Promise<void> {
  await db.photos.delete(id)
}

export async function updatePhoto(id: string, patch: Partial<Photo>): Promise<void> {
  await db.photos.update(id, patch)
}

/* --------------------------------------------------------- backup / sync */

export interface Backup {
  format: 'hydraulic-itp-backup'
  version: 1
  exportedAt: string
  projects: Project[]
  drawings: Drawing[]
  itps: Itp[]
  photos: Photo[]
}

/**
 * Full JSON export. `projectId` limits the backup to one project, which is the
 * usual way of handing a completed job to the document controller.
 */
export async function exportBackup(projectId?: string): Promise<Backup> {
  const projects = projectId
    ? ((await db.projects.get(projectId)) ? [(await db.projects.get(projectId))!] : [])
    : await db.projects.toArray()
  const ids = new Set(projects.map((p) => p.id))
  const drawings = (await db.drawings.toArray()).filter((d) => ids.has(d.projectId))
  const itps = (await db.itps.toArray()).filter((i) => ids.has(i.projectId))
  const itpIds = new Set(itps.map((i) => i.id))
  const photos = (await db.photos.toArray()).filter((p) => itpIds.has(p.itpId))
  return {
    format: 'hydraulic-itp-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    projects,
    drawings,
    itps,
    photos,
  }
}

export interface ImportResult {
  projects: number
  drawings: number
  itps: number
  photos: number
}

/**
 * Restores a backup. Records are written with `put`, so re-importing a backup
 * over the top of the same device updates in place rather than duplicating.
 */
export async function importBackup(data: unknown): Promise<ImportResult> {
  const b = data as Backup
  if (!b || b.format !== 'hydraulic-itp-backup') {
    throw new Error('Not a Hydraulic ITP backup file.')
  }
  await db.transaction('rw', db.projects, db.drawings, db.itps, db.photos, async () => {
    await db.projects.bulkPut(b.projects ?? [])
    await db.drawings.bulkPut(b.drawings ?? [])
    await db.itps.bulkPut(b.itps ?? [])
    await db.photos.bulkPut(b.photos ?? [])
  })
  return {
    projects: b.projects?.length ?? 0,
    drawings: b.drawings?.length ?? 0,
    itps: b.itps?.length ?? 0,
    photos: b.photos?.length ?? 0,
  }
}

/** Rough on-device footprint, used by the settings screen. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
}
