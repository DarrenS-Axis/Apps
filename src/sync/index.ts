import { db, loadSettings, onOutboxChange, saveSettings } from '../data/db'
import type { Photo, SyncConfig } from '../data/types'
import { currentAccount, signIn as msalSignIn, signOut as msalSignOut, tokenProvider } from './auth'
import { NATIONAL_TABLES, SyncEngine, type SyncReport } from './engine'
import { flushEvents, raiseEvent } from './events'
import { GraphClient } from './graph'
import { provision, resolveSiteId, type ProvisionReport } from './provision'

export { raiseEvent, flushEvents }
export { applyOrgConfig, orgConfig } from './orgConfig'
export { flowUrl } from './events'
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
let again = false

/**
 * Push the outbox, then pull. One at a time; a request made while one is
 * running is folded into a second run straight after, so a change made
 * mid-sync still goes up promptly.
 */
export function syncNow(): Promise<SyncReport> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    const report: SyncReport = { pushed: 0, pulled: 0, failed: 0, errors: [], at: Date.now() }
    let settings = await loadSettings()
    let c = settings.sync
    if (!isConfigured(c)) {
      report.errors.push('SharePoint is not configured.')
      return report
    }
    try {
      // A managed device finds the site itself; nobody runs anything first.
      if (!c.siteId) {
        if (!c.managed) {
          report.errors.push('Run Provision once to connect the site.')
          return report
        }
        const graph = new GraphClient(tokenProvider(c), c.graphBaseUrl || undefined)
        const siteId = await resolveSiteId(graph, c.siteUrl!)
        await saveSettings({ sync: { ...c, siteId } })
        settings = await loadSettings()
        c = settings.sync
      }
      const engine = new SyncEngine(c, tokenProvider(c))
      const run = async () => {
        await engine.push(report)
        const national = settings.role === 'national_qa'
        const state = national ? undefined : settings.state
        // Until the person has said which state they are in, fetch only what
        // is shared by every state — never another state's records.
        const tables = !national && !state ? NATIONAL_TABLES : undefined
        const newest = await engine.pull(report, { since: c.lastSyncAt ?? 0, state, tables })
        // Only advance the watermark when nothing failed, so a failed push is
        // retried and nothing pulled in the meantime is skipped; and not on a
        // partial pull, or the rest would be skipped once the state is known.
        if (report.failed === 0 && !tables) {
          const latest = await loadSettings()
          await saveSettings({ sync: { ...latest.sync, lastSyncAt: Math.max(newest, latest.sync.lastSyncAt ?? 0) } })
        }
      }
      try {
        await run()
      } catch (err) {
        // The lists are made once for the whole organisation; the first
        // signed-in person with the rights does it without being asked.
        if (c.managed && err instanceof Error && /is missing — run Provision/.test(err.message)) {
          await provisionSharePoint()
          await run()
        } else throw err
      }
      await flushEvents()
    } catch (err) {
      report.errors.push(err instanceof Error ? err.message : String(err))
      report.failed++
    }
    lastReport = report
    return report
  })().finally(() => {
    running = undefined
    if (again) {
      again = false
      void syncNow()
    }
  })
  return running
}

/** The last sync's outcome, for the status pill. */
export let lastReport: SyncReport | undefined

async function canSync(): Promise<boolean> {
  const s = await loadSettings()
  if (!isConfigured(s.sync) || !navigator.onLine) return false
  // A managed device syncs from its first signed-in moment; an unmanaged one once provisioned.
  if (s.sync.managed) return Boolean(s.sync.devToken || s.sync.account)
  return Boolean(s.sync.siteId)
}

let pushTimer = 0

/** A change was made on this device: send it in a moment, batched with any that follow. */
function schedulePush(): void {
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    void canSync().then((ok) => {
      if (ok) void syncNow()
    })
  }, 1500)
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
 * Background sync: every change is sent within a couple of seconds; other
 * devices' changes are pulled on coming online, on returning to the app, and
 * every `pollSeconds` (30 by default) while it is on screen. Returns a stop
 * function.
 */
export function startAutoSync(): () => void {
  const tick = () => {
    if (document.visibilityState !== 'visible') return
    void canSync().then((ok) => {
      if (ok) void syncNow()
    })
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick()
  }
  onOutboxChange(schedulePush)
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', onVisible)
  let timer = 0
  void loadSettings().then((s) => {
    const seconds = s.sync.managed ? Math.max(3, s.sync.pollSeconds ?? 30) : 300
    timer = window.setInterval(tick, seconds * 1000)
  })
  tick()
  return () => {
    window.removeEventListener('online', tick)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
    onOutboxChange(() => undefined)
  }
}
