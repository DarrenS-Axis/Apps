import { useEffect, useRef, useState, type ReactNode } from 'react'
import { POINT_TYPES, type PointType } from '../data/types'

/* ------------------------------------------------------------------ icons */

type IconProps = { className?: string }

const svg = (path: ReactNode) =>
  function Icon({ className }: IconProps) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {path}
      </svg>
    )
  }

export const IconHome = svg(
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </>,
)
export const IconList = svg(
  <>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </>,
)
export const IconPlan = svg(
  <>
    <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </>,
)
export const IconCamera = svg(
  <>
    <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="13" r="3.4" />
  </>,
)
export const IconCog = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </>,
)
export const IconPlus = svg(<path d="M12 5v14M5 12h14" />)
export const IconBack = svg(<path d="m15 19-7-7 7-7" />)
export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </>,
)
export const IconCheck = svg(<path d="m4 12.5 5.5 5.5L20 6.5" />)
export const IconClose = svg(<path d="M6 6l12 12M18 6 6 18" />)
export const IconTrash = svg(
  <>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </>,
)
export const IconDownload = svg(
  <>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 20h16" />
  </>,
)
export const IconPdf = svg(
  <>
    <path d="M6 3h8l5 5v13H6z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h1.6a1.4 1.4 0 0 1 0 2.8H9V13zm0 2.8V18" />
  </>,
)
export const IconPin = svg(
  <>
    <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.6" />
  </>,
)
export const IconCopy = svg(
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </>,
)
export const IconWarn = svg(
  <>
    <path d="M12 4.5 21 20H3z" />
    <path d="M12 10v4.5M12 17.2h.01" />
  </>,
)
export const IconLock = svg(
  <>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </>,
)
export const IconSign = svg(
  <>
    <path d="M3 18c3.5 0 3.5-9 7-9s3.5 6 6.5 6c1.6 0 2.4-1.2 2.4-1.2" />
    <path d="M4 21h16" />
  </>,
)
export const IconHand = svg(
  <>
    <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M15 11.5V6.5a1.5 1.5 0 0 1 3 0V14" />
    <path d="M9 11V9a1.5 1.5 0 0 0-3 0v5.5c0 3.6 2.6 6.5 6 6.5h1.5c3 0 5.5-2.5 5.5-5.5V14" />
  </>,
)
export const IconHighlight = svg(
  <>
    <path d="M14 4.5 19.5 10 11 18.5H5.5V13z" />
    <path d="m12.5 6 5.5 5.5" />
    <path d="M4 21h16" />
  </>,
)
export const IconArea = svg(
  <>
    <rect x="4" y="6" width="16" height="12" rx="1.5" strokeDasharray="3.5 2.5" />
    <path d="M8.5 12h7" />
  </>,
)
export const IconFolder = svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />)

/* ------------------------------------------------------------------ chips */

export function PointChip({ point, withLabel = false }: { point: PointType; withLabel?: boolean }) {
  const t = POINT_TYPES[point]
  return (
    <span className={`chip ${t.cls}`} title={t.help}>
      {point} {withLabel ? t.label : t.short}
    </span>
  )
}

/* ---------------------------------------------------------------- sheets */

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
        {footer ? <div className="sheet__body" style={{ paddingTop: 0 }}>{footer}</div> : null}
      </div>
    </div>
  )
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{title}</div>
      {hint ? <div className="small" style={{ marginTop: 4 }}>{hint}</div> : null}
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span style={{ textTransform: 'none', fontWeight: 400, marginTop: 4, color: 'var(--ink-3)' }}>{hint}</span> : null}
    </label>
  )
}

/* ------------------------------------------------------------- signature */

/**
 * Pointer-driven signature pad. Draws at device pixel ratio so a signature
 * captured on a phone is still crisp when it lands in the PDF.
 */
export function SignaturePad({
  value,
  onChange,
  height = 160,
}: {
  value?: string
  onChange: (dataUrl: string | undefined) => void
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(Boolean(value))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#10202c'
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, height)
      img.src = value
      setHasInk(true)
    }
    // Re-initialising on `value` would wipe strokes mid-signature, so this runs
    // once per mount and the caller remounts (via key) to load a new signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    drawing.current = true
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pos(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    if (!hasInk) setHasInk(true)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange(undefined)
  }

  return (
    <div className="stack">
      <div className="sigpad">
        <canvas
          ref={canvasRef}
          style={{ height }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {!hasInk ? <div className="sigpad__hint">Sign here</div> : null}
      </div>
      <div className="row row--end">
        <button className="btn btn--ghost btn--sm" onClick={clear} type="button">
          Clear
        </button>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- toast */

export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}

/** Small hook for the transient confirmation messages used across the app. */
export function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = (m: string) => {
    setMsg(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), 2600)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [msg, show]
}

/** Confirmation that reads as a question rather than a generic "are you sure". */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'btn btn--danger btn--sm',
}: {
  label: ReactNode
  confirmLabel: string
  onConfirm: () => void
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (armed) {
          onConfirm()
          setArmed(false)
        } else setArmed(true)
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
