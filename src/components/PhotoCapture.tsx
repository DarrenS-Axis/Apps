import { useEffect, useRef, useState } from 'react'
import type { Itp, Photo, PhotoCategory, Settings } from '../data/types'
import { PHOTO_CATEGORIES } from '../data/types'
import { capturePhoto, formatCoords, stampText } from '../lib/images'
import { addPhoto, deletePhoto, updatePhoto } from '../data/db'
import { ConfirmButton, IconCamera, IconClose, IconTrash, Sheet } from './ui'

/* ------------------------------------------------------------ capture bar */

interface CaptureProps {
  itp: Itp
  settings: Settings
  itemNo?: string
  /** Plan pin these photos are being taken at. */
  pinId?: string
  defaultCategory?: PhotoCategory
  onCaptured: (photo: Photo) => void
  onError: (message: string) => void
  label?: string
}

/**
 * Two ways in: the camera (`capture="environment"` opens the rear camera
 * directly on a phone) and the gallery, for photos already taken or for a
 * desktop review session.
 */
export function PhotoCaptureButtons({
  itp,
  settings,
  itemNo,
  pinId,
  defaultCategory = 'installation',
  onCaptured,
  onError,
  label = 'Take photo',
}: CaptureProps) {
  const cameraRef = useRef<HTMLInputElement | null>(null)
  const galleryRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  const handle = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const file of Array.from(files)) {
        const pin = pinId ? itp.pins.find((p) => p.id === pinId) : undefined
        const photo = await capturePhoto(file, {
          itpId: itp.id,
          itemNo,
          pinId,
          category: defaultCategory,
          settings,
          contextLines: [
            `ITP ${itp.itpNumber} — ${itp.title}`,
            [itp.area, itemNo ? `Item ${itemNo}` : '', pin ? `Pin ${pin.label}` : ''].filter(Boolean).join(' · '),
          ],
        })
        await addPhoto(photo)
        onCaptured(photo)
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not add that photo.')
    } finally {
      setBusy(false)
      if (cameraRef.current) cameraRef.current.value = ''
      if (galleryRef.current) galleryRef.current.value = ''
    }
  }

  return (
    <div className="row">
      <input
        ref={cameraRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handle(e.target.files)}
      />
      <input
        ref={galleryRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handle(e.target.files)}
      />
      <button className="btn btn--sm" onClick={() => cameraRef.current?.click()} disabled={busy} type="button">
        <IconCamera />
        {busy ? 'Saving…' : label}
      </button>
      <button className="btn btn--ghost btn--sm" onClick={() => galleryRef.current?.click()} disabled={busy} type="button">
        Add from gallery
      </button>
    </div>
  )
}

/* -------------------------------------------------------------- thumbnail */

export function PhotoGrid({
  photos,
  onOpen,
}: {
  photos: Photo[]
  onOpen: (photo: Photo) => void
}) {
  if (photos.length === 0) return null
  return (
    <div className="photos">
      {photos.map((p) => (
        <button key={p.id} className="photo" onClick={() => onOpen(p)} type="button">
          <img src={p.thumb} alt={p.caption || PHOTO_CATEGORIES[p.category]} loading="lazy" />
          <span className="photo__tag">
            {p.pinId ? '📍 ' : ''}
            {p.itemNo ? `#${p.itemNo}` : PHOTO_CATEGORIES[p.category]}
          </span>
          <span className="photo__stamp">{stampText(p.takenAt)}</span>
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------- lightbox */

export function PhotoViewer({
  photo,
  itp,
  onClose,
  onChanged,
  onDeleted,
}: {
  photo: Photo
  itp: Itp
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(photo.caption)
  const [category, setCategory] = useState<PhotoCategory>(photo.category)
  const [itemNo, setItemNo] = useState(photo.itemNo ?? '')
  const [pinId, setPinId] = useState(photo.pinId ?? '')

  const pinLabel = itp.pins.find((p) => p.id === photo.pinId)?.label

  // The lightbox covers the screen, so the page behind it must not scroll —
  // otherwise closing it drops you somewhere you did not leave. Escape closes
  // it, matching the sheets.
  useEffect(() => {
    if (editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [editing, onClose])

  const save = async () => {
    await updatePhoto(photo.id, {
      caption,
      category,
      itemNo: itemNo || undefined,
      pinId: pinId || undefined,
    })
    setEditing(false)
    onChanged()
  }

  if (editing) {
    return (
      <Sheet title="Photo details" onClose={() => setEditing(false)}>
        <div className="stack">
          <label className="field">
            <span>Caption</span>
            <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What this photo shows" />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as PhotoCategory)}>
                {Object.entries(PHOTO_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Against item</span>
              <select value={itemNo} onChange={(e) => setItemNo(e.target.value)}>
                <option value="">General record</option>
                {itp.items.map((i) => (
                  <option key={i.no} value={i.no}>
                    {i.no} — {i.installation.slice(0, 52)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Taken at plan pin</span>
            <select value={pinId} onChange={(e) => setPinId(e.target.value)}>
              <option value="">Not located on a plan</option>
              {itp.pins.map((p) => (
                <option key={p.id} value={p.id}>
                  Pin {p.label}
                  {p.note ? ` — ${p.note.slice(0, 44)}` : ''}
                </option>
              ))}
            </select>
            {itp.pins.length === 0 ? (
              <span style={{ textTransform: 'none', fontWeight: 400, marginTop: 4, color: 'var(--ink-3)' }}>
                Drop a pin on the Plans tab first to locate photos on the drawing.
              </span>
            ) : null}
          </label>
          <div className="row row--end">
            <button className="btn btn--ghost" onClick={() => setEditing(false)} type="button">
              Cancel
            </button>
            <button className="btn" onClick={save} type="button">
              Save
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo">
      <div className="lightbox__bar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{photo.caption || PHOTO_CATEGORIES[photo.category]}</div>
          <div className="small">
            {stampText(photo.takenAt)}
            {photo.takenAtFromExif ? ' · from camera' : ' · recorded at capture'}
            {photo.itemNo ? ` · item ${photo.itemNo}` : ''}
            {pinLabel ? ` · pin ${pinLabel}` : ''}
            {formatCoords(photo.lat, photo.lng) ? ` · ${formatCoords(photo.lat, photo.lng)}` : ''}
          </div>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>
      <img src={photo.data} alt={photo.caption || 'Site photo'} />
      <div className="lightbox__bar">
        <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)} type="button">
          Edit details
        </button>
        <span className="spacer" />
        <ConfirmButton
          label={
            <>
              <IconTrash />
              Delete
            </>
          }
          confirmLabel="Tap again to delete"
          onConfirm={async () => {
            await deletePhoto(photo.id)
            onDeleted()
          }}
        />
      </div>
    </div>
  )
}
