/**
 * Autopin: finding every penetration on a searchable penetration plan and
 * placing a pin on it.
 *
 * Two kinds of drawing arrive, and both are handled:
 *
 *  - **Numbered tags**, as the Firedoc consultant requirements ask for:
 *    "F0001-FW-100mm". The number before the dash identifies a row on the
 *    imported register ("the dash breaks the search string").
 *
 *  - **Size-and-type tags**, which is what hydraulic consultants actually
 *    issue: "100 FW", "40 B", "ST 100" beside a coloured penetration symbol,
 *    with no number at all. There is no register to match, so each tag
 *    becomes a new penetration, numbered in reading order.
 *
 * Either way the pin goes on the *symbol* the tag labels, not on the text:
 * the tag is written beside the penetration, sometimes on a leader, and a pin
 * on the words would put the collar in the wrong place. The symbol is found by
 * rendering the sheet and looking near each tag for a small, solid, coloured
 * mark — the filled circle-and-cross every hydraulic drafter uses.
 */

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

/** The searchable part of a numbered tag: everything before the first dash, upper-cased. */
export const tagKey = (s: string): string => s.trim().split(/[-–—]/)[0].trim().toUpperCase()

/* ----------------------------------------------------------- tag parsing */

/**
 * Nominal pipe sizes a tag can carry. Restricting to these is what keeps room
 * names ("SPECT 01", "UPTAKE 03") and dimension strings out of the results.
 */
const NOMINAL_SIZES = new Set([15, 18, 20, 25, 32, 40, 50, 63, 65, 75, 80, 90, 100, 110, 125, 150, 160, 200, 225, 250, 300, 315, 375])

/** Codes that look like a type but are not a penetration. */
const NOT_A_TYPE = new Set(['MM', 'DIA', 'RL', 'FFL', 'SSL', 'FL', 'AHD', 'CL', 'TYP', 'MIN', 'MAX', 'NTS', 'REV'])

export interface ParsedTag {
  size: number
  ref: string
}

/**
 * Reads a size-and-type tag: "100 FW", "40 IWTD", "100mm WC", "ST 100", "FW100".
 * Returns null for anything else.
 */
export function parseTypeTag(text: string): ParsedTag | null {
  const t = text.trim().toUpperCase().replace(/Ø|⌀/g, '')
  const sizeFirst = /^(\d{2,3})\s*(?:MM)?\s*([A-Z][A-Z0-9]{0,5})$/.exec(t)
  const typeFirst = /^([A-Z][A-Z0-9]{0,5}?)\s*(\d{2,3})\s*(?:MM)?$/.exec(t)
  const m = sizeFirst ? { size: Number(sizeFirst[1]), ref: sizeFirst[2] } : typeFirst ? { size: Number(typeFirst[2]), ref: typeFirst[1] } : null
  if (!m || !NOMINAL_SIZES.has(m.size) || NOT_A_TYPE.has(m.ref) || /^\d/.test(m.ref)) return null
  return m
}

/* ------------------------------------------------------ symbol finding */

export interface Symbol {
  /** Centre in page points. */
  x: number
  y: number
  /** Mean colour, for picking out the drawing's penetration symbol colour. */
  rgb: [number, number, number]
}

/**
 * Finds penetration symbols inside a window of a rendered page.
 *
 * A symbol is a small solid disc, usually with thin crosshairs through it.
 * Two things make that hard to pick out naively: symbols drawn close together
 * touch through their crosshairs and read as one blob, and a symbol drawn
 * against another coloured mark — the yellow boxes some drafters use — merges
 * with it. So the coloured ink is first *eroded*: anything thinner than about
 * a point and a half (crosshairs, leaders, outlines, wall lines) disappears,
 * and only the solid discs survive, each on its own. Pixels are also joined
 * only to neighbours of the same colour, so purple never fuses with yellow.
 */
function findSymbolsIn(img: ImageData, originX: number, originY: number, scale: number): Symbol[] {
  const { width: w, height: h, data } = img
  const n = w * h
  const coloured = new Uint8Array(n)
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    // Saturated and not near-white: a coloured ink, not grey linework.
    coloured[p] = max - min > 70 && min < 200 ? 1 : 0
  }

  // Dimension and leader lines are often drawn straight through a symbol,
  // cutting the disc in two. Bridge any gap up to a line's width that has
  // ink of the same symbol on both sides, horizontally or vertically.
  const gap = Math.max(2, Math.round(1.1 * scale))
  const bridged = coloured.slice()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (coloured[p]) continue
      for (let d = 1; d <= gap && !bridged[p]; d++) {
        for (let e = 1; e <= gap + 1 - d; e++) {
          const lx = x - d, rx = x + e, uy = y - d, dy = y + e
          if ((lx >= 0 && rx < w && coloured[p - d] && coloured[p + e]) || (uy >= 0 && dy < h && coloured[p - d * w] && coloured[p + e * w])) {
            bridged[p] = 1
            break
          }
        }
      }
    }
  }

  // Erosion by a square of radius k: a pixel survives only if every pixel
  // within k of it is coloured. Done as two separable passes of run lengths.
  const k = Math.max(1, Math.round(0.75 * scale))
  const horiz = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    let run = 0
    const row = y * w
    const left = new Uint16Array(w)
    for (let x = 0; x < w; x++) {
      run = bridged[row + x] ? run + 1 : 0
      left[x] = run
    }
    run = 0
    for (let x = w - 1; x >= 0; x--) {
      run = bridged[row + x] ? run + 1 : 0
      horiz[row + x] = left[x] > k && run > k ? 1 : 0
    }
  }
  const core = new Uint8Array(n)
  for (let x = 0; x < w; x++) {
    let run = 0
    const up = new Uint16Array(h)
    for (let y = 0; y < h; y++) {
      run = horiz[y * w + x] ? run + 1 : 0
      up[y] = run
    }
    run = 0
    for (let y = h - 1; y >= 0; y--) {
      run = horiz[y * w + x] ? run + 1 : 0
      core[y * w + x] = up[y] > k && run > k ? 1 : 0
    }
  }

  const seen = new Uint8Array(n)
  const out: Symbol[] = []
  const stack: number[] = []
  // Disc cores after erosion: roughly 1.5–10 pt across.
  const minSide = 1.2 * scale
  const maxSide = 11 * scale
  for (let start = 0; start < n; start++) {
    if (!core[start] || seen[start] || !coloured[start]) continue
    const seed: [number, number, number] = [data[start * 4], data[start * 4 + 1], data[start * 4 + 2]]
    let count = 0, sx = 0, sy = 0, sr = 0, sg = 0, sb = 0, inked = 0
    let x0 = w, y0 = h, x1 = 0, y1 = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()!
      const x = p % w, y = (p - x) / w
      count++
      sx += x
      sy += y
      if (coloured[p]) {
        sr += data[p * 4]
        sg += data[p * 4 + 1]
        sb += data[p * 4 + 2]
        inked++
      }
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= n || seen[q] || !core[q]) continue
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue
        // Bridged pixels are the line's colour, not the symbol's; they join freely.
        if (coloured[q] && colourDistance([data[q * 4], data[q * 4 + 1], data[q * 4 + 2]], seed) > 90) continue
        seen[q] = 1
        stack.push(q)
      }
    }
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue
    // A disc is round: similar width and height, and it fills most of its box
    // (π/4 ≈ 0.79 for a perfect one). A fat bar or a filled square fails one.
    if (Math.max(bw, bh) / Math.min(bw, bh) > 1.5) continue
    const fill = count / (bw * bh)
    if (fill < 0.55 || fill > 0.95) continue
    out.push({
      x: originX + (sx / count + 0.5) / scale,
      y: originY + (sy / count + 0.5) / scale,
      rgb: [sr / inked, sg / inked, sb / inked],
    })
  }
  return out
}

const colourDistance = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/* ------------------------------------------------- symbols from vectors */

type Matrix = [number, number, number, number, number, number]
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0]
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
  colour: string
}

/**
 * Reads the penetration symbols straight out of the drawing's vector content.
 *
 * CAD exports draw a solid disc as a stack of thin filled strips (AutoCAD
 * writes one per scanline), or as a very wide stroke. Either way each piece
 * is a coloured, filled shape; touching pieces of one colour are joined, and
 * a joined shape that is small and round is a symbol. Lines drawn over a
 * symbol are separate shapes, so — unlike looking at pixels — they cannot
 * hide it.
 */
async function vectorSymbols(
  page: Awaited<ReturnType<Awaited<ReturnType<PdfModule['getDocument']>['promise']>['getPage']>>,
  vp: { convertToViewportPoint: (x: number, y: number) => number[] },
  OPS: PdfModule['OPS'],
): Promise<Symbol[]> {
  const list = await page.getOperatorList()
  const FILLS = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
  const STROKES = new Set<number>([OPS.stroke, OPS.closeStroke])
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const stack: { ctm: Matrix; fill: string; stroke: string; lw: number }[] = []
  let fill = '#000000'
  let stroke = '#000000'
  let lw = 1
  const boxes: Box[] = []

  const toPage = (x: number, y: number): [number, number] => {
    const px = ctm[0] * x + ctm[2] * y + ctm[4]
    const py = ctm[1] * x + ctm[3] * y + ctm[5]
    const [vx, vy] = vp.convertToViewportPoint(px, py)
    return [vx, vy]
  }

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i]
    const args = list.argsArray[i] as unknown[]
    switch (fn) {
      case OPS.save:
        stack.push({ ctm, fill, stroke, lw })
        break
      case OPS.restore: {
        const s = stack.pop()
        if (s) ({ ctm, fill, stroke, lw } = s)
        break
      }
      case OPS.transform:
        ctm = multiply(ctm, args as Matrix)
        break
      case OPS.paintFormXObjectBegin:
        stack.push({ ctm, fill, stroke, lw })
        if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as Matrix)
        break
      case OPS.paintFormXObjectEnd: {
        const s = stack.pop()
        if (s) ({ ctm, fill, stroke, lw } = s)
        break
      }
      case OPS.setFillRGBColor:
        fill = String(args[0])
        break
      case OPS.setStrokeRGBColor:
        stroke = String(args[0])
        break
      case OPS.setLineWidth:
        lw = Number(args[0]) || 0
        break
      case OPS.constructPath: {
        const paint = args[0] as number
        const mm = args[2] as ArrayLike<number> | undefined
        if (!mm || mm.length < 4 || !Number.isFinite(mm[0])) break
        const scale = Math.hypot(ctm[0], ctm[1])
        const isFill = FILLS.has(paint)
        // A stroke only draws a solid mark when the pen is wide.
        const wide = STROKES.has(paint) && lw * scale >= 1.8
        if (!isFill && !wide) break
        const pad = wide ? lw / 2 : 0
        const a = toPage(mm[0] - pad, mm[1] - pad)
        const b = toPage(mm[2] + pad, mm[3] + pad)
        const box = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]), colour: isFill ? fill : stroke }
        // Anything bigger than a symbol could ever be is a room fill or a wall.
        if (box.x1 - box.x0 > 16 || box.y1 - box.y0 > 16) break
        boxes.push(box)
        break
      }
    }
  }

  // Join touching pieces of the same colour, using a coarse grid so a
  // drawing with thousands of shapes stays quick.
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const CELL = 8
  const grid = new Map<string, number[]>()
  boxes.forEach((b, i) => {
    for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++) {
      for (let gy = Math.floor(b.y0 / CELL); gy <= Math.floor(b.y1 / CELL); gy++) {
        const key = `${gx},${gy}`
        const cell = grid.get(key)
        if (cell) cell.push(i)
        else grid.set(key, [i])
      }
    }
  })
  const EPS = 0.4
  for (const cell of grid.values()) {
    for (let a = 0; a < cell.length; a++) {
      for (let c = a + 1; c < cell.length; c++) {
        const p = boxes[cell[a]], q = boxes[cell[c]]
        if (p.colour !== q.colour) continue
        if (p.x0 > q.x1 + EPS || q.x0 > p.x1 + EPS || p.y0 > q.y1 + EPS || q.y0 > p.y1 + EPS) continue
        parent[find(cell[a])] = find(cell[c])
      }
    }
  }
  const groups = new Map<number, Box>()
  boxes.forEach((b, i) => {
    const r = find(i)
    const g = groups.get(r)
    if (!g) groups.set(r, { ...b })
    else {
      g.x0 = Math.min(g.x0, b.x0)
      g.y0 = Math.min(g.y0, b.y0)
      g.x1 = Math.max(g.x1, b.x1)
      g.y1 = Math.max(g.y1, b.y1)
    }
  })

  const out: Symbol[] = []
  for (const g of groups.values()) {
    const w = g.x1 - g.x0
    const h = g.y1 - g.y0
    // A penetration symbol: a couple of points to about fourteen across, and round-ish.
    if (w < 2 || h < 2 || w > 14 || h > 14) continue
    if (Math.max(w, h) / Math.min(w, h) > 1.5) continue
    const rgb = hexToRgb(g.colour)
    // Black and grey are linework and text (arrowheads, dots); a symbol is coloured.
    if (Math.max(...rgb) - Math.min(...rgb) < 60) continue
    out.push({ x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2, rgb })
  }
  return out
}

/* ------------------------------------------------------------- scanning */

export interface ScannedTag {
  /** What the plan said. */
  text: string
  /** A register number, when the tag is a numbered one. */
  number?: string
  /** Size and type, when the tag carries them. */
  size?: number
  ref?: string
  /** Normalised 0..1 position of the pin — on the symbol when one was found. */
  x: number
  y: number
  /** True when the pin sits on a symbol; false when it fell back to the tag. */
  onSymbol: boolean
}

/**
 * A penetration symbol no tag claimed — a drafting slip such as a tag reading
 * "B" with no size, or one left off entirely. Kept so nothing drawn is lost.
 */
export interface UntaggedSymbol {
  x: number
  y: number
  /** A type code written beside it, if there is one. */
  ref?: string
}

export interface ScannedPage {
  page: number
  tags: ScannedTag[]
  untagged: UntaggedSymbol[]
  /** Size in points, for anyone mapping positions back onto the sheet. */
  width: number
  height: number
}

export interface ScanProgress {
  page: number
  total: number
  stage: 'reading' | 'symbols'
}

interface RawTag {
  text: string
  number?: string
  size?: number
  ref?: string
  /** Text box in page points, y down. */
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Scans every page of a penetration plan for tags, and places each one on the
 * symbol it labels. `numbers` are register numbers to look for as well.
 */
export async function scanPenetrationPlan(
  file: Blob,
  opts: { numbers?: string[]; maxPages?: number; onProgress?: (p: ScanProgress) => void } = {},
): Promise<ScannedPage[]> {
  const wanted = new Map((opts.numbers ?? []).map((n) => [tagKey(n), n]))
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await loadingTask.promise
  const out: ScannedPage[] = []
  try {
    const total = Math.min(pdf.numPages, opts.maxPages ?? 40)
    for (let n = 1; n <= total; n++) {
      opts.onProgress?.({ page: n, total, stage: 'reading' })
      const page = await pdf.getPage(n)
      const vp = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()

      // Text runs on the sheet, in page points with y down.
      const runs = content.items
        .filter((i): i is typeof i & { str: string; transform: number[]; width: number; height: number } => 'str' in i && Boolean(i.str.trim()))
        .map((i) => {
          const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5])
          const h = Math.max(i.height, Math.hypot(i.transform[2], i.transform[3])) || 6
          return { str: i.str.trim(), left: x, bottom: y, right: x + i.width, top: y - h }
        })

      const raw: RawTag[] = []
      const used = new Set<number>()
      runs.forEach((r, idx) => {
        // Numbered tags: the token before the dash is a register number.
        for (const token of r.str.split(/\s+/)) {
          const key = tagKey(token)
          const number = key ? wanted.get(key) : undefined
          if (number && !raw.some((t) => t.number === number)) {
            const parsed = parseTypeTag(token.split(/[-–—]/).slice(1).reverse().join(' ')) ?? undefined
            raw.push({ text: r.str, number, size: parsed?.size, ref: parsed?.ref, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
            used.add(idx)
          }
        }
        if (used.has(idx)) return
        // Size-and-type tags, whole in one run…
        const parsed = parseTypeTag(r.str)
        if (parsed) {
          raw.push({ text: r.str, ...parsed, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
          used.add(idx)
          return
        }
        // …or split across two runs on the same line ("100" "FW").
        const next = runs[idx + 1]
        if (next && !used.has(idx + 1) && Math.abs(next.bottom - r.bottom) < 2 && next.left - r.right < 6) {
          const joined = parseTypeTag(`${r.str} ${next.str}`)
          if (joined) {
            raw.push({ text: `${r.str} ${next.str}`, ...joined, left: r.left, top: Math.min(r.top, next.top), right: next.right, bottom: r.bottom })
            used.add(idx)
            used.add(idx + 1)
          }
        }
      })

      let tags: ScannedTag[] = []
      let untagged: UntaggedSymbol[] = []
      if (raw.length) {
        opts.onProgress?.({ page: n, total, stage: 'symbols' })
        const placed = await placeOnSymbols(page, vp.width, vp.height, raw)
        tags = placed.tags
        // A lone type code beside an unclaimed symbol is its tag, missing a size.
        const loose = runs.filter((r, i) => !used.has(i) && /^[A-Z]{1,5}$/.test(r.str) && !NOT_A_TYPE.has(r.str))
        untagged = placed.unclaimed.map((sym) => {
          let ref: string | undefined
          let best = 22
          for (const r of loose) {
            const d = Math.hypot((r.left + r.right) / 2 - sym.x, (r.top + r.bottom) / 2 - sym.y)
            if (d < best) {
              best = d
              ref = r.str
            }
          }
          return { x: sym.x / vp.width, y: sym.y / vp.height, ref }
        })
      }
      out.push({ page: n, tags, untagged, width: vp.width, height: vp.height })
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }
  return out
}

/** How far from its tag a symbol may sit, in points. */
const SEARCH_RADIUS = 34

/**
 * Renders the page once and, for each tag, looks for symbols nearby. Tags and
 * symbols are then paired closest-first so two tags never claim one symbol.
 */
async function placeOnSymbols(
  page: Awaited<ReturnType<Awaited<ReturnType<PdfModule['getDocument']>['promise']>['getPage']>>,
  width: number,
  height: number,
  raw: RawTag[],
): Promise<{ tags: ScannedTag[]; unclaimed: Symbol[] }> {
  const pdfjs = await loadPdfjs()
  const vp1 = page.getViewport({ scale: 1 })
  const fromVectors = await vectorSymbols(page, vp1, pdfjs.OPS).catch(() => [] as Symbol[])
  if (fromVectors.length) {
    const near = raw.map((t) => {
      const cx = (t.left + t.right) / 2
      const cy = (t.top + t.bottom) / 2
      return fromVectors.filter((s) => Math.hypot(s.x - cx, s.y - cy) <= SEARCH_RADIUS)
    })
    const result = pair(raw, near, width, height)
    // Every symbol of the drawing's penetration colour that no tag claimed.
    const unclaimed = result.colour
      ? fromVectors.filter((s) => !result.taken.has(s) && colourDistance(s.rgb, result.colour!) < 60)
      : []
    return { tags: result.tags, unclaimed }
  }

  // No vector symbols (a drawing flattened to an image, or symbols drawn
  // another way): fall back to looking at the rendered pixels.
  // As sharp as a phone's canvas limit allows (iOS caps at ~16.7 megapixels).
  const scale = Math.min(2.4, Math.sqrt(14e6 / (width * height)))
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const fallback = () => ({ tags: raw.map((t) => ({ ...toTag(t, width, height), onSymbol: false })), unclaimed: [] as Symbol[] })
  if (!ctx) return fallback()
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise

  // Symbols near each tag.
  const near: Symbol[][] = raw.map((t) => {
    const cx = (t.left + t.right) / 2
    const cy = (t.top + t.bottom) / 2
    const x0 = Math.max(0, Math.floor((cx - SEARCH_RADIUS) * scale))
    const y0 = Math.max(0, Math.floor((cy - SEARCH_RADIUS) * scale))
    const x1 = Math.min(canvas.width, Math.ceil((cx + SEARCH_RADIUS) * scale))
    const y1 = Math.min(canvas.height, Math.ceil((cy + SEARCH_RADIUS) * scale))
    if (x1 <= x0 || y1 <= y0) return []
    return findSymbolsIn(ctx.getImageData(x0, y0, x1 - x0, y1 - y0), x0 / scale, y0 / scale, scale)
  })
  canvas.width = canvas.height = 0 // release the bitmap straight away on a phone

  // Neighbouring tags search overlapping windows, so one symbol is found once
  // per tag near it. Merge detections at the same spot into one, or two tags
  // could each claim what is really a single penetration.
  const canonical: Symbol[] = []
  const merge = (s: Symbol): Symbol => {
    const same = canonical.find((c) => Math.hypot(c.x - s.x, c.y - s.y) < 1.5)
    if (same) return same
    canonical.push(s)
    return s
  }
  for (let i = 0; i < near.length; i++) near[i] = near[i].map(merge)
  // Pixels only show the windows around tags, so an untagged symbol elsewhere
  // cannot be found this way.
  return { tags: pair(raw, near, width, height).tags, unclaimed: [] }
}

/**
 * Pairs tags with symbols, closest first, so two tags never claim one symbol.
 * The tag is usually written above or beside its symbol, so a symbol above the
 * text is taken only if nothing better fits.
 */
function pair(
  raw: RawTag[],
  near: Symbol[][],
  width: number,
  height: number,
): { tags: ScannedTag[]; taken: Set<Symbol>; colour?: [number, number, number] } {

  // The penetration symbol is one colour on a given drawing; take the most
  // common colour among candidates and ignore marks of any other.
  const all = near.flat()
  let symbolColour: [number, number, number] | undefined
  let best = 0
  for (const s of all) {
    const votes = all.filter((o) => colourDistance(o.rgb, s.rgb) < 60).length
    if (votes > best) {
      best = votes
      symbolColour = s.rgb
    }
  }

  const pairs: { t: number; s: Symbol; d: number }[] = []
  near.forEach((list, t) => {
    const tag = raw[t]
    const cx = (tag.left + tag.right) / 2
    const cy = (tag.top + tag.bottom) / 2
    for (const s of list) {
      if (symbolColour && colourDistance(s.rgb, symbolColour) > 60) continue
      const d = Math.hypot(s.x - cx, s.y - cy) + (s.y < tag.top - 2 ? 8 : 0)
      if (d <= SEARCH_RADIUS) pairs.push({ t, s, d })
    }
  })
  pairs.sort((a, b) => a.d - b.d)
  const taken = new Set<Symbol>()
  const chosen = new Map<number, Symbol>()
  for (const p of pairs) {
    if (chosen.has(p.t) || taken.has(p.s)) continue
    chosen.set(p.t, p.s)
    taken.add(p.s)
  }

  const tags = raw.map((t, i) => {
    const s = chosen.get(i)
    if (!s) return { ...toTag(t, width, height), onSymbol: false }
    return { ...toTag(t, width, height), x: s.x / width, y: s.y / height, onSymbol: true }
  })
  return { tags, taken, colour: symbolColour }
}

function toTag(t: RawTag, width: number, height: number): Omit<ScannedTag, 'onSymbol'> {
  return {
    text: t.text,
    number: t.number,
    size: t.size,
    ref: t.ref,
    x: (t.left + t.right) / 2 / width,
    y: (t.top + t.bottom) / 2 / height,
  }
}

/** Reading order: top to bottom in bands, left to right within a band. */
export function readingOrder<T extends { x: number; y: number }>(list: T[], band = 0.02): T[] {
  return [...list].sort((a, b) => {
    const ra = Math.round(a.y / band)
    const rb = Math.round(b.y / band)
    return ra - rb || a.x - b.x
  })
}
