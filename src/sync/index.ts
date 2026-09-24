import { db, loadSettings, saveSettings } from '../data/db'
import type { Photo, SyncConfig } from '../data/types'
import { currentAccount, signIn as msalSignIn, signOut as msalSignOut, tokenProvider } from './auth'
import { SyncEngine, type SyncReport } from './engine'
import { flushEvents, raiseEvent } from './events'
import { GraphClient } from './graph'
import { provision, resolveSiteId, type ProvisionReport } from './provision'

export { raiseEvent, flushEvents }
export type { SyncReport, ProvisionReport }

/**
 * The public face of the sync layer. The screens call these; everything else
 * in this folder is plumbing.
 */

export const isConfigured = (c: SyncConfig): boolean =>
  c.mode === 'sharepoint' && Boolean(c.siteUrl) && (Boolean(c.devToken) || (Boolean(c.tenantId) && Boolean(c.clientId)))

export async function signIn(): Promise<void> {
  const settings = await loadSettings()
  const account = await msalSignIn(settings.sync)
  await saveSettings({ sync: { ...settings.sync, account } })
}

export async function signOut(): Promise<void> {
  const settings = await loadSettings()
  await msalSignOut(settings.sync).catch(() => undefined)
  await saveSettings({ sync: { ...settings.sync, account: undefined } })
}

export async function refreshAccount(): Promise<void> {
  const settings = await loadSettings()
  if (settings.sync.devToken) return
  const account = await currentAccount(settings.sync).catch(() => null)
  if ((account?.username ?? '') !== (settings.sync.account?.username ?? '')) {
    await saveSettings({ sync: { ...settings.sync, account: account ?? undefined } })
  }
}

/** Resolves the site and creates the lists. */
export async function provisionSharePoint(): Promise<ProvisionReport> {
  const settings = await loadSettings()
  const c = settings.sync
  if (!c.siteUrl) throw new Error('Enter the SharePoint site URL first.')
  const graph = new GraphClient(tokenProvider(c), c.graphBaseUrl || undefined)
  const siteId = await resolveSiteId(graph, c.siteUrl)
  const report = await provision(graph, siteId)
  await saveSettings({ sync: { ...c, siteId, provisionedAt: Date.now() } })
  return report
}

let running: Promise<SyncReport> | undefined

/** Push the outbox, then pull the state's changes. One at a time. */
export function syncNow(): Promise<SyncReport> {
  if (running) return running
  running = (async () => {
    const report: SyncReport = { pushed: 0, pulled: 0, failed: 0, errors: [], at: Date.now() }
    const settings = await loadSettings()
    const c = settings.sync
    if (!isConfigured(c)) {
      report.errors.push('SharePoint is not configured.')
      return report
    }
    if (!c.siteId) {
      report.errors.push('Run Provision once to connect the site.')
      return report
    }
    const engine = new SyncEngine(c, tokenProvider(c))
    try {
      await engine.push(report)
      const state = settings.role === 'national_qa' ? undefined : settings.state
      const newest = await engine.pull(report, { since: c.lastSyncAt ?? 0, state })
      // Only advance the watermark when nothing failed, so a failed push is
      // retried and nothing pulled in the meantime is skipped.
      if (report.failed === 0) {
        const latest = await loadSettings()
        await saveSettings({ sync: { ...latest.sync, lastSyncAt: Math.max(newest, latest.sync.lastSyncAt ?? 0) } })
      }
      await flushEvents()
    } catch (err) {
      report.errors.push(err instanceof Error ? err.message : String(err))
      report.failed++
    }
    return report
  })().finally(() => {
    running = undefined
  })
  return running
}

/**
 * Photos pulled from SharePoint arrive with their thumbnail only. This fetches
 * the full image the first time it is needed and keeps it.
 */
export async function ensurePhotoData(photo: Photo): Promise<Photo> {
  if (photo.data) return photo
  const path = (photo as Photo & { filePath?: string }).filePath
  if (!path) return photo
  const settings = await loadSettings()
  const engine = new SyncEngine(settings.sync, tokenProvider(settings.sync))
  const data = await engine.fetchFile(path)
  await db.photos.update(photo.id, { data })
  return { ...photo, data }
}

/** Same for a plan image. */
export async function ensureDrawingImage(drawingId: string): Promise<void> {
  const d = await db.drawings.get(drawingId)
  if (!d || d.imageData) return
  const path = (d as typeof d & { filePath?: string }).filePath
  if (!path) return
  const settings = await loadSettings()
  const engine = new SyncEngine(settings.sync, tokenProvider(settings.sync))
  const imageData = await engine.fetchFile(path)
  await db.drawings.update(drawingId, { imageData })
}

/**
 * Background sync: on coming online, on returning to the tab, and every few
 * minutes while it is open. Returns a stop function.
 */
export function startAutoSync(intervalMs = 5 * 60_000): () => void {
  const tick = () => {
    void loadSettings().then((s) => {
      if (isConfigured(s.sync) && s.sync.siteId && navigator.onLine) void syncNow()
    })
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick()
  }
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(tick, intervalMs)
  tick()
  return () => {
    window.removeEventListener('online', tick)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}
