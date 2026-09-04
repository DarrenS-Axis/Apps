import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../data/db'
import { useItps, useLive } from '../data/store'
import type { Photo, PhotoCategory } from '../data/types'
import { PHOTO_CATEGORIES } from '../data/types'
import { PhotoViewer } from '../components/PhotoCapture'
import { Empty, IconCamera, IconSearch, Toast, useToast } from '../components/ui'
import { stampText } from '../lib/images'
import { formatDate } from '../lib/format'

const NO_PHOTOS: Photo[] = []

/** Every photo on the job, newest first, grouped by the day it was taken. */
export function PhotosPage() {
  const { projectId } = useParams()
  const itps = useItps(projectId)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PhotoCategory | 'all'>('all')
  const [viewing, setViewing] = useState<Photo | null>(null)
  const [toast, showToast] = useToast()

  const itpIds = useMemo(() => itps.map((i) => i.id).join(','), [itps])

  const photos = useLive(
    async () => {
      const ids = new Set(itpIds ? itpIds.split(',') : [])
      if (ids.size === 0) return NO_PHOTOS
      const all = await db.photos.toArray()
      return all.filter((p) => ids.has(p.itpId)).sort((a, b) => b.takenAt - a.takenAt)
    },
    [itpIds],
    NO_PHOTOS,
  )

  const itpById = useMemo(() => new Map(itps.map((i) => [i.id, i])), [itps])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return photos.filter((p) => {
      if (category !== 'all' && p.category !== category) return false
      if (!q) return true
      const itp = itpById.get(p.itpId)
      return [p.caption, p.itemNo, itp?.title, itp?.area, itp?.itpNumber].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [photos, query, category, itpById])

  const byDay = useMemo(() => {
    const groups = new Map<string, Photo[]>()
    for (const p of filtered) {
      const key = new Date(p.takenAt).toISOString().slice(0, 10)
      const list = groups.get(key)
      if (list) list.push(p)
      else groups.set(key, [p])
    }
    return [...groups.entries()]
  }, [filtered])

  const viewingItp = viewing ? itpById.get(viewing.itpId) : undefined

  return (
    <>
      <div className="searchbar">
        <IconSearch />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search photos by caption, item, ITP or area"
        />
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button
          className={`btn btn--sm ${category === 'all' ? '' : 'btn--ghost'}`}
          onClick={() => setCategory('all')}
          type="button"
        >
          All ({photos.length})
        </button>
        {(Object.keys(PHOTO_CATEGORIES) as PhotoCategory[]).map((c) => {
          const count = photos.filter((p) => p.category === c).length
          if (count === 0) return null
          return (
            <button
              key={c}
              className={`btn btn--sm ${category === c ? '' : 'btn--ghost'}`}
              onClick={() => setCategory(c)}
              type="button"
            >
              {PHOTO_CATEGORIES[c]} ({count})
            </button>
          )
        })}
      </div>

      {byDay.length === 0 ? (
        <div className="card">
          <div className="card__body">
            <Empty
              icon={<IconCamera />}
              title={photos.length === 0 ? 'No photos captured yet' : 'No photos match that filter'}
              hint={photos.length === 0 ? 'Open an ITP item and take a photo — it is stamped with the capture time automatically.' : undefined}
            />
          </div>
        </div>
      ) : (
        byDay.map(([day, list]) => (
          <div key={day}>
            <div className="section-title">
              <h2>{formatDate(day)}</h2>
              <span>{list.length} photo{list.length > 1 ? 's' : ''}</span>
            </div>
            <div className="photos">
              {list.map((p) => {
                const itp = itpById.get(p.itpId)
                return (
                  <button key={p.id} className="photo" onClick={() => setViewing(p)} type="button">
                    <img src={p.thumb} alt={p.caption || PHOTO_CATEGORIES[p.category]} loading="lazy" />
                    <span className="photo__tag">
                      {itp ? `ITP ${itp.itpNumber}` : '—'}
                      {p.itemNo ? ` · ${p.itemNo}` : ''}
                    </span>
                    <span className="photo__stamp">{stampText(p.takenAt)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))
      )}

      {viewing && viewingItp ? (
        <PhotoViewer
          photo={viewing}
          itp={viewingItp}
          onClose={() => setViewing(null)}
          onChanged={() => showToast('Photo updated')}
          onDeleted={() => {
            setViewing(null)
            showToast('Photo deleted')
          }}
        />
      ) : null}
      <Toast message={toast} />
    </>
  )
}
