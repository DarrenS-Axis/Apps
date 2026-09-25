/**
 * Reads an architectural FF&E plan for the room data schedule: the rooms
 * (a name over a number — "HOT LAB" / "04A.G.03"), and the FF&E tags that
 * are on the schedule ("HB1", "WC2"), each put in the room it sits in.
 *
 * Which room a tag is in is decided two ways. The walls: the sheet is drawn
 * to a bitmap and every open pixel is claimed by the room label it can reach
 * soonest without crossing a line, so a basin beside a wall belongs to the
 * room it is actually in, not the one whose label happens to be nearer. And
 * the plain distance to the nearest label, for the small rooms whose label
 * sits outside them (WCs, stores). When the two disagree the tag is flagged
 * for someone to confirm, with both rooms offered.
 *
 * A 1:50 enlargement repeats rooms (and their tags) already on the 1:100
 * plan. Room labels are grouped into views by spacing; a view whose rooms
 * are mostly on the main plan is a repeat, and its tags are not counted.
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

export interface ScannedRoom {
  number: string
  name: string
  /** Label centre, 0–1 of the sheet. */
  x: number
  y: number
}

export interface ScannedFfeTag {
  code: string
  x: number
  y: number
  roomNumber?: string
  /** The other room in the running when the two methods disagree. */
  altRoomNumber?: string
  check?: string
}

export interface RoomScanPage {
  page: number
  rooms: ScannedRoom[]
  tags: ScannedFfeTag[]
  /** Tags in a repeated (enlarged) view, not counted. */
  repeated: ScannedFfeTag[]
  /** Other trades' tags on the sheet, for reference: [code, count]. */
  otherTags: [string, number][]
  /** Repeated views, 0–1 boxes. */
  repeatedViews: { x0: number; y0: number; x1: number; y1: number }[]
}

export interface RoomScanProgress {
  page: number
  total: number
  stage: 'reading' | 'walls'
}

interface Run {
  s: string
  /** Centre, in page points (y down). */
  cx: number
  cy: number
  /** Baseline-left and size, for rows of upright text. */
  x: number
  y: number
  w: number
  h: number
  upright: boolean
}

/** A run that looks like a tag rather than words: HB1, GR2, MA, DB1.c. */
const TAG_LIKE = /^[A-Z]{1,4}\d{0,2}(\.[a-z0-9])?$/

function looksLikeRoomNo(s: string, codes: Set<string>): boolean {
  if (s.length > 12 || !/\d/.test(s) || codes.has(s.toUpperCase())) return false
  if (TAG_LIKE.test(s)) return false
  // 298, 295A, 04A.G.03, G.21, L3-101 — not a bare dimension like 2140 on its own (names are required anyway).
  return /^(\d{3,4}[A-Z]?|[A-Z0-9]{1,4}(?:[.\-][A-Z0-9]{1,4}){1,4})$/i.test(s)
}

const wordy = (s: string) =>
  /[A-Za-z]/.test(s) && !(s.length <= 4 && TAG_LIKE.test(s)) && s.length <= 40 && !/revision|comments?:|refer|drawing|scale/i.test(s)

/** Title-block captions that sit over a number like a room label does. */
const TITLE_BLOCK = /\b(no\.?|number|sheet|contract|project|rev(ision)?|date|scale|status|job|drawn|checked|approved|dwg|size)\s*[:.]?$/i

/** Rooms: a stack of name lines directly over a number. */
function findRooms(runs: Run[], codes: Set<string>): (ScannedRoom & { box: [number, number, number, number] })[] {
  const upright = runs.filter((r) => r.upright)
  const out: (ScannedRoom & { box: [number, number, number, number] })[] = []
  for (const n of upright) {
    if (!looksLikeRoomNo(n.s, codes)) continue
    const lines: Run[] = []
    let cur = n
    for (let k = 0; k < 4; k++) {
      const above = upright.filter(
        (r) => r !== n && !looksLikeRoomNo(r.s, codes) && wordy(r.s) && cur.y - r.y > 0 && cur.y - r.y <= cur.h * 1.8 && Math.abs(r.cx - n.cx) < Math.max(r.w, n.w) * 0.6 + 6,
      )
      if (!above.length) break
      const next = above.reduce((a, b) => (cur.y - a.y < cur.y - b.y ? a : b))
      lines.unshift(next)
      cur = next
    }
    if (!lines.length || TITLE_BLOCK.test(lines[lines.length - 1].s)) continue
    const all = [...lines, n]
    const top = lines[0].y - lines[0].h
    out.push({
      number: n.s,
      name: lines.map((l) => l.s).join(' ').replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/'),
      x: n.cx,
      y: (top + n.y) / 2,
      box: [Math.min(...all.map((r) => r.x)) - 2, top - 2, Math.max(...all.map((r) => r.x + r.w)) + 2, n.y + 3],
    })
  }
  return out
}

/** Groups labels into drawing views by spacing (single linkage). */
function views<T extends { x: number; y: number }>(items: T[], gap: number): T[][] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) < gap) parent[find(i)] = find(j)
  const groups = new Map<number, T[]>()
  items.forEach((it, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), it]))
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

/**
 * Every open pixel claimed by the room label it reaches first without
 * crossing a line. Returns the claim and the path length, per pixel.
 */
function claimByWalls(img: ImageData, seeds: { x: number; y: number; room: number }[], clear: [number, number, number, number][]) {
  const { width: W, height: H, data } = img
  const open = new Uint8Array(W * H)
  for (let i = 0, p = 0; i < W * H; i++, p += 4) open[i] = data[p] * 0.3 + data[p + 1] * 0.59 + data[p + 2] * 0.11 >= 185 ? 1 : 0
  // Label text is not a wall.
  for (const [x0, y0, x1, y1] of clear) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) open[y * W + x] = 1
  }
  const owner = new Int16Array(W * H).fill(-1)
  const dist = new Int32Array(W * H).fill(-1)
  const queue = new Int32Array(W * H)
  let head = 0
  let tail = 0
  for (const s of seeds) {
    const i = Math.round(s.y) * W + Math.round(s.x)
    if (s.x < 0 || s.y < 0 || s.x >= W || s.y >= H || dist[i] >= 0) continue
    open[i] = 1
    dist[i] = 0
    owner[i] = s.room
    queue[tail++] = i
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % W
    const d = dist[i] + 1
    const o = owner[i]
    const next = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]
    for (const j of next) {
      if (j < 0 || j >= W * H || !open[j] || dist[j] >= 0) continue
      dist[j] = d
      owner[j] = o
      queue[tail++] = j
    }
  }
  return { owner, dist, W, H }
}

export async function scanRoomPlan(
  file: Blob,
  opts: { codes: string[]; maxPages?: number; onProgress?: (p: RoomScanProgress) => void },
): Promise<RoomScanPage[]> {
  const codes = new Set(opts.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await task.promise
  const out: RoomScanPage[] = []
  try {
    const total = Math.min(pdf.numPages, opts.maxPages ?? 20)
    for (let n = 1; n <= total; n++) {
      opts.onProgress?.({ page: n, total, stage: 'reading' })
      const page = await pdf.getPage(n)
      const vp = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const runs: Run[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const [a, b, c, d, e, f] = item.transform as number[]
        const len = Math.hypot(a, b) || 1
        const h = Math.hypot(c, d) || item.height || 6
        // Centre of the run, worked out along its own direction so rotated tags land right.
        const px = e + (a / len) * (item.width / 2) + (c / (Math.hypot(c, d) || 1)) * h * 0.35
        const py = f + (b / len) * (item.width / 2) + (d / (Math.hypot(c, d) || 1)) * h * 0.35
        const [cx, cy] = vp.convertToViewportPoint(px, py)
        const [x, y] = vp.convertToViewportPoint(e, f)
        runs.push({ s: item.str.trim(), cx, cy, x, y, w: item.width, h, upright: Math.abs(b) < 0.01 * len && a > 0 })
      }

      const maxDim = Math.max(vp.width, vp.height)
      const found = findRooms(runs, codes)
      const grouped = views(found, maxDim * 0.11)
      const main = grouped[0] ?? []
      const mainNos = new Set(main.map((r) => r.number.toUpperCase()))
      const repeatedViews: RoomScanPage['repeatedViews'] = []
      for (const g of grouped.slice(1)) {
        const nos = new Set(g.map((r) => r.number.toUpperCase()))
        const shared = [...nos].filter((x) => mainNos.has(x)).length
        if (shared / nos.size < 0.5) continue
        const pad = maxDim * 0.06
        repeatedViews.push({
          x0: Math.min(...g.map((r) => r.x)) - pad,
          y0: Math.min(...g.map((r) => r.y)) - pad,
          x1: Math.max(...g.map((r) => r.x)) + pad,
          y1: Math.max(...g.map((r) => r.y)) + pad,
        })
      }
      const inRepeat = (x: number, y: number) => repeatedViews.some((v) => x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1)
      const rooms = found.filter((r) => !inRepeat(r.x, r.y))
      // One entry per room number; a long corridor labelled twice keeps both labels as seeds.
      const roomNos = [...new Set(rooms.map((r) => r.number))]

      const tagRuns = runs.filter((r) => codes.has(r.s.toUpperCase()))
      const others = new Map<string, number>()
      for (const r of runs) {
        const s = r.s
        if (!codes.has(s.toUpperCase()) && TAG_LIKE.test(s) && /\d/.test(s)) others.set(s, (others.get(s) ?? 0) + 1)
      }

      // The walls, at about a pixel a point (capped for phones).
      const tags: ScannedFfeTag[] = []
      const repeated: ScannedFfeTag[] = []
      let claim: ReturnType<typeof claimByWalls> | null = null
      const scale = Math.min(1.1, 2000 / maxDim)
      if (tagRuns.length && rooms.length) {
        opts.onProgress?.({ page: n, total, stage: 'walls' })
        try {
          const rvp = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(rvp.width)
          canvas.height = Math.round(rvp.height)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.fillStyle = '#fff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            await page.render({ canvas, canvasContext: ctx, viewport: rvp }).promise
            claim = claimByWalls(
              ctx.getImageData(0, 0, canvas.width, canvas.height),
              rooms.map((r) => ({ x: r.x * scale, y: r.y * scale, room: roomNos.indexOf(r.number) })),
              rooms.map((r) => r.box.map((v) => v * scale) as [number, number, number, number]),
            )
          }
        } catch {
          claim = null // no canvas (or too big): fall back to distance alone
        }
      }

      for (const t of tagRuns) {
        const tag: ScannedFfeTag = { code: [...codes].find((c) => c === t.s.toUpperCase()) ?? t.s, x: t.cx / vp.width, y: t.cy / vp.height }
        if (inRepeat(t.cx, t.cy)) {
          repeated.push(tag)
          continue
        }
        if (!rooms.length) {
          tags.push({ ...tag, check: 'No rooms found on the sheet' })
          continue
        }
        // Nearest label.
        const byDist = rooms.map((r) => ({ r, d: Math.hypot(r.x - t.cx, r.y - t.cy) })).sort((p, q) => p.d - q.d)
        const near = byDist[0]
        // Walls: the first open pixel around the tag's symbol that a room has claimed.
        let walled: { room: string; d: number } | undefined
        if (claim) {
          for (const rad of [9, 13, 17, 23, 30]) {
            for (let a = 0; a < 360; a += 10) {
              const x = Math.round((t.cx + rad * Math.cos((a * Math.PI) / 180)) * scale)
              const y = Math.round((t.cy + rad * Math.sin((a * Math.PI) / 180)) * scale)
              if (x < 0 || y < 0 || x >= claim.W || y >= claim.H) continue
              const i = y * claim.W + x
              if (claim.owner[i] < 0) continue
              const d = claim.dist[i] / scale
              if (!walled || d < walled.d) walled = { room: roomNos[claim.owner[i]], d }
            }
            if (walled) break
          }
        }
        if (!walled || walled.room === near.r.number) {
          tag.roomNumber = near.r.number
          if (near.d > maxDim * 0.06) tag.check = 'Far from any room label'
        } else if (walled.d > near.d * 1.6) {
          // A label outside a small room: the walls send the tag the long way round.
          tag.roomNumber = near.r.number
          tag.altRoomNumber = walled.room
          tag.check = `Nearest label is ${near.r.name} ${near.r.number}; the walls suggest ${rooms.find((r) => r.number === walled!.room)?.name ?? ''} ${walled.room}`
        } else {
          tag.roomNumber = walled.room
          tag.altRoomNumber = near.r.number
          tag.check = `Walls put it in ${rooms.find((r) => r.number === walled!.room)?.name ?? ''} ${walled.room}; the nearest label is ${near.r.name} ${near.r.number}`
        }
        tags.push(tag)
      }

      const seen = new Set<string>()
      out.push({
        page: n,
        rooms: rooms
          .filter((r) => (seen.has(r.number) ? false : (seen.add(r.number), true)))
          .map((r) => ({ number: r.number, name: r.name, x: r.x / vp.width, y: r.y / vp.height })),
        tags,
        repeated,
        otherTags: [...others].sort((p, q) => q[1] - p[1]),
        repeatedViews: repeatedViews.map((v) => ({ x0: v.x0 / vp.width, y0: v.y0 / vp.height, x1: v.x1 / vp.width, y1: v.y1 / vp.height })),
      })
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return out
}
