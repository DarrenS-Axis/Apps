// The labour workbook opened straight from a file — no Microsoft 365 sign-in.
// An .xlsx is a zip of XML: the page unzips it in the browser, shows the
// cells, and on save writes the changed cells back into the workbook's own
// XML, so colours, column widths, other sheets and formulas are kept.
//
// LocalBook has the same methods the app uses on the SharePoint workbook
// (sheets, readSheet, readRange, writeRange, stamp), so the rest of the page
// works the same either way.

import { parseCell, colName } from './graph.js'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// ------------------------------------------------------------------ zip

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw')
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer())
}

async function deflate(bytes) {
  const cs = new CompressionStream('deflate-raw')
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer())
}

async function unzip(buf) {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error("That file isn't an Excel workbook (.xlsx).")
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const files = new Map()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = bytes.subarray(start, start + size)
    files.set(name, method === 0 ? raw.slice() : await inflate(raw))
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function zip(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name)
    const comp = await deflate(data)
    const crc = crc32(data)
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true) // UTF-8 names
    head.setUint16(8, 8, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, comp.length, true)
    head.setUint32(22, data.length, true)
    head.setUint16(26, nameBytes.length, true)
    parts.push(new Uint8Array(head.buffer), nameBytes, comp)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(8, 0x0800, true)
    cen.setUint16(10, 8, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, comp.length, true)
    cen.setUint32(24, data.length, true)
    cen.setUint16(28, nameBytes.length, true)
    cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), nameBytes)
    offset += 30 + nameBytes.length + comp.length
  }
  const cenSize = central.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.size, true)
  end.setUint16(10, files.size, true)
  end.setUint32(12, cenSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ------------------------------------------------------------------ workbook

const xml = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml')
const els = (node, tag) => [...node.getElementsByTagNameNS(NS, tag)]

function textOf(node) {
  // Rich text runs: <r><t>…</t></r>; phonetic runs (<rPh>) are not shown.
  return els(node, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('')
}

export class LocalBook {
  /** source: a File, plus (where the browser allows) a handle to save back to. */
  static async open(file, handle) {
    const b = new LocalBook()
    b.handle = handle || null
    await b.load(file)
    return b
  }

  async load(file) {
    this.name = file.name
    this.lastModified = file.lastModified
    this.files = await unzip(await file.arrayBuffer())
    const wb = xml(this.files.get('xl/workbook.xml'))
    const rels = xml(this.files.get('xl/_rels/workbook.xml.rels'))
    const target = new Map([...rels.getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]))
    this.sheetList = els(wb, 'sheet')
      .filter((s) => (s.getAttribute('state') || 'visible') === 'visible')
      .map((s, i) => {
        let t = target.get(s.getAttributeNS(REL_NS, 'id'))
        t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '')
        return { name: s.getAttribute('name'), position: i, path: t }
      })
    const ss = this.files.get('xl/sharedStrings.xml')
    this.shared = ss ? els(xml(ss), 'si').map(textOf) : []
    this.docs = new Map() // sheet name -> parsed XML document, once read
    this.edits = new Map() // sheet name -> Map("r,c" -> value)
    this.dirty = false
  }

  get webUrl() { return '' }

  async sheets() {
    return this.sheetList.map(({ name, position }) => ({ name, position, visibility: 'Visible' }))
  }

  doc(name) {
    let d = this.docs.get(name)
    if (!d) {
      const s = this.sheetList.find((x) => x.name === name)
      if (!s) throw new Error(`No sheet called ${name}`)
      d = xml(this.files.get(s.path))
      this.docs.set(name, d)
    }
    return d
  }

  async readSheet(name) {
    const d = this.doc(name)
    const cells = []
    let rows = 0, cols = 0
    for (const c of els(d, 'c')) {
      const ref = c.getAttribute('r')
      if (!ref) continue
      const { row, col } = parseCell(ref)
      const t = c.getAttribute('t')
      const v = els(c, 'v')[0]
      const f = els(c, 'f')[0]
      let value = ''
      if (t === 's' && v) value = this.shared[Number(v.textContent)] ?? ''
      else if (t === 'inlineStr') value = textOf(els(c, 'is')[0] || c)
      else if (t === 'str' || t === 'e') value = v ? v.textContent : ''
      else if (t === 'b') value = v ? v.textContent === '1' : ''
      else if (v) value = Number(v.textContent)
      const formula = f && f.textContent ? '=' + f.textContent : value
      if (value === '' && formula === '') continue
      cells.push([row, col, value, formula])
      rows = Math.max(rows, row + 1)
      cols = Math.max(cols, col + 1)
    }
    rows = Math.max(rows, 1); cols = Math.max(cols, 1)
    const values = Array.from({ length: rows }, () => new Array(cols).fill(''))
    const formulas = Array.from({ length: rows }, () => new Array(cols).fill(''))
    for (const [r, c, v, f] of cells) { values[r][c] = v; formulas[r][c] = f }
    // Edits not yet saved to the file.
    for (const [key, v] of this.edits.get(name) || []) {
      const [r, c] = key.split(',').map(Number)
      if (r < rows && c < cols) { values[r][c] = v; formulas[r][c] = v }
    }
    return { values, formulas, rows, cols }
  }

  async readRange(name, address) {
    const data = await this.readSheet(name)
    const [a, b = a] = address.split(':').map(parseCell)
    const values = []
    for (let r = a.row; r <= b.row; r++) {
      const row = []
      for (let c = a.col; c <= b.col; c++) row.push(data.values[r]?.[c] ?? '')
      values.push(row)
    }
    return { values }
  }

  async writeRange(name, address, values) {
    const [a] = address.split(':').map(parseCell)
    if (!this.edits.has(name)) this.edits.set(name, new Map())
    const m = this.edits.get(name)
    values.forEach((row, i) => row.forEach((v, j) => m.set(`${a.row + i},${a.col + j}`, v)))
    this.dirty = true
    this.onChange?.()
    return { values }
  }

  /** "Has the file changed" — only meaningful when we can re-read it from disk. */
  async stamp() {
    if (this.handle && !this.dirty) {
      const file = await this.handle.getFile()
      if (file.lastModified !== this.lastModified) await this.load(file)
    }
    return { cTag: String(this.lastModified), lastModifiedDateTime: new Date(this.lastModified).toISOString() }
  }

  /** The workbook with every edit written into its sheets, as an .xlsx Blob. */
  async build() {
    const enc = new TextEncoder()
    const out = new Map(this.files)
    for (const [name, edits] of this.edits) {
      if (!edits.size) continue
      const d = this.doc(name)
      const data = els(d, 'sheetData')[0]
      const rowEls = new Map(els(data, 'row').map((r) => [Number(r.getAttribute('r')), r]))
      for (const [key, v] of edits) {
        const [r, c] = key.split(',').map(Number)
        const rowNo = r + 1
        let row = rowEls.get(rowNo)
        if (!row) {
          row = d.createElementNS(NS, 'row')
          row.setAttribute('r', String(rowNo))
          const after = [...rowEls.keys()].filter((n) => n > rowNo).sort((x, y) => x - y)[0]
          data.insertBefore(row, after ? rowEls.get(after) : null)
          rowEls.set(rowNo, row)
        }
        const ref = colName(c) + rowNo
        let cell = els(row, 'c').find((x) => x.getAttribute('r') === ref)
        if (!cell) {
          cell = d.createElementNS(NS, 'c')
          cell.setAttribute('r', ref)
          const next = els(row, 'c').find((x) => parseCell(x.getAttribute('r')).col > c)
          row.insertBefore(cell, next || null)
          // Without a style of its own the cell takes its row's (as Excel does).
          if (row.getAttribute('s') && row.getAttribute('customFormat') === '1') cell.setAttribute('s', row.getAttribute('s'))
        }
        // Keep the cell's style (its colour), replace its content.
        while (cell.firstChild) cell.removeChild(cell.firstChild)
        cell.removeAttribute('t')
        if (v === '' || v === null) continue
        if (typeof v === 'number') {
          const ve = d.createElementNS(NS, 'v'); ve.textContent = String(v); cell.append(ve)
        } else {
          cell.setAttribute('t', 'inlineStr')
          const is = d.createElementNS(NS, 'is')
          const t = d.createElementNS(NS, 't')
          if (/^\s|\s$/.test(v)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
          t.textContent = String(v)
          is.append(t); cell.append(is)
        }
      }
      // The used-range hint may now be too small; Excel recomputes it if absent.
      for (const dim of els(d, 'dimension')) dim.parentNode.removeChild(dim)
      const path = this.sheetList.find((s) => s.name === name).path
      out.set(path, enc.encode(new XMLSerializer().serializeToString(d)))
    }
    // Formulas that read edited cells recalculate when Excel next opens it.
    const wbDoc = xml(this.files.get('xl/workbook.xml'))
    let calc = els(wbDoc, 'calcPr')[0]
    if (!calc) { calc = wbDoc.createElementNS(NS, 'calcPr'); wbDoc.documentElement.append(calc) }
    calc.setAttribute('fullCalcOnLoad', '1')
    out.set('xl/workbook.xml', enc.encode(new XMLSerializer().serializeToString(wbDoc)))
    return zip(out)
  }

  /**
   * Saves. With a file handle (Chrome / Edge on a computer) the opened file is
   * overwritten in place — in a OneDrive-synced SharePoint folder that puts
   * the change back in SharePoint. Otherwise the workbook is downloaded.
   */
  async save() {
    const blob = await this.build()
    if (this.handle && this.handle.createWritable) {
      const perm = await this.handle.requestPermission?.({ mode: 'readwrite' })
      if (perm && perm !== 'granted') throw new Error('Permission to save over the file was refused.')
      const w = await this.handle.createWritable()
      await w.write(blob)
      await w.close()
      const file = await this.handle.getFile()
      await this.load(file)
      return 'saved'
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = this.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    this.edits.clear()
    this.files = await unzip(await blob.arrayBuffer())
    this.docs.clear()
    this.dirty = false
    return 'downloaded'
  }
}

/** Asks for the workbook: the file picker that can save back where it can, else a plain one. */
export async function pickWorkbook() {
  if (window.showOpenFilePicker) {
    let handle
    try {
      ;[handle] = await window.showOpenFilePicker({
        types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'] } }],
      })
    } catch (err) {
      if (err.name === 'AbortError') throw err
      handle = null // not allowed here (e.g. some frames): use the plain picker
    }
    if (handle) {
      await rememberHandle(handle)
      return LocalBook.open(await handle.getFile(), handle)
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    input.onchange = () => (input.files[0] ? LocalBook.open(input.files[0]).then(resolve, reject) : reject(new Error('No file chosen')))
    input.click()
  })
}

// The last file opened, kept so it can be reopened with one click next time
// (Chrome / Edge keep file handles in IndexedDB; other browsers skip this).
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('axis-labour', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function kv(mode, fn) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode)
    const req = fn(tx.objectStore('kv'))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
  })
}
async function rememberHandle(handle) {
  try { await kv('readwrite', (s) => s.put(handle, 'lastFile')) } catch { /* not supported */ }
}
export async function lastHandle() {
  try { return (await kv('readonly', (s) => s.get('lastFile'))) || null } catch { return null }
}
export async function reopen(handle) {
  const perm = await handle.requestPermission({ mode: 'readwrite' })
  if (perm !== 'granted') throw new Error('Permission to open the file was refused.')
  return LocalBook.open(await handle.getFile(), handle)
}
