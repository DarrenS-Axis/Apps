import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Drawing, Itp, Photo, Project } from '../data/types'
import { PHOTO_CATEGORIES } from '../data/types'
import { formatDate, formatDateTime, itpProgress } from './format'
import { formatCoords, stampText } from './images'

/**
 * Renders an ITP to the same document the paper form produces:
 *
 *   page 1  header block, materials verification table, the numbered
 *           inspection & test schedule and the sign-off block
 *   page 2+ the photographic record, with a plan extract showing the
 *           location pins
 *
 * jsPDF draws the tables directly rather than screenshotting the DOM, so the
 * output is selectable text at any page size and does not depend on what the
 * phone happened to be rendering.
 */

const PAGE = { w: 210, h: 297 } // A4 portrait, mm
const M = 10 // page margin

const GREEN = [222, 235, 214] as const
const HEAD_GREEN = [214, 231, 205] as const
const GREY = [242, 244, 246] as const
const LINE = [130, 140, 150] as const
const INK = [16, 32, 44] as const

interface ExportInput {
  itp: Itp
  project: Project
  drawings: Drawing[]
  photos: Photo[]
}

function markings(doc: jsPDF, project: Project): void {
  if (!project.marking) return
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(200, 30, 30)
    doc.text(project.marking, PAGE.w / 2, 7, { align: 'center' })
    doc.text(project.marking, PAGE.w / 2, PAGE.h - 6, { align: 'center' })
    doc.setFontSize(7)
    doc.setTextColor(120, 130, 140)
    doc.setFont('helvetica', 'normal')
    doc.text(`Page ${p} of ${pages}`, PAGE.w - M, PAGE.h - 6, { align: 'right' })
  }
  doc.setTextColor(INK[0], INK[1], INK[2])
}

/**
 * Draws the boxed header that sits above the schedule on page 1 and returns the
 * y position the materials table should start at.
 */
function drawHeader(doc: jsPDF, itp: Itp, project: Project, drawings: Drawing[]): number {
  const top = 14
  const h = 26
  const logoW = 34
  const titleW = 62

  doc.setDrawColor(LINE[0], LINE[1], LINE[2])
  doc.setLineWidth(0.3)
  doc.rect(M, top, PAGE.w - M * 2, h)

  // Contractor block, left.
  doc.line(M + logoW, top, M + logoW, top + h)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(project.contractor || 'Contractor', M + logoW / 2, top + h / 2 - 1, { align: 'center', maxWidth: logoW - 3 })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(project.projectNumber || '', M + logoW / 2, top + h / 2 + 3.5, { align: 'center' })

  // Title and approval block.
  const cx = M + logoW
  doc.line(cx + titleW, top, cx + titleW, top + h)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('INSPECTION & TEST PLAN', cx + titleW / 2, top + 6, { align: 'center' })
  doc.setLineWidth(0.2)
  doc.line(cx, top + 8.5, cx + titleW, top + 8.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(
    `Approved for use by  ${project.approvedBy || '—'}${project.approvedByRole ? `, ${project.approvedByRole}` : ''}`,
    cx + 2,
    top + 12,
    { maxWidth: titleW - 4 },
  )
  doc.line(cx, top + 17.5, cx + titleW, top + 17.5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.text(project.stage || project.name, cx + titleW / 2, top + 21.5, { align: 'center', maxWidth: titleW - 4 })

  // ITP number, revision and document number.
  const nx = cx + titleW
  const nw = 46
  doc.setLineWidth(0.3)
  doc.line(nx + nw, top, nx + nw, top + h)
  doc.setLineWidth(0.2)
  doc.line(nx, top + 12, nx + nw, top + 12)
  doc.line(nx, top + 19, nx + nw, top + 19)
  doc.line(nx + 20, top, nx + 20, top + 19)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text('ITP NUMBER:', nx + 2, top + 4)
  doc.text('Revision No:', nx + 22, top + 4)
  doc.text('Revision Date:', nx + 22, top + 15)
  doc.text('Document No.', nx + 2, top + 15)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(itp.itpNumber, nx + 10, top + 9.5, { align: 'center' })
  doc.setFontSize(9)
  doc.text(itp.revision, nx + 33, top + 9.5, { align: 'center' })
  doc.setFontSize(7.5)
  doc.text(formatDate(itp.revisionDate), nx + 33, top + 17.5, { align: 'center' })
  doc.setFontSize(7)
  doc.text(itp.documentNo || '—', nx + 10, top + 17.5, { align: 'center' })

  // Green title panel, right, as on the paper form.
  const tx = nx + nw
  const tw = PAGE.w - M - tx
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2])
  doc.rect(tx, top, tw, h, 'F')
  doc.setLineWidth(0.3)
  doc.rect(tx, top, tw, h)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(INK[0], INK[1], INK[2])
  doc.text(itp.title, tx + tw / 2, top + h / 2 + 1, { align: 'center', maxWidth: tw - 4 })

  // Legend row.
  let y = top + h
  doc.rect(M, y, PAGE.w - M * 2, 5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.8)
  doc.text('W - Witness;  H - Hold Point;  S - Surveillance;  X - Self Inspection', PAGE.w / 2, y + 3.4, { align: 'center' })
  y += 5

  // Drawing number and area row.
  const dwgLabelW = 26
  const areaLabelW = 14
  const areaX = M + 84
  doc.rect(M, y, PAGE.w - M * 2, 6)
  doc.setFillColor(GREY[0], GREY[1], GREY[2])
  doc.rect(M, y, dwgLabelW, 6, 'FD')
  doc.rect(areaX, y, areaLabelW, 6, 'FD')
  doc.setFontSize(6.8)
  doc.text('Drawing Number', M + 1.5, y + 4)
  doc.text('Area', areaX + 1.5, y + 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const dwgText = drawings.map((d) => [d.number, d.revision].filter(Boolean).join(' ')).join(', ') || '—'
  doc.text(dwgText, M + dwgLabelW + 2, y + 4, { maxWidth: areaX - (M + dwgLabelW) - 4 })
  doc.text(
    [itp.area, itp.location].filter(Boolean).join(' — ') || '—',
    areaX + areaLabelW + 2,
    y + 4,
    { maxWidth: PAGE.w - M - (areaX + areaLabelW) - 4 },
  )

  return y + 6
}

export async function exportItpPdf({ itp, project, drawings, photos }: ExportInput): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  doc.setTextColor(INK[0], INK[1], INK[2])

  const headerBottom = drawHeader(doc, itp, project, drawings)

  /* ------------------------------------------------------- materials */

  autoTable(doc, {
    startY: headerBottom,
    margin: { left: M, right: M },
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.4, lineColor: [LINE[0], LINE[1], LINE[2]], lineWidth: 0.2, textColor: [INK[0], INK[1], INK[2]] },
    headStyles: { fillColor: [HEAD_GREEN[0], HEAD_GREEN[1], HEAD_GREEN[2]], textColor: [INK[0], INK[1], INK[2]], fontStyle: 'bold', halign: 'left' },
    head: [[{ content: 'MATERIALS:', colSpan: 4, styles: { halign: 'center' } }], ['Item:', 'Requirements:', 'Batch / cert. ref.', 'Check']],
    body: itp.materials.map((m) => [
      m.item,
      m.requirement,
      m.reference || '',
      m.compliant === true ? 'X' : m.compliant === false ? 'NC' : '',
    ]),
    columnStyles: {
      0: { cellWidth: 34, fillColor: [GREY[0], GREY[1], GREY[2]] },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 30 },
      3: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
    },
  })

  /* -------------------------------------------------------- schedule */

  const afterMaterials = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  autoTable(doc, {
    startY: afterMaterials + 1,
    margin: { left: M, right: M, bottom: 12 },
    theme: 'grid',
    styles: {
      fontSize: 6.6,
      cellPadding: 1.3,
      lineColor: [LINE[0], LINE[1], LINE[2]],
      lineWidth: 0.2,
      textColor: [INK[0], INK[1], INK[2]],
      valign: 'middle',
    },
    headStyles: {
      fillColor: [HEAD_GREEN[0], HEAD_GREEN[1], HEAD_GREEN[2]],
      textColor: [INK[0], INK[1], INK[2]],
      fontStyle: 'bold',
      halign: 'center',
    },
    head: [
      [{ content: 'INSPECTION & TEST PLAN', colSpan: 5, styles: { halign: 'center' } }],
      ['No.', 'Installation:', 'Acceptance Criteria', 'Point', 'Initial & Date'],
    ],
    body: itp.items.map((i) => {
      const result = [
        i.recordValue ? `${i.recordLabel}: ${i.recordValue} ${i.recordUnit ?? ''}`.trim() : '',
        i.comment ? `Note: ${i.comment}` : '',
        i.release ? `Released by ${i.release.releasedBy}${i.release.reference ? ` (${i.release.reference})` : ''} ${formatDate(i.release.at)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      return [
        i.no,
        result ? `${i.installation}\n${result}` : i.installation,
        i.acceptance,
        i.point,
        i.status === 'pass'
          ? `${i.initials ?? ''}\n${i.date ? formatDate(i.date) : ''}`
          : i.status === 'fail'
            ? 'NCR'
            : i.status === 'na'
              ? 'N/A'
              : '',
      ]
    }),
    columnStyles: {
      0: { cellWidth: 9, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 78 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const item = itp.items[data.row.index]
      if (!item) return
      if (item.point === 'H' && item.status !== 'pass') {
        data.cell.styles.fillColor = [255, 237, 213]
      } else if (item.status === 'fail') {
        data.cell.styles.fillColor = [254, 226, 226]
      } else if (item.status === 'na') {
        data.cell.styles.textColor = [130, 140, 150]
      }
    },
  })

  /* --------------------------------------------------------- sign-off */

  const afterSchedule = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  drawSignOff(doc, itp, afterSchedule + 2)

  /* ------------------------------------------------- photographic record */

  const plans = drawings.filter((d) => d.imageData)
  const orderedPhotos = [...photos].sort((a, b) => a.takenAt - b.takenAt)

  if (plans.length || orderedPhotos.length) {
    doc.addPage()
    let y = 14
    doc.setFillColor(HEAD_GREEN[0], HEAD_GREEN[1], HEAD_GREEN[2])
    doc.rect(M, y, PAGE.w - M * 2, 6, 'F')
    doc.setDrawColor(LINE[0], LINE[1], LINE[2])
    doc.rect(M, y, PAGE.w - M * 2, 6)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('PHOTOGRAPHIC RECORD', PAGE.w / 2, y + 4, { align: 'center' })
    y += 9

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(
      `ITP ${itp.itpNumber} — ${itp.title} · ${itp.area}${itp.location ? ` · ${itp.location}` : ''}`,
      M,
      y + 2,
    )
    y += 6

    for (const plan of plans) {
      y = await drawPlanExtract(doc, plan, itp, y)
    }

    y = drawPhotoGrid(doc, orderedPhotos, y)
    void y
  }

  markings(doc, project)
  return doc.output('blob')
}

function drawSignOff(doc: jsPDF, itp: Itp, top: number): void {
  let y = top
  const h = 30
  if (y + h > PAGE.h - 14) {
    doc.addPage()
    y = 14
  }

  const w = PAGE.w - M * 2
  const half = w / 2
  doc.setDrawColor(LINE[0], LINE[1], LINE[2])
  doc.setLineWidth(0.3)
  doc.rect(M, y, w, h)
  doc.line(M + half, y, M + half, y + h)

  const block = (x: number, label: string, sign?: NonNullable<Itp['signOff']>, extras: string[] = []) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text(label, x + 2, y + 4.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.6)
    let ly = y + 9.5
    doc.text(`Name:  ${sign?.name || '.'.repeat(38)}`, x + 2, ly)
    for (const extra of extras) {
      ly += 3.6
      doc.text(extra, x + 2, ly, { maxWidth: half - 4 })
    }

    // Signature sits on its own baseline near the bottom of the block.
    const sigY = y + h - 4
    doc.text('Signature:', x + 2, sigY)
    if (sign?.signature) {
      try {
        doc.addImage(sign.signature, 'PNG', x + 18, sigY - 10, 32, 11)
      } catch {
        // A corrupt signature image must not stop the whole export.
      }
    }
    doc.line(x + 18, sigY + 0.5, x + half - 26, sigY + 0.5)
    doc.text(`Date: ${sign?.at ? formatDate(sign.at) : ''}`, x + half - 24, sigY)
    doc.line(x + half - 15, sigY + 0.5, x + half - 2, sigY + 0.5)
  }

  const progress = itpProgress(itp)
  block(M, 'INSTALLER SIGN-OFF', itp.signOff, [
    itp.signOff?.licence ? `Licence / CP no.:  ${itp.signOff.licence}` : 'Licence / CP no.:',
    `Date completed:  ${formatDate(itp.dateCompleted) || ''}`,
  ])
  block(M + half, 'CLIENT / SUPERINTENDENT ACCEPTANCE', itp.clientSignOff, [
    `Company:  ${itp.clientSignOff?.company ?? ''}`,
    `${progress.signed} of ${progress.applicable} applicable items signed${progress.failed ? ` · ${progress.failed} non-conforming` : ''}`,
  ])

  if (itp.notes) {
    doc.setFontSize(6.4)
    doc.setFont('helvetica', 'italic')
    doc.text(`Notes: ${itp.notes}`, M, y + h + 4, { maxWidth: w })
  }
}

/** Draws a plan with the ITP's location pins burned onto it. */
async function drawPlanExtract(doc: jsPDF, plan: Drawing, itp: Itp, top: number): Promise<number> {
  const pins = itp.pins.filter((p) => p.drawingId === plan.id)
  if (!plan.imageData) return top

  const composited = await compositePins(plan, pins)
  const maxW = PAGE.w - M * 2
  const maxH = 96
  const ratio = (plan.imageHeight ?? 700) / (plan.imageWidth ?? 1000)
  let w = maxW
  let h = w * ratio
  if (h > maxH) {
    h = maxH
    w = h / ratio
  }

  let y = top
  if (y + h + 10 > PAGE.h - 14) {
    doc.addPage()
    y = 14
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.text(
    `Plan extract — ${[plan.number, plan.revision].filter(Boolean).join(' ')}${plan.title ? ` · ${plan.title}` : ''}${
      pins.length ? ` · ${pins.length} location${pins.length > 1 ? 's' : ''} marked` : ''
    }`,
    M,
    y + 3,
  )
  y += 5

  try {
    doc.addImage(composited, 'JPEG', M + (maxW - w) / 2, y, w, h)
    doc.setDrawColor(LINE[0], LINE[1], LINE[2])
    doc.setLineWidth(0.2)
    doc.rect(M + (maxW - w) / 2, y, w, h)
  } catch {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7)
    doc.text('Plan image could not be embedded.', M, y + 5)
  }
  y += h + 3

  if (pins.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.4)
    for (const pin of pins) {
      const line = `  ${pin.label}. ${pin.itemNo ? `Item ${pin.itemNo} — ` : ''}${pin.note || 'Location marked'}`
      if (y > PAGE.h - 16) {
        doc.addPage()
        y = 14
      }
      doc.text(line, M, y + 2, { maxWidth: PAGE.w - M * 2 })
      y += 3.4
    }
    y += 2
  }

  return y + 3
}

/** Renders pins onto a copy of the plan so the PDF shows them in place. */
function compositePins(plan: Drawing, pins: Itp['pins']): Promise<string> {
  return new Promise((resolve) => {
    if (!plan.imageData) return resolve('')
    if (pins.length === 0) return resolve(plan.imageData)

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(plan.imageData!)
      ctx.drawImage(img, 0, 0)

      const r = Math.max(14, canvas.width * 0.014)
      for (const pin of pins) {
        const x = pin.x * canvas.width
        const y = pin.y * canvas.height
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = '#0f7ac2'
        ctx.fill()
        ctx.lineWidth = Math.max(2, r * 0.18)
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.font = `700 ${Math.round(r * 1.1)}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(pin.label, x, y + 1)
      }
      resolve(canvas.toDataURL('image/jpeg', 0.86))
    }
    img.onerror = () => resolve(plan.imageData!)
    img.src = plan.imageData
  })
}

/** Photo contact sheet: three across, each captioned with its timestamp. */
function drawPhotoGrid(doc: jsPDF, photos: Photo[], top: number): number {
  if (photos.length === 0) return top

  const cols = 3
  const gap = 3
  const cellW = (PAGE.w - M * 2 - gap * (cols - 1)) / cols
  const imgH = cellW * 0.75
  const capH = 9
  const cellH = imgH + capH

  let y = top
  let col = 0

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  if (y + 6 > PAGE.h - 14) {
    doc.addPage()
    y = 14
  }
  doc.text(`Photographs (${photos.length})`, M, y + 3)
  y += 6

  for (const photo of photos) {
    if (col === 0 && y + cellH > PAGE.h - 14) {
      doc.addPage()
      y = 14
    }
    const x = M + col * (cellW + gap)

    // Letterbox inside the cell so a portrait phone photo is not squashed.
    const scale = Math.min(cellW / photo.width, imgH / photo.height)
    const pw = photo.width * scale
    const ph = photo.height * scale
    try {
      doc.addImage(photo.data, 'JPEG', x + (cellW - pw) / 2, y + (imgH - ph) / 2, pw, ph)
    } catch {
      // An unreadable photo still leaves its captioned cell in the record.
    }
    doc.setDrawColor(LINE[0], LINE[1], LINE[2])
    doc.setLineWidth(0.2)
    doc.rect(x, y, cellW, imgH)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5.6)
    doc.setTextColor(INK[0], INK[1], INK[2])
    doc.text(
      `${photo.itemNo ? `Item ${photo.itemNo} · ` : ''}${PHOTO_CATEGORIES[photo.category]}`,
      x + 0.5,
      y + imgH + 2.4,
      { maxWidth: cellW - 1 },
    )
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.2)
    doc.text(
      `${stampText(photo.takenAt)}${photo.takenAtFromExif ? '' : ' (recorded)'}`,
      x + 0.5,
      y + imgH + 5,
      { maxWidth: cellW - 1 },
    )
    const detail = [photo.caption, formatCoords(photo.lat, photo.lng)].filter(Boolean).join(' · ')
    if (detail) doc.text(detail, x + 0.5, y + imgH + 7.4, { maxWidth: cellW - 1 })

    col += 1
    if (col === cols) {
      col = 0
      y += cellH + gap
    }
  }

  return col === 0 ? y : y + cellH + gap
}

/**
 * Register export — one row per ITP with its progress and open hold points, for
 * the weekly report to the head contractor.
 */
export function exportRegisterPdf(project: Project, itps: Itp[]): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('HYDRAULIC ITP REGISTER', 12, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(
    [project.name, project.projectNumber, project.client, `Issued ${formatDateTime(Date.now())}`].filter(Boolean).join('  ·  '),
    12,
    21,
  )

  autoTable(doc, {
    startY: 25,
    margin: { left: 12, right: 12 },
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5, lineColor: [LINE[0], LINE[1], LINE[2]], lineWidth: 0.2 },
    headStyles: { fillColor: [HEAD_GREEN[0], HEAD_GREEN[1], HEAD_GREEN[2]], textColor: [INK[0], INK[1], INK[2]], fontStyle: 'bold' },
    head: [['ITP', 'Title', 'Area / location', 'Rev', 'Signed', 'Open holds', 'NCRs', 'Completed', 'Signed by']],
    body: itps.map((itp) => {
      const p = itpProgress(itp)
      return [
        itp.itpNumber,
        itp.title,
        [itp.area, itp.location].filter(Boolean).join(' — '),
        itp.revision,
        `${p.signed}/${p.applicable}`,
        p.openHolds.length ? p.openHolds.map((h) => h.no).join(', ') : '—',
        p.failed || '—',
        itp.dateCompleted ? formatDate(itp.dateCompleted) : '—',
        itp.signOff?.name ?? '—',
      ]
    }),
    columnStyles: {
      0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 18, halign: 'center' },
      5: { cellWidth: 22, halign: 'center' },
      6: { cellWidth: 14, halign: 'center' },
      7: { cellWidth: 24, halign: 'center' },
    },
  })

  markings(doc, project)
  return doc.output('blob')
}
