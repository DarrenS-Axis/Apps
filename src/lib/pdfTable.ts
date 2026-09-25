import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { loadPdfjs } from './planImport'
import type { Sheet } from './xlsx'

/**
 * Reads the tables in a PDF — a schedule printed from Excel, exported from
 * Revit or typed up by an architect — back into rows and columns, so the
 * same importers that read .xlsx files read the PDF.
 *
 * A PDF has no table, only text at positions and lines drawn on the page.
 * The header row is found by its words (the caller says what a header looks
 * like). The columns come from the table's vertical rules where it has them,
 * and otherwise from the gutters: the strips of page no text crosses. The rows
 * come from the horizontal rules, so a cell that wraps onto three lines stays
 * one cell; a table without rules is read line by line and the caller decides
 * which lines start a row and which carry on the one above. A table that runs
 * over several pages is one table, whether or not the header is repeated.
 */

export interface PdfTableOptions {
  /** Is this line of text (cells joined by " | ") the table's header? */
  isHeader: (line: string) => boolean
  /**
   * Does this line start a row, or carry on the row above (a wrapped
   * description)? `header` is the column headings, `prev` the row so far.
   */
  startsRow: (cells: string[], header: string[], prev: string[] | undefined) => boolean
  maxPages?: number
  onProgress?: (page: number, total: number) => void
}

interface Piece {
  s: string
  x: number
  x1: number
  /** Baseline, and the text's height, in page points (y down). */
  y: number
  h: number
}

interface Line {
  y: number
  h: number
  pieces: Piece[]
}

interface Layout {
  /** Column edges, left to right: column i is [edges[i], edges[i+1]). */
  edges: number[]
  header: string[]
  /** Columns from the table's own rules, rather than guessed from the gutters. */
  ruled?: boolean
}

const DARK = 215

/** Text pieces into lines, top to bottom, each left to right. */
function toLines(pieces: Piece[]): Line[] {
  const sorted = [...pieces].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Line[] = []
  for (const p of sorted) {
    const line = lines.find((l) => Math.abs(l.y - p.y) <= Math.min(l.h, p.h) * 0.45)
    if (line) {
      line.pieces.push(p)
      line.h = Math.max(line.h, p.h)
    } else lines.push({ y: p.y, h: p.h, pieces: [p] })
  }
  for (const l of lines) l.pieces.sort((a, b) => a.x - b.x)
  return lines.sort((a, b) => a.y - b.y)
}

/** A line's text in cells split at wide gaps — for recognising the header. */
function lineCells(l: Line): string[] {
  const out: string[] = []
  let cur: Piece | null = null
  for (const p of l.pieces) {
    if (cur && p.x - cur.x1 < l.h * 0.9) {
      out[out.length - 1] += (p.x - cur.x1 > l.h * 0.12 ? ' ' : '') + p.s
      cur = { ...p, x: cur.x }
    } else {
      out.push(p.s)
      cur = p
    }
  }
  return out
}

/** The page drawn in grey, for finding its ruled lines. */
async function renderGrey(page: PDFPageProxy) {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, 3000 / Math.max(base.width, base.height))
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
  const { data, width: W, height: H } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const grey = new Uint8Array(W * H)
  for (let i = 0, p = 0; i < W * H; i++, p += 4) grey[i] = data[p] * 0.3 + data[p + 1] * 0.59 + data[p + 2] * 0.11
  canvas.width = canvas.height = 0
  return { grey, W, H, scale }
}

/** Positions (in points) of the ruled lines crossing at least `min` of a span. */
function rules(
  img: { grey: Uint8Array; W: number; H: number; scale: number },
  dir: 'h' | 'v',
  across: [number, number],
  along: [number, number],
  min: number,
): number[] {
  const { grey, W, H, scale } = img
  const [a0, a1] = [Math.max(0, Math.floor(across[0] * scale)), Math.min(dir === 'h' ? H : W, Math.ceil(across[1] * scale))]
  const [b0, b1] = [Math.max(0, Math.floor(along[0] * scale)), Math.min(dir === 'h' ? W : H, Math.ceil(along[1] * scale))]
  const found: number[] = []
  for (let a = a0; a < a1; a++) {
    let dark = 0
    for (let b = b0; b < b1; b++) {
      const v = dir === 'h' ? grey[a * W + b] : grey[b * W + a]
      if (v < DARK) dark++
    }
    if (dark >= (b1 - b0) * min) found.push(a / scale)
  }
  // A rule a few pixels thick is one rule.
  const merged: number[] = []
  for (const v of found) {
    if (merged.length && v - merged[merged.length - 1] < 2.5) merged[merged.length - 1] = v
    else merged.push(v)
  }
  return merged
}

/** Column edges from the gutters no text crosses (tables without vertical rules). */
function gutterEdges(lines: Line[], header: Line[], width: number): number[] {
  const n = Math.ceil(width) + 2
  const cover = new Float32Array(n)
  const mark = (p: Piece, w: number) => {
    for (let x = Math.max(0, Math.floor(p.x)); x < Math.min(n, Math.ceil(p.x1)); x++) cover[x] += w
  }
  // A line or two of text running across (a heading, a note) does not close a gutter; the header always counts.
  const allow = Math.max(1, lines.length * 0.04)
  for (const l of lines) for (const p of l.pieces) mark(p, 1)
  for (const l of header) for (const p of l.pieces) mark(p, allow + 1)
  const spans: [number, number][] = []
  let start = -1
  for (let x = 0; x < n; x++) {
    const on = cover[x] > allow
    if (on && start < 0) start = x
    if (!on && start >= 0) {
      spans.push([start, x])
      start = -1
    }
  }
  if (start >= 0) spans.push([start, n])
  // Two header cells in one span (text bridging a gutter): split between them.
  const out: [number, number][] = []
  for (const [s, e] of spans) {
    const cells = header
      .flatMap((l) => l.pieces)
      .filter((p) => p.x >= s - 1 && p.x1 <= e + 1)
      .sort((a, b) => a.x - b.x)
    let from = s
    for (let i = 1; i < cells.length; i++) {
      const gap = cells[i].x - cells[i - 1].x1
      if (gap > Math.max(cells[i].h, 4)) {
        const cut = (cells[i - 1].x1 + cells[i].x) / 2
        out.push([from, cut])
        from = cut
      }
    }
    out.push([from, e])
  }
  const edges = [0]
  for (let i = 1; i < out.length; i++) edges.push((out[i - 1][1] + out[i][0]) / 2)
  edges.push(width + 1)
  return edges
}

const colOf = (edges: number[], p: Piece) => {
  const mid = Math.min(p.x + (p.x1 - p.x) / 2, p.x + 8)
  for (let i = edges.length - 2; i >= 0; i--) if (mid >= edges[i]) return i
  return 0
}

/** One line of text in one cell, with where it ends and its character width. */
interface CellLine {
  s: string
  x1: number
  cw: number
}
type Cells = CellLine[][] & { cont?: boolean }

/** Marks a row that may be the rest of the row above (a wrapped line, or a row broken over a page). */
const withCont = (c: Cells, cont: boolean): Cells => Object.assign(c, { cont })

/** Lines into cells by column. */
function cellsOf(lines: Line[], edges: number[]): Cells {
  const cols = edges.length - 1
  const out: Cells = Array.from({ length: cols }, () => [])
  for (const l of lines) {
    const parts: (CellLine & { n: number; w: number })[] = Array.from({ length: cols }, () => ({ s: '', x1: 0, cw: 0, n: 0, w: 0 }))
    const last: (Piece | null)[] = Array(cols).fill(null)
    for (const p of l.pieces) {
      const c = colOf(edges, p)
      const prev = last[c]
      const part = parts[c]
      part.s += prev ? (p.x - prev.x1 > l.h * 0.12 ? ' ' : '') + p.s : p.s
      part.x1 = p.x1
      part.n += p.s.length
      part.w += p.x1 - p.x
      last[c] = p
    }
    parts.forEach((t, c) => t.s.trim() && out[c].push({ s: t.s.trim(), x1: t.x1, cw: t.n ? t.w / t.n : l.h * 0.5 }))
  }
  return out
}

/**
 * A cell's lines back into its text. A line is the cell wrapping, not a new
 * line in the cell, when the next word would not have fitted after it (the
 * line runs to the column's edge), or when it breaks mid-sentence.
 */
function cellText(lines: CellLine[], right: number): string {
  let text = ''
  lines.forEach((line, i) => {
    if (!i) {
      text = line.s
      return
    }
    const prev = lines[i - 1]
    const word = line.s.split(/\s/)[0].length
    // The next word would have fitted: the line was broken on purpose.
    const fitted = prev.x1 + (word + 1) * prev.cw < right - prev.cw
    // Otherwise it wrapped if it breaks mid-sentence. "WC - Accessible" over "Caroma Care 800"
    // could be either; a break is kept, so a name stays apart from its description.
    const midSentence = /^[a-z]/.test(line.s) || /[,\-/&(+]$|\b(and|with|of|for|to|the|a|an|in|on|or|by|at|from|into|within|x)$/i.test(prev.s)
    // A word or two pushed onto the next line ("Hand Basin - Small Wall" / "Mounted") is the wrap.
    const tail = line.s.split(/\s+/).length <= 2 && !/:/.test(line.s)
    if (fitted || !(midSentence || tail)) text += '\n' + line.s
    else text += (/\w-$/.test(prev.s) ? '' : ' ') + line.s
  })
  return text
}

const flat = (cells: Cells) => cells.map((c) => c.map((l) => l.s).join(' '))

/**
 * pdf.js joins text on one baseline when the gap is small, so two headings
 * ("Item/Quantity" "Selection / Description") can arrive as one piece. Such a
 * piece is cut at the column edges it crosses, at the space nearest each edge.
 */
function splitAt(lines: Line[], cuts: number[], ok: (left: Piece, right: Piece) => boolean = () => true): Line[] {
  const split = (p: Piece): Piece[] => {
    const cut = cuts.find((c) => p.x < c - 1.5 && p.x1 > c + 1.5)
    if (cut === undefined) return [p]
    const per = (p.x1 - p.x) / p.s.length
    let best = -1
    for (let i = 1; i < p.s.length - 1; i++) if (p.s[i] === ' ' && (best < 0 || Math.abs(p.x + i * per - cut) < Math.abs(p.x + best * per - cut))) best = i
    if (best < 0) return [p]
    const left = { ...p, s: p.s.slice(0, best).trimEnd() }
    left.x1 = p.x + left.s.length * per
    const right = { ...p, s: p.s.slice(best + 1).trimStart() }
    right.x = p.x1 - right.s.length * per
    if (!ok(left, right)) return [p]
    return [...split(left), ...split(right)]
  }
  return lines.map((l) => ({ ...l, pieces: l.pieces.flatMap(split) }))
}

/**
 * Rows of a table without ruled lines. Where rows are spaced further apart
 * than the lines within them (cell padding), the spacing says where each row
 * starts; otherwise every line is a row for the caller to join up.
 */
function bandsBySpacing(lines: Line[]): Line[][] {
  const gaps = lines.slice(1).map((l, i) => l.y - lines[i].y)
  const common = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.25)] ?? 0
  const wide = gaps.filter((g) => g > common * 1.12).length
  const tight = gaps.filter((g) => g <= common * 1.05).length
  if (!common || wide < 2 || tight < 2) return lines.map((l) => [l])
  const out: Line[][] = [[lines[0]]]
  gaps.forEach((g, i) => (g > common * 1.12 ? out.push([lines[i + 1]]) : out[out.length - 1].push(lines[i + 1])))
  return out
}

/** Drops columns with no heading into the column on their left. */
function tidy(layout: Layout): Layout {
  const edges = [layout.edges[0]]
  const header: string[] = []
  layout.header.forEach((h, i) => {
    if (h || !header.length) {
      if (i > 0) edges.push(layout.edges[i])
      header.push(h)
    }
  })
  edges.push(layout.edges[layout.edges.length - 1])
  return { edges, header }
}

export async function readPdfTables(file: Blob, opts: PdfTableOptions): Promise<Sheet[]> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await task.promise
  // Each table: its layout and its rows as read (banded rows, or single lines to be joined).
  const tables: { layout: Layout; rows: Cells[]; firstPage: number }[] = []
  let carry: Layout | null = null
  let anyText = false
  try {
    const total = Math.min(pdf.numPages, opts.maxPages ?? 40)
    for (let n = 1; n <= total; n++) {
      opts.onProgress?.(n, total)
      const page = await pdf.getPage(n)
      const vp = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const pieces: Piece[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const [a, b, c, d, e, f] = item.transform as number[]
        // Upright text only: rotated captions and title blocks are not table cells.
        if (Math.abs(b) > 0.01 * Math.abs(a) || a <= 0) continue
        const h = Math.hypot(c, d) || item.height || 6
        const [x, y] = vp.convertToViewportPoint(e, f)
        const lead = item.str.length - item.str.trimStart().length
        const w = item.width
        const per = item.str.length ? w / item.str.length : 0
        pieces.push({ s: item.str.trim(), x: x + lead * per, x1: x + w - (item.str.length - item.str.trimEnd().length) * per, y, h })
      }
      if (pieces.length) anyText = true
      const lines = toLines(pieces)
      const hi = lines.findIndex((l) => opts.isHeader(lineCells(l).join(' | ')))
      if (hi < 0 && !carry) {
        page.cleanup()
        continue
      }

      // The ruled lines, where the table has them.
      const head = hi >= 0 ? lines[hi] : null
      const img = await renderGrey(page).catch(() => null)
      let hRules: number[] = []
      let vRules: number[] = []
      let x0 = 0
      let x1 = vp.width
      if (img) {
        const span = head ? [Math.min(...head.pieces.map((p) => p.x)), Math.max(...head.pieces.map((p) => p.x1))] : [carry!.edges[1] ?? 0, carry!.edges[carry!.edges.length - 2] ?? vp.width]
        const top = head ? head.y - head.h * 3 : 0
        hRules = rules(img, 'h', [top, vp.height], [span[0], span[1]], 0.85)
        if (hRules.length >= 2) {
          // The table's width is the width of its rules.
          const row = Math.round(hRules[hRules.length - 1] * img.scale)
          let a = Math.floor(span[0] * img.scale)
          let b = Math.ceil(span[1] * img.scale)
          while (a > 0 && img.grey[row * img.W + a - 1] < DARK) a--
          while (b < img.W - 1 && img.grey[row * img.W + b + 1] < DARK) b++
          x0 = a / img.scale
          x1 = b / img.scale
          vRules = rules(img, 'v', [x0 - 2, x1 + 2], [hRules[0], hRules[hRules.length - 1]], 0.45)
        }
      }

      // A page without a heading carries on the last table only if its columns line up.
      if (hi < 0 && carry) {
        const inner = carry.edges.slice(1, -1)
        // Ruled: the rules must be where the columns were. Not ruled: little text may cross them.
        const lined = vRules.length >= 3
          ? inner.filter((e) => vRules.some((v) => Math.abs(v - e) < 4)).length
          : inner.filter((e) => lines.filter((l) => l.pieces.some((p) => p.x < e - 2 && p.x1 > e + 2)).length <= Math.max(1, lines.length * 0.1)).length
        if (!inner.length || lined < inner.length * 0.7) {
          carry = null
          page.cleanup()
          continue
        }
      }

      // Lines in the table: from the header (or the top, carried on) down.
      const body = lines.filter((l, i) => (hi >= 0 ? i >= hi : true) && l.pieces.some((p) => p.x1 >= x0 - 2 && p.x <= x1 + 2))
      // Which lines are the header: its band between rules, or it and any wrapped heading line right against it.
      let headerLines: Line[] = []
      if (head) {
        const above = hRules.filter((r) => r < head.y - head.h * 0.3).pop()
        const below = hRules.find((r) => r > head.y)
        if (above !== undefined && below !== undefined) headerLines = lines.filter((l) => l.y > above && l.y - l.h * 0.3 < below)
        else {
          headerLines = [head]
          const next = lines[hi + 1]
          if (next && next.y - head.y < head.h * 1.45 && !/\d/.test(next.pieces.map((p) => p.s).join(''))) headerLines.push(next)
        }
      }

      // Columns.
      let layout: Layout
      let dataLines = body.filter((l) => !headerLines.includes(l) && (headerLines.length ? l.y > Math.max(...headerLines.map((h) => h.y)) : true))
      if (headerLines.length) {
        let edges: number[]
        if (vRules.length >= 3) {
          edges = [vRules[0] - 1, ...vRules.slice(1, -1), vRules[vRules.length - 1] + 1]
          headerLines = splitAt(headerLines, edges.slice(1, -1))
        } else {
          // The gutters in the data first, to cut headings pdf.js ran together; then with the headings.
          // Only where each half has data of its own beneath it: "Tapware Code" over a column
          // whose values only sometimes reach under "Code" stays whole.
          const rough = gutterEdges(dataLines, [], vp.width)
          const data = dataLines.flatMap((l) => l.pieces)
          const own = (p: Piece, other: Piece) => data.some((d) => d.x < p.x1 && d.x1 > p.x && !(d.x < other.x1 && d.x1 > other.x))
          headerLines = splitAt(headerLines, rough.slice(1, -1), (a, b) => own(a, b) && own(b, a))
          edges = gutterEdges(dataLines, headerLines, vp.width)
        }
        const ruled = vRules.length >= 3
        const found = { edges, header: flat(cellsOf(headerLines, edges)) }
        // Ruled columns are real even without a heading; guessed ones without a heading are text overflow.
        layout = { ...(ruled ? found : tidy(found)), ruled }
      } else layout = carry!
      dataLines = splitAt(dataLines, layout.edges.slice(1, -1))

      // Rows: the bands between rules, or single lines.
      const rows: Cells[] = []
      const below = hRules.filter((r) => r > Math.max(...(headerLines.length ? headerLines : dataLines.slice(0, 1)).map((l) => l.y)))
      const bandStart = headerLines.length ? below[0] : hRules[0]
      if (hRules.length >= 3 && bandStart !== undefined) {
        const cuts = hRules.filter((r) => r >= bandStart)
        const mid = (l: Line) => l.y - l.h * 0.3
        // A row broken across pages has no rule where the page ends: the text running up to
        // the first rule, and on from the last, is part of a row too (but not a page header or footer).
        const run = (from: number, dir: 1 | -1) => {
          const out: Line[] = []
          let edge = from
          for (const l of dir > 0 ? dataLines.filter((d) => mid(d) > from) : dataLines.filter((d) => mid(d) < from).reverse()) {
            if (Math.abs(mid(l) - edge) > l.h * 2) break
            out.push(l)
            edge = mid(l)
          }
          return dir > 0 ? out : out.reverse()
        }
        let first = !headerLines.length
        const push = (band: Line[]) => {
          if (!band.length) return
          rows.push(withCont(cellsOf(band, layout.edges), first))
          first = false
        }
        if (!headerLines.length) push(run(cuts[0], -1))
        for (let i = 0; i + 1 < cuts.length; i++) push(dataLines.filter((l) => mid(l) > cuts[i] && mid(l) < cuts[i + 1]))
        push(run(cuts[cuts.length - 1], 1))
      } else {
        const bands = bandsBySpacing(dataLines)
        // Single lines are for the caller to join up; with bands, only the first on a carried-on page may carry on a row.
        for (const [i, band] of bands.entries()) rows.push(withCont(cellsOf(band, layout.edges), band.length === 1 && bands.every((b) => b.length === 1) ? true : !headerLines.length && i === 0))
      }

      const same = tables.length && tables[tables.length - 1].layout.header.join('|').toLowerCase() === layout.header.join('|').toLowerCase()
      if (same) tables[tables.length - 1].rows.push(...rows)
      else tables.push({ layout, rows, firstPage: n })
      carry = layout
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  if (!anyText) throw new Error('This PDF has no text to read — it is a scan or a picture. Ask for the schedule as a searchable PDF or as Excel.')

  return tables.map((t) => {
    let header = [...t.layout.header]
    let rows = t.rows
    if (!t.layout.ruled) {
      // A heading guessed into two columns ("Room" "No.") leaves the second with no data: put it back.
      for (let i = header.length - 1; i > 0; i--) {
        if (rows.some((r) => r[i]?.length)) continue
        header[i - 1] = `${header[i - 1]} ${header[i]}`.trim()
        header = header.filter((_, j) => j !== i)
        rows = rows.map((r) => withCont(r.filter((_, j) => j !== i) as Cells, r.cont ?? false))
      }
    }
    const merged: Cells[] = []
    for (const r of rows) {
      const prev = merged[merged.length - 1]
      if (!prev || !r.cont || opts.startsRow(flat(r), header, flat(prev))) merged.push(withCont(r.map((c) => [...c]) as Cells, false))
      else r.forEach((c, i) => prev[i].push(...c))
    }
    // Each column's right-hand edge: as far as its text reaches anywhere in the table.
    const right = header.map((_, i) => Math.max(0, ...rows.flatMap((r) => (r[i] ?? []).map((l) => l.x1))))
    return { name: `PDF page ${t.firstPage}`, rows: [header, ...merged.map((r) => r.map((c, i) => cellText(c, right[i])))] }
  })
}
