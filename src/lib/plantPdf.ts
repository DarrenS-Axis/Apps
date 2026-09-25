import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { PlantItem } from '../data/types'
import { PLANT_STATUS_LABEL } from '../data/types'
import { formatDate, formatDateTime } from './format'
import { plantLink, qrMatrix } from './qr'

/**
 * QR labels and the plant list, drawn as vectors so the codes print sharp on
 * any printer and scan from a metre away.
 */

/**
 * Avery L7160 / J8160: 21 labels, 63.5 × 38.1 mm, three across and seven
 * down on A4. The same layout fits most "21 per sheet" labels.
 */
const SHEET = { cols: 3, rows: 7, w: 63.5, h: 38.1, left: 7.2, top: 15.1, pitchX: 66.0, pitchY: 38.1 }

export interface LabelSpec {
  plantNo: string
  type?: string
  brandModel?: string
  axisNo?: string
}

/** Draws the code inside a `size` square, keeping a two-module quiet zone within it. */
function drawQr(doc: jsPDF, text: string, x: number, y: number, size: number): void {
  const m = qrMatrix(text)
  const cell = size / (m.length + 4)
  x += cell * 2
  y += cell * 2
  doc.setFillColor(0, 0, 0)
  m.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      if (!row[c]) {
        c++
        continue
      }
      const start = c
      while (c < row.length && row[c]) c++
      // A hair of overlap so no printer leaves white seams between modules.
      doc.rect(x + start * cell, y + r * cell, (c - start) * cell + 0.02, cell + 0.02, 'F')
    }
  })
}

/** One label's content inside its box. */
function drawLabel(doc: jsPDF, spec: LabelSpec, x: number, y: number, entity: string): void {
  // With the label's own margin that is four clear modules round the code, as the QR standard asks.
  const pad = 1.4
  const qr = SHEET.h - pad * 2
  drawQr(doc, plantLink(spec.plantNo), x + pad, y + pad, qr)
  const tx = x + pad + qr + 0.6
  const tw = SHEET.w - (tx - x) - pad
  doc.setTextColor(16, 32, 44)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.text('AXIS PLANT', tx, y + 6)
  doc.setFontSize(13)
  doc.text(spec.plantNo, tx, y + 12.5, { maxWidth: tw })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  const lines = doc.splitTextToSize([spec.type, spec.brandModel].filter(Boolean).join(' · ') || ' ', tw).slice(0, 3)
  doc.text(lines, tx, y + 17)
  if (spec.axisNo) doc.text(`Tool no. ${spec.axisNo}`, tx, y + 17 + lines.length * 3)
  doc.setFontSize(5.5)
  doc.setTextColor(90, 100, 110)
  doc.text(doc.splitTextToSize(`Property of ${entity}. Scan to log where it is.`, tw).slice(0, 2), tx, y + SHEET.h - 5.2)
}

/**
 * A sheet (or sheets) of QR labels. `skip` leaves that many labels blank at
 * the start, so a part-used sheet can go back through the printer.
 */
export function plantLabelsPdf(specs: LabelSpec[], opts: { entity: string; skip?: number; outlines?: boolean }): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const perPage = SHEET.cols * SHEET.rows
  const skip = Math.max(0, Math.min(perPage - 1, opts.skip ?? 0))
  specs.forEach((spec, i) => {
    const slot = i + skip
    if (slot > 0 && slot % perPage === 0) doc.addPage()
    const n = slot % perPage
    const x = SHEET.left + (n % SHEET.cols) * SHEET.pitchX
    const y = SHEET.top + Math.floor(n / SHEET.cols) * SHEET.pitchY
    if (opts.outlines) {
      doc.setDrawColor(200, 205, 210)
      doc.setLineWidth(0.1)
      doc.roundedRect(x, y, SHEET.w, SHEET.h, 2, 2, 'S')
    }
    drawLabel(doc, spec, x, y, opts.entity)
  })
  return doc.output('blob')
}

/**
 * The plant list, as the AXIMSRG-03 form sets it out — for the principal
 * contractor on the first of each month, or for the yard.
 */
export function plantListPdf(items: PlantItem[], opts: { title: string; entity: string; subtitle?: string }): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(`${opts.entity} — Plant & Equipment Register`, 12, 15)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text([opts.title, opts.subtitle, `AXIMSRG-03 · Issued ${formatDateTime(Date.now())} · ${items.length} items`].filter(Boolean).join('  ·  '), 12, 20)
  doc.setFontSize(6.5)
  doc.setTextColor(70, 80, 90)
  doc.text(
    doc.splitTextToSize(
      'SITE: The plant listed below will be brought onto site and operated under our control. None of the listed mobile plant will be operated or static plant used until appropriate plant inspection and maintenance records have been provided to the Principal Contractor. All inspection and maintenance records will as a minimum comply with the manufacturer’s recommendations or the relevant Australian Standard.',
      273,
    ),
    12,
    24.5,
  )
  doc.setTextColor(16, 32, 44)
  autoTable(doc, {
    startY: 31,
    margin: { left: 12, right: 12 },
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.3, lineColor: [130, 140, 150], lineWidth: 0.2 },
    headStyles: { fillColor: [214, 231, 205], textColor: [16, 32, 44], fontStyle: 'bold' },
    head: [['Plant no.', 'Equipment type', 'Brand and model', 'Serial #', 'Axis no.', 'Location', 'Status', 'Calibration', 'Last test / tag', 'Last seen']],
    body: items.map((i) => [
      i.plantNo,
      i.type,
      i.brandModel,
      i.serial,
      i.axisNo ?? '',
      i.location,
      PLANT_STATUS_LABEL[i.status],
      i.calibratedAt ? formatDate(i.calibratedAt) : (i.calibration ?? ''),
      i.lastTestAt ? formatDate(i.lastTestAt) : (i.lastTestNote ?? ''),
      i.seenAt ? `${formatDateTime(i.seenAt)}${i.seenBy ? ` · ${i.seenBy}` : ''}` : '',
    ]),
    columnStyles: { 0: { cellWidth: 18, fontStyle: 'bold' }, 4: { cellWidth: 18 }, 6: { cellWidth: 20 }, 7: { cellWidth: 20 }, 8: { cellWidth: 22 } },
  })
  return doc.output('blob')
}
