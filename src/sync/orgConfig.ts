import { db, loadOrg, loadSettings, saveOrg, saveSettings } from '../data/db'
import type { SyncConfig } from '../data/types'

/**
 * The organisation's connection, shipped with the app as axis-config.json
 * beside index.html. With it, every phone and laptop that opens the link
 * connects to the same SharePoint site — nobody types a tenant id — and the
 * only step left for a person is signing in with their work account.
 *
 * Only values that are safe to publish belong here: the tenant and the
 * application (client) id identify the app, they are not secrets. The Power
 * Automate URL does carry a key, so it is kept in SharePoint (the org
 * settings record) where only signed-in staff can read it.
 *
 * The deploy workflow writes the file from repository variables
 * (AXIS_TENANT_ID, AXIS_CLIENT_ID, AXIS_SITE_URL); a committed
 * public/axis-config.json works too.
 */
export interface OrgConfig {
  tenantId: string
  clientId: string
  siteUrl: string
  libraryName?: string
  /** People must sign in before the app opens. Default true. */
  requireSignIn?: boolean
  /** Seconds between pulls while the app is open. Default 30. */
  pollSeconds?: number
  /** Test harness only: a stand-in Graph server and token. */
  graphBaseUrl?: string
  devToken?: string
}

let loaded: Promise<OrgConfig | null> | undefined

/** The organisation config, or null when the app is running standalone. */
export function orgConfig(): Promise<OrgConfig | null> {
  loaded ??= (async () => {
    try {
      const res = await fetch('./axis-config.json', { cache: 'no-store' })
      if (!res.ok) return null
      const c = (await res.json()) as Partial<OrgConfig>
      if (!c.siteUrl || !((c.tenantId && c.clientId) || c.devToken)) return null
      return c as OrgConfig
    } catch {
      return null
    }
  })()
  return loaded
}

/**
 * Brings this device's connection in line with the organisation's. Run at
 * every start, so a change to the config reaches every device on its next
 * open. Returns whether the device is now managed.
 */
export async function applyOrgConfig(): Promise<boolean> {
  const c = await orgConfig()
  const settings = await loadSettings()
  // Move a flow URL entered on this device before org settings existed into
  // the shared record, so it is set once for everyone.
  if (settings.sync.powerAutomateUrl && !(await loadOrg())?.powerAutomateUrl) {
    await saveOrg({ powerAutomateUrl: settings.sync.powerAutomateUrl })
  }
  if (!c) {
    if (settings.sync.managed) await saveSettings({ sync: { ...settings.sync, managed: false, requireSignIn: false } })
    return false
  }
  const next: SyncConfig = {
    ...settings.sync,
    mode: 'sharepoint',
    managed: true,
    tenantId: c.tenantId,
    clientId: c.clientId,
    // A different site means a different store: forget the old one's ids.
    ...(settings.sync.siteUrl !== c.siteUrl ? { siteId: undefined, lastSyncAt: undefined } : {}),
    siteUrl: c.siteUrl,
    libraryName: c.libraryName ?? settings.sync.libraryName,
    requireSignIn: c.requireSignIn ?? true,
    pollSeconds: c.pollSeconds ?? 30,
    graphBaseUrl: c.graphBaseUrl,
    devToken: c.devToken,
  }
  if (settings.sync.siteUrl && settings.sync.siteUrl !== c.siteUrl) await db.remoteIds.clear()
  if (JSON.stringify(next) !== JSON.stringify(settings.sync)) await saveSettings({ sync: next })
  return true
}
