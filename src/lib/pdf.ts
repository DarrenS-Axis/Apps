import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Defect, Drawing, Itp, Photo, PlanRegion, Project } from '../data/types'
import { DEFECT_STATUS_LABEL, ITP_STATUS_LABEL, PHOTO_CATEGORIES, REGION_COLOURS, REGION_STROKE_FRACTION } from '../data/types'
import { aud } from './reporting'
import { deriveStatus, formatDate, formatDateTime, itpProgress } from './format'
import { getTemplate } from '../data/templates'
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
 * Places a logo inside a box, keeping its aspect ratio and centring it on the
 * axis it does not fill. Returns the width it actually occupied, so a caption
 * can sit beside it.
 *
 * A logo that cannot be read is skipped rather than thrown: an ITP still has to
 * export when someone has attached something odd as a company mark.
 */
function drawLogo(
  doc: jsPDF,
  data: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  align: 'left' | 'centre' = 'centre',
): number {
  try {
    const props = doc.getImageProperties(data)
    if (!props.width || !props.height) return 0
    const scale = Math.min(maxW / props.width, maxH / props.height)
    const w = props.width * scale
    const h = props.height * scale
    const dx = align === 'left' ? x : x + (maxW - w) / 2
    const format = (props.fileType || 'PNG').toUpperCase()
    doc.addImage(data, format, dx, y + (maxH - h) / 2, w, h, undefined, 'FAST')
    return w
  } catch {
    return 0
  }
}

/**
 * The head contractor's band above the ITP itself: their logo and business
 * name on the left, the job on the right. Returns its height, zero when the job
 * carries neither.
 */
function drawClientBand(doc: jsPDF, project: Project, y: number): number {
  if (!project.client && !project.clientLogo) return 0
  const h = 12
  let x = M

  if (project.clientLogo) {
    const used = drawLogo(doc, project.clientLogo, M, y, 42, h, 'left')
    if (used) x = M + used + 4
  }

  if (project.client) {
    // With a logo the name would otherwise be printed twice — most company
    // marks are wordmarks — so it drops to the caption line beside it.
    if (x > M) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(110, 120, 130)
      doc.text(`${project.client}  ·  HEAD CONTRACTOR`, x, y + 7.4, { maxWidth: 96 })
    } else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(INK[0], INK[1], INK[2])
      doc.text(project.client, x, y + 6.6, { maxWidth: 96 })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(110, 120, 130)
      doc.text('HEAD CONTRACTOR', x, y + 10.2)
    }
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(90, 100, 110)
  const job = [project.name, project.projectNumber].filter(Boolean).join('  ·  ')
  doc.text(job, PAGE.w - M, y + 5.4, { align: 'right', maxWidth: 80 })
  if (project.address) doc.text(project.address, PAGE.w - M, y + 9, { align: 'right', maxWidth: 80 })

  doc.setDrawColor(LINE[0], LINE[1], LINE[2])
  doc.setLineWidth(0.3)
  doc.line(M, y + h - 1.5, PAGE.w - M, y + h - 1.5)
  doc.setTextColor(INK[0], INK[1], INK[2])
  return h
}

/**
 * Draws the boxed header that sits above the schedule on page 1 and returns the
 * y position the materials table should start at.
 */
function drawHeader(doc: jsPDF, itp: Itp, project: Project, drawings: Drawing[]): number {
  // The marking is stamped across the top of every page, so the band has to
  // start below it rather than under it.
  const bandTop = project.marking ? 10 : 3
  const bandH = drawClientBand(doc, project, bandTop)
  const top = bandH ? bandTop + bandH + 1 : 14
  const h = 26
  const logoW = 34
  const titleW = 62

  doc.setDrawColor(LINE[0], LINE[1], LINE[2])
  doc.setLineWidth(0.3)
  doc.rect(M, top, PAGE.w - M * 2, h)

  // Contractor block, left: their logo if they have attached one, their name if
  // not — the cell is never left empty.
  doc.line(M + logoW, top, M + logoW, top + h)
  const drewLogo = project.contractorLogo ? drawLogo(doc, project.contractorLogo, M + 2, top + 3, logoW - 4, h - 10) : 0
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  if (!drewLogo) {
    doc.text(project.contractor || 'Contractor', M + logoW / 2, top + h / 2 - 1, { align: 'center', maxWidth: logoW - 3 })
  } else if (project.contractor) {
    doc.setFontSize(6.5)
    doc.text(project.contractor, M + logoW / 2, top + h - 6, { align: 'center', maxWidth: logoW - 3 })
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(project.projectNumber || '', M + logoW / 2, top + h - 2.5, { align: 'center' })

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
  doc.text(itp.itcNumber ? 'ITC #' : 'Document No.', nx + 2, top + 15)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(itp.itpNumber, nx + 10, top + 9.5, { align: 'center' })
  doc.setFontSize(9)
  doc.text(itp.revision, nx + 33, top + 9.5, { align: 'center' })
  doc.setFontSize(7.5)
  doc.text(formatDate(itp.revisionDate), nx + 33, top + 17.5, { align: 'center' })
  doc.setFontSize(7)
  doc.text(itp.itcNumber || itp.documentNo || '—', nx + 10, top + 17.5, { align: 'center' })
  // Progress and status, as the Controldoc header prints them.
  const progressPct = itpProgress(itp).percent
  doc.setFontSize(6.5)
  doc.text(`Progress ${progressPct}%  ·  ${ITP_STATUS_LABEL[deriveStatus(itp)]}`, nx + nw / 2, top + 23.5, { align: 'center' })

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
  doc.text('H = Hold Point;  M = Monitor / Surveillance;  W = Witness;  X = Self Inspection by performer of work', PAGE.w / 2, y + 3.4, { align: 'center' })
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
  y += 6

  // Controldoc location and reference row.
  const gps = itp.lat !== undefined && itp.lng !== undefined ? `GPS ${formatCoords(itp.lat, itp.lng)}${itp.accuracy ? ` ±${Math.round(itp.accuracy)} m` : ''}` : ''
  if (itp.locationPath || itp.locRef || itp.planRef || gps) {
    doc.rect(M, y, PAGE.w - M * 2, 6)
    doc.setFillColor(GREY[0], GREY[1], GREY[2])
    doc.rect(M, y, dwgLabelW, 6, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.8)
    doc.text('Location / Loc.Ref', M + 1.5, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text([itp.locationPath, itp.locRef, itp.planRef, gps].filter(Boolean).join('   ·   '), M + dwgLabelW + 2, y + 4, {
      maxWidth: PAGE.w - M * 2 - dwgLabelW - 4,
    })
    y += 6
  }

  return y
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

  // 3.0 TEST RECORD — the fixed form every Controldoc ITP carries.
  {
    const rec = itp.testRecord
    const tpl = getTemplate(itp.templateCode)
    const yn = (v: boolean | null | undefined) => (v === true ? 'Yes' : v === false ? 'No' : '')
    const rows: [string, string][] = [
      ['Australian Standard minimum test criteria', [tpl?.test.standard, tpl?.test.pressureKpa ? `${tpl.test.pressureKpa} kPa` : '', tpl?.test.minutes ? `${tpl.test.minutes} minutes` : ''].filter(Boolean).join(' · ')],
      ['Service', rec?.service ?? itp.title],
      ['Test type', rec?.testType ?? tpl?.test.type ?? ''],
      ['Date of test', formatDate(rec?.dateOfTest) || ''],
      ['Final test — time started / ended', [rec?.testStarted, rec?.testEnded].filter(Boolean).join(' – ')],
      ['Pressure at start (kPa)', rec?.pressureAtStart ?? ''],
      ['Pressure loss (kPa) or loss at end (ml)', rec?.loss ?? ''],
      ['Test equipment', rec?.equipment ?? ''],
      ['Total loss (kPa) or make-up water (ml)', rec?.totalLoss ?? ''],
      ['Test pass', yn(rec?.pass)],
      ['ITP compliance check complete', yn(rec?.complianceCheck)],
      ['Additional notes', rec?.notes ?? ''],
    ]
    if (tpl?.test.preTest) {
      rows.splice(4, 0, [`${tpl.test.preTest.label} — time started / ended`, [rec?.preTestStarted, rec?.preTestEnded].filter(Boolean).join(' – ')], [`${tpl.test.preTest.label} pressure (kPa)`, rec?.preTestPressure ?? ''])
    }
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 1,
      margin: { left: M, right: M, bottom: 12 },
      theme: 'grid',
      styles: { fontSize: 6.6, cellPadding: 1.3, lineColor: [LINE[0], LINE[1], LINE[2]], lineWidth: 0.2, textColor: [INK[0], INK[1], INK[2]] },
      headStyles: { fillColor: [HEAD_GREEN[0], HEAD_GREEN[1], HEAD_GREEN[2]], textColor: [INK[0], INK[1], INK[2]], fontStyle: 'bold', halign: 'center' },
      head: [[{ content: 'TEST RECORD (3.0)', colSpan: 2 }]],
      body: rows.map(([k, v], n) => [`Step ${n + 1}   ${k}`, v]),
      columnStyles: { 0: { cellWidth: 78, fillColor: [GREY[0], GREY[1], GREY[2]] }, 1: { cellWidth: 'auto' } },
    })
  }
  drawSignOff(doc, itp, (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2)

  /* ------------------------------------------------- photographic record */

  const plans = drawings.filter((d) => d.imageData)
  const orderedPhotos = [...photos].sort((a, b) => a.takenAt - b.takenAt)
  const pinLabels = new Map(itp.pins.map((p) => [p.id, p.label]))

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
      y = await drawPlanExtract(doc, plan, itp, orderedPhotos, y)
    }

    y = drawPhotoGrid(doc, orderedPhotos, pinLabels, y)
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
  block(M, 'AXIS SIGN-OFF', itp.signOff, [
    itp.signOff?.licence ? `Licence / CP no.:  ${itp.signOff.licence}` : 'Licence / CP no.:',
    `Date completed:  ${formatDate(itp.dateCompleted) || ''}`,
  ])
  block(M + half, 'ADDITIONAL SIGN-OFF (CLIENT / SUPERINTENDENT)', itp.clientSignOff, [
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
async function drawPlanExtract(
  doc: jsPDF,
  plan: Drawing,
  itp: Itp,
  photos: Photo[],
  top: number,
): Promise<number> {
  const pins = itp.pins.filter((p) => p.drawingId === plan.id)
  const regions = (itp.regions ?? []).filter((r) => r.drawingId === plan.id)
  if (!plan.imageData) return top

  const composited = await compositeMarkup(plan, pins, regions)
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
  const marks = [
    regions.length ? `${regions.length} highlighted extent${regions.length > 1 ? 's' : ''}` : '',
    pins.length ? `${pins.length} location${pins.length > 1 ? 's' : ''} marked` : '',
  ].filter(Boolean)
  doc.text(
    `Plan extract — ${[plan.number, plan.revision].filter(Boolean).join(' ')}${plan.title ? ` · ${plan.title}` : ''}${
      marks.length ? ` · ${marks.join(', ')}` : ''
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

  const legend: string[] = [
    ...regions.map(
      (r) =>
        `  ${r.label || '–'}. ${REGION_COLOURS[r.colour]?.label ?? ''} ${
          r.kind === 'area' ? 'area' : 'run'
        } — ${r.itemNo ? `Item ${r.itemNo}: ` : ''}${r.note || 'Extent covered by this ITP'}`,
    ),
    ...pins.map((pin) => {
      const count = photos.filter((ph) => ph.pinId === pin.id).length
      return `  ${pin.label}. ${pin.itemNo ? `Item ${pin.itemNo} — ` : ''}${pin.note || 'Location marked'}${
        count ? ` (${count} photo${count > 1 ? 's' : ''})` : ''
      }${pin.lat !== undefined && pin.lng !== undefined ? ` · GPS ${formatCoords(pin.lat, pin.lng)}` : ''}`
    }),
  ]

  if (legend.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.4)
    for (const line of legend) {
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

/**
 * Draws the ITP's markup onto a copy of the plan so the exported PDF shows the
 * same thing the crew saw on the device: the highlighted extent of the work,
 * with pins on top.
 */
function compositeMarkup(plan: Drawing, pins: Itp['pins'], regions: PlanRegion[]): Promise<string> {
  return new Promise((resolve) => {
    if (!plan.imageData) return resolve('')
    if (pins.length === 0 && regions.length === 0) return resolve(plan.imageData)

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(plan.imageData!)
      ctx.drawImage(img, 0, 0)

      const stroke = Math.max(canvas.width, canvas.height) * REGION_STROKE_FRACTION

      // Highlights first, so pins stay readable on top of them.
      for (const region of regions) {
        const colour = REGION_COLOURS[region.colour] ?? REGION_COLOURS.yellow
        ctx.save()
        if (region.kind === 'area') {
          const [a, b] = region.points
          if (a && b) {
            const x = Math.min(a.x, b.x) * canvas.width
            const y = Math.min(a.y, b.y) * canvas.height
            const w = Math.abs(b.x - a.x) * canvas.width
            const h = Math.abs(b.y - a.y) * canvas.height
            ctx.fillStyle = colour.fill
            ctx.fillRect(x, y, w, h)
            ctx.strokeStyle = colour.stroke
            ctx.lineWidth = stroke * 0.3
            ctx.strokeRect(x, y, w, h)
            drawRegionLabel(ctx, region.label, x + stroke * 0.4, y + stroke * 1.4, stroke, colour.stroke)
          }
        } else if (region.points.length >= 2) {
          ctx.beginPath()
          region.points.forEach((pt, i) => {
            const x = pt.x * canvas.width
            const y = pt.y * canvas.height
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.strokeStyle = colour.fill
          ctx.lineWidth = stroke
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke()
          const first = region.points[0]
          drawRegionLabel(
            ctx,
            region.label,
            first.x * canvas.width,
            first.y * canvas.height - stroke * 0.7,
            stroke,
            colour.stroke,
          )
        }
        ctx.restore()
      }

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

/** Region reference, outlined in white so it reads over busy linework. */
function drawRegionLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  stroke: number,
  colour: string,
): void {
  if (!label) return
  ctx.font = `700 ${Math.round(stroke * 1.3)}px system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.lineWidth = stroke * 0.28
  ctx.strokeStyle = '#ffffff'
  ctx.strokeText(label, x, y)
  ctx.fillStyle = colour
  ctx.fillText(label, x, y)
}

/** Photo contact sheet: three across, each captioned with its timestamp. */
function drawPhotoGrid(doc: jsPDF, photos: Photo[], pinLabels: Map<string, string>, top: number): number {
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
    const pinLabel = photo.pinId ? pinLabels.get(photo.pinId) : undefined
    doc.text(
      `${photo.itemNo ? `Item ${photo.itemNo} · ` : ''}${pinLabel ? `Pin ${pinLabel} · ` : ''}${
        PHOTO_CATEGORIES[photo.category]
      }`,
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

/* ================================================================ Reviewdoc */

/**
 * A crop of the plan around one defect, with the pin drawn — the "Mini Map"
 * column of the QA report, drawn at a size a phone can produce quickly.
 */
function miniMap(plan: Drawing, x: number, y: number, label: string): Promise<string> {
  return new Promise((resolve) => {
    if (!plan.imageData) return resolve('')
    const img = new Image()
    img.onload = () => {
      const size = Math.round(Math.max(img.naturalWidth, img.naturalHeight) * 0.18)
      const sx = Math.max(0, Math.min(img.naturalWidth - size, x * img.naturalWidth - size / 2))
      const sy = Math.max(0, Math.min(img.naturalHeight - size, y * img.naturalHeight - size / 2))
      const canvas = document.createElement('canvas')
      const out = 360
      canvas.width = out
      canvas.height = out
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve('')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, out, out)
      ctx.drawImage(img, sx, sy, size, size, 0, 0, out, out)
      const px = ((x * img.naturalWidth - sx) / size) * out
      const py = ((y * img.naturalHeight - sy) / size) * out
      ctx.beginPath()
      ctx.arc(px, py, 16, 0, Math.PI * 2)
      ctx.fillStyle = '#c2410c'
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = '#fff'
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.font = '700 15px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, px, py + 1)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => resolve('')
    img.src = plan.imageData!
  })
}

export interface QaReportInput {
  project: Project
  unit?: { name: string; entity: string; office?: string; phone?: string }
  defects: Defect[]
  drawings: Drawing[]
  photos: Photo[]
  /** Who the report goes to — the head contractor. */
  to?: string
}

/**
 * The Reviewdoc QA REPORT sent to the head contractor: a cover page, then
 * one row per defect with its location, mini map, description, cost and
 * photo, the way the Controldoc export lays it out.
 */
export async function exportQaReportPdf({ project, unit, defects, drawings, photos, to }: QaReportInput): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  doc.setTextColor(INK[0], INK[1], INK[2])

  // Cover.
  let y = 30
  if (project.contractorLogo) drawLogo(doc, project.contractorLogo, M, y - 12, 50, 18, 'left')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('QA REPORT', PAGE.w - M, y, { align: 'right' })
  y += 16
  doc.setFontSize(10)
  const lines: [string, string][] = [
    ['To:', to || project.client || '—'],
    ['Project:', project.name],
    ['Address:', project.address || '—'],
    ['Date:', formatDate(new Date().toISOString().slice(0, 10))],
    ['Company:', unit?.entity || project.contractor || 'Axis Plumbing'],
    ['Office:', unit?.office || ''],
    ['Direct:', unit?.phone || ''],
  ]
  for (const [k, v] of lines) {
    if (!v) continue
    doc.setFont('helvetica', 'bold')
    doc.text(k, M, y)
    doc.setFont('helvetica', 'normal')
    doc.text(v, M + 26, y, { maxWidth: PAGE.w - M * 2 - 26 })
    y += 7
  }
  y += 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`${defects.length} items · ${aud(defects.reduce((n, d) => n + (d.cost ?? 0), 0))}`, M, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(110, 120, 130)
  doc.text(`Open ${defects.filter((d) => d.status === 'open').length} · Rectified ${defects.filter((d) => d.status === 'rectified').length} · Closed ${defects.filter((d) => d.status === 'closed').length}`, M, y)
  doc.setTextColor(INK[0], INK[1], INK[2])

  // Rows.
  doc.addPage()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('QA report export', M, 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(`Project Name: ${project.name}`, M, 19)
  doc.text(`Printed: ${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`, M, 23)

  const drawingById = new Map(drawings.map((d) => [d.id, d]))
  const rows: (string | { image: string })[][] = []
  for (const d of defects) {
    const plan = d.drawingId ? drawingById.get(d.drawingId) : undefined
    const map = plan && d.x !== undefined && d.y !== undefined ? await miniMap(plan, d.x, d.y, '1') : ''
    const photo = photos.find((p) => p.defectId === d.id)
    rows.push([
      d.number,
      [d.locationPath, plan ? `${plan.number} ${plan.revision}`.trim() : '', d.locRef, d.lat !== undefined && d.lng !== undefined ? `GPS ${formatCoords(d.lat, d.lng)}${d.accuracy ? ` (±${Math.round(d.accuracy)} m)` : ''}` : ''].filter(Boolean).join('\n') || '-',
      map ? { image: map } : '',
      `${d.service}: ${d.description}${d.status !== 'open' ? `\n[${DEFECT_STATUS_LABEL[d.status]}]` : ''}`,
      d.cost ? aud(d.cost) : '',
      photo ? { image: photo.thumb } : '',
    ])
  }

  autoTable(doc, {
    startY: 27,
    margin: { left: M, right: M, bottom: 14 },
    theme: 'grid',
    styles: { fontSize: 6.8, cellPadding: 1.6, lineColor: [LINE[0], LINE[1], LINE[2]], lineWidth: 0.2, textColor: [INK[0], INK[1], INK[2]], valign: 'top', minCellHeight: 30 },
    headStyles: { fillColor: [GREY[0], GREY[1], GREY[2]], textColor: [INK[0], INK[1], INK[2]], fontStyle: 'bold' },
    head: [['ID', 'Location / Loc.Ref', 'Mini Map', 'Description', 'Costs', 'Photo']],
    body: rows.map((r) => r.map((c) => (typeof c === 'string' ? c : ''))),
    columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 34 }, 2: { cellWidth: 30 }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 16, halign: 'right' }, 5: { cellWidth: 30 } },
    didDrawCell: (data) => {
      if (data.section !== 'body') return
      const cell = rows[data.row.index]?.[data.column.index]
      if (!cell || typeof cell === 'string') return
      const w = data.cell.width - 3
      const h = data.cell.height - 3
      const s = Math.min(w, h)
      try {
        doc.addImage(cell.image, 'JPEG', data.cell.x + 1.5, data.cell.y + 1.5, s, s)
      } catch {
        // an unreadable image leaves an empty cell
      }
    },
  })

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(120, 130, 140)
    doc.text(`${unit?.entity ?? project.contractor ?? 'Axis'} · Reviewdoc`, M, PAGE.h - 6)
    doc.text(`Pages ${p} / ${pages}`, PAGE.w - M, PAGE.h - 6, { align: 'right' })
  }
  return doc.output('blob')
}
