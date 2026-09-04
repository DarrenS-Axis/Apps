/**
 * Minimal EXIF reader.
 *
 * The app only needs three things out of a camera file: when the shot was
 * actually taken, where it was taken, and which way the sensor was held. That
 * is a handful of tags, so it is cheaper to walk the APP1 segment directly than
 * to ship a general purpose EXIF library into an offline bundle.
 */

export interface ExifData {
  /** Epoch ms from DateTimeOriginal (falling back to DateTimeDigitized). */
  takenAt?: number
  lat?: number
  lng?: number
  /** EXIF orientation, 1..8. */
  orientation?: number
}

const TAG_ORIENTATION = 0x0112
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_DATETIME_DIGITIZED = 0x9004
const TAG_GPS_LAT_REF = 0x0001
const TAG_GPS_LAT = 0x0002
const TAG_GPS_LNG_REF = 0x0003
const TAG_GPS_LNG = 0x0004

/** "2024:03:19 14:22:07" — EXIF stores local time with no zone. */
function parseExifDate(s: string): number | undefined {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim())
  if (!m) return undefined
  const [, y, mo, d, h, mi, sec] = m
  const t = new Date(+y, +mo - 1, +d, +h, +mi, +sec).getTime()
  return Number.isFinite(t) ? t : undefined
}

export function readExif(buffer: ArrayBuffer): ExifData {
  const out: ExifData = {}
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return out // not a JPEG

  // Walk the JPEG marker segments looking for APP1/Exif.
  let offset = 2
  let tiffStart = -1
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break
    const marker = view.getUint8(offset + 1)
    if (marker === 0xda || marker === 0xd9) break // start of scan / end of image
    const size = view.getUint16(offset + 2)
    if (marker === 0xe1 && offset + 10 <= view.byteLength) {
      // "Exif\0\0"
      if (view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0x0000) {
        tiffStart = offset + 10
        break
      }
    }
    offset += 2 + size
  }
  if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return out

  const byteOrder = view.getUint16(tiffStart)
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return out
  const le = byteOrder === 0x4949

  const u16 = (o: number) => view.getUint16(o, le)
  const u32 = (o: number) => view.getUint32(o, le)

  const ascii = (o: number, len: number): string => {
    let s = ''
    for (let i = 0; i < len && o + i < view.byteLength; i++) {
      const c = view.getUint8(o + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }

  const rational = (o: number): number => {
    const num = u32(o)
    const den = u32(o + 4)
    return den === 0 ? 0 : num / den
  }

  /** Reads one IFD, returning a map of tag -> value offset and count. */
  const readIfd = (ifdOffset: number): Map<number, { type: number; count: number; valueOffset: number }> => {
    const entries = new Map<number, { type: number; count: number; valueOffset: number }>()
    if (ifdOffset + 2 > view.byteLength) return entries
    const count = u16(ifdOffset)
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12
      if (entry + 12 > view.byteLength) break
      const tag = u16(entry)
      const type = u16(entry + 2)
      const n = u32(entry + 4)
      // Values of 4 bytes or fewer are stored inline in the entry itself.
      const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
      const byteLen = (sizes[type] ?? 1) * n
      const valueOffset = byteLen <= 4 ? entry + 8 : tiffStart + u32(entry + 8)
      entries.set(tag, { type, count: n, valueOffset })
    }
    return entries
  }

  const ifd0 = readIfd(tiffStart + u32(tiffStart + 4))

  const orient = ifd0.get(TAG_ORIENTATION)
  if (orient) out.orientation = u16(orient.valueOffset)

  const exifPtr = ifd0.get(TAG_EXIF_IFD)
  if (exifPtr) {
    const exifIfd = readIfd(tiffStart + u32(exifPtr.valueOffset))
    const dto = exifIfd.get(TAG_DATETIME_ORIGINAL) ?? exifIfd.get(TAG_DATETIME_DIGITIZED)
    if (dto) out.takenAt = parseExifDate(ascii(dto.valueOffset, dto.count))
  }

  const gpsPtr = ifd0.get(TAG_GPS_IFD)
  if (gpsPtr) {
    const gps = readIfd(tiffStart + u32(gpsPtr.valueOffset))
    const dms = (e: { valueOffset: number } | undefined): number | undefined => {
      if (!e) return undefined
      const d = rational(e.valueOffset)
      const m = rational(e.valueOffset + 8)
      const s = rational(e.valueOffset + 16)
      return d + m / 60 + s / 3600
    }
    const lat = dms(gps.get(TAG_GPS_LAT))
    const lng = dms(gps.get(TAG_GPS_LNG))
    const latRef = gps.get(TAG_GPS_LAT_REF)
    const lngRef = gps.get(TAG_GPS_LNG_REF)
    if (lat !== undefined && Number.isFinite(lat)) {
      out.lat = ascii(latRef?.valueOffset ?? 0, 1).toUpperCase() === 'S' ? -lat : lat
    }
    if (lng !== undefined && Number.isFinite(lng)) {
      out.lng = ascii(lngRef?.valueOffset ?? 0, 1).toUpperCase() === 'W' ? -lng : lng
    }
  }

  return out
}
