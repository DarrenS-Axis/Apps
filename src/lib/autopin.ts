/**
 * Autopin: finding every penetration tag on a searchable penetration plan.
 *
 * The consultants' requirements exist for this: tags must be unique, must
 * match the register exactly, and any size or type on the tag is separated by
 * a dash because "the dash breaks the search string". So a tag on the plan
 * reading "F0001-FW-100mm" is found by the register number "F0001".
 */
export interface FoundTag {
  number: string
  /** Normalised 0..1 position on the rendered page. */
  x: number
  y: number
  /** What the plan actually said, for the import report. */
  text: string
}

export interface AutopinPage {
  page: number
  found: FoundTag[]
  /** Distinct numbers seen on the page, matched or not. */
  candidates: number
}

type PdfModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<PdfModule> | null = null
async function loadPdfjs(): Promise<PdfModule> {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
    return pdfjs
  })()
  return pdfjsPromise
}

/** The searchable part of a tag: everything before the first dash, upper-cased. */
export const tagKey = (s: string): string => s.trim().split(/[-–—]/)[0].trim().toUpperCase()

/**
 * Scans a PDF for the given register numbers. Every text run on each page is
 * split at dashes and whitespace, and a run whose leading token equals a
 * register number (case-insensitive) is a hit at that run's position.
 */
export async function findTagsInPdf(file: Blob, numbers: string[], opts: { maxPages?: number } = {}): Promise<AutopinPage[]> {
  const wanted = new Map(numbers.map((n) => [tagKey(n), n]))
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loadingTask.promise
  const out: AutopinPage[] = []
  try {
    const total = Math.min(pdf.numPages, opts.maxPages ?? 40)
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const found: FoundTag[] = []
      const seen = new Set<string>()
      const candidates = new Set<string>()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        // A tag can be split across runs ("F0001" "-FW") or carry the whole
        // thing; either way the leading token is what identifies it.
        for (const token of item.str.split(/\s+/)) {
          const key = tagKey(token)
          if (!key) continue
          if (/^[A-Z]{0,3}\d{3,}[A-Z]?$/.test(key)) candidates.add(key)
          const number = wanted.get(key)
          if (!number || seen.has(number)) continue
          const [vx, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
          found.push({ number, x: vx / viewport.width, y: vy / viewport.height, text: item.str.trim() })
          seen.add(number)
        }
      }
      out.push({ page: n, found, candidates: candidates.size })
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }
  return out
}
