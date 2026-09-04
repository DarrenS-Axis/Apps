/**
 * Importing plans from wherever the crew keeps them.
 *
 * On site, drawings almost never arrive as images — they come out of SharePoint,
 * OneDrive or a consultant's transmittal as PDFs, often a multi-sheet set. This
 * module turns any of those into the raster plan the viewer and the PDF export
 * need, and does it entirely on the device so a drawing never leaves the phone.
 *
 * pdf.js is loaded on demand: it is roughly a megabyte, and most sessions on
 * site never add a drawing at all.
 */

import { processImage } from './images'
import { readExif } from './exif'

export interface PlanPage {
  /** 1-based page number as printed in the PDF. */
  page: number
  /** JPEG data URL of the rendered page. */
  data: string
  thumb: string
  width: number
  height: number
  /** Text found on the page, used to guess the drawing number and title. */
  text: string
}

export interface PlanImport {
  kind: 'image' | 'pdf'
  /** Every page for a PDF; a single entry for an image. */
  pages: PlanPage[]
  /** Original file name, used to pre-fill the drawing number. */
  fileName: string
}

/** Long edge, in pixels, that a rendered plan page is capped at. */
const PLAN_MAX_EDGE = 2600

// The legacy build targets browsers a few versions back. pdf.js's modern build
// uses very new JS (Map.prototype.getOrInsertComputed and friends) that throws
// on the phones and tablets already in use on site.
type PdfModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<PdfModule> | null = null

/**
 * Loads pdf.js and points it at a worker bundled with the app rather than a
 * CDN — the whole app has to keep working with no signal.
 */
async function loadPdfjs(): Promise<PdfModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        return pdfjs
      } catch (err) {
        // Retry on the next attempt rather than caching the failure.
        pdfjsPromise = null
        if (!navigator.onLine) {
          throw new Error(
            'the PDF reader has not been downloaded yet and this device is offline. Import one plan while you have signal and it is cached for good.',
          )
        }
        throw err
      }
    })()
  }
  return pdfjsPromise
}

export function isPdf(file: File | Blob, name?: string): boolean {
  const fileName = name ?? (file instanceof File ? file.name : '')
  return file.type === 'application/pdf' || /\.pdf$/i.test(fileName)
}

/** Renders one PDF page to a JPEG at a sensible on-device resolution. */
async function renderPage(
  pdf: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['getDocument']>['promise']>,
  pageNo: number,
): Promise<PlanPage> {
  const page = await pdf.getPage(pageNo)

  // Scale so the long edge lands near PLAN_MAX_EDGE: a plan has to stay legible
  // when someone pinch-zooms into a corner of it.
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(4, Math.max(1, PLAN_MAX_EDGE / Math.max(base.width, base.height)))
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available in this browser.')

  // Plans are line drawings on white; without this, transparent areas render black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvas, canvasContext: ctx, viewport }).promise

  let text = ''
  try {
    const content = await page.getTextContent()
    text = content.items
      .map((i) => ('str' in i ? i.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    // A scanned plan has no text layer; the title-block guess just gets skipped.
  }

  const data = canvas.toDataURL('image/jpeg', 0.88)

  const tScale = Math.min(1, 320 / Math.max(canvas.width, canvas.height))
  const tCanvas = document.createElement('canvas')
  tCanvas.width = Math.max(1, Math.round(canvas.width * tScale))
  tCanvas.height = Math.max(1, Math.round(canvas.height * tScale))
  tCanvas.getContext('2d')?.drawImage(canvas, 0, 0, tCanvas.width, tCanvas.height)

  page.cleanup()

  return {
    page: pageNo,
    data,
    thumb: tCanvas.toDataURL('image/jpeg', 0.7),
    width: canvas.width,
    height: canvas.height,
    text,
  }
}

export interface ImportProgress {
  page: number
  total: number
}

/**
 * Turns a picked file into one or more plan pages.
 *
 * Accepts anything the OS file picker can hand over, which on a phone includes
 * OneDrive and SharePoint through the Files / Documents provider.
 */
export async function importPlanFile(
  file: File | Blob,
  opts: { fileName?: string; onProgress?: (p: ImportProgress) => void; maxPages?: number } = {},
): Promise<PlanImport> {
  const fileName = opts.fileName ?? (file instanceof File ? file.name : 'plan')

  if (!isPdf(file, fileName)) {
    const buf = await file.arrayBuffer()
    const exif = readExif(buf)
    const img = await processImage(file, {
      maxEdge: PLAN_MAX_EDGE,
      orientation: exif.orientation,
      quality: 0.88,
    })
    return {
      kind: 'image',
      fileName,
      pages: [{ page: 1, data: img.data, thumb: img.thumb, width: img.width, height: img.height, text: '' }],
    }
  }

  const pdfjs = await loadPdfjs()
  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
  const pdf = await loadingTask.promise

  try {
    // A full drawing set can run to hundreds of sheets; rendering them all would
    // exhaust the device. Cap it and let the user re-import for later sheets.
    const total = Math.min(pdf.numPages, opts.maxPages ?? 40)
    const pages: PlanPage[] = []
    for (let n = 1; n <= total; n++) {
      opts.onProgress?.({ page: n, total })
      pages.push(await renderPage(pdf, n))
    }
    return { kind: 'pdf', fileName, pages }
  } finally {
    // Releases the worker and the decoded page cache — a large drawing set
    // holds a lot of memory on a phone.
    await loadingTask.destroy()
  }
}

/** Prefixes that look like drawing numbers but are material or pipe specs. */
const SPEC_PREFIXES = /^(PM|PN|SN|DN|PE|PVC|HDPE|RCP|AS|NZS|ISO|BS|EN|SR|MPa|KPA)$/i

/** Rejects PM64, PN16, DN100, PE100 and friends. */
function looksLikeSpec(candidate: string): boolean {
  const prefix = /^([A-Z]+)/i.exec(candidate)?.[1] ?? ''
  return SPEC_PREFIXES.test(prefix)
}

/**
 * Best-effort guess at the drawing number, revision and title, so the crew is
 * not retyping what the title block already says.
 *
 * Deliberately conservative: a wrong drawing number silently recorded against
 * an ITP is worse than an empty field someone has to fill in, so this only
 * offers a number it is reasonably sure of. Everything it produces is editable.
 */
export function guessDrawingDetails(page: PlanPage, fileName: string): {
  number?: string
  revision?: string
  title?: string
} {
  const out: { number?: string; revision?: string; title?: string } = {}

  const stem = fileName.replace(/\.[^.]+$/, '')

  // The file name is the most trustworthy source — a drawing exported from
  // SharePoint is usually named after its number. Allow a missing separator here.
  const fromName = /\b([A-Z]{1,3}[-_ ]?\d{2,4}(?:[-_]\d{1,3})?)\b/.exec(stem.toUpperCase())
  if (fromName && !looksLikeSpec(fromName[1])) {
    out.number = fromName[1].replace(/[_ ]/g, '-')
  }

  // Falling back to the page text, require an explicit separator. Without it,
  // body text like "PM 64 quarry sand" or "PE100 pipe" reads as a drawing number.
  if (!out.number) {
    const text = page.text.toUpperCase()
    const labelled = /\b(?:DRAWING|DWG|SHEET)\s*(?:NO\.?|NUMBER|#)?\s*[:.]?\s*([A-Z]{1,3}-\d{2,4}(?:-\d{1,3})?)\b/.exec(text)
    const bare = /\b([A-Z]{1,3}-\d{3,4}(?:-\d{1,3})?)\b/.exec(text)
    const candidate = labelled?.[1] ?? bare?.[1]
    if (candidate && !looksLikeSpec(candidate)) out.number = candidate
  }

  const revision = /\b(?:REV(?:ISION)?\.?\s*(?:NO\.?)?\s*[:.]?\s*|ISSUE\s*)([A-Z0-9]{1,3})\b/.exec(
    `${stem} ${page.text}`.toUpperCase(),
  )
  if (revision) out.revision = `REV ${revision[1]}`

  const title = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (title && title.length <= 90) out.title = title

  return out
}
