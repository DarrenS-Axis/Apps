// The sheet, drawn on a canvas. The workbook is ~220 rows by ~600 days, far
// too many cells for the DOM, so only what's on screen is painted. A
// transparent scroller above the canvas provides native scrolling (wheel,
// trackpad, touch) and the scrollbars.

import { colourFor, display, normalise, sameDay } from './sheet.js'

const ROW_H = 24
const FONT = '12px "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif'
const BOLD = '600 12px "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif'

export class Grid {
  constructor(host, handlers) {
    this.host = host
    this.h = handlers
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'grid-canvas'
    this.scroller = document.createElement('div')
    this.scroller.className = 'grid-scroller'
    this.scroller.tabIndex = 0
    this.spacer = document.createElement('div')
    this.scroller.append(this.spacer)
    host.append(this.canvas, this.scroller)
    this.ctx = this.canvas.getContext('2d')
    this.sel = null // { r0, c0, r1, c1, ar, ac } in sheet coordinates
    this.flash = new Map() // "r,c" -> expiry time
    this.pending = new Set() // "r,c"
    this.highlight = ''
    this.rows = [] // sheet rows shown below the frozen rows
    this.textCache = new Map()

    this.scroller.addEventListener('scroll', () => this.draw())
    new ResizeObserver(() => this.resize()).observe(host)
    this.bindPointer()
  }

  /** model: { data, layout } */
  setModel(model, keepScroll) {
    this.model = model
    const { layout, data } = model
    this.colX = [0]
    for (let c = 0; c < data.cols; c++) this.colX.push(this.colX[c] + layout.widths[c])
    this.frozenW = this.colX[layout.frozenCols]
    this.frozenH = Math.min(layout.frozenRows, data.rows) * ROW_H
    this.today = new Date()
    this.todayCol = layout.dates.findIndex((d) => d && sameDay(d, this.today))
    if (!keepScroll) this.sel = null
    this.applyFilter(this.filter)
    if (!keepScroll) {
      this.scroller.scrollTop = 0
      this.scroller.scrollLeft = 0
    }
  }

  /** Which body rows to show: fn(sheetRow) → boolean, or null for all. */
  applyFilter(fn) {
    this.filter = fn
    if (!this.model) return
    const { data, layout } = this.model
    this.rows = []
    for (let r = layout.frozenRows; r < data.rows; r++) if (!fn || fn(r)) this.rows.push(r)
    this.rowIndex = new Map(this.rows.map((r, i) => [r, i]))
    this.spacer.style.width = `${this.colX[this.colX.length - 1]}px`
    this.spacer.style.height = `${this.frozenH + this.rows.length * ROW_H}px`
    this.draw()
  }

  resize() {
    const dpr = window.devicePixelRatio || 1
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.dpr = dpr
    this.draw()
  }

  get viewW() { return this.scroller.clientWidth }
  get viewH() { return this.scroller.clientHeight }

  // Column under an x offset from the canvas's left edge.
  colAt(x) {
    const { frozenCols } = this.model.layout
    if (x < this.frozenW) return this.search(x, 0, frozenCols)
    return this.search(x - this.frozenW + this.scroller.scrollLeft + this.frozenW, frozenCols, this.colX.length - 1)
  }

  search(x, lo, hi) {
    // last c with colX[c] <= x
    let a = lo, b = hi - 1
    if (x < this.colX[lo]) return lo
    while (a < b) {
      const m = (a + b + 1) >> 1
      if (this.colX[m] <= x) a = m
      else b = m - 1
    }
    return a
  }

  // Sheet row under a y offset, or -1.
  rowAt(y) {
    const fr = Math.min(this.model.layout.frozenRows, this.model.data.rows)
    if (y < this.frozenH) return Math.floor(y / ROW_H) < fr ? Math.floor(y / ROW_H) : -1
    const i = Math.floor((y - this.frozenH + this.scroller.scrollTop) / ROW_H)
    return i >= 0 && i < this.rows.length ? this.rows[i] : -1
  }

  /** Screen rectangle of a cell, relative to the grid. */
  cellRect(r, c) {
    const { frozenRows, frozenCols } = this.model.layout
    const x = c < frozenCols ? this.colX[c] : this.colX[c] - this.scroller.scrollLeft
    let y
    if (r < frozenRows) y = r * ROW_H
    else {
      const i = this.rowIndex.get(r)
      if (i === undefined) return null
      y = this.frozenH + i * ROW_H - this.scroller.scrollTop
    }
    return { x, y, w: this.colX[c + 1] - this.colX[c], h: ROW_H }
  }

  /** Scrolls so the cell is visible. */
  reveal(r, c) {
    const { frozenRows, frozenCols } = this.model.layout
    const s = this.scroller
    if (c >= frozenCols) {
      const left = this.colX[c] - this.frozenW
      const right = this.colX[c + 1] - this.frozenW
      const width = this.viewW - this.frozenW
      if (left < s.scrollLeft) s.scrollLeft = left
      else if (right > s.scrollLeft + width) s.scrollLeft = right - width
    }
    if (r >= frozenRows) {
      const i = this.rowIndex.get(r)
      if (i === undefined) return
      const top = i * ROW_H
      const height = this.viewH - this.frozenH
      if (top < s.scrollTop) s.scrollTop = top
      else if (top + ROW_H > s.scrollTop + height) s.scrollTop = top + ROW_H - height
    }
  }

  /** Puts a column at the left edge of the scrolling area (e.g. today). */
  scrollToCol(c, back = 2) {
    const target = Math.max(this.model.layout.frozenCols, c - back)
    this.scroller.scrollLeft = this.colX[target] - this.frozenW
  }

  /** Anchor (the active cell) and the opposite corner of the selection. */
  select(ar, ac, cr = ar, cc = ac) {
    this.sel = { ar, ac, cr, cc, r0: Math.min(ar, cr), r1: Math.max(ar, cr), c0: Math.min(ac, cc), c1: Math.max(ac, cc) }
    this.draw()
    this.h.onSelect?.(this.sel)
  }

  /** Visible sheet rows within the selection, top to bottom. */
  selectedRows() {
    if (!this.sel) return []
    const { frozenRows } = this.model.layout
    const out = []
    for (let r = this.sel.r0; r <= this.sel.r1; r++) {
      if (r < frozenRows || this.rowIndex.has(r)) out.push(r)
    }
    return out
  }

  // Moves the cursor by rows / cols, skipping hidden rows.
  move(dr, dc, extend) {
    if (!this.sel) return
    const { data } = this.model
    let r = extend ? this.sel.cr : this.sel.ar
    let c = extend ? this.sel.cc : this.sel.ac
    c = Math.max(0, Math.min(data.cols - 1, c + dc))
    if (dr) {
      const order = [...Array(Math.min(this.model.layout.frozenRows, data.rows)).keys(), ...this.rows]
      let i = order.indexOf(r)
      i = Math.max(0, Math.min(order.length - 1, i + dr))
      r = order[i]
    }
    if (extend) this.select(this.sel.ar, this.sel.ac, r, c)
    else this.select(r, c)
    this.reveal(r, c)
  }

  bindPointer() {
    const s = this.scroller
    let dragging = false
    const hit = (e) => {
      const b = s.getBoundingClientRect()
      const x = e.clientX - b.left
      const y = e.clientY - b.top
      if (x > this.viewW || y > this.viewH) return null // on a scrollbar
      const r = this.rowAt(y)
      const c = this.colAt(x)
      return r < 0 ? null : { r, c }
    }
    s.addEventListener('pointerdown', (e) => {
      if (!this.model || e.button > 0) return
      const p = hit(e)
      if (!p) return
      this.lastPointer = e.pointerType
      if (e.pointerType === 'mouse') {
        if (e.shiftKey && this.sel) this.select(this.sel.ar, this.sel.ac, p.r, p.c)
        else this.select(p.r, p.c)
        dragging = true
        s.setPointerCapture(e.pointerId)
        s.focus({ preventScroll: true })
      }
    })
    s.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const p = hit(e)
      if (p && (p.r !== this.sel.cr || p.c !== this.sel.cc)) this.select(this.sel.ar, this.sel.ac, p.r, p.c)
    })
    s.addEventListener('pointerup', () => { dragging = false })
    // Touch: a tap selects, a tap on the selected cell edits. Drags scroll.
    s.addEventListener('click', (e) => {
      if (!this.model) return
      const p = hit(e)
      if (!p) return
      if (this.lastPointer && this.lastPointer !== 'mouse') {
        const already = this.sel && this.sel.r0 === p.r && this.sel.r1 === p.r && this.sel.c0 === p.c && this.sel.c1 === p.c
        if (already) this.h.onActivate?.(p.r, p.c)
        else this.select(p.r, p.c)
      }
      this.h.onClickCell?.(p.r, p.c, e)
    })
    s.addEventListener('dblclick', (e) => {
      const p = hit(e)
      if (p) this.h.onActivate?.(p.r, p.c)
    })
  }

  draw() {
    if (this._raf) return
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint() })
  }

  paint() {
    const ctx = this.ctx
    const dpr = this.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const W = this.host.clientWidth
    const H = this.host.clientHeight
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    if (!this.model) return
    const { layout, data } = this.model
    const sl = this.scroller.scrollLeft
    const st = this.scroller.scrollTop
    const fc = layout.frozenCols
    const fr = Math.min(layout.frozenRows, data.rows)

    // Visible columns and rows of the scrolling area.
    const c0 = this.search(this.frozenW + sl, fc, this.colX.length - 1)
    const c1 = this.search(this.frozenW + sl + W, fc, this.colX.length - 1)
    const i0 = Math.max(0, Math.floor(st / ROW_H))
    const i1 = Math.min(this.rows.length - 1, Math.floor((st + H - this.frozenH) / ROW_H))

    const now = performance.now()
    const cell = (r, c, x, y) => this.paintCell(ctx, r, c, x, y, this.colX[c + 1] - this.colX[c], now)

    ctx.save()
    ctx.beginPath(); ctx.rect(this.frozenW, this.frozenH, W - this.frozenW, H - this.frozenH); ctx.clip()
    for (let i = i0; i <= i1; i++) {
      const y = this.frozenH + i * ROW_H - st
      for (let c = c0; c <= c1; c++) cell(this.rows[i], c, this.colX[c] - sl, y)
    }
    ctx.restore()

    ctx.save()
    ctx.beginPath(); ctx.rect(0, this.frozenH, this.frozenW, H - this.frozenH); ctx.clip()
    for (let i = i0; i <= i1; i++) {
      const y = this.frozenH + i * ROW_H - st
      for (let c = 0; c < fc; c++) cell(this.rows[i], c, this.colX[c], y)
    }
    ctx.restore()

    ctx.save()
    ctx.beginPath(); ctx.rect(this.frozenW, 0, W - this.frozenW, this.frozenH); ctx.clip()
    for (let r = 0; r < fr; r++) for (let c = c0; c <= c1; c++) cell(r, c, this.colX[c] - sl, r * ROW_H)
    ctx.restore()

    for (let r = 0; r < fr; r++) for (let c = 0; c < fc; c++) cell(r, c, this.colX[c], r * ROW_H)

    // Frozen-pane dividers.
    ctx.fillStyle = '#0f2436'
    ctx.fillRect(this.frozenW - 1, 0, 2, H)
    ctx.fillRect(0, this.frozenH - 1, W, 2)

    // Today's column.
    if (this.todayCol >= c0 && this.todayCol <= c1) {
      const x = this.colX[this.todayCol] - sl
      if (x >= this.frozenW - 1) {
        ctx.strokeStyle = '#e8590c'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, 1, this.colX[this.todayCol + 1] - this.colX[this.todayCol] - 2, H - 2)
      }
    }

    this.paintSelection(ctx, W, H)
    if ([...this.flash.values()].some((t) => t > now)) setTimeout(() => this.draw(), 250)
  }

  paintCell(ctx, r, c, x, y, w, now) {
    const { layout, data } = this.model
    const v = data.values[r][c]
    const txt = display(v)
    const isHead = r < layout.frozenRows
    const isFrozenCol = c < layout.frozenCols
    const date = layout.dates[c]
    const weekend = date && (date.getDay() === 0 || date.getDay() === 6)
    let bg = '#ffffff'
    let fg = '#1b2733'
    if (isHead) {
      bg = date && sameDay(date, this.today) ? '#ffe3cc' : weekend ? '#dfe5ea' : '#eef2f5'
    } else if (isFrozenCol) {
      bg = '#f7f9fa'
    } else if (txt && layout.kind === 'roster') {
      const col = colourFor(v)
      bg = col.bg
      fg = col.fg
    } else if (weekend) {
      bg = '#eef1f3'
    }
    if (this.highlight && !isHead && !isFrozenCol && layout.kind === 'roster') {
      const match = txt && normalise(v).includes(this.highlight)
      if (!match) { if (txt) { bg = '#f4f5f6'; fg = '#a0a8b0' } }
      else { bg = '#ffd43b'; fg = '#000' }
    }
    ctx.fillStyle = bg
    ctx.fillRect(x, y, w, ROW_H)
    ctx.strokeStyle = '#d5dbe0'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + w - 0.5, y); ctx.lineTo(x + w - 0.5, y + ROW_H)
    ctx.moveTo(x, y + ROW_H - 0.5); ctx.lineTo(x + w, y + ROW_H - 0.5)
    ctx.stroke()
    // Month boundaries read more easily with a heavier line.
    if (date && date.getDate() === 1) {
      ctx.fillStyle = '#8c9aa6'
      ctx.fillRect(x, y, 1.5, ROW_H)
    }
    if (txt) {
      ctx.font = isHead || (isFrozenCol && c === layout.nameCol && !/\(|\[/.test(txt) && layout.kind === 'roster') ? BOLD : FONT
      ctx.fillStyle = fg
      ctx.textBaseline = 'middle'
      const centre = !isFrozenCol && (isHead || layout.kind === 'roster')
      const t = this.fit(ctx, txt, w - 8)
      if (centre) {
        ctx.textAlign = 'center'
        ctx.fillText(t, x + w / 2, y + ROW_H / 2 + 0.5)
      } else {
        ctx.textAlign = typeof v === 'number' ? 'right' : 'left'
        ctx.fillText(t, typeof v === 'number' ? x + w - 4 : x + 4, y + ROW_H / 2 + 0.5)
      }
    }
    const f = data.formulas[r][c]
    if (typeof f === 'string' && f.startsWith('=')) {
      ctx.fillStyle = '#7b8a97'
      ctx.beginPath(); ctx.moveTo(x + w - 7, y + 1); ctx.lineTo(x + w - 1, y + 1); ctx.lineTo(x + w - 1, y + 7); ctx.fill()
    }
    const key = r + ',' + c
    if (this.pending.has(key)) {
      ctx.fillStyle = '#1c7ed6'
      ctx.beginPath(); ctx.arc(x + 5, y + 5, 2.5, 0, Math.PI * 2); ctx.fill()
    }
    const fl = this.flash.get(key)
    if (fl) {
      if (fl > now) {
        ctx.strokeStyle = '#f08c00'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1.5, y + 1.5, w - 3, ROW_H - 3)
      } else this.flash.delete(key)
    }
  }

  fit(ctx, s, max) {
    const key = ctx.font + '|' + max + '|' + s
    let t = this.textCache.get(key)
    if (t !== undefined) return t
    t = s
    if (ctx.measureText(s).width > max) {
      let lo = 0, hi = s.length
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1
        if (ctx.measureText(s.slice(0, m) + '…').width <= max) lo = m
        else hi = m - 1
      }
      t = lo > 0 ? s.slice(0, lo) + '…' : ''
    }
    if (this.textCache.size > 20000) this.textCache.clear()
    this.textCache.set(key, t)
    return t
  }

  paintSelection(ctx, W, H) {
    if (!this.sel) return
    const { r0, r1, c0, c1, ar: cr, ac: cc } = this.sel
    const rows = this.selectedRows()
    if (!rows.length) return
    const a = this.cellRect(rows[0], c0)
    const b = this.cellRect(rows[rows.length - 1], c1)
    if (!a || !b) return
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip()
    const x = a.x, y = a.y, w = b.x + b.w - a.x, h = b.y + b.h - a.y
    if (r0 !== r1 || c0 !== c1) {
      ctx.fillStyle = 'rgba(28,126,214,0.14)'
      ctx.fillRect(x, y, w, h)
    }
    ctx.strokeStyle = '#1c7ed6'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
    const cur = this.cellRect(cr, cc)
    if (cur && (r0 !== r1 || c0 !== c1)) {
      ctx.lineWidth = 1
      ctx.strokeRect(cur.x + 2.5, cur.y + 2.5, cur.w - 5, cur.h - 5)
    }
    ctx.restore()
  }
}

export { ROW_H }
