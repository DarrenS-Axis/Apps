import { db, loadOrg, uid } from '../data/db'
import { loadSettings } from '../data/db'
import { recipientsFor } from '../data/people'
import { appBase } from '../lib/qr'

/**
 * Events the app raises for Power Automate.
 *
 * Each is posted as JSON to the flow's "When an HTTP request is received"
 * URL. The flow decides what to do with it — post to the state's Teams
 * channel, email the superintendent, add a row to the monthly report. When
 * the device is offline the event waits in `events` and goes when the next
 * sync runs, so nothing is lost and nothing is sent twice.
 */
export type QaEventType =
  | 'itp.completed_by_site'
  | 'itp.reviewed_approved'
  | 'itp.defected'
  | 'itp.hold_point_reached'
  | 'penetration.completed_by_site'
  | 'penetration.defected'
  | 'penetration.allocated'
  | 'defect.allocated'
  | 'plant.allocated'
  | 'itp.allocated'
  | 'plant.missing'
  | 'notification.test'
  | 'defect.raised'
  | 'defect.closed'
  | 'sync.completed'

export interface QaEvent {
  event: QaEventType
  at: string
  actor: string
  state?: string
  businessUnit?: string
  project?: { id: string; name: string; number?: string; client?: string }
  record?: Record<string, unknown>
  summary: string
  /**
   * Who should be told, from the People profiles: the person work was
   * allocated to, and everyone in the state who asked for this event.
   */
  recipients: { name: string; email: string; why: string }[]
  /** The same, as one "a@x; b@y" string — straight into an Outlook or Teams "To". */
  notifyEmails: string
  /** Opens the record in the app. */
  link?: string
}

/** The JSON schema to paste into the flow trigger, so the fields are typed downstream. */
export const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    event: { type: 'string' },
    at: { type: 'string' },
    actor: { type: 'string' },
    state: { type: 'string' },
    businessUnit: { type: 'string' },
    project: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' }, number: { type: 'string' }, client: { type: 'string' } },
    },
    record: { type: 'object' },
    summary: { type: 'string' },
    recipients: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, why: { type: 'string' } } },
    },
    notifyEmails: { type: 'string' },
    link: { type: 'string' },
  },
}

/** The notification flow: the organisation's (shared through SharePoint), or one set on this device before that existed. */
export async function flowUrl(): Promise<string | undefined> {
  return (await loadOrg())?.powerAutomateUrl || (await loadSettings()).sync.powerAutomateUrl || undefined
}

export async function raiseEvent(
  input: Omit<QaEvent, 'at' | 'actor' | 'recipients' | 'notifyEmails' | 'link'> & { projectId?: string; /** App route, e.g. "/plant/tag/SA-0001". */ link?: string },
): Promise<void> {
  const settings = await loadSettings()
  if (!(await flowUrl())) return
  let project = input.project
  let state = input.state
  let businessUnit = input.businessUnit
  if (input.projectId && !project) {
    const p = await db.projects.get(input.projectId)
    if (p) {
      project = { id: p.id, name: p.name, number: p.projectNumber, client: p.client }
      state = p.state
      businessUnit = (await db.businessUnits.get(p.businessUnitId))?.name
    }
  }
  const record = input.record ?? {}
  const recipients = await recipientsFor(input.event, state, {
    name: typeof record.assignedTo === 'string' ? record.assignedTo : undefined,
    email: typeof record.assignedEmail === 'string' ? record.assignedEmail : undefined,
  })
  const payload: QaEvent = {
    recipients,
    notifyEmails: recipients.map((r) => r.email).join('; '),
    link: input.link ? `${appBase()}#${input.link}` : undefined,
    event: input.event,
    at: new Date().toISOString(),
    actor: settings.userName || settings.sync.account?.name || 'Unknown',
    state,
    businessUnit,
    project,
    record: input.record,
    summary: input.summary,
  }
  await db.events.add({ id: uid('evt'), at: Date.now(), payload, attempts: 0 })
  void flushEvents()
}

let flushing = false

/** Sends queued events, oldest first, stopping at the first failure. */
export async function flushEvents(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 }
  flushing = true
  const result = { sent: 0, failed: 0 }
  try {
    const url = await flowUrl()
    if (!url) return result
    const queued = await db.events.orderBy('at').toArray()
    for (const e of queued) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e.payload) })
        if (!res.ok) throw new Error(`Flow returned ${res.status}`)
        await db.events.delete(e.id)
        result.sent++
      } catch {
        await db.events.update(e.id, { attempts: e.attempts + 1 })
        result.failed++
        break
      }
    }
  } finally {
    flushing = false
  }
  return result
}
