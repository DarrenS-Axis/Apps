/**
 * Reads an .xlsx workbook in the browser with no library: a workbook is a zip
 * of XML, the browser can inflate (DecompressionStream) and parse XML
 * (DOMParser), and the consultants' Autopin register is a plain grid. CSV is
 * accepted too, for anyone who exports it that way.
 */

export interface Sheet {
  name: string
  rows: string[][]
}

/* ------------------------------------------------------------------ zip */

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

function readCentralDirectory(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  // End of central directory record: scan back for its signature.
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66_000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip / xlsx file.')
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  const decoder = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen))
    entries.push({ name, method, compressedSize, localHeaderOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function readEntry(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buf)
  const nameLen = view.getUint16(e.localHeaderOffset + 26, true)
  const extraLen = view.getUint16(e.localHeaderOffset + 28, true)
  const start = e.localHeaderOffset + 30 + nameLen + extraLen
  const data = new Uint8Array(buf, start, e.compressedSize)
  if (e.method === 0) return data
  if (e.method !== 8) throw new Error(`Unsupported zip compression (${e.method}).`)
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/* ----------------------------------------------------------------- xlsx */

const colIndex = (ref: string): number => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function parseXml(bytes: Uint8Array): Document {
  return new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml')
}

export async function readXlsx(file: Blob): Promise<Sheet[]> {
  const buf = await file.arrayBuffer()
  const entries = readCentralDirectory(buf)
  const byName = new Map(entries.map((e) => [e.name, e]))
  const need = (name: string) => {
    const e = byName.get(name)
    if (!e) throw new Error(`Workbook is missing ${name}.`)
    return readEntry(buf, e)
  }

  const shared: string[] = []
  if (byName.has('xl/sharedStrings.xml')) {
    const doc = parseXml(await need('xl/sharedStrings.xml'))
    for (const si of Array.from(doc.getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''))
    }
  }

  const wb = parseXml(await need('xl/workbook.xml'))
  const rels = parseXml(await need('xl/_rels/workbook.xml.rels'))
  const relMap = new Map(
    Array.from(rels.getElementsByTagName('Relationship')).map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']),
  )

  const sheets: Sheet[] = []
  for (const s of Array.from(wb.getElementsByTagName('sheet'))) {
    const rid = s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? ''
    let target = relMap.get(rid) ?? ''
    target = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`
    const entry = byName.get(target)
    if (!entry) continue
    const doc = parseXml(await readEntry(buf, entry))
    const rows: string[][] = []
    for (const row of Array.from(doc.getElementsByTagName('row'))) {
      const cells: string[] = []
      for (const c of Array.from(row.getElementsByTagName('c'))) {
        const idx = colIndex(c.getAttribute('r') ?? 'A')
        const type = c.getAttribute('t')
        let value = ''
        if (type === 'inlineStr') {
          value = Array.from(c.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('')
        } else {
          const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
          value = type === 's' ? (shared[Number(v)] ?? '') : v
        }
        cells[idx] = value.replace(/\s+/g, ' ').trim()
      }
      for (let i = 0; i < cells.length; i++) cells[i] ??= ''
      rows.push(cells)
    }
    sheets.push({ name: s.getAttribute('name') ?? `Sheet${sheets.length + 1}`, rows })
  }
  return sheets
}

/* ------------------------------------------------------------------ csv */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell.trim())
    rows.push(row)
  }
  return rows.filter((r) => r.some(Boolean))
}

/** Reads a register from whichever of the two formats it arrives in. */
export async function readRegisterFile(file: File): Promise<Sheet[]> {
  if (/\.csv$/i.test(file.name)) return [{ name: file.name, rows: parseCsv(await file.text()) }]
  return readXlsx(file)
}
