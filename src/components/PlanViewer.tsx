import { useCallback, useEffect, useRef, useState } from 'react'
import type { Drawing, PlanPin, PlanRegion, RegionColour } from '../data/types'
import { REGION_COLOURS, REGION_STROKE_FRACTION } from '../data/types'

/** What a drag on the plan does. */
export type PlanMode = 'view' | 'pin' | 'highlight' | 'area'

interface Props {
  drawing: Drawing
  pins: PlanPin[]
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
}

interface Transform {
  scale: number
  x: number
  y: number
}

type Point = { x: number; y: number }

/**
 * Pan / zoom plan viewer with pin dropping and region highlighting.
 *
 * Deliberately hand-rolled on pointer events rather than a map library: it has
 * to work offline from a data URL, on a phone, with one finger for pan and two
 * for pinch, and to switch that same one-finger drag into a highlighter when
 * someone is marking up the extent of an ITP.
 */
export function PlanViewer({
  drawing,
  pins,
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
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 })
  const [size, setSize] = useState({ w: drawing.imageWidth ?? 1000, h: drawing.imageHeight ?? 700 })

  // Pointer bookkeeping: one pointer pans or draws, two always pinch.
  const pointers = useRef(new Map<number, Point>())
  const pinchStart = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null)
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const moved = useRef(false)
  const [draft, setDraft] = useState<Point[] | null>(null)
  const drafting = useRef(false)

  const drawingMode = mode === 'highlight' || mode === 'area'

  const fit = useCallback(
    (w = size.w, h = size.h) => {
      const el = wrapRef.current
      if (!el || !w || !h) return
      const rect = el.getBoundingClientRect()
      const scale = Math.min(rect.width / w, rect.height / h)
      setT({ scale, x: (rect.width - w * scale) / 2, y: (rect.height - h * scale) / 2 })
    },
    [size.w, size.h],
  )

  useEffect(() => {
    if (!drawing.imageData) return
    const img = new Image()
    img.onload = () => {
      setSize({ w: img.naturalWidth, h: img.naturalHeight })
      fit(img.naturalWidth, img.naturalHeight)
    }
    img.src = drawing.imageData
    // Refit whenever a different drawing is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id, drawing.imageData])

  useEffect(() => {
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fit])

  /** Screen coordinates to normalised 0..1 position on the drawing. */
  const toPlan = (clientX: number, clientY: number): Point | null => {
    const el = wrapRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const px = (clientX - rect.left - t.x) / t.scale
    const py = (clientY - rect.top - t.y) / t.scale
    return { x: px / size.w, y: py / size.h }
  }

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = (clientX ?? rect.left + rect.width / 2) - rect.left
    const cy = (clientY ?? rect.top + rect.height / 2) - rect.top
    setT((prev) => {
      const scale = Math.min(12, Math.max(0.05, prev.scale * factor))
      const k = scale / prev.scale
      return { scale, x: cx - (cx - prev.x) * k, y: cy - (cy - prev.y) * k }
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false

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
      pinchStart.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: t.scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      }
      panStart.current = null
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const target = pinchStart.current.scale * (dist / pinchStart.current.dist)
      moved.current = true
      setT((prev) => {
        const scale = Math.min(12, Math.max(0.05, target))
        const el = wrapRef.current
        if (!el) return prev
        const rect = el.getBoundingClientRect()
        const cx = pinchStart.current!.cx - rect.left
        const cy = pinchStart.current!.cy - rect.top
        const k = scale / prev.scale
        return { scale, x: cx - (cx - prev.x) * k, y: cy - (cy - prev.y) * k }
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
        const far = Math.hypot((p.x - last.x) * size.w, (p.y - last.y) * size.h) > 4 / t.scale
        return far ? [...prev, p] : prev
      })
      return
    }

    if (panStart.current) {
      const dx = e.clientX - panStart.current.x
      const dy = e.clientY - panStart.current.y
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true
      setT((prev) => ({ ...prev, x: panStart.current!.tx + dx, y: panStart.current!.ty + dy }))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const wasSingle = pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
    if (pointers.current.size === 0) panStart.current = null

    if (drafting.current) {
      drafting.current = false
      const points = draft ?? []
      setDraft(null)
      // A tap with no drag is not a region; ignore it rather than storing a dot.
      const enough = mode === 'area' ? points.length === 2 : points.length >= 2
      if (enough && onDrawRegion) onDrawRegion(mode === 'area' ? 'area' : 'highlight', points)
      return
    }

    // A tap that did not pan is a pin placement.
    if (wasSingle && !moved.current && mode === 'pin' && onDropPin) {
      const p = toPlan(e.clientX, e.clientY)
      if (p && p.x >= 0 && p.y >= 0 && p.x <= 1 && p.y <= 1) onDropPin(p.x, p.y)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)
  }

  if (!drawing.imageData) {
    return (
      <div className="planview" style={{ height, display: 'grid', placeItems: 'center' }}>
        <span className="muted small">No plan image attached to {drawing.number || 'this drawing'}.</span>
      </div>
    )
  }

  const strokeWidth = Math.max(size.w, size.h) * REGION_STROKE_FRACTION
  const cursor = mode === 'pin' ? 'crosshair' : drawingMode ? 'cell' : 'grab'

  return (
    <div
      ref={wrapRef}
      className="planview"
      style={{ height, cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div
        className="planview__inner"
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`, width: size.w, height: size.h }}
      >
        <img src={drawing.imageData} alt={`Plan ${drawing.number}`} width={size.w} height={size.h} draggable={false} />

        {/* Regions sit between the plan and the pins so pins stay tappable. */}
        <svg
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          {regions.map((r) => (
            <RegionShape
              key={r.id}
              region={r}
              w={size.w}
              h={size.h}
              strokeWidth={strokeWidth}
              selected={r.id === selectedRegionId}
              onSelect={onSelectRegion}
            />
          ))}
          {draft && draft.length > 0 ? (
            <RegionShape
              region={{
                id: 'draft',
                drawingId: drawing.id,
                kind: mode === 'area' ? 'area' : 'highlight',
                points: draft,
                colour: drawColour,
                label: '',
                createdAt: 0,
              }}
              w={size.w}
              h={size.h}
              strokeWidth={strokeWidth}
            />
          ) : null}
        </svg>

        {pins.map((pin) => (
          <button
            key={pin.id}
            className="pin"
            title={pin.note || pin.label}
            style={{
              left: `${pin.x * 100}%`,
              top: `${pin.y * 100}%`,
              // Counter-scale so pins stay a constant size as the plan zooms.
              transform: `translate(-50%, -100%) scale(${1 / t.scale})`,
              transformOrigin: 'bottom center',
              border: 0,
              background: 'none',
              padding: 0,
            }}
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
            </svg>
            <span className="pin__label">{pin.label}</span>
          </button>
        ))}
      </div>

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
          onClick={() => fit()}
          aria-label="Fit to view"
          style={{ fontSize: 12, fontWeight: 700 }}
        >
          FIT
        </button>
      </div>
    </div>
  )
}

/** One highlighted extent, drawn in the plan's own pixel space. */
function RegionShape({
  region,
  w,
  h,
  strokeWidth,
  selected,
  onSelect,
}: {
  region: PlanRegion
  w: number
  h: number
  strokeWidth: number
  selected?: boolean
  onSelect?: (region: PlanRegion) => void
}) {
  const colour = REGION_COLOURS[region.colour] ?? REGION_COLOURS.yellow
  const interactive = onSelect
    ? { pointerEvents: 'auto' as const, cursor: 'pointer' }
    : { pointerEvents: 'none' as const }

  const handlers = onSelect
    ? {
        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation()
          onSelect(region)
        },
      }
    : {}

  if (region.kind === 'area') {
    const [a, b] = region.points
    if (!a || !b) return null
    const x = Math.min(a.x, b.x) * w
    const y = Math.min(a.y, b.y) * h
    const rw = Math.abs(b.x - a.x) * w
    const rh = Math.abs(b.y - a.y) * h
    return (
      <g style={interactive} {...handlers}>
        <rect
          x={x}
          y={y}
          width={rw}
          height={rh}
          fill={colour.fill}
          stroke={colour.stroke}
          strokeWidth={selected ? strokeWidth * 0.5 : strokeWidth * 0.3}
          strokeDasharray={selected ? `${strokeWidth} ${strokeWidth * 0.6}` : undefined}
        />
        {region.label ? (
          <text
            x={x + strokeWidth * 0.4}
            y={y + strokeWidth * 1.4}
            fontSize={strokeWidth * 1.3}
            fontWeight="700"
            fill={colour.stroke}
            stroke="#fff"
            strokeWidth={strokeWidth * 0.12}
            paintOrder="stroke"
          >
            {region.label}
          </text>
        ) : null}
      </g>
    )
  }

  const d = region.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * w} ${p.y * h}`).join(' ')
  const first = region.points[0]
  return (
    <g style={interactive} {...handlers}>
      <path
        d={d}
        fill="none"
        stroke={colour.fill}
        strokeWidth={selected ? strokeWidth * 1.35 : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {selected ? (
        <path
          d={d}
          fill="none"
          stroke={colour.stroke}
          strokeWidth={strokeWidth * 0.16}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${strokeWidth * 0.6} ${strokeWidth * 0.5}`}
        />
      ) : null}
      {region.label && first ? (
        <text
          x={first.x * w}
          y={first.y * h - strokeWidth * 0.7}
          fontSize={strokeWidth * 1.3}
          fontWeight="700"
          fill={colour.stroke}
          stroke="#fff"
          strokeWidth={strokeWidth * 0.12}
          paintOrder="stroke"
        >
          {region.label}
        </text>
      ) : null}
    </g>
  )
}
