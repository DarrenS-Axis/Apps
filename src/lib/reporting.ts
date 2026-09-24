import type { BusinessUnit, Defect, Itp, Penetration, Project, QaStatus, ServiceType } from '../data/types'
import { isOutstanding } from '../data/types'
import { deriveStatus } from './format'

/**
 * The monthly QA report, computed rather than compiled.
 *
 * The Controldoc report has three parts and these reproduce them from the
 * records: the Firedoc summary (Setup / In progress / Completed by site /
 * Reviewed & approved / Defected / Outstanding per project), the completed
 * ITP trend over three months, and Reviewdoc value and quantity by service
 * type and by project. Run for one business unit, one state, or nationally.
 */

export interface StatusCounts {
  setup: number
  in_progress: number
  completed_by_site: number
  reviewed_approved: number
  defected: number
  outstanding: number
  total: number
}

const emptyCounts = (): StatusCounts => ({
  setup: 0,
  in_progress: 0,
  completed_by_site: 0,
  reviewed_approved: 0,
  defected: 0,
  outstanding: 0,
  total: 0,
})

function tally(counts: StatusCounts, status: QaStatus): void {
  counts[status] += 1
  counts.total += 1
  if (isOutstanding(status)) counts.outstanding += 1
}

/**
 * "Setup" in the Firedoc report is the count of penetrations on the register
 * — every one starts there — so `total` is what the report prints under Setup.
 */
export function firedocSummary(penetrations: Penetration[]): StatusCounts {
  const c = emptyCounts()
  for (const p of penetrations) tally(c, p.status)
  return c
}

export function controldocSummary(itps: Itp[]): StatusCounts {
  const c = emptyCounts()
  for (const i of itps) tally(c, deriveStatus(i))
  return c
}

/** Month key like "2024-09". */
export const monthKey = (epoch: number): string => new Date(epoch).toISOString().slice(0, 7)

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
}

/** The last `n` months, oldest first, ending with the current one. */
export function recentMonths(n: number, now = Date.now()): string[] {
  const out: string[] = []
  const d = new Date(now)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** When an ITP counts as completed for the trend: the site sign-off date. */
export function itpCompletedAt(itp: Itp): number | undefined {
  const signed = itp.axisSignOff?.at ?? itp.signOff?.at
  if (signed) return signed
  if (itp.dateCompleted) return Date.parse(itp.dateCompleted)
  return undefined
}

/** Completed ITPs per month for each project over the given months. */
export function completedTrend(itps: Itp[], months: string[]): Map<string, number> {
  const out = new Map(months.map((m) => [m, 0]))
  for (const i of itps) {
    const at = itpCompletedAt(i)
    if (!at) continue
    const k = monthKey(at)
    if (out.has(k)) out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}

export interface ReviewdocTotals {
  value: number
  qty: number
  byService: Map<ServiceType, { value: number; qty: number }>
}

export function reviewdocTotals(defects: Defect[]): ReviewdocTotals {
  const byService = new Map<ServiceType, { value: number; qty: number }>()
  let value = 0
  for (const d of defects) {
    value += d.cost ?? 0
    const s = byService.get(d.service) ?? { value: 0, qty: 0 }
    s.value += d.cost ?? 0
    s.qty += 1
    byService.set(d.service, s)
  }
  return { value, qty: defects.length, byService }
}

export interface ProjectReportRow {
  project: Project
  unit?: BusinessUnit
  firedoc: StatusCounts
  controldoc: StatusCounts
  trend: Map<string, number>
  reviewdoc: ReviewdocTotals
}

export interface QaReport {
  months: string[]
  rows: ProjectReportRow[]
  firedoc: StatusCounts
  controldoc: StatusCounts
  trend: Map<string, number>
  reviewdoc: ReviewdocTotals
}

/** Builds the report for whichever projects are handed in. */
export function buildReport(input: {
  projects: Project[]
  units: BusinessUnit[]
  itps: Itp[]
  penetrations: Penetration[]
  defects: Defect[]
  months?: string[]
}): QaReport {
  const months = input.months ?? recentMonths(3)
  const unitById = new Map(input.units.map((u) => [u.id, u]))
  const rows: ProjectReportRow[] = input.projects.map((project) => {
    const itps = input.itps.filter((i) => i.projectId === project.id)
    const pens = input.penetrations.filter((p) => p.projectId === project.id)
    const defs = input.defects.filter((d) => d.projectId === project.id)
    return {
      project,
      unit: unitById.get(project.businessUnitId),
      firedoc: firedocSummary(pens),
      controldoc: controldocSummary(itps),
      trend: completedTrend(itps, months),
      reviewdoc: reviewdocTotals(defs),
    }
  })
  rows.sort((a, b) => (a.unit?.name ?? '').localeCompare(b.unit?.name ?? '') || a.project.name.localeCompare(b.project.name))
  const projectIds = new Set(input.projects.map((p) => p.id))
  const scoped = <T extends { projectId: string }>(list: T[]) => list.filter((x) => projectIds.has(x.projectId))
  return {
    months,
    rows,
    firedoc: firedocSummary(scoped(input.penetrations)),
    controldoc: controldocSummary(scoped(input.itps)),
    trend: completedTrend(scoped(input.itps), months),
    reviewdoc: reviewdocTotals(scoped(input.defects)),
  }
}

export const aud = (n: number): string => `$${Math.round(n).toLocaleString('en-AU')}`
