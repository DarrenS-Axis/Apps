import { liveQuery } from 'dexie'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db, loadSettings } from './db'
import type { BusinessUnit, Defect, Depot, Drawing, Itp, Penetration, Person, Photo, PlantItem, Project, Settings, StateCode } from './types'
import { DEFAULT_SETTINGS } from './types'

/**
 * Subscribes to a Dexie live query and re-renders when the underlying tables
 * change. Dexie ships `liveQuery` in core, so this keeps the bundle free of an
 * extra React binding package.
 *
 * `deps` controls when the query is re-subscribed — pass the values the querier
 * closes over, exactly like `useEffect`.
 */
export function useLive<T>(querier: () => T | Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial)
  const queryRef = useRef(querier)
  queryRef.current = querier

  useEffect(() => {
    const sub = liveQuery(() => queryRef.current()).subscribe({
      next: (v) => setValue(v as T),
      error: (err) => console.error('Live query failed', err),
    })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return value
}

const EMPTY_PROJECTS: Project[] = []
const EMPTY_DRAWINGS: Drawing[] = []
const EMPTY_ITPS: Itp[] = []
const EMPTY_PHOTOS: Photo[] = []
const EMPTY_UNITS: BusinessUnit[] = []
const EMPTY_PENS: Penetration[] = []
const EMPTY_DEFECTS: Defect[] = []
const EMPTY_PLANT: PlantItem[] = []
const EMPTY_DEPOTS: Depot[] = []

export function useBusinessUnits(state?: StateCode): BusinessUnit[] {
  return useLive(
    async () => {
      const all = await db.businessUnits.toArray()
      return (state ? all.filter((u) => u.state === state) : all).sort((a, b) => a.name.localeCompare(b.name))
    },
    [state],
    EMPTY_UNITS,
  )
}

export function useBusinessUnit(id?: string): BusinessUnit | undefined {
  return useLive(() => (id ? db.businessUnits.get(id) : undefined), [id], undefined)
}

/**
 * Every project, unscoped. The screens use `useVisibleProjects`, which applies
 * the signed-in person's state; this exists for reporting and migration.
 */
export function useProjects(): Project[] {
  return useLive(() => db.projects.orderBy('updatedAt').reverse().toArray(), [], EMPTY_PROJECTS)
}

/**
 * Projects the signed-in person may open. Site and state QA see their own
 * state only — the one silo the app enforces on the device; national QA sees
 * the lot. Nothing is shown until a state has been chosen.
 */
export function useVisibleProjects(): Project[] {
  const settings = useSettings()
  const { role, state, businessUnitIds } = settings
  return useLive(
    async () => {
      const all = await db.projects.orderBy('updatedAt').reverse().toArray()
      if (role === 'national_qa') return all
      if (!state) return []
      return all.filter(
        (p) => p.state === state && (businessUnitIds.length === 0 || businessUnitIds.includes(p.businessUnitId)),
      )
    },
    [role, state, businessUnitIds.join(',')],
    EMPTY_PROJECTS,
  )
}

export function usePenetrations(projectId?: string): Penetration[] {
  return useLive(
    () => (projectId ? db.penetrations.where('projectId').equals(projectId).sortBy('number') : []),
    [projectId],
    EMPTY_PENS,
  )
}

export function usePenetration(id?: string): Penetration | undefined {
  return useLive(() => (id ? db.penetrations.get(id) : undefined), [id], undefined)
}

export function useDefects(projectId?: string): Defect[] {
  return useLive(
    () => (projectId ? db.defects.where('projectId').equals(projectId).sortBy('number') : []),
    [projectId],
    EMPTY_DEFECTS,
  )
}

export function useDefect(id?: string): Defect | undefined {
  return useLive(() => (id ? db.defects.get(id) : undefined), [id], undefined)
}

const EMPTY_PEOPLE: Person[] = []

/** People profiles: a state's, plus anyone who covers every state; all of them for 'all'. */
export function usePeople(state?: StateCode | 'all'): Person[] {
  return useLive(
    async () => {
      const all = await db.people.toArray()
      return (state === 'all' || !state ? all : all.filter((p) => p.state === state || p.allStates)).sort((a, b) => a.name.localeCompare(b.name))
    },
    [state],
    EMPTY_PEOPLE,
  )
}

/** A state's plant register; every state's for national QA (no state given). */
export function usePlant(state?: StateCode | 'all'): PlantItem[] {
  return useLive(
    () => (!state ? [] : state === 'all' ? db.plant.orderBy('plantNo').toArray() : db.plant.where('state').equals(state).sortBy('plantNo')),
    [state],
    EMPTY_PLANT,
  )
}

export function usePlantItem(id?: string): PlantItem | undefined {
  return useLive(() => (id ? db.plant.get(id) : undefined), [id], undefined)
}

export function useDepots(state?: StateCode | 'all'): Depot[] {
  return useLive(
    async () => {
      if (!state) return []
      const all = state === 'all' ? await db.depots.toArray() : await db.depots.where('state').equals(state).toArray()
      return all.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name))
    },
    [state],
    EMPTY_DEPOTS,
  )
}

/** Photos taken at a penetration, a defect or of a piece of plant. */
export function useRecordPhotos(key: 'penetrationId' | 'defectId' | 'plantId', id?: string): Photo[] {
  return useLive(() => (id ? db.photos.where(key).equals(id).sortBy('takenAt') : []), [key, id], EMPTY_PHOTOS)
}

/** How many changes are waiting to reach SharePoint. */
export function useOutboxCount(): number {
  return useLive(() => db.outbox.count(), [], 0)
}

export function useProject(id?: string): Project | undefined {
  return useLive(() => (id ? db.projects.get(id) : undefined), [id], undefined)
}

export function useDrawings(projectId?: string): Drawing[] {
  return useLive(
    () => (projectId ? db.drawings.where('projectId').equals(projectId).toArray() : []),
    [projectId],
    EMPTY_DRAWINGS,
  )
}

export function useDrawing(id?: string): Drawing | undefined {
  return useLive(() => (id ? db.drawings.get(id) : undefined), [id], undefined)
}

export function useItps(projectId?: string): Itp[] {
  return useLive(
    () => (projectId ? db.itps.where('projectId').equals(projectId).toArray() : []),
    [projectId],
    EMPTY_ITPS,
  )
}

export function useItp(id?: string): Itp | undefined {
  return useLive(() => (id ? db.itps.get(id) : undefined), [id], undefined)
}

export function usePhotos(itpId?: string): Photo[] {
  return useLive(
    () => (itpId ? db.photos.where('itpId').equals(itpId).toArray() : []),
    [itpId],
    EMPTY_PHOTOS,
  )
}

export function useSettings(): Settings {
  return useLive(() => loadSettings(), [], DEFAULT_SETTINGS)
}

const NOT_LOADED: { settings: Settings; loaded: boolean } = { settings: DEFAULT_SETTINGS, loaded: false }

/**
 * Settings together with whether they have been read from the device yet. A
 * fresh install and a not-yet-loaded store both look like DEFAULT_SETTINGS,
 * and the app must not route on the second — so the flag and the value come
 * from the one query and can never disagree.
 */
export function useSettingsState(): { settings: Settings; loaded: boolean } {
  return useLive(async () => ({ settings: await loadSettings(), loaded: true }), [], NOT_LOADED)
}

/** Photos grouped by the schedule item they evidence. */
export function usePhotosByItem(itpId?: string): Map<string, Photo[]> {
  const photos = usePhotos(itpId)
  return useMemo(() => {
    const map = new Map<string, Photo[]>()
    for (const p of photos) {
      const key = p.itemNo ?? ''
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }
    for (const list of map.values()) list.sort((a, b) => a.takenAt - b.takenAt)
    return map
  }, [photos])
}

/** Tracks whether the browser thinks it is online, for the offline banner. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** The last project opened, so the app returns to where the user left off. */
export function useActiveProjectId(): [string | undefined, (id: string | undefined) => void] {
  const settings = useSettings()
  const set = (id: string | undefined) => {
    void db.settings.put({ ...settings, id: 'app', activeProjectId: id, updatedAt: Date.now() })
  }
  return [settings.activeProjectId, set]
}
