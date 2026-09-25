import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Drawing, FfeType, Project, Room, RoomItem, Submission } from '../data/types'
import { REVIEW_STATUS_LABEL, SUBMISSION_REVIEWERS } from '../data/types'
import { buildSchedule, checks, totals } from './roomData'
import { formatDate, formatDateTime } from './format'
import { importPlanFile } from './planImport'

/**
 * The room data schedule and the sample submission form, as PDFs.
 */

const INK: [number, number, number] = [16, 32, 44]
const LINE: [number, number, number] = [60, 70, 80]
const HEAD: [number, number, number] = [214, 231, 205]
const ROOM: [number, number, number] = [236, 243, 232]
const AMBER: [number, number, number] = [161, 98, 7]

function logo(doc: jsPDF, data: string | undefined, x: number, y: number, maxW: number, maxH: number): number {
  if (!data) return 0
  try {
    const p = doc.getImageProperties(data)
    const s = Math.min(maxW / p.width, maxH / p.height)
    doc.addImage(data, (p.fileType || 'PNG').toUpperCase(), x, y + (maxH - p.height * s) / 2, p.width * s, p.height * s, undefined, 'FAST')
    return p.width * s
  } catch {
    return 0
  }
}

/* ------------------------------------------------------------ room data */

export function roomDataPdf(input: { project: Project; types: FfeType[]; rooms: Room[]; items: RoomItem[]; plans: Drawing[] }): Blob {
  const { project, types, rooms, items } = input
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const W = 297
  const header = (title: string) => {
    const lw = logo(doc, project.contractorLogo, 12, 7, 40, 14)
    doc.setTextColor(...INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(title, lw ? 12 + lw + 6 : 12, 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text([project.name, project.projectNumber, project.client, `Issued ${formatDateTime(Date.now())}`].filter(Boolean).join('  ·  '), lw ? 12 + lw + 6 : 12, 19)
  }

  header('HYDRAULIC FIXTURE SCHEDULE — ROOM DATA')
  const groups = buildSchedule(types, rooms, items)
  const body: (string | number | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = []
  let level = ''
  for (const g of groups) {
    if (g.room?.level && g.room.level !== level) {
      level = g.room.level
      body.push([{ content: level, colSpan: 10, styles: { fontStyle: 'bold', fillColor: [255, 255, 255] } }])
    }
    body.push([
      { content: '', styles: { fillColor: ROOM } },
      { content: g.room ? g.room.name : g.heading, styles: { fontStyle: 'bold', fillColor: ROOM } },
      { content: g.room?.number ?? '', styles: { fontStyle: 'bold', fillColor: ROOM } },
      { content: '', colSpan: 7, styles: { fillColor: ROOM } },
    ])
    for (const l of g.lines) {
      const style = l.flag ? { textColor: AMBER } : {}
      body.push([
        { content: l.sampleRef, styles: style },
        '',
        '',
        { content: l.fixture + (l.flag ? `\n(${l.flag})` : ''), styles: style },
        { content: l.code, styles: { fontStyle: 'bold' } },
        l.tapwareCode,
        typeof l.qty === 'number' ? l.qty : String(l.qty),
        l.inWall,
        l.description,
        l.finish,
      ])
    }
  }
  autoTable(doc, {
    startY: 25,
    margin: { left: 8, right: 8 },
    theme: 'grid',
    styles: { fontSize: 6.3, cellPadding: 1.1, lineColor: LINE, lineWidth: 0.15, textColor: INK, valign: 'top' },
    headStyles: { fillColor: HEAD, textColor: INK, fontStyle: 'bold' },
    head: [['Sample Ref.', 'Room Type / Area', 'Room No.', 'Fixture', 'Code', 'Tapware Code', 'Qty', 'In wall items', 'Description', 'Colour / Finish']],
    body: body as never,
    rowPageBreak: 'avoid',
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 26 }, 2: { cellWidth: 17 }, 3: { cellWidth: 34 }, 4: { cellWidth: 12 }, 5: { cellWidth: 22 }, 6: { cellWidth: 9, halign: 'center' }, 7: { cellWidth: 26 }, 9: { cellWidth: 26 } },
  })

  // Totals against the schedule.
  doc.addPage()
  header('SANITARY & TAPWARE SCHEDULE — QUANTITIES')
  const tot = totals(types, items)
  autoTable(doc, {
    startY: 25,
    margin: { left: 12, right: 12 },
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.3, lineColor: LINE, lineWidth: 0.15, textColor: INK, valign: 'top' },
    headStyles: { fillColor: HEAD, textColor: INK, fontStyle: 'bold' },
    head: [['Sample Ref.', 'Sanitary Code', 'Tapware Code', 'Selection / Description', 'Colour / Finish', 'In rooms', 'Schedule', 'Check']],
    body: tot.map((t) => [
      t.type.sampleRef,
      t.type.kind === 'tapware' ? '' : t.type.code,
      t.type.kind === 'tapware' ? t.type.code : '',
      [t.type.name, t.type.description].filter(Boolean).join('\n'),
      t.type.finish,
      t.placed,
      t.scheduled ?? '',
      t.scheduled !== undefined && t.scheduled !== t.placed ? `${t.placed > t.scheduled ? '+' : ''}${t.placed - t.scheduled}` : '',
    ]),
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 18, fontStyle: 'bold' }, 2: { cellWidth: 28 }, 4: { cellWidth: 32 }, 5: { cellWidth: 15, halign: 'center' }, 6: { cellWidth: 16, halign: 'center' }, 7: { cellWidth: 14, halign: 'center', textColor: AMBER } },
    foot: [['', '', 'TOTAL ITEMS', '', '', tot.reduce((n, t) => n + t.placed, 0), tot.reduce((n, t) => n + (t.scheduled ?? 0), 0) || '', '']],
    footStyles: { fillColor: HEAD, textColor: INK, fontStyle: 'bold' },
  })

  const list = checks(types, rooms, items)
  if (list.length) {
    doc.addPage()
    header('CHECKS BEFORE ISSUE')
    autoTable(doc, {
      startY: 25,
      margin: { left: 12, right: 12 },
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.5, lineColor: LINE, lineWidth: 0.15, textColor: INK },
      headStyles: { fillColor: HEAD, textColor: INK, fontStyle: 'bold' },
      head: [['#', 'Kind', 'Item']],
      body: list.map((c, i) => [i + 1, { room: 'Room to confirm', missing: 'Not placed', quantity: 'Quantity', unknown: 'Not in schedule', unassigned: 'No room' }[c.kind], c.text]),
      columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 32 } },
    })
  }

  // The plans, marked up with every placed item.
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  for (const plan of input.plans) {
    if (!plan.imageData || !plan.imageWidth || !plan.imageHeight) continue
    const pins = items.filter((i) => i.drawingId === plan.id && i.x !== undefined && i.y !== undefined)
    if (!pins.length) continue
    doc.addPage()
    header(`FF&E MARK-UP — ${plan.number} ${plan.revision}`.trim())
    const maxW = W - 24
    const maxH = 210 - 32
    const s = Math.min(maxW / plan.imageWidth, maxH / plan.imageHeight)
    const w = plan.imageWidth * s
    const h = plan.imageHeight * s
    const x0 = 12 + (maxW - w) / 2
    const y0 = 25
    try {
      doc.addImage(plan.imageData, 'JPEG', x0, y0, w, h, undefined, 'FAST')
    } catch {
      continue
    }
    doc.setFontSize(4.5)
    for (const p of pins) {
      const px = x0 + p.x! * w
      const py = y0 + p.y! * h
      doc.setDrawColor(255, 255, 255)
      doc.setLineWidth(0.3)
      if (p.check) doc.setFillColor(217, 119, 6)
      else doc.setFillColor(15, 122, 194)
      doc.circle(px, py, 1.3, 'FD')
      doc.setTextColor(...INK)
      doc.setFont('helvetica', 'bold')
      const r = p.roomId ? roomById.get(p.roomId) : undefined
      doc.text(`${p.code}${r ? ` · ${r.number}` : ''}`, px + 1.8, py + 0.8)
    }
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setFillColor(15, 122, 194)
    doc.circle(14, 205, 1.3, 'F')
    doc.text('Placed', 17, 206)
    doc.setFillColor(217, 119, 6)
    doc.circle(34, 205, 1.3, 'F')
    doc.text('Room to confirm', 37, 206)
  }
  return doc.output('blob')
}

/* ----------------------------------------------------- sample submission */

/**
 * The Sample Submission Form as the builders issue it, then the tech data
 * behind it: images as they are, PDF data sheets drawn page by page.
 */
export async function submissionPdf(input: { project: Project; sub: Submission }): Promise<Blob> {
  const { project, sub } = input
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const L = 16
  const R = 194
  const Wd = R - L
  doc.setTextColor(...INK)
  doc.setDrawColor(...INK)

  // The builder's logo (the client on the job), and ours.
  const lw = logo(doc, project.clientLogo, L, 10, 42, 18)
  if (!lw && project.client) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(project.client, L, 22)
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('SAMPLE SUBMISSION FORM', R, 24, { align: 'right' })

  let y = 32
  const LINE_H = (size: number) => (size * 1.15) / 2.835 // pt to mm at the text's line height
  const cell = (x: number, yy: number, w: number, h: number, text: string | string[], bold = false, size = 8.5) => {
    doc.setLineWidth(0.3)
    doc.rect(x, yy, w, h)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    const lines = Array.isArray(text) ? text : doc.splitTextToSize(text || '', w - 3)
    doc.text(lines, x + 1.5, yy + 4, { lineHeightFactor: 1.15 })
  }
  /** Wraps a value to a column, smaller type when it runs long, and says what was left off. */
  const fit = (text: string, w: number, maxLines: number, more: (n: number) => string) => {
    for (const size of [8.5, 7.5, 6.5]) {
      doc.setFontSize(size)
      const lines: string[] = doc.splitTextToSize(text || '', w - 3)
      if (lines.length <= maxLines || size === 6.5) {
        if (lines.length <= maxLines) return { lines, size }
        // Cut at a whole entry and say how many are left.
        const joined = lines.slice(0, maxLines - 1).join(' ')
        const cut = joined.lastIndexOf(',') > 0 ? joined.slice(0, joined.lastIndexOf(',') + 1) : joined
        const left = text.split(',').length - (cut.split(',').length - 1)
        return { lines: [...(doc.splitTextToSize(cut, w - 3) as string[]), ...(doc.splitTextToSize(more(Math.max(1, left)), w - 3) as string[])], size }
      }
    }
    return { lines: [text], size: 8.5 }
  }
  const heightOf = (lines: number, size: number, min = 8.5) => Math.max(min, 2.5 + lines * LINE_H(size) + 1.5)
  const row4 = (a: string, b: string, c: string, d: string, h = 8.5) => {
    doc.setFontSize(8.5)
    const need = Math.max(...[
      [a, 45],
      [b, 40],
      [c, 38],
      [d, Wd - 123],
    ].map(([t, w]) => heightOf(doc.splitTextToSize(String(t) || '', Number(w) - 3).length, 8.5)))
    h = Math.max(h, need)
    cell(L, y, 45, h, a, true)
    cell(L + 45, y, 40, h, b)
    cell(L + 85, y, 38, h, c, true)
    cell(L + 123, y, Wd - 123, h, d)
    y += h
  }
  const row2 = (a: string, b: string, h = 8.5) => {
    cell(L, y, 45, h, a, true)
    cell(L + 45, y, Wd - 45, h, b)
    y += h
  }
  const bar = (text: string, h = 7, heavy = false) => {
    doc.setLineWidth(heavy ? 0.8 : 0.3)
    doc.rect(L, y, Wd, h)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(text, L + 1.5, y + 4.7)
    y += h
  }
  const builder = project.client ? project.client.toUpperCase() : 'BUILDER'
  row4('PROJECT:', project.name, `${builder} SAMPLE NO.`, sub.builderNo ?? '')
  row4('DATE SUBMITTED:', sub.dateSubmitted ? formatDate(sub.dateSubmitted) : '', 'SC / ALA SAMPLE No.', sub.number)
  row4('DISCIPLINE:', sub.discipline, 'SPECIFIED:', sub.specified)
  row4('SUBCONTRACTOR/ SUPPLIER:', sub.supplier, 'PHOTO ATTACHED:', sub.photoAttached)
  {
    // The location can list a dozen rooms: smaller type, then a pointer to the room data.
    const loc = fit(sub.location, 40, 9, (n) => `+ ${n} more — see room data schedule`)
    const h = Math.max(heightOf(loc.lines.length, loc.size), heightOf(2, 8.5))
    cell(L, y, 45, h, 'LOCATION:', true)
    cell(L + 45, y, 40, h, loc.lines, false, loc.size)
    cell(L + 85, y, 38, h, 'TECH DATA INCLUDED: Y/N', true)
    cell(L + 123, y, Wd - 123, h, sub.techDataIncluded ? 'Y' : 'N')
    y += h
  }
  doc.setFontSize(8.5)
  row2('SAMPLE TITLE:', sub.title, heightOf(doc.splitTextToSize(sub.title || '', Wd - 48).length, 8.5))
  {
    const desc = fit(sub.description, Wd - 45, 7, () => '(continued in the tech data)')
    const h = heightOf(desc.lines.length, desc.size, 11)
    cell(L, y, 45, h, 'DESCRIPTION OF SUBMISSION:', true)
    cell(L + 45, y, Wd - 45, h, desc.lines, false, desc.size)
    y += h
  }
  doc.setLineWidth(0.8)
  doc.line(L, y, R, y)
  bar('APPROVAL / RESPONSE:')

  const tick = (x: number, yy: number, on: boolean) => {
    doc.setDrawColor(41, 98, 170)
    doc.setLineWidth(0.5)
    doc.rect(x, yy, 6, 4.4)
    if (on) {
      doc.setLineWidth(0.7)
      doc.line(x + 1.2, yy + 2.3, x + 2.6, yy + 3.6)
      doc.line(x + 2.6, yy + 3.6, x + 5, yy + 0.8)
    }
    doc.setDrawColor(...INK)
  }
  for (const { key, label } of SUBMISSION_REVIEWERS) {
    const r = sub.reviews[key] ?? { status: '' as const }
    bar(`${label}:`, 7, true)
    cell(L, y, Wd / 2 - 6, 7, `Name: ${r.name ?? ''}`)
    cell(L + Wd / 2 - 6, y, Wd / 2 + 6, 7, `Company: ${r.company ?? ''}`)
    y += 7
    cell(L, y, Wd / 2 - 6, 7, 'Signature:')
    if (r.signature) logo(doc, r.signature, L + 20, y + 0.5, 40, 6)
    cell(L + Wd / 2 - 6, y, Wd / 2 + 6, 7, `Date: ${r.date ? formatDate(r.date) : ''}`)
    y += 7
    cell(L, y, Wd, 6.5, 'Approval Status (please tick):')
    y += 6.5
    cell(L, y, 55, 7, 'Approved:')
    tick(L + 47, y + 1.3, r.status === 'approved')
    cell(L + 55, y, 70, 7, 'Approved subject to comments:')
    tick(L + 116, y + 1.3, r.status === 'approved_comments')
    cell(L + 125, y, Wd - 125, 7, 'Rejected:')
    tick(R - 9, y + 1.3, r.status === 'rejected')
    y += 7
    cell(L, y, Wd, 9, `Comments: ${r.comments ?? ''}`)
    y += 9
  }
  doc.setLineWidth(0.8)
  doc.line(L, y, R, y)
  cell(L, y, Wd, 11, `General Comments: ${sub.generalComments ?? ''}`)
  y += 11
  cell(L, y, 55, 7, `Made By: ${sub.madeBy ?? ''}`)
  cell(L + 55, y, 60, 7, `Date: ${sub.madeDate ? formatDate(sub.madeDate) : ''}`)
  cell(L + 115, y, Wd - 115, 7, `Company: ${sub.supplier}`)
  y += 7
  cell(L, y, Wd, 10, 'Any approvals or rejections will not relieve the contractor of any of their obligations to carry out the works in accordance with the requirements of the contract.', false, 7.5)
  doc.setLineWidth(0.8)
  doc.rect(L, 32, Wd, y + 10 - 32)

  // The tech data.
  for (const a of sub.attachments) {
    if (!a.data) continue
    try {
      if (/^data:image\//.test(a.data)) {
        doc.addPage()
        const p = doc.getImageProperties(a.data)
        const s = Math.min(180 / p.width, 267 / p.height)
        doc.addImage(a.data, (p.fileType || 'JPEG').toUpperCase(), 15 + (180 - p.width * s) / 2, 15, p.width * s, p.height * s, undefined, 'FAST')
      } else if (/^data:application\/pdf/.test(a.data)) {
        const blob = await (await fetch(a.data)).blob()
        const pages = await importPlanFile(blob, { fileName: a.name, maxPages: 30 })
        for (const pg of pages.pages) {
          const portrait = pg.height >= pg.width
          doc.addPage('a4', portrait ? 'portrait' : 'landscape')
          const pw = portrait ? 210 : 297
          const ph = portrait ? 297 : 210
          const s = Math.min((pw - 16) / pg.width, (ph - 16) / pg.height)
          doc.addImage(pg.data, 'JPEG', (pw - pg.width * s) / 2, (ph - pg.height * s) / 2, pg.width * s, pg.height * s, undefined, 'FAST')
        }
      }
    } catch {
      // A data sheet that cannot be read is left out rather than failing the form.
    }
  }
  return doc.output('blob')
}

export const reviewSummary = (sub: Submission): string =>
  SUBMISSION_REVIEWERS.map(({ key, label }) => {
    const r = sub.reviews[key]
    return r?.status ? `${label.split(' ')[0]}: ${REVIEW_STATUS_LABEL[r.status]}` : ''
  })
    .filter(Boolean)
    .join(' · ')
