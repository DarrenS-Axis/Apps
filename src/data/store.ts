import { liveQuery } from 'dexie'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db, loadSettings } from './db'
import type { Drawing, Itp, Photo, Project, Settings } from './types'
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

export function useProjects(): Project[] {
  return useLive(() => db.projects.orderBy('updatedAt').reverse().toArray(), [], EMPTY_PROJECTS)
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
