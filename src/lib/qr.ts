import qrcode from 'qrcode-generator'

/**
 * QR codes for the plant register. A label carries a link to the item —
 * `…/#/plant/tag/SA-0412` — so any phone camera opens it, and the app's own
 * scanner reads the plant number out of the same link.
 */

/** The app's own address, without the route. */
export const appBase = (): string => `${location.origin}${location.pathname}`

export const plantLink = (plantNo: string): string => `${appBase()}#/plant/tag/${encodeURIComponent(plantNo)}`

/**
 * The plant number in whatever a scan returned: our link, a bare number, or
 * a link from another copy of the app. Null when it is none of those.
 */
export function plantNoFromCode(text: string): string | null {
  const t = text.trim()
  const m = /#\/plant\/tag\/([^/?#\s]+)/.exec(t)
  if (m) return decodeURIComponent(m[1]).toUpperCase()
  if (/^[A-Z]{2,3}-\d{1,6}$/i.test(t)) return t.toUpperCase()
  return null
}

/** Dark modules of the code, row by row. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/** An SVG path of the code, one unit per module, with a four-module quiet zone. */
export function qrSvg(text: string): { path: string; size: number } {
  const m = qrMatrix(text)
  const q = 4
  let path = ''
  m.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      if (!row[c]) {
        c++
        continue
      }
      const start = c
      while (c < row.length && row[c]) c++
      path += `M${start + q} ${r + q}h${c - start}v1h${start - c}z`
    }
  })
  return { path, size: m.length + q * 2 }
}

/* ------------------------------------------------------------- decoding */

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> }

let detector: Detector | null | undefined

/** The browser's own barcode reader where there is one (Android Chrome); faster and better in poor light. */
async function nativeDetector(): Promise<Detector | null> {
  if (detector !== undefined) return detector
  const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
  try {
    if (BD && (!BD.getSupportedFormats || (await BD.getSupportedFormats()).includes('qr_code'))) {
      detector = new BD({ formats: ['qr_code'] })
      return detector
    }
  } catch {
    // Unsupported here; fall through to the JavaScript decoder.
  }
  detector = null
  return null
}

/** Reads a QR code from a video frame, image or canvas. */
export async function decodeQr(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap, canvas?: HTMLCanvasElement): Promise<string | null> {
  const native = await nativeDetector()
  if (native) {
    try {
      const found = await native.detect(source)
      if (found[0]?.rawValue) return found[0].rawValue
    } catch {
      // Fall back below.
    }
  }
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.width
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.height
  if (!w || !h) return null
  // jsQR is slow on a full 12-megapixel photo and no better for it.
  const scale = Math.min(1, 1000 / Math.max(w, h))
  const cw = Math.round(w * scale)
  const ch = Math.round(h * scale)
  const c = canvas ?? document.createElement('canvas')
  c.width = cw
  c.height = ch
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, cw, ch)
  const { default: jsQR } = await import('jsqr')
  const img = ctx.getImageData(0, 0, cw, ch)
  return jsQR(img.data, cw, ch, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

/**
 * Loads the decoder once the app has settled, so the service worker caches it
 * while there is signal — a yard or a basement is where labels get scanned.
 */
export function warmQrDecoder(delayMs = 4000): () => void {
  const t = window.setTimeout(() => void import('jsqr').catch(() => undefined), delayMs)
  return () => window.clearTimeout(t)
}

/** Reads a QR code from a photo of a label. */
export async function decodeQrFile(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Could not open that image.'))
      i.src = url
    })
    return await decodeQr(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}
