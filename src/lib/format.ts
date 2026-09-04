import type { Itp, ItpItem, ItpStatus } from '../data/types'

const pad = (n: number) => String(n).padStart(2, '0')

/** dd/mm/yyyy — the convention on the paper form. */
export function formatDate(value?: string | number): string {
  if (value === undefined || value === '') return ''
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function formatDateTime(epoch?: number): string {
  if (!epoch) return ''
  const d = new Date(epoch)
  return `${formatDate(epoch)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "3 days ago" style, for list screens. */
export function relativeTime(epoch: number): string {
  const diff = Date.now() - epoch
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return formatDate(epoch)
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10)

/* -------------------------------------------------------------- progress */

export interface ItpProgress {
  total: number
  /** Items that count toward completion — everything except N/A. */
  applicable: number
  signed: number
  failed: number
  na: number
  percent: number
  /** Hold points not yet released. */
  openHolds: ItpItem[]
  /** Witness points not yet signed. */
  openWitness: ItpItem[]
  /** The first hold point that is blocking work from proceeding. */
  blockingHold?: ItpItem
}

export function itpProgress(itp: Itp): ItpProgress {
  const total = itp.items.length
  const na = itp.items.filter((i) => i.status === 'na').length
  const signed = itp.items.filter((i) => i.status === 'pass').length
  const failed = itp.items.filter((i) => i.status === 'fail').length
  const applicable = total - na
  const openHolds = itp.items.filter((i) => i.point === 'H' && i.status !== 'pass' && i.status !== 'na')
  const openWitness = itp.items.filter((i) => i.point === 'W' && i.status !== 'pass' && i.status !== 'na')
  return {
    total,
    applicable,
    signed,
    failed,
    na,
    percent: applicable === 0 ? 100 : Math.round((signed / applicable) * 100),
    openHolds,
    openWitness,
    blockingHold: openHolds[0],
  }
}

/**
 * A hold point stops the work that follows it. An item is blocked when an
 * earlier hold point in the schedule has not been released.
 */
export function blockingHoldFor(itp: Itp, index: number): ItpItem | undefined {
  for (let i = 0; i < index; i++) {
    const item = itp.items[i]
    if (item.point === 'H' && item.status !== 'pass' && item.status !== 'na') return item
  }
  return undefined
}

/** Status derived from the schedule, so a list never disagrees with the detail. */
export function deriveStatus(itp: Itp): ItpStatus {
  if (itp.status === 'closed') return 'closed'
  const p = itpProgress(itp)
  if (p.signed === 0 && p.failed === 0) return 'draft'
  if (p.signed + p.na >= p.total && itp.signOff?.name) return 'complete'
  if (p.blockingHold && p.signed > 0) return 'awaiting_hold'
  return 'in_progress'
}

export function statusChipClass(status: ItpStatus): string {
  switch (status) {
    case 'complete':
      return 'chip--ok'
    case 'closed':
      return 'chip--accent'
    case 'awaiting_hold':
      return 'chip--hold'
    case 'in_progress':
      return 'chip--warn'
    default:
      return ''
  }
}

/** File-name-safe slug for exports. */
export function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
