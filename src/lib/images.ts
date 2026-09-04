import { readExif } from './exif'
import type { Photo, PhotoCategory, Settings } from '../data/types'
import { uid } from '../data/db'

/** Formats an epoch for the caption burned into a photo and shown in lists. */
export function stampText(epoch: number): string {
  const d = new Date(epoch)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds(),
  )}`
}

export function formatCoords(lat?: number, lng?: number): string {
  if (lat === undefined || lng === undefined) return ''
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

function readFile(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the image.'))
    img.src = src
  })
}

/** Applies the EXIF orientation so a phone photo is not stored on its side. */
function orientedSize(w: number, h: number, orientation = 1): { w: number; h: number } {
  return orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h }
}

function applyOrientation(ctx: CanvasRenderingContext2D, orientation: number, w: number, h: number): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0)
      break
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h)
      break
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h)
      break
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      ctx.transform(0, 1, -1, 0, w, 0)
      break
    case 7:
      ctx.transform(0, -1, -1, 0, w, h)
      break
    case 8:
      ctx.transform(0, -1, 1, 0, 0, h)
      break
    default:
      break
  }
}

/** Draws the date/time/location caption bar across the bottom of the photo. */
function burnStamp(canvas: HTMLCanvasElement, lines: string[]): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || lines.length === 0) return
  const scale = canvas.width / 1000
  const fontSize = Math.max(13, Math.round(22 * scale))
  const pad = Math.round(fontSize * 0.5)
  const lineH = Math.round(fontSize * 1.28)
  const boxH = lineH * lines.length + pad * 2

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
  ctx.fillRect(0, canvas.height - boxH, canvas.width, boxH)
  ctx.font = `600 ${fontSize}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, canvas.height - boxH + pad + i * lineH, canvas.width - pad * 2)
  })
  ctx.restore()
}

interface ProcessedImage {
  data: string
  thumb: string
  width: number
  height: number
}

/**
 * Downscales to `maxEdge`, corrects orientation, optionally burns a caption,
 * and produces a matching thumbnail. Everything is JPEG so a job with hundreds
 * of photos still fits inside the browser's storage quota.
 */
export async function processImage(
  file: Blob,
  opts: { maxEdge: number; orientation?: number; stampLines?: string[]; quality?: number },
): Promise<ProcessedImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const orientation = opts.orientation ?? 1
    const src = orientedSize(img.naturalWidth, img.naturalHeight, orientation)
    const scale = Math.min(1, opts.maxEdge / Math.max(src.w, src.h))
    const w = Math.max(1, Math.round(src.w * scale))
    const h = Math.max(1, Math.round(src.h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not available in this browser.')
    ctx.save()
    applyOrientation(ctx, orientation, w, h)
    // After the orientation transform the drawing space is the pre-rotation size.
    const drawW = orientation >= 5 && orientation <= 8 ? h : w
    const drawH = orientation >= 5 && orientation <= 8 ? w : h
    ctx.drawImage(img, 0, 0, drawW, drawH)
    ctx.restore()

    if (opts.stampLines?.length) burnStamp(canvas, opts.stampLines)
    const data = canvas.toDataURL('image/jpeg', opts.quality ?? 0.82)

    const tScale = Math.min(1, 320 / Math.max(w, h))
    const tCanvas = document.createElement('canvas')
    tCanvas.width = Math.max(1, Math.round(w * tScale))
    tCanvas.height = Math.max(1, Math.round(h * tScale))
    tCanvas.getContext('2d')?.drawImage(canvas, 0, 0, tCanvas.width, tCanvas.height)
    const thumb = tCanvas.toDataURL('image/jpeg', 0.7)

    return { data, thumb, width: w, height: h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Best-effort device position; never blocks capture if it is refused. */
export function currentPosition(timeout = 8000): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    )
  })
}

export interface CapturePhotoOptions {
  itpId: string
  itemNo?: string
  category: PhotoCategory
  caption?: string
  settings: Settings
  /** Extra caption lines, e.g. the ITP number and area. */
  contextLines?: string[]
}

/**
 * Turns a camera / gallery file into a stored Photo record.
 *
 * `takenAt` prefers the file's EXIF DateTimeOriginal, which is the moment the
 * shutter fired, and falls back to the clock when the file has no EXIF (some
 * browsers strip it). `takenAtFromExif` records which of the two was used so
 * the evidence trail is honest about it.
 */
export async function capturePhoto(file: Blob, opts: CapturePhotoOptions): Promise<Photo> {
  const buf = await readFile(file)
  const exif = readExif(buf)

  const addedAt = Date.now()
  const takenAt = exif.takenAt ?? addedAt

  let lat = exif.lat
  let lng = exif.lng
  let accuracy: number | undefined
  if (opts.settings.captureGps && (lat === undefined || lng === undefined)) {
    const pos = await currentPosition()
    if (pos) {
      lat = pos.coords.latitude
      lng = pos.coords.longitude
      accuracy = pos.coords.accuracy
    }
  }

  const stampLines: string[] = []
  if (opts.settings.stampPhotos) {
    stampLines.push(stampText(takenAt))
    for (const line of opts.contextLines ?? []) if (line) stampLines.push(line)
    const coords = formatCoords(lat, lng)
    if (coords) stampLines.push(`GPS ${coords}${accuracy ? ` (±${Math.round(accuracy)} m)` : ''}`)
  }

  const processed = await processImage(file, {
    maxEdge: opts.settings.photoMaxEdge,
    orientation: exif.orientation,
    stampLines,
  })

  return {
    id: uid('pho'),
    itpId: opts.itpId,
    itemNo: opts.itemNo,
    category: opts.category,
    caption: opts.caption ?? '',
    data: processed.data,
    thumb: processed.thumb,
    width: processed.width,
    height: processed.height,
    takenAt,
    takenAtFromExif: exif.takenAt !== undefined,
    addedAt,
    lat,
    lng,
    accuracy,
    by: opts.settings.userName || undefined,
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
