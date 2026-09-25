import { db, now, uid } from './db'
import type { Depot, PlantItem, PlantMove, PlantStatus, Project, StateCode } from './types'

/**
 * The plant register: every tool and piece of plant a state owns, where it
 * is, and how that is known. An item is found by being photographed or
 * scanned — the position of that sighting decides whether it is back at a
 * yard or office (and so available) or out on a job.
 */

/* ------------------------------------------------------------ geometry */

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * How far from a depot still counts as at it. A seeded depot only knows its
 * suburb, so it is matched across the suburb until its address is found.
 */
export const depotReach = (d: Depot): number => (d.source === 'seed' ? Math.max(d.radius, 1500) : d.radius)

/** A job counts as "here" when one of its records was located within this. */
export const SITE_REACH_M = 600

export interface Sighting {
  lat: number
  lng: number
  accuracy?: number
  at: number
}

export type Placement =
  | { kind: 'depot'; depot: Depot; distance: number }
  | { kind: 'project'; project: Project; distance: number }
  | { kind: 'unknown' }

/**
 * Every position a job is known at: where its ITPs were signed, its
 * penetrations and defects were raised, and plant was seen on it. Jobs have
 * an address but no coordinates, and these are better than a geocoded
 * address anyway — they are where people actually stood.
 */
export async function sitePositions(state: StateCode): Promise<Map<string, { lat: number; lng: number }[]>> {
  const projects = (await db.projects.where('state').equals(state).toArray()).filter((p) => !p.archived)
  const ids = new Set(projects.map((p) => p.id))
  const out = new Map<string, { lat: number; lng: number }[]>()
  const add = (projectId: string | undefined, lat?: number, lng?: number) => {
    if (!projectId || !ids.has(projectId) || lat === undefined || lng === undefined) return
    const list = out.get(projectId)
    if (list) list.push({ lat, lng })
    else out.set(projectId, [{ lat, lng }])
  }
  for (const i of await db.itps.toArray()) {
    add(i.projectId, i.lat, i.lng)
    for (const pin of i.pins) add(i.projectId, pin.lat, pin.lng)
  }
  for (const p of await db.penetrations.toArray()) add(p.projectId, p.lat, p.lng)
  for (const d of await db.defects.toArray()) add(d.projectId, d.lat, d.lng)
  for (const item of await db.plant.where('state').equals(state).toArray()) {
    for (const m of item.history) if (m.status === 'on_site') add(m.projectId, m.lat, m.lng)
  }
  return out
}

/** Decides where a sighting puts an item: a yard or office first, then a job. */
export async function placeSighting(state: StateCode, s: Sighting): Promise<Placement> {
  // A poor fix (say ±80 m indoors) still counts at the edge of the fence.
  const slack = Math.min(s.accuracy ?? 0, 150)
  let best: Placement = { kind: 'unknown' }
  for (const d of await db.depots.where('state').equals(state).toArray()) {
    if (d.lat === undefined || d.lng === undefined) continue
    const distance = distanceM(s.lat, s.lng, d.lat, d.lng)
    if (distance <= depotReach(d) + slack && (best.kind !== 'depot' || distance < best.distance)) {
      best = { kind: 'depot', depot: d, distance }
    }
  }
  if (best.kind === 'depot') return best
  const positions = await sitePositions(state)
  let nearest: { projectId: string; distance: number } | undefined
  for (const [projectId, points] of positions) {
    for (const p of points) {
      const distance = distanceM(s.lat, s.lng, p.lat, p.lng)
      if (distance <= SITE_REACH_M + slack && (!nearest || distance < nearest.distance)) nearest = { projectId, distance }
    }
  }
  if (nearest) {
    const project = await db.projects.get(nearest.projectId)
    if (project) return { kind: 'project', project, distance: nearest.distance }
  }
  return best
}

/* ------------------------------------------------------------ numbering */

export const plantNoPattern = (state: StateCode) => new RegExp(`^${state}-(\\d+)$`, 'i')

/** Next free register number for the state: SA-0001, SA-0002… */
export async function nextPlantNo(state: StateCode, after = 0): Promise<string> {
  const re = plantNoPattern(state)
  let max = after
  await db.plant.where('state').equals(state).each((p) => {
    const m = re.exec(p.plantNo)
    if (m) max = Math.max(max, Number(m[1]))
  })
  return formatPlantNo(state, max + 1)
}

export const formatPlantNo = (state: StateCode, n: number) => `${state}-${String(n).padStart(4, '0')}`

/* ------------------------------------------------------------------ CRUD */

export type NewPlantItem = Omit<PlantItem, 'id' | 'plantNo' | 'history' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<PlantItem, 'plantNo' | 'history'>>

export async function createPlantItem(input: NewPlantItem, by?: string): Promise<PlantItem> {
  const plantNo = input.plantNo?.trim() || (await nextPlantNo(input.state))
  const item: PlantItem = {
    ...input,
    plantNo,
    id: uid('plt'),
    history: input.history ?? [{ at: now(), by, status: input.status, location: input.location, depotId: input.depotId, projectId: input.projectId, via: 'manual', note: 'Added to the register' }],
    createdAt: now(),
    updatedAt: now(),
  }
  await db.plant.add(item)
  return item
}

export async function updatePlantItem(id: string, patch: Partial<PlantItem>): Promise<void> {
  await db.plant.update(id, { ...patch, updatedAt: now() })
}

export async function deletePlantItem(id: string): Promise<void> {
  await db.transaction('rw', db.plant, db.photos, async () => {
    await db.photos.where('plantId').equals(id).delete()
    await db.plant.delete(id)
  })
}

export async function findPlantByNo(plantNo: string, states?: StateCode[]): Promise<PlantItem | undefined> {
  const key = plantNo.trim().toUpperCase()
  const all = await db.plant.where('plantNo').equalsIgnoreCase(key).toArray()
  return all.find((p) => !states || states.includes(p.state))
}

/* ------------------------------------------------------------ movement */

export interface MoveInput {
  status: PlantStatus
  location: string
  depotId?: string
  projectId?: string
  via: PlantMove['via']
  by?: string
  note?: string
  photoId?: string
  /** Position the move was recorded at, when there was one. */
  geo?: Sighting
  /** Someone had the item in front of them — a photo or a scan, not a guess. */
  seen?: boolean
}

/**
 * Records where an item is now, appending to its history. Read-modify-write
 * in a transaction, since a GPS fix can land seconds after the action and
 * must not undo an edit made in between.
 */
export async function movePlant(id: string, move: MoveInput): Promise<PlantItem | undefined> {
  return db.transaction('rw', db.plant, async () => {
    const item = await db.plant.get(id)
    if (!item) return undefined
    const at = move.geo?.at ?? now()
    const entry: PlantMove = {
      at,
      by: move.by,
      status: move.status,
      location: move.location,
      depotId: move.depotId,
      projectId: move.projectId,
      lat: move.geo?.lat,
      lng: move.geo?.lng,
      accuracy: move.geo?.accuracy,
      via: move.via,
      photoId: move.photoId,
      note: move.note,
    }
    const patch: Partial<PlantItem> = {
      status: move.status,
      location: move.location,
      depotId: move.depotId,
      projectId: move.projectId,
      history: [...item.history, entry],
      updatedAt: now(),
    }
    if (move.geo) {
      Object.assign(patch, { lat: move.geo.lat, lng: move.geo.lng, accuracy: move.geo.accuracy, locatedAt: move.geo.at })
    }
    if (move.seen) {
      patch.seenAt = at
      patch.seenBy = move.by
    }
    await db.plant.update(id, patch)
    return { ...item, ...patch }
  })
}

/**
 * The status an item takes when it is seen somewhere. Seeing an item is
 * proof it is not missing; a broken or written-off one stays broken or
 * written off wherever it is found.
 */
export function statusWhenSeen(current: PlantStatus, at: 'depot' | 'site'): PlantStatus {
  if (current === 'out_of_service' || current === 'disposed') return current
  return at === 'depot' ? 'available' : 'on_site'
}

export interface SightingResult {
  item: PlantItem
  placement: Placement
}

/**
 * A photo or scan with a position: works out where that is and moves the
 * item there. Somewhere that is neither a depot nor a known job leaves the
 * location as it was and returns `unknown`, for the person to say which job.
 */
export async function recordSighting(
  id: string,
  s: Sighting,
  sightingOpts: { via: PlantMove['via']; by?: string; photoId?: string },
): Promise<SightingResult | undefined> {
  const opts = { ...sightingOpts, seen: true }
  const item = await db.plant.get(id)
  if (!item) return undefined
  const placement = await placeSighting(item.state, s)
  let move: MoveInput
  if (placement.kind === 'depot') {
    // Keep "Office" for an item already filed at this depot's office.
    const area = item.depotId === placement.depot.id && item.location ? item.location : placement.depot.defaultArea || 'Yard'
    move = { status: statusWhenSeen(item.status, 'depot'), location: area, depotId: placement.depot.id, ...opts, geo: s }
  } else if (placement.kind === 'project') {
    move = { status: statusWhenSeen(item.status, 'site'), location: placement.project.name, projectId: placement.project.id, ...opts, geo: s }
  } else {
    // Not at a yard or a known job: record the sighting, keep the place.
    move = {
      status: item.status === 'missing' ? 'on_site' : item.status,
      location: item.location,
      depotId: item.depotId,
      projectId: item.projectId,
      ...opts,
      geo: s,
      note: 'Seen away from the yard and known jobs',
    }
  }
  const updated = await movePlant(id, move)
  return updated ? { item: updated, placement } : undefined
}

/* -------------------------------------------------------------- depots */

export async function createDepot(input: Omit<Depot, 'id' | 'createdAt' | 'updatedAt'>): Promise<Depot> {
  const d: Depot = { ...input, id: uid('dep'), createdAt: now(), updatedAt: now() }
  await db.depots.add(d)
  return d
}

export async function updateDepot(id: string, patch: Partial<Depot>): Promise<void> {
  await db.depots.update(id, { ...patch, updatedAt: now() })
}

export async function deleteDepot(id: string): Promise<void> {
  await db.depots.delete(id)
}

/**
 * Looks an address up on OpenStreetMap. Unit numbers confuse it, so the
 * street address is tried when the full one finds nothing. Returns null
 * offline or on any failure — the depot then waits for someone to set it on
 * site.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const attempts = [address, address.replace(/^\s*(unit|shop|suite|factory|lot)?\s*\d+[a-z]?\s*[/,]\s*/i, ''), address.replace(/^[^,]*?\d+[a-z]?\s*[/,]\s*/i, '')]
  const tried = new Set<string>()
  for (const raw of attempts) {
    const q = raw.trim()
    if (!q || tried.has(q)) continue
    tried.add(q)
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(q)}`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      })
      clearTimeout(timer)
      if (!res.ok) continue
      const hits = (await res.json()) as { lat: string; lon: string }[]
      if (hits[0]) return { lat: Number(hits[0].lat), lng: Number(hits[0].lon) }
    } catch {
      return null
    }
  }
  return null
}

/* ------------------------------------------------------------- checks */

/**
 * Test & tag falls due every three months on construction sites
 * (AS/NZS 3760). Only items with a test date on the register are checked.
 */
export function testTagDue(item: PlantItem, at = Date.now()): { due: number; overdue: boolean } | null {
  if (!item.lastTestAt) return null
  const d = new Date(item.lastTestAt)
  if (Number.isNaN(d.getTime())) return null
  const due = new Date(d)
  due.setMonth(due.getMonth() + 3)
  return { due: due.getTime(), overdue: due.getTime() < at }
}

/** Not photographed or scanned in this many days, while supposedly out on a job. */
export const STALE_DAYS = 60

export function isStale(item: PlantItem, at = Date.now()): boolean {
  if (item.status !== 'on_site') return false
  const last = item.seenAt ?? item.createdAt
  return at - last > STALE_DAYS * 86400000
}
