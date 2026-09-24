import type { GraphClient } from './graph'
import { LIBRARY_NAME, LISTS, type ColumnDef } from './schema'

interface SpList {
  id: string
  displayName: string
  list?: { template?: string }
}

/** Resolves the Graph site id from a SharePoint site URL. */
export async function resolveSiteId(graph: GraphClient, siteUrl: string): Promise<string> {
  const u = new URL(siteUrl)
  const path = u.pathname.replace(/\/+$/, '')
  const site = await graph.get<{ id: string }>(`/sites/${u.hostname}:${path}`)
  return site.id
}

function columnBody(c: ColumnDef): Record<string, unknown> {
  const body: Record<string, unknown> = { name: c.name, indexed: Boolean(c.indexed) }
  switch (c.type) {
    case 'text':
      body.text = { maxLength: 255 }
      break
    case 'note':
      body.text = { allowMultipleLines: true, textType: 'plain', linesForEditing: 6 }
      break
    case 'number':
      body.number = { decimalPlaces: 'automatic' }
      break
    case 'boolean':
      body.boolean = {}
      break
    case 'dateTime':
      body.dateTime = { format: 'dateTime' }
      break
  }
  return body
}

export interface ProvisionReport {
  created: string[]
  existing: string[]
  columnsAdded: number
}

/**
 * Creates every QA list and the document library on the site if they are not
 * there, and adds any column a list is missing. Safe to run again after an
 * upgrade: it only ever adds.
 */
export async function provision(graph: GraphClient, siteId: string): Promise<ProvisionReport> {
  const report: ProvisionReport = { created: [], existing: [], columnsAdded: 0 }
  const existing = await graph.all<SpList>(`/sites/${siteId}/lists?$select=id,displayName,list`)
  const byName = new Map(existing.map((l) => [l.displayName, l]))

  for (const def of LISTS) {
    let list = byName.get(def.displayName)
    if (!list) {
      list = await graph.post<SpList>(`/sites/${siteId}/lists`, {
        displayName: def.displayName,
        columns: def.columns.map(columnBody),
        list: { template: 'genericList', contentTypesEnabled: false },
      })
      report.created.push(def.displayName)
      continue
    }
    report.existing.push(def.displayName)
    const cols = await graph.all<{ name: string }>(`/sites/${siteId}/lists/${list.id}/columns?$select=name`)
    const have = new Set(cols.map((c) => c.name))
    for (const c of def.columns) {
      if (have.has(c.name)) continue
      await graph.post(`/sites/${siteId}/lists/${list.id}/columns`, columnBody(c))
      report.columnsAdded++
    }
  }

  if (!byName.has(LIBRARY_NAME)) {
    await graph.post(`/sites/${siteId}/lists`, { displayName: LIBRARY_NAME, list: { template: 'documentLibrary' } })
    report.created.push(LIBRARY_NAME)
  } else {
    report.existing.push(LIBRARY_NAME)
  }
  return report
}

/** Map of list display name → id, fetched once per sync. */
export async function listIds(graph: GraphClient, siteId: string): Promise<Map<string, string>> {
  const lists = await graph.all<SpList>(`/sites/${siteId}/lists?$select=id,displayName`)
  return new Map(lists.map((l) => [l.displayName, l.id]))
}

/** The drive id of the QA Files library. */
export async function libraryDriveId(graph: GraphClient, siteId: string): Promise<string> {
  const drives = await graph.all<{ id: string; name: string }>(`/sites/${siteId}/drives?$select=id,name`)
  const drive = drives.find((d) => d.name === LIBRARY_NAME)
  if (!drive) throw new Error(`The "${LIBRARY_NAME}" library is missing — run Provision first.`)
  return drive.id
}
