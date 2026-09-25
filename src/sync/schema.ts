import type { SyncedTable } from '../data/db'
import type { Defect, Depot, Drawing, Itp, Penetration, Photo, PlantItem, Project } from '../data/types'
import { PLANT_STATUS_LABEL, QA_STATUS_LABEL } from '../data/types'

/**
 * How each local table is laid out in SharePoint.
 *
 * Every list carries the whole record as JSON in `Payload`, which is what the
 * app reads back, plus a handful of plain columns — state, project, status,
 * cost — so that Power Automate, Power BI and a person looking at the list
 * can filter and total without parsing anything. The plain columns are
 * derived on the way up and never read on the way down, so they cannot
 * drift from the record.
 *
 * Large binaries (plan images, full-size photos, attachments) go to the
 * document library instead; the payload keeps a thumbnail and the file's
 * path.
 */
export type ColumnType = 'text' | 'note' | 'number' | 'boolean' | 'dateTime'

export interface ColumnDef {
  name: string
  type: ColumnType
  indexed?: boolean
}

export interface ListDef {
  table: SyncedTable
  displayName: string
  columns: ColumnDef[]
}

const common: ColumnDef[] = [
  { name: 'RecordId', type: 'text', indexed: true },
  { name: 'State', type: 'text', indexed: true },
  { name: 'UpdatedAt', type: 'number', indexed: true },
  { name: 'Payload', type: 'note' },
]

export const LIBRARY_NAME = 'QA Files'

export const LISTS: ListDef[] = [
  { table: 'businessUnits', displayName: 'QA Business Units', columns: [...common, { name: 'Entity', type: 'text' }] },
  {
    table: 'projects',
    displayName: 'QA Projects',
    columns: [
      ...common,
      { name: 'BusinessUnitId', type: 'text', indexed: true },
      { name: 'ProjectNumber', type: 'text' },
      { name: 'Client', type: 'text' },
      { name: 'Archived', type: 'boolean' },
    ],
  },
  {
    table: 'drawings',
    displayName: 'QA Drawings',
    columns: [...common, { name: 'ProjectId', type: 'text', indexed: true }, { name: 'Number', type: 'text' }, { name: 'Revision', type: 'text' }, { name: 'FilePath', type: 'text' }],
  },
  {
    table: 'itps',
    displayName: 'QA ITPs',
    columns: [
      ...common,
      { name: 'ProjectId', type: 'text', indexed: true },
      { name: 'ItcNumber', type: 'text' },
      { name: 'ItpNumber', type: 'text' },
      { name: 'TemplateCode', type: 'text' },
      { name: 'Area', type: 'text' },
      { name: 'Status', type: 'text', indexed: true },
      { name: 'Progress', type: 'number' },
      { name: 'OpenHolds', type: 'number' },
      { name: 'DateClosed', type: 'text' },
      { name: 'Lat', type: 'number' },
      { name: 'Lng', type: 'number' },
    ],
  },
  {
    table: 'penetrations',
    displayName: 'QA Penetrations',
    columns: [
      ...common,
      { name: 'ProjectId', type: 'text', indexed: true },
      { name: 'Number', type: 'text' },
      { name: 'Kind', type: 'text' },
      { name: 'Size', type: 'text' },
      { name: 'Ref', type: 'text' },
      { name: 'Material', type: 'text' },
      { name: 'FRL', type: 'text' },
      { name: 'ProfileId', type: 'text' },
      { name: 'Status', type: 'text', indexed: true },
      { name: 'Lat', type: 'number' },
      { name: 'Lng', type: 'number' },
      { name: 'DrawingId', type: 'text' },
    ],
  },
  {
    table: 'defects',
    displayName: 'QA Defects',
    columns: [
      ...common,
      { name: 'ProjectId', type: 'text', indexed: true },
      { name: 'Number', type: 'text' },
      { name: 'Service', type: 'text' },
      { name: 'Status', type: 'text', indexed: true },
      { name: 'Cost', type: 'number' },
      { name: 'RaisedAt', type: 'number' },
      { name: 'Lat', type: 'number' },
      { name: 'Lng', type: 'number' },
      { name: 'DrawingId', type: 'text' },
    ],
  },
  {
    table: 'photos',
    displayName: 'QA Photos',
    columns: [
      ...common,
      { name: 'ProjectId', type: 'text', indexed: true },
      { name: 'ItpId', type: 'text' },
      { name: 'PenetrationId', type: 'text' },
      { name: 'DefectId', type: 'text' },
      { name: 'PlantId', type: 'text' },
      { name: 'TakenAt', type: 'number' },
      { name: 'FilePath', type: 'text' },
    ],
  },
  {
    table: 'plant',
    displayName: 'QA Plant',
    columns: [
      ...common,
      { name: 'PlantNo', type: 'text', indexed: true },
      { name: 'AxisNo', type: 'text' },
      { name: 'EquipmentType', type: 'text' },
      { name: 'BrandModel', type: 'text' },
      { name: 'Serial', type: 'text' },
      { name: 'Status', type: 'text', indexed: true },
      { name: 'Location', type: 'text' },
      { name: 'ProjectId', type: 'text' },
      { name: 'DepotId', type: 'text' },
      { name: 'SeenAt', type: 'number' },
      { name: 'SeenBy', type: 'text' },
      { name: 'LastTestAt', type: 'text' },
      { name: 'Lat', type: 'number' },
      { name: 'Lng', type: 'number' },
    ],
  },
  {
    table: 'depots',
    displayName: 'QA Depots',
    columns: [...common, { name: 'Address', type: 'text' }, { name: 'Lat', type: 'number' }, { name: 'Lng', type: 'number' }, { name: 'Radius', type: 'number' }],
  },
]

export const listFor = (table: SyncedTable): ListDef => LISTS.find((l) => l.table === table)!

/** A file that has to go to the document library rather than the list. */
export interface BinaryPart {
  path: string
  dataUrl: string
}

export interface Prepared {
  fields: Record<string, unknown>
  /** The payload with binaries stripped, so it fits a note column. */
  payload: Record<string, unknown>
  binaries: BinaryPart[]
}

const mimeExt = (dataUrl: string): string => {
  const m = /^data:([^;]+);/.exec(dataUrl)
  const mime = m?.[1] ?? 'application/octet-stream'
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'application/pdf' ? 'pdf' : 'bin'
}

/**
 * Turns a local record into list fields plus any files. `state` and the
 * project id are threaded through so every list can be filtered by them
 * without a lookup — that is what keeps a state's pull to its own records.
 */
export function prepare(table: SyncedTable, record: Record<string, unknown>, state: string): Prepared {
  const binaries: BinaryPart[] = []
  const payload: Record<string, unknown> = { ...record }
  const fields: Record<string, unknown> = {
    Title: String(record.name ?? record.title ?? record.number ?? record.id),
    RecordId: record.id,
    State: state,
    UpdatedAt: Number(record.updatedAt ?? record.addedAt ?? Date.now()),
  }

  switch (table) {
    case 'businessUnits':
      fields.Entity = record.entity
      break
    case 'projects': {
      const p = record as unknown as Project
      Object.assign(fields, { BusinessUnitId: p.businessUnitId, ProjectNumber: p.projectNumber, Client: p.client, Archived: Boolean(p.archived) })
      // Logos are small PNGs; they stay in the payload.
      break
    }
    case 'drawings': {
      const d = record as unknown as Drawing
      Object.assign(fields, { ProjectId: d.projectId, Number: d.number, Revision: d.revision })
      if (d.imageData) {
        const path = `plans/${d.projectId}/${d.id}.${mimeExt(d.imageData)}`
        binaries.push({ path, dataUrl: d.imageData })
        payload.imageData = undefined
        payload.filePath = path
        fields.FilePath = path
      }
      break
    }
    case 'itps': {
      const i = record as unknown as Itp
      const openHolds = i.items.filter((it) => it.point === 'H' && it.status !== 'pass' && it.status !== 'na').length
      Object.assign(fields, {
        ProjectId: i.projectId,
        ItcNumber: i.itcNumber ?? '',
        ItpNumber: i.itpNumber,
        TemplateCode: i.templateCode,
        Area: i.area,
        Status: QA_STATUS_LABEL[i.status] ?? i.status,
        Progress: i.progress ?? 0,
        OpenHolds: openHolds,
        DateClosed: i.dateClosed ?? '',
        Lat: i.lat ?? null,
        Lng: i.lng ?? null,
      })
      const attachments = (i.attachments ?? []).map((a) => {
        if (!a.data) return a
        const path = `attachments/${i.projectId}/${i.id}/${a.id}-${a.name}`
        binaries.push({ path, dataUrl: a.data })
        return { ...a, data: undefined, url: path }
      })
      payload.attachments = attachments
      break
    }
    case 'penetrations': {
      const p = record as unknown as Penetration
      Object.assign(fields, {
        ProjectId: p.projectId,
        Number: p.number,
        Kind: p.kind,
        Size: p.size,
        Ref: p.ref,
        Material: p.material,
        FRL: p.frl,
        ProfileId: p.profileId ?? '',
        Status: QA_STATUS_LABEL[p.status] ?? p.status,
        Lat: p.lat ?? null,
        Lng: p.lng ?? null,
        DrawingId: p.drawingId ?? '',
      })
      break
    }
    case 'defects': {
      const d = record as unknown as Defect
      Object.assign(fields, {
        ProjectId: d.projectId,
        Number: d.number,
        Service: d.service,
        Status: d.status,
        Cost: d.cost ?? 0,
        RaisedAt: d.raisedAt,
        Lat: d.lat ?? null,
        Lng: d.lng ?? null,
        DrawingId: d.drawingId ?? '',
      })
      break
    }
    case 'photos': {
      const ph = record as unknown as Photo & { projectId?: string }
      Object.assign(fields, {
        ProjectId: ph.projectId ?? '',
        ItpId: ph.itpId ?? '',
        PenetrationId: ph.penetrationId ?? '',
        DefectId: ph.defectId ?? '',
        PlantId: ph.plantId ?? '',
        TakenAt: ph.takenAt,
      })
      if (ph.data) {
        const folder = ph.projectId ?? (ph.plantId ? `plant/${state || 'unfiled'}` : 'unfiled')
        const path = `photos/${folder}/${ph.id}.${mimeExt(ph.data)}`
        binaries.push({ path, dataUrl: ph.data })
        payload.data = undefined
        payload.filePath = path
        fields.FilePath = path
      }
      break
    }
    case 'plant': {
      const p = record as unknown as PlantItem
      fields.Title = `${p.plantNo} ${p.type}`.trim()
      Object.assign(fields, {
        PlantNo: p.plantNo,
        AxisNo: p.axisNo ?? '',
        EquipmentType: p.type,
        BrandModel: p.brandModel,
        Serial: p.serial,
        Status: PLANT_STATUS_LABEL[p.status] ?? p.status,
        Location: p.location,
        ProjectId: p.projectId ?? '',
        DepotId: p.depotId ?? '',
        SeenAt: p.seenAt ?? null,
        SeenBy: p.seenBy ?? '',
        LastTestAt: p.lastTestAt ?? '',
        Lat: p.lat ?? null,
        Lng: p.lng ?? null,
      })
      break
    }
    case 'depots': {
      const d = record as unknown as Depot
      Object.assign(fields, { Address: d.address, Lat: d.lat ?? null, Lng: d.lng ?? null, Radius: d.radius })
      break
    }
  }

  fields.Payload = JSON.stringify(payload)
  return { fields, payload, binaries }
}
