import { useEffect, useRef, useState } from 'react'
import { decodeQr, decodeQrFile } from '../lib/qr'

/**
 * Reads QR labels with the phone's camera. Three ways in, because site
 * conditions vary: the live camera; a photo of the label, for a phone that
 * will not share its camera with a web page; and typing the number printed
 * under the code.
 *
 * Every read is reported; telling repeats apart is the caller's business,
 * since stocktake wants each item once and a single scan wants the first.
 */
export function QrScanner({ onCode, paused = false }: { onCode: (text: string) => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const photoRef = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<'starting' | 'live' | 'denied' | 'unsupported'>('starting')
  const [typed, setTyped] = useState('')
  const [photoMessage, setPhotoMessage] = useState('')
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false
    let busy = false
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unsupported')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      } catch {
        if (!stopped) setState('denied')
        return
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play().catch(() => undefined)
      setState('live')
      timer = window.setInterval(async () => {
        if (busy || pausedRef.current || !video.videoWidth) return
        busy = true
        try {
          const text = await decodeQr(video, canvasRef.current ?? undefined)
          if (text && !stopped) onCodeRef.current(text)
        } finally {
          busy = false
        }
      }, 220)
    }
    void start()
    return () => {
      stopped = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return
    setPhotoMessage('Reading the label…')
    const text = await decodeQrFile(file).catch(() => null)
    if (photoRef.current) photoRef.current.value = ''
    if (text) {
      setPhotoMessage('')
      onCode(text)
    } else setPhotoMessage('No QR code found in that photo — fill the frame with the label and try again.')
  }

  return (
    <div className="stack">
      <div className="scanner">
        <video ref={videoRef} playsInline muted aria-label="Camera" />
        {state === 'live' ? <div className="scanner__frame" aria-hidden="true" /> : null}
        {state !== 'live' ? (
          <div className="scanner__msg">
            {state === 'starting'
              ? 'Starting the camera…'
              : state === 'denied'
                ? 'The camera is blocked for this site. Allow it in the browser settings, or take a photo of the label below.'
                : 'This browser cannot share its camera with the app. Take a photo of the label below.'}
          </div>
        ) : null}
        <canvas ref={canvasRef} hidden />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input ref={photoRef} className="visually-hidden" type="file" accept="image/*" capture="environment" aria-label="Photo of a QR label" onChange={(e) => fromPhoto(e.target.files?.[0])} />
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => photoRef.current?.click()}>
          Photo of the label
        </button>
        <form
          className="row"
          style={{ gap: 6, flex: 1, minWidth: 200 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (typed.trim()) onCode(typed.trim())
            setTyped('')
          }}
        >
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type the plant no., e.g. SA-0042" aria-label="Plant number" autoCapitalize="characters" style={{ flex: 1 }} />
          <button className="btn btn--ghost btn--sm" type="submit">
            Go
          </button>
        </form>
      </div>
      {photoMessage ? <p className="small muted" style={{ margin: 0 }}>{photoMessage}</p> : null}
    </div>
  )
}
