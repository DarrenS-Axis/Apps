import { useEffect, useRef, useState } from 'react'
import { createDrawing } from '../data/db'
import type { Drawing } from '../data/types'
import { formatDateTime } from '../lib/format'
import { currentPosition, formatCoords } from '../lib/images'
import { guessDrawingDetails, importPlanFile, type ImportProgress, type PlanImport } from '../lib/planImport'
import { Field } from './ui'

/**
 * Pieces Firedoc and Reviewdoc share for locating a record: a plan pulled in
 * from wherever the phone can reach, and the device's own position.
 */

export type Geo = { lat: number; lng: number; accuracy?: number; locatedAt: number }

export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`

/* ----------------------------------------------------------- location */

/** The device's position, fetched on mount and on demand. */
export function useDeviceLocation(enabled: boolean) {
  const [geo, setGeo] = useState<Geo | null>(null)
  const [state, setState] = useState<'idle' | 'locating' | 'unavailable'>('idle')
  const locate = async () => {
    setState('locating')
    const pos = await currentPosition(12000)
    if (pos) {
      setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, locatedAt: Date.now() })
      setState('idle')
    } else {
      setState('unavailable')
    }
  }
  useEffect(() => {
    if (enabled) void locate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
  return { geo, state, locate, clear: () => setGeo(null) }
}

export function LocationLine({ geo, state, onLocate, onClear }: { geo: Geo | null; state: 'idle' | 'locating' | 'unavailable'; onLocate: () => void; onClear?: () => void }) {
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="small" style={{ flex: 1, minWidth: 160 }}>
        {geo ? (
          <>
            <span className="mono">GPS {formatCoords(geo.lat, geo.lng)}</span>
            {geo.accuracy ? <span className="muted"> ±{Math.round(geo.accuracy)} m</span> : null}
            <span className="muted"> · {formatDateTime(geo.locatedAt)}</span> ·{' '}
            <a href={mapsUrl(geo.lat, geo.lng)} target="_blank" rel="noreferrer">
              Open in maps
            </a>
          </>
        ) : state === 'locating' ? (
          <span className="muted">Locating…</span>
        ) : state === 'unavailable' ? (
          <span className="muted">Location unavailable — allow location for this site, or move to where the phone can see the sky.</span>
        ) : (
          <span className="muted">No device location recorded.</span>
        )}
      </span>
      <button className="btn btn--ghost btn--sm" type="button" disabled={state === 'locating'} onClick={onLocate}>
        {geo ? 'Refresh location' : 'Locate me'}
      </button>
      {geo && onClear ? (
        <button className="btn btn--ghost btn--sm" type="button" onClick={onClear}>
          Clear
        </button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------- plan picking */

/**
 * Pulls a plan into the project from inside Reviewdoc, so a QA walk does not
 * detour through the Plans tab: the file browser reaches SharePoint, OneDrive
 * or whatever the phone is signed in to, and a multi-sheet PDF asks which
 * sheet before the drawing is created.
 */
export function PlanImporter({ projectId, onImported, onCancel }: { projectId: string; onImported: (drawing: Drawing) => void; onCancel: () => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [imported, setImported] = useState<PlanImport | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [number, setNumber] = useState('')
  const [title, setTitle] = useState('')
  const [revision, setRevision] = useState('')

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const plan = await importPlanFile(file, { onProgress: setProgress })
      setImported(plan)
      const guess = guessDrawingDetails(plan.pages[0], plan.fileName)
      setNumber(guess.number ?? '')
      setTitle(guess.title ?? '')
      setRevision(guess.revision ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    } finally {
      setBusy(false)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const save = async () => {
    const page = imported?.pages[pageIndex]
    if (!page) return
    const drawing = await createDrawing({
      projectId,
      number: number.trim() || imported!.fileName.replace(/\.[a-z]+$/i, ''),
      title: title.trim() || 'Plan',
      revision: revision.trim(),
      discipline: 'Hydraulic',
      imageData: page.data,
      imageWidth: page.width,
      imageHeight: page.height,
      thumbData: page.thumb,
    })
    onImported(drawing)
  }

  return (
    <div className="card">
      <div className="card__body stack">
        <span className="field-label">Import a plan</span>
        {!imported ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              A PDF or image from this device, SharePoint, OneDrive or any store the phone is signed in to. Rendered on the device — nothing is uploaded.
            </p>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf,image/*" onChange={(e) => void pick(e.target.files?.[0])} disabled={busy} />
            {busy ? <span className="small muted">{progress ? `Rendering sheet ${progress.page} of ${progress.total}…` : 'Reading…'}</span> : null}
            {error ? <div className="banner banner--warn">{error}</div> : null}
          </>
        ) : (
          <>
            {imported.pages.length > 1 ? (
              <div>
                <span className="small muted">Which sheet?</span>
                <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                  {imported.pages.map((p, i) => (
                    <button key={p.page} type="button" className={`btn btn--sm ${i === pageIndex ? '' : 'btn--ghost'}`} onClick={() => setPageIndex(i)} style={{ flex: 'none' }}>
                      <img src={p.thumb} alt="" style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 4, marginRight: 6 }} />
                      {p.page}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="field-grid">
              <Field label="Drawing number">
                <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="HC-201" />
              </Field>
              <Field label="Revision">
                <input type="text" value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="Rev C" />
              </Field>
            </div>
            <Field label="Title">
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="row row--end">
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => setImported(null)}>
                Choose another
              </button>
              <button className="btn btn--sm" type="button" onClick={() => void save()}>
                Use this plan
              </button>
            </div>
          </>
        )}
        {!imported ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel} style={{ alignSelf: 'flex-start' }}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  )
}

