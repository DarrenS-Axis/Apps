import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Drawing, PlanPin, PlanRegion, RegionColour } from '../data/types'
import { REGION_COLOURS, REGION_STROKE_FRACTION } from '../data/types'

/** What a drag on the plan does. */
export type PlanMode = 'view' | 'pin' | 'highlight' | 'area'

interface Props {
  drawing: Drawing
  pins: PlanPin[]
  /** How many photos hang off each pin, keyed by pin id. */
  photoCounts?: Record<string, number>
  regions?: PlanRegion[]
  /** Fires with normalised 0..1 coordinates when the user taps in `pin` mode. */
  onDropPin?: (x: number, y: number) => void
  /** Fires with the traced path (highlight) or two corners (area). */
  onDrawRegion?: (kind: 'highlight' | 'area', points: { x: number; y: number }[]) => void
  onSelectPin?: (pin: PlanPin) => void
  onSelectRegion?: (region: PlanRegion) => void
  selectedPinId?: string
  selectedRegionId?: string
  height?: number
  mode?: PlanMode
  /** Colour used for the region currently being drawn. */
  drawColour?: RegionColour
  /** Overlays live gesture state, for diagnosing device-specific problems. */
  debug?: boolean
}

interface Transform {
  scale: number
  x: number
  y: number
}

type Point = { x: number; y: number }

/** Below this separation two touches are one point, not a pinch. */
const MIN_PINCH_DISTANCE = 24

/**
 * How long a tracked pointer may go unheard before a new touch treats it as
 * lost. Browsers occasionally drop a pointerup — a stale entry would otherwise
 * make every later one-finger drag look like a pinch.
 */
const STALE_POINTER_MS = 2000

/** Zoom range, in image pixels per CSS pixel. */
const MIN_SCALE = 0.02
const MAX_SCALE = 16

/**
 * How much of the plan must stay on screen, in CSS pixels. Panning is otherwise
 * unbounded, and once zoomed in it takes only a couple of drags to push the
 * drawing entirely out of view — leaving a blank panel that looks for all the
 * world like the viewer has died.
 */
const PAN_MARGIN = 72

/**
 * Pan / zoom plan viewer with pin dropping and region highlighting.
 *
 * The plan is painted into a canvas the size of the viewport rather than being
 * a CSS-transformed <img>. That matters on site: a transformed image is
 * composited as one layer covering the whole *scaled* drawing, so a 2600 px
 * plan zoomed in became a layer tens of thousands of pixels per side — far past
 * the 4096-8192 px texture limit on phone GPUs — and the tab was killed while
 * panning around it. Drawing only the visible slice keeps memory flat at
 * roughly one viewport whatever the zoom, so the ceiling can stay generous.
 *
 * Pins stay as DOM buttons: they are a constant size on screen, so they cost
 * nothing and remain real, focusable, tappable controls.
 */
export function PlanViewer({
  drawing,
  pins,
  photoCounts = {},
  regions = [],
  onDropPin,
  onDrawRegion,
  onSelectPin,
  onSelectRegion,
  selectedPinId,
  selectedRegionId,
  height = 420,
  mode = 'view',
  drawColour = 'yellow',
  debug = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 })
  // The window listeners are bound once and read the handlers through a ref, so
  // the transform they see can lag React's commit by a frame during a fast
  // gesture. This always holds the newest value.
  const tRef = useRef(t)
  tRef.current = t
  const [size, setSize] = useState({ w: drawing.imageWidth ?? 1000, h: drawing.imageHeight ?? 700 })
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [ready, setReady] = useState(false)

  // Pointer bookkeeping: one pointer pans or draws, two always pinch. The
  // timestamp exists so a pointer whose release was never delivered cannot
  // wedge the viewer permanently — see the prune in onPointerDown.
  const pointers = useRef(new Map<number, Point & { at: number }>())
  const pinchStart = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null)
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const moved = useRef(false)
  const [draft, setDraft] = useState<Point[] | null>(null)
  const drafting = useRef(false)

  const drawingMode = mode === 'highlight' || mode === 'area'

  const [debugTick, setDebugTick] = useState(0)
  const noteGesture = useCallback(() => {
    if (debug) setDebugTick((n) => n + 1)
  }, [debug])

  const clampScale = useCallback(
    (value: number) => (Number.isFinite(value) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) : MIN_SCALE),
    [],
  )

  /** Keeps at least a corner of the plan within the viewport. */
  const clampT = useCallback(
    (next: Transform): Transform => {
      if (box.w < 1 || box.h < 1 || !Number.isFinite(next.x) || !Number.isFinite(next.y)) return next
      const pw = size.w * next.scale
      const ph = size.h * next.scale
      const mx = Math.min(PAN_MARGIN, pw, box.w)
      const my = Math.min(PAN_MARGIN, ph, box.h)
      return {
        scale: next.scale,
        x: Math.min(box.w - mx, Math.max(mx - pw, next.x)),
        y: Math.min(box.h - my, Math.max(my - ph, next.y)),
      }
    },
    [box.w, box.h, size.w, size.h],
  )

  /* -------------------------------------------------------------- sizing */

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setBox({ w: rect.width, h: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (size.w < 1 || size.h < 1 || box.w < 1 || box.h < 1) return
    const scale = Math.min(box.w / size.w, box.h / size.h)
    if (!Number.isFinite(scale) || scale <= 0) return
    setT({ scale, x: (box.w - size.w * scale) / 2, y: (box.h - size.h * scale) / 2 })
  }, [size.w, size.h, box.w, box.h])

  // Load the plan once per drawing.
  useEffect(() => {
    if (!drawing.imageData) {
      imageRef.current = null
      setReady(false)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      imageRef.current = img
      setSize({ w: img.naturalWidth, h: img.naturalHeight })
      setReady(true)
    }
    img.onerror = () => {
      if (!cancelled) setReady(false)
    }
    img.src = drawing.imageData
    return () => {
      cancelled = true
    }
  }, [drawing.id, drawing.imageData])

  // Fit whenever the plan or the viewport changes shape — but not on every
  // transform change, which would fight the user mid-gesture.
  useEffect(() => {
    if (!ready) return
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, size.w, size.h, box.w, box.h])

  /**
   * Stops the browser claiming the gesture for itself.
   *
   * React registers `touchmove` and `wheel` as passive listeners on its root, so
   * `preventDefault()` from a React handler is ignored — they have to be bound
   * directly, non-passively. iOS Safari additionally handles pinch through its
   * own `gesture*` events and page-zooms regardless of `touch-action: none`,
   * cancelling our pointers mid-gesture, which left the plan unable to pan or
   * pinch at all on a phone.
   */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const stop = (e: Event) => {
      if (e.cancelable) e.preventDefault()
    }
    const opts: AddEventListenerOptions = { passive: false }
    el.addEventListener('touchmove', stop, opts)
    el.addEventListener('wheel', stop, opts)
    el.addEventListener('gesturestart', stop, opts)
    el.addEventListener('gesturechange', stop, opts)
    el.addEventListener('gestureend', stop, opts)
    return () => {
      el.removeEventListener('touchmove', stop, opts)
      el.removeEventListener('wheel', stop, opts)
      el.removeEventListener('gesturestart', stop, opts)
      el.removeEventListener('gesturechange', stop, opts)
      el.removeEventListener('gestureend', stop, opts)
    }
  }, [])

  /* ------------------------------------------------------------- drawing */

  const strokeWidth = Math.max(size.w, size.h) * REGION_STROKE_FRACTION

  /** Builds a region's path in screen coordinates. */
  const regionPath = useCallback(
    (region: Pick<PlanRegion, 'kind' | 'points'>, tr: Transform): Path2D | null => {
      const path = new Path2D()
      const sx = (p: Point) => tr.x + p.x * size.w * tr.scale
      const sy = (p: Point) => tr.y + p.y * size.h * tr.scale

      if (region.kind === 'area') {
        const [a, b] = region.points
        if (!a || !b) return null
        path.rect(Math.min(sx(a), sx(b)), Math.min(sy(a), sy(b)), Math.abs(sx(b) - sx(a)), Math.abs(sy(b) - sy(a)))
        return path
      }

      if (region.points.length < 2) return null
      region.points.forEach((p, i) => (i === 0 ? path.moveTo(sx(p), sy(p)) : path.lineTo(sx(p), sy(p))))
      return path
    },
    [size.w, size.h],
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || box.w < 1 || box.h < 1) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Cap the backing store so a high-DPR tablet cannot blow the budget either.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cw = Math.round(box.w * dpr)
    const ch = Math.round(box.h * dpr)
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box.w, box.h)
    ctx.fillStyle = '#eef2f6'
    ctx.fillRect(0, 0, box.w, box.h)

    if (img) {
      // Only the visible slice of the plan is drawn, which is what keeps memory
      // flat however far in the user zooms.
      const sx = Math.max(0, -t.x / t.scale)
      const sy = Math.max(0, -t.y / t.scale)
      const sw = Math.min(size.w - sx, box.w / t.scale)
      const sh = Math.min(size.h - sy, box.h / t.scale)
      if (sw > 0 && sh > 0) {
        ctx.imageSmoothingEnabled = t.scale < 1
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, sx, sy, sw, sh, t.x + sx * t.scale, t.y + sy * t.scale, sw * t.scale, sh * t.scale)
      }
    }

    const screenStroke = strokeWidth * t.scale

    const paint = (region: Pick<PlanRegion, 'kind' | 'points' | 'colour' | 'label'>, selected: boolean) => {
      const colour = REGION_COLOURS[region.colour] ?? REGION_COLOURS.yellow
      const path = regionPath(region, t)
      if (!path) return

      if (region.kind === 'area') {
        ctx.fillStyle = colour.fill
        ctx.fill(path)
        ctx.strokeStyle = colour.stroke
        ctx.lineWidth = Math.max(1, screenStroke * (selected ? 0.5 : 0.3))
        ctx.setLineDash(selected ? [screenStroke, screenStroke * 0.6] : [])
        ctx.stroke(path)
        ctx.setLineDash([])
      } else {
        ctx.strokeStyle = colour.fill
        ctx.lineWidth = Math.max(2, screenStroke * (selected ? 1.35 : 1))
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke(path)
        if (selected) {
          ctx.strokeStyle = colour.stroke
          ctx.lineWidth = Math.max(1, screenStroke * 0.16)
          ctx.setLineDash([screenStroke * 0.6, screenStroke * 0.5])
          ctx.stroke(path)
          ctx.setLineDash([])
        }
      }

      const first = region.points[0]
      if (region.label && first) {
        const lx = t.x + first.x * size.w * t.scale
        const ly = t.y + first.y * size.h * t.scale
        const fontSize = Math.max(11, Math.min(28, screenStroke * 1.3))
        ctx.font = `700 ${fontSize}px system-ui, sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        const ty = region.kind === 'area' ? ly + fontSize * 1.1 : ly - fontSize * 0.5
        ctx.lineWidth = Math.max(2, fontSize * 0.28)
        ctx.strokeStyle = '#ffffff'
        ctx.strokeText(region.label, lx + 2, ty)
        ctx.fillStyle = colour.stroke
        ctx.fillText(region.label, lx + 2, ty)
      }
    }

    for (const region of regions) paint(region, region.id === selectedRegionId)
    if (draft && draft.length > 0) {
      paint({ kind: mode === 'area' ? 'area' : 'highlight', points: draft, colour: drawColour, label: '' }, false)
    }
  }, [box.w, box.h, t, size.w, size.h, regions, draft, drawColour, mode, selectedRegionId, strokeWidth, regionPath])

  // Painting in a layout effect keeps the plan in step with the pins, which
  // React lays out in the same commit.
  useLayoutEffect(() => {
    draw()
    // Exposed for the pinch regression test, which needs the live zoom now that
    // there is no transform on an element to read it back from.
    const probe = window as unknown as { __planScale?: number; __planX?: number; __planY?: number }
    probe.__planScale = t.scale
    probe.__planX = t.x
    probe.__planY = t.y
  }, [draw, t.scale, t.x, t.y])

  /* ------------------------------------------------------------ geometry */

  /** Screen coordinates to normalised 0..1 position on the drawing. */
  const toPlan = (clientX: number, clientY: number): Point | null => {
    const el = wrapRef.current
    if (!el || !size.w || !size.h || !t.scale) return null
    const rect = el.getBoundingClientRect()
    return {
      x: (clientX - rect.left - t.x) / t.scale / size.w,
      y: (clientY - rect.top - t.y) / t.scale / size.h,
    }
  }

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = (clientX ?? rect.left + rect.width / 2) - rect.left
    const cy = (clientY ?? rect.top + rect.height / 2) - rect.top
    setT((prev) => {
      const scale = clampScale(prev.scale * factor)
      const k = scale / prev.scale
      if (!Number.isFinite(k)) return prev
      return clampT({ scale, x: cx - (cx - prev.x) * k, y: cy - (cy - prev.y) * k })
    })
  }

  /** Topmost region under a tap, now that regions are painted rather than DOM. */
  const regionAt = (clientX: number, clientY: number): PlanRegion | null => {
    const canvas = canvasRef.current
    const el = wrapRef.current
    if (!canvas || !el) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const rect = el.getBoundingClientRect()
    // isPointInPath takes coordinates in the canvas backing store, unaffected by
    // the current transform — while the paths are built in CSS pixels and are
    // scaled by it. Without converting, hit-testing silently misses on every
    // high-DPR screen, which is every phone.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const px = (clientX - rect.left) * dpr
    const py = (clientY - rect.top) * dpr

    for (let i = regions.length - 1; i >= 0; i--) {
      const region = regions[i]
      const path = regionPath(region, t)
      if (!path) continue
      if (region.kind === 'area') {
        if (ctx.isPointInPath(path, px, py)) return region
      } else {
        // A generous hit width: a highlighter stroke is thin when zoomed out.
        ctx.lineWidth = Math.max(16, strokeWidth * t.scale)
        if (ctx.isPointInStroke(path, px, py)) return region
      }
    }
    return null
  }

  /* ------------------------------------------------------------ gestures */

  const onPointerDown = (e: React.PointerEvent) => {
    // Movement and release are tracked on the window (see the effect below), so
    // no pointer capture is taken here at all. Capture was the source of a
    // whole class of Safari failures, and it is not needed once the release is
    // heard wherever it happens.
    // Drop anything stale before counting fingers. If a release went missing —
    // and browsers do lose them — a leftover pointer would make the next
    // one-finger drag look like a pinch, which does nothing, and the plan would
    // appear stuck until it was remounted.
    const now = performance.now()
    // The first finger of a new touch is flagged primary by the spec, so nothing
    // else can legitimately still be down: whatever is left in the map is a
    // release we never heard. Age is the fallback for mice and pens.
    if (e.isPrimary && e.pointerType === 'touch') {
      pointers.current.clear()
      pinchStart.current = null
      panStart.current = null
    }
    for (const [id, p] of pointers.current) {
      if (id !== e.pointerId && now - p.at > STALE_POINTER_MS) pointers.current.delete(id)
    }

    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: now })
    moved.current = false
    noteGesture()

    if (pointers.current.size === 1) {
      if (drawingMode && onDrawRegion) {
        const p = toPlan(e.clientX, e.clientY)
        if (p) {
          drafting.current = true
          setDraft([p])
          return
        }
      }
      panStart.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }
    } else if (pointers.current.size === 2) {
      // A second finger always means pinch, even mid-stroke — abandon the draft
      // rather than leaving a stray mark from the zoom gesture.
      drafting.current = false
      setDraft(null)
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      // Two fingers landing on the same spot would give a baseline of zero and
      // divide by zero on the first move, slamming the plan to maximum zoom.
      pinchStart.current =
        dist >= MIN_PINCH_DISTANCE ? { dist, scale: t.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 } : null
      panStart.current = null
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: performance.now() })

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)

      // The fingers may only now have separated enough to mean a pinch.
      if (!pinchStart.current) {
        if (dist < MIN_PINCH_DISTANCE) return
        pinchStart.current = { dist, scale: t.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
        return
      }

      const target = pinchStart.current.scale * (dist / pinchStart.current.dist)
      moved.current = true
      setT((prev) => {
        const el = wrapRef.current
        if (!el) return prev
        const scale = clampScale(target)
        const k = scale / prev.scale
        if (!Number.isFinite(k)) return prev
        const rect = el.getBoundingClientRect()
        const cx = pinchStart.current!.cx - rect.left
        const cy = pinchStart.current!.cy - rect.top
        return clampT({ scale, x: cx - (cx - prev.x) * k, y: cy - (cy - prev.y) * k })
      })
      return
    }

    if (drafting.current) {
      const p = toPlan(e.clientX, e.clientY)
      if (!p) return
      moved.current = true
      setDraft((prev) => {
        if (!prev) return [p]
        if (mode === 'area') return [prev[0], p]
        // Thin the traced path: at screen resolution anything closer than this
        // adds points without adding shape.
        const last = prev[prev.length - 1]
        const far = Math.hypot((p.x - last.x) * size.w, (p.y - last.y) * size.h) * t.scale > 3
        return far ? [...prev, p] : prev
      })
      return
    }

    if (panStart.current) {
      const dx = e.clientX - panStart.current.x
      const dy = e.clientY - panStart.current.y
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true
      setT((prev) => clampT({ scale: prev.scale, x: panStart.current!.tx + dx, y: panStart.current!.ty + dy }))
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    // These listeners are on the window, so ignore releases from pointers that
    // never started a gesture here — a tap on a button elsewhere on the page
    // would otherwise be read as the end of a pan.
    if (!pointers.current.has(e.pointerId)) return
    noteGesture()
    const wasSingle = pointers.current.size === 1
    pointers.current.delete(e.pointerId)

    if (pointers.current.size < 2) pinchStart.current = null
    if (pointers.current.size === 0) {
      panStart.current = null
    } else if (pointers.current.size === 1 && !drafting.current) {
      // One finger left after a pinch. Without re-anchoring here the plan
      // simply stopped responding until every finger was lifted.
      const [remaining] = [...pointers.current.values()]
      panStart.current = { x: remaining.x, y: remaining.y, tx: tRef.current.x, ty: tRef.current.y }
    }

    if (drafting.current) {
      drafting.current = false
      const points = draft ?? []
      setDraft(null)
      // A tap with no drag is not a region; ignore it rather than storing a dot.
      const enough = mode === 'area' ? points.length === 2 : points.length >= 2
      if (enough && onDrawRegion) onDrawRegion(mode === 'area' ? 'area' : 'highlight', points)
      return
    }

    if (!wasSingle || moved.current) return

    // A tap that did not pan: drop a pin, or select a region under the finger.
    if (mode === 'pin' && onDropPin) {
      const p = toPlan(e.clientX, e.clientY)
      if (p && p.x >= 0 && p.y >= 0 && p.x <= 1 && p.y <= 1) onDropPin(p.x, p.y)
      return
    }
    if (onSelectRegion) {
      const region = regionAt(e.clientX, e.clientY)
      if (region) onSelectRegion(region)
    }
  }

  /**
   * The browser took the gesture over. Drop everything rather than half-keeping
   * state: a cancelled pointer never sends another event, so any anchor left
   * behind would wedge the viewer until the component remounted.
   */
  const onPointerCancel = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      pinchStart.current = null
      panStart.current = null
      drafting.current = false
      setDraft(null)
    } else if (pointers.current.size < 2) {
      pinchStart.current = null
    }
  }

  // Latest handlers, so the window listeners below never close over stale state.
  const gestureRef = useRef({ onPointerMove, onPointerUp, onPointerCancel })
  gestureRef.current = { onPointerMove, onPointerUp, onPointerCancel }

  /**
   * Gestures are followed on the window, not the viewer.
   *
   * Pinching spreads the fingers well beyond a 420 px-tall plan, so a finger is
   * routinely released outside it. Bound to the element, that `pointerup` was
   * never heard and the pointer stayed in the tracked map for good — after
   * which a one-finger drag counted as two pointers, was taken for a pinch, and
   * did nothing at all. That is why dragging worked until the first pinch and
   * not after.
   */
  useEffect(() => {
    const move = (e: PointerEvent) => gestureRef.current.onPointerMove(e)
    const up = (e: PointerEvent) => gestureRef.current.onPointerUp(e)
    const cancel = (e: PointerEvent) => gestureRef.current.onPointerCancel(e)
    // Losing the window or the tab mid-gesture leaves nothing to release it.
    const reset = () => {
      pointers.current.clear()
      pinchStart.current = null
      panStart.current = null
      drafting.current = false
      setDraft(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [])

  const onWheel = (e: React.WheelEvent) => {
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)
  }

  /* -------------------------------------------------------------- render */

  if (!drawing.imageData) {
    return (
      <div className="planview" style={{ height, display: 'grid', placeItems: 'center' }}>
        <span className="muted small">No plan image attached to {drawing.number || 'this drawing'}.</span>
      </div>
    )
  }

  const cursor = mode === 'pin' ? 'crosshair' : drawingMode ? 'cell' : 'grab'

  return (
    <div
      ref={wrapRef}
      className="planview"
      style={{ height, cursor }}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      <canvas
        ref={canvasRef}
        className="planview__canvas"
        aria-label={`Plan ${drawing.number}`}
        role="img"
      />

      {pins.map((pin) => {
        const photos = photoCounts[pin.id] ?? 0
        const left = t.x + pin.x * size.w * t.scale
        const top = t.y + pin.y * size.h * t.scale
        // Keep offscreen pins out of the DOM; a big drawing can carry a lot.
        if (left < -60 || top < -60 || left > box.w + 60 || top > box.h + 60) return null
        return (
          <button
            key={pin.id}
            className="pin"
            title={`${pin.note || pin.label}${photos ? ` — ${photos} photo${photos > 1 ? 's' : ''}` : ''}`}
            style={{ left, top, border: 0, background: 'none', padding: 0 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onSelectPin?.(pin)
            }}
          >
            <svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true">
              <path
                d="M15 37C15 37 28 22.5 28 14A13 13 0 1 0 2 14c0 8.5 13 23 13 23z"
                fill={pin.id === selectedPinId ? '#c2410c' : '#0f7ac2'}
                stroke="#fff"
                strokeWidth="2"
              />
              {/* A pin carrying photos gets a badge, so the plan shows at a
                  glance where evidence was actually captured. */}
              {photos ? (
                <>
                  <circle cx="24" cy="7" r="6.5" fill="#15803d" stroke="#fff" strokeWidth="2" />
                  <text x="24" y="10.2" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff" stroke="none">
                    {photos > 9 ? '9+' : photos}
                  </text>
                </>
              ) : null}
            </svg>
            <span className="pin__label">{pin.label}</span>
          </button>
        )
      })}

      {debug ? (
        <div className="planview__debug" aria-hidden="true">
          <div>
            pointers {pointers.current.size} · pinch {pinchStart.current ? 'y' : 'n'} · pan{' '}
            {panStart.current ? 'y' : 'n'} · draw {drafting.current ? 'y' : 'n'}
          </div>
          <div>
            mode {mode} · scale {t.scale.toFixed(2)} · x {Math.round(t.x)} y {Math.round(t.y)}
          </div>
          <div>
            plan {size.w}×{size.h} · view {Math.round(box.w)}×{Math.round(box.h)} · ev {debugTick}
          </div>
        </div>
      ) : null}

      <div className="planview__zoom">
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomAt(1.3)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomAt(1 / 1.3)} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={fit}
          aria-label="Fit to view"
          style={{ fontSize: 12, fontWeight: 700 }}
        >
          FIT
        </button>
      </div>
    </div>
  )
}
