import { db, SYNCED_TABLES, withRemoteWrites, type SyncedTable } from '../data/db'
import type { OutboxEntry, SyncConfig } from '../data/types'
import { GraphClient, GraphError } from './graph'
import { libraryDriveId, listIds } from './provision'
import { listFor, prepare } from './schema'

/**
 * Moves changes between the device and SharePoint.
 *
 * Push drains the outbox: each entry names a table and a record; the record
 * is read fresh (so a burst of edits goes up once, as it stands now), turned
 * into list fields and files, and upserted by RecordId. Pull asks every list
 * for items changed since the last pull — narrowed to the person's state
 * unless they are national QA — and writes them locally without re-queueing
 * them. Last writer wins on `updatedAt`; a local record with an edit still
 * in the outbox is never overwritten by an older remote copy.
 */

interface SpItem {
  id: string
  fields: Record<string, unknown>
}

export interface SyncReport {
  pushed: number
  pulled: number
  failed: number
  errors: string[]
  at: number
}

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => (await fetch(dataUrl)).blob()

/** Escapes a value for an OData string literal. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

const PREFER_UNINDEXED = { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }

export class SyncEngine {
  private graph: GraphClient
  private lists?: Map<string, string>
  private driveId?: string

  constructor(
    private readonly config: SyncConfig,
    private readonly getToken: () => Promise<string>,
  ) {
    this.graph = new GraphClient(getToken, config.graphBaseUrl || undefined)
  }

  private get siteId(): string {
    if (!this.config.siteId) throw new Error('SharePoint site not resolved — sign in and provision first.')
    return this.config.siteId
  }

  private async listId(table: SyncedTable): Promise<string> {
    this.lists ??= await listIds(this.graph, this.siteId)
    const id = this.lists.get(listFor(table).displayName)
    if (!id) throw new Error(`List "${listFor(table).displayName}" is missing — run Provision.`)
    return id
  }

  private async drive(): Promise<string> {
    this.driveId ??= await libraryDriveId(this.graph, this.siteId)
    return this.driveId
  }

  /* ------------------------------------------------------------- push */

  private async stateFor(record: Record<string, unknown>): Promise<string> {
    if (typeof record.state === 'string') return record.state
    // Plant photos belong to a state's register, not a project.
    if (record.plantId && !record.projectId) return (await db.plant.get(record.plantId as string))?.state ?? ''
    const projectId =
      (record.projectId as string | undefined) ??
      (await (async () => {
        // A photo names its record, not its project.
        if (record.itpId) return (await db.itps.get(record.itpId as string))?.projectId
        if (record.penetrationId) return (await db.penetrations.get(record.penetrationId as string))?.projectId
        if (record.defectId) return (await db.defects.get(record.defectId as string))?.projectId
        return undefined
      })())
    if (!projectId) return ''
    record.projectId ??= projectId
    return (await db.projects.get(projectId))?.state ?? ''
  }

  private async findRemote(table: SyncedTable, recordId: string): Promise<string | undefined> {
    const key = `${table}:${recordId}`
    const cached = await db.remoteIds.get(key)
    if (cached) return cached.spId
    const listId = await this.listId(table)
    const items = await this.graph.get<{ value: SpItem[] }>(
      `/sites/${this.siteId}/lists/${listId}/items?$select=id&$filter=fields/RecordId eq ${lit(recordId)}`,
      PREFER_UNINDEXED,
    )
    const spId = items.value[0]?.id
    if (spId) await db.remoteIds.put({ id: key, spId })
    return spId
  }

  async pushOne(entry: OutboxEntry): Promise<void> {
    const table = entry.table as SyncedTable
    const listId = await this.listId(table)

    if (entry.op === 'delete') {
      const spId = await this.findRemote(table, entry.recordId)
      if (spId) {
        await this.graph.delete(`/sites/${this.siteId}/lists/${listId}/items/${spId}`).catch((e: GraphError) => {
          if (e.status !== 404) throw e
        })
        await db.remoteIds.delete(`${table}:${entry.recordId}`)
      }
      return
    }

    const record = (await db.table(table).get(entry.recordId)) as Record<string, unknown> | undefined
    if (!record) return // deleted since it was queued
    const state = await this.stateFor(record)
    const { fields, binaries } = prepare(table, record, state)

    if (binaries.length) {
      const driveId = await this.drive()
      for (const b of binaries) {
        const blob = await dataUrlToBlob(b.dataUrl)
        await this.graph.put(`/drives/${driveId}/root:/${b.path}:/content`, blob, blob.type || 'application/octet-stream')
      }
    }

    const spId = await this.findRemote(table, entry.recordId)
    if (spId) {
      await this.graph.patch(`/sites/${this.siteId}/lists/${listId}/items/${spId}/fields`, fields)
    } else {
      const created = await this.graph.post<SpItem>(`/sites/${this.siteId}/lists/${listId}/items`, { fields })
      await db.remoteIds.put({ id: `${table}:${entry.recordId}`, spId: created.id })
    }
  }

  async push(report: SyncReport): Promise<void> {
    const entries = await db.outbox.orderBy('at').toArray()
    for (const entry of entries) {
      try {
        await this.pushOne(entry)
        await db.outbox.delete(entry.id)
        report.pushed++
      } catch (err) {
        report.failed++
        const message = err instanceof Error ? err.message : String(err)
        report.errors.push(`${entry.table}/${entry.recordId}: ${message}`)
        await db.outbox.update(entry.id, { attempts: entry.attempts + 1, lastError: message })
        // Auth and site problems will fail every entry the same way.
        if (err instanceof GraphError && (err.status === 401 || err.status === 403)) break
      }
    }
  }

  /* ------------------------------------------------------------- pull */

  async pull(report: SyncReport, opts: { since: number; state?: string }): Promise<number> {
    let newest = opts.since
    for (const table of SYNCED_TABLES) {
      const listId = await this.listId(table)
      const filters = [`fields/UpdatedAt gt ${opts.since}`]
      // Business units are national; everything else is a state's own.
      if (opts.state && table !== 'businessUnits') filters.push(`fields/State eq ${lit(opts.state)}`)
      const items = await this.graph.all<SpItem>(
        `/sites/${this.siteId}/lists/${listId}/items?$expand=fields&$filter=${encodeURIComponent(filters.join(' and '))}`,
        PREFER_UNINDEXED,
      )
      if (!items.length) continue

      const pending = new Set((await db.outbox.where('table').equals(table).toArray()).map((o) => o.recordId))
      await withRemoteWrites(async () => {
        for (const item of items) {
          const raw = item.fields.Payload
          if (typeof raw !== 'string') continue
          let record: Record<string, unknown>
          try {
            record = JSON.parse(raw)
          } catch {
            report.errors.push(`${table}/${item.id}: unreadable payload`)
            continue
          }
          const id = String(record.id ?? item.fields.RecordId)
          const remoteUpdated = Number(record.updatedAt ?? item.fields.UpdatedAt ?? 0)
          newest = Math.max(newest, Number(item.fields.UpdatedAt ?? 0))
          const local = (await db.table(table).get(id)) as Record<string, unknown> | undefined
          if (local && pending.has(id)) continue // ours is newer and still going up
          if (local && Number(local.updatedAt ?? 0) > remoteUpdated) continue
          // A binary the remote holds stays remote until it is needed; keep any
          // copy this device already has.
          if (local?.data && !record.data) record.data = local.data
          if (local?.imageData && !record.imageData) record.imageData = local.imageData
          await db.table(table).put(record)
          await db.remoteIds.put({ id: `${table}:${id}`, spId: item.id })
          report.pulled++
        }
      })
    }
    return newest
  }

  /** Fetches a file from the library as a data URL, for photos pulled without their image. */
  async fetchFile(path: string): Promise<string> {
    const driveId = await this.drive()
    const token = await this.getToken()
    const res = await fetch(`${this.graph.base}/drives/${driveId}/root:/${path}:/content`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new GraphError(`Could not fetch ${path} (${res.status})`, res.status)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
  }
}
