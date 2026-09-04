import { useCallback, useEffect, useRef, useState } from 'react'
import type { Drawing, PlanPin } from '../data/types'

interface Props {
  drawing: Drawing
  pins: PlanPin[]
  /** Fires with normalised 0..1 coordinates when the user taps the plan. */
  onDropPin?: (x: number, y: number) => void
  onSelectPin?: (pin: PlanPin) => void
  selectedPinId?: string
  height?: number
  /** Adds the "tap to place" affordance and crosshair cursor. */
  placing?: boolean
}

interface Transform {
  scale: number
  x: number
  y: number
}

/**
 * Pan / zoom plan viewer with pin placement.
 *
 * Deliberately hand-rolled on pointer events rather than a map library: it has
 * to work offline from a data URL, on a phone, with one finger for pan and two
 * for pinch, and the whole thing is under 200 lines.
 */
export function PlanViewer({
  drawing,
  pins,
  onDropPin,
  onSelectPin,
  selectedPinId,
  height = 420,
  placing = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 })
  const [size, setSize] = useState({ w: drawing.imageWidth ?? 1000, h: drawing.imageHeight ?? 700 })

  // Pointer bookkeeping: one pointer pans, two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null)
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const moved = useRef(false)

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
      panStart.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }
    } else if (pointers.current.size === 2) {
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
      const factor = dist / pinchStart.current.dist
      const target = pinchStart.current.scale * factor
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

    // A tap that did not pan is a pin placement.
    if (wasSingle && !moved.current && onDropPin && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect()
      const px = (e.clientX - rect.left - t.x) / t.scale
      const py = (e.clientY - rect.top - t.y) / t.scale
      if (px >= 0 && py >= 0 && px <= size.w && py <= size.h) {
        onDropPin(px / size.w, py / size.h)
      }
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

  return (
    <div
      ref={wrapRef}
      className="planview"
      style={{ height, cursor: placing ? 'crosshair' : 'grab' }}
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
