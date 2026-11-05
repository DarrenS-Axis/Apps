// Floor-plan underlays: PDF pages and images.
//
// The plan itself is kept out of the project object. A multi-megabyte image
// copied into every undo snapshot and every localStorage autosave would blow
// the 5 MB storage quota and slow every edit, so the project only holds a
// reference and the picture lives as a Blob in IndexedDB.

const PDFJS_VERSION = '6.3.289'
// The build copies pdf.js next to this file (vite.config.ts). The CDN copy is
// only for running the folder straight off a static server without a build.
const PDFJS_BASES = [new URL('./vendor/', import.meta.url).href, `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/`]

let pdfjs = null
export async function loadPdfjs() {
  if (pdfjs) return pdfjs
  for (const base of PDFJS_BASES) {
    try {
      const lib = await import(/* @vite-ignore */ `${base}pdf.min.mjs`)
      lib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`
      pdfjs = lib
      return lib
    } catch {
      // try the next location
    }
  }
  throw new Error('The PDF reader could not be loaded — check the connection and try again.')
}

export async function openPdf(file) {
  const lib = await loadPdfjs()
  return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
}

/** Release a document and its worker. */
export function closePdf(doc) {
  try {
    doc?.loadingTask?.destroy()
  } catch {
    // already closed
  }
}

/** Paper size of a page in points (1/72 inch), rotation applied. */
export async function pageSize(doc, pageNo) {
  const vp = (await doc.getPage(pageNo)).getViewport({ scale: 1 })
  return { widthPt: vp.width, heightPt: vp.height }
}

/**
 * Render one page to a PNG. Resolution is capped so an A0 sheet stays a
 * sensible size, while small sheets still render sharp enough to zoom into.
 */
export async function renderPdfPage(doc, pageNo, maxPx = 7000) {
  const page = await doc.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(5, maxPx / Math.max(base.width, base.height))
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(vp.width)
  canvas.height = Math.ceil(vp.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the page'))), 'image/png'))
  canvas.width = canvas.height = 0
  return { blob, widthPt: base.width, heightPt: base.height }
}

/** Metres per world unit when one world unit is one PDF point at 1:ratio. */
export const metresPerPoint = (ratio) => (ratio * 25.4) / 72 / 1000

const PAPER = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] }
export function paperName(widthPt, heightPt) {
  const mm = [widthPt, heightPt].map((p) => (p * 25.4) / 72).sort((a, b) => a - b)
  for (const [name, [a, b]] of Object.entries(PAPER)) if (Math.abs(mm[0] - a) < 4 && Math.abs(mm[1] - b) < 4) return name
  return `${Math.round(mm[0])} × ${Math.round(mm[1])} mm`
}

// ---------- blob store (IndexedDB) ----------

const DB_NAME = 'axis-mep'
const STORE = 'underlays'
let dbPromise = null

function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
  })
}

export const putBlob = (key, blob) => tx('readwrite', (s) => s.put(blob, key)).catch(() => undefined)
export const getBlob = (key) => tx('readonly', (s) => s.get(key)).catch(() => undefined)
/** Remove every stored plan except the ones still referenced. */
export async function pruneBlobs(keep) {
  try {
    const keys = await tx('readonly', (s) => s.getAllKeys())
    await Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => tx('readwrite', (s) => s.delete(k))))
  } catch {
    // storage unavailable: nothing to prune
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(url) {
  return (await fetch(url)).blob()
}

export function imageSize(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { reject(new Error('That file is not an image this browser can read')); URL.revokeObjectURL(url) }
    img.src = url
  })
}
