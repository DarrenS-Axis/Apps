import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { addPhoto, db } from '../data/db'
import {
  createDepot,
  createPlantItem,
  deleteDepot,
  deletePlantItem,
  depotReach,
  findPlantByNo,
  geocodeAddress,
  isStale,
  movePlant,
  recordSighting,
  STALE_DAYS,
  testTagDue,
  updateDepot,
  updatePlantItem,
  type Placement,
  type Sighting,
} from '../data/plant'
import { useBusinessUnits, useDepots, useLive, usePlant, usePlantItem, useRecordPhotos, useSettings } from '../data/store'
import {
  PLANT_STATUS_LABEL,
  PLANT_STATUSES,
  STATE_CODES,
  STATE_NAMES,
  type Depot,
  type Photo,
  type PlantItem,
  type PlantMove,
  type PlantStatus,
  type Project,
  type StateCode,
} from '../data/types'
import { PhotoGrid, PhotoViewer } from '../components/PhotoCapture'
import { mapsUrl } from '../components/Locate'
import { QrScanner } from '../components/QrScanner'
import { ConfirmButton, Empty, Field, IconCamera, IconDownload, IconPlus, IconWarn, Sheet, Toast, useToast } from '../components/ui'
import { downloadBlob, formatDate, formatDateTime, relativeTime, todayIso } from '../lib/format'
import { capturePhoto, currentPosition, formatCoords } from '../lib/images'
import { importPlantRows, matchProject, parsePlantRegister, plantCsv, type ParsedRegister } from '../lib/plantRegister'
import { plantLabelsPdf, plantListPdf } from '../lib/plantPdf'
import { plantLink, plantNoFromCode, qrSvg } from '../lib/qr'
import { readRegisterFile } from '../lib/xlsx'

/**
 * The plant register for a state: every tool and piece of plant, where it
 * is and how that is known. Photographing or scanning an item records where
 * the phone is — at a yard or office the item is back and available; on a
 * job it is on site.
 */

export const STATUS_CLASS: Record<PlantStatus, string> = {
  available: 'chip--ok',
  on_site: 'chip--surv',
  out_of_service: 'chip--warn',
  missing: 'chip--hold',
  disposed: '',
}

const VIA_LABEL: Record<PlantMove['via'], string> = {
  photo: 'Photographed',
  scan: 'QR scanned',
  stocktake: 'Stocktake scan',
  manual: 'Updated',
  import: 'Register import',
}

type Show = 'active' | 'all' | PlantStatus | 'stale' | 'tag_due' | 'unlabelled' | 'unlocated'

const SHOW_LABEL: Record<Show, string> = {
  active: 'In service (not disposed)',
  all: 'Everything, disposed included',
  available: 'Available',
  on_site: 'On site',
  out_of_service: 'Out of service',
  missing: 'Missing',
  disposed: 'Disposed',
  stale: `On site, not seen in ${STALE_DAYS} days`,
  tag_due: 'Test & tag overdue',
  unlabelled: 'No QR label printed',
  unlocated: 'Never photographed or scanned',
}

const PAGE = 120

/** Only the one attempt per depot per visit to look an address up. */
const geocodeTried = new Set<string>()

function placementText(p: Placement, item: PlantItem): { text: string; tone: 'ok' | 'info' | 'warn' } {
  if (p.kind === 'depot') {
    return {
      text: `At ${p.depot.name} (${Math.round(p.distance)} m) — ${item.location}, ${PLANT_STATUS_LABEL[item.status].toLowerCase()}.`,
      tone: 'ok',
    }
  }
  if (p.kind === 'project') return { text: `On site at ${p.project.name} (${Math.round(p.distance)} m from its records).`, tone: 'info' }
  return { text: 'Not at a yard, an office or a job with located records. Which job is it on?', tone: 'warn' }
}

/**
 * A label scanned with the phone's own camera opens #/plant/tag/SA-0042.
 * It hands the number to the register, which opens the item.
 */
export function PlantTagLink() {
  const { plantNo } = useParams()
  return <Navigate to="/plant" replace state={{ tag: plantNo }} />
}

export function PlantPage() {
  const location = useLocation()
  const tagged = (location.state as { tag?: string } | null)?.tag
  // Arriving from a project: its plant.
  const fromJob = (location.state as { where?: string } | null)?.where
  const navigate = useNavigate()
  const settings = useSettings()
  const national = settings.role === 'national_qa'
  const [chosen, setChosen] = useState<StateCode | 'all' | ''>('')
  const scope: StateCode | 'all' | undefined = national ? chosen || settings.state || 'all' : settings.state
  const states: StateCode[] = national ? STATE_CODES : settings.state ? [settings.state] : []
  const plant = usePlant(scope)
  const depots = useDepots(scope)
  const units = useBusinessUnits()
  const projects = useLive(
    async () => (scope ? (await db.projects.toArray()).filter((p) => !p.archived && (scope === 'all' || p.state === scope)).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [scope],
    [] as Project[],
  )
  const [toast, showToast] = useToast()
  const [query, setQuery] = useState('')
  const [show, setShow] = useState<Show>('active')
  const [where, setWhere] = useState(fromJob ?? '')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<{ id: string; via?: 'scan' } | null>(null)
  const [unknown, setUnknown] = useState<string | null>(null)
  const [panel, setPanel] = useState<'' | 'scan' | 'stocktake' | 'add' | 'import' | 'labels' | 'depots'>('')
  const [addNo, setAddNo] = useState('')

  const entityFor = (state: StateCode) => units.find((u) => u.state === state)?.entity ?? `Axis ${state}`

  // A label scanned with the phone's own camera: open the item and record the sighting.
  useEffect(() => {
    if (!tagged || !states.length) return
    navigate('/plant', { replace: true, state: null })
    void findPlantByNo(tagged, states).then((item) => {
      if (item) setOpen({ id: item.id, via: 'scan' })
      else setUnknown(tagged.toUpperCase())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagged, states.join(',')])

  // A depot seeded with only its suburb looks its address up once there is signal.
  useEffect(() => {
    for (const d of depots) {
      if (d.source !== 'seed' || geocodeTried.has(d.id) || !navigator.onLine) continue
      geocodeTried.add(d.id)
      void geocodeAddress(d.address).then((hit) => {
        if (hit) void updateDepot(d.id, { lat: hit.lat, lng: hit.lng, source: 'address' })
      })
    }
  }, [depots])

  const counts = useMemo(() => {
    const c: Record<Show, number> = { active: 0, all: plant.length, available: 0, on_site: 0, out_of_service: 0, missing: 0, disposed: 0, stale: 0, tag_due: 0, unlabelled: 0, unlocated: 0 }
    const t = Date.now()
    for (const i of plant) {
      c[i.status]++
      if (i.status !== 'disposed') c.active++
      if (isStale(i, t)) c.stale++
      if (i.status !== 'disposed' && testTagDue(i, t)?.overdue) c.tag_due++
      if (i.status !== 'disposed' && !i.labelPrintedAt) c.unlabelled++
      if (i.status !== 'disposed' && !i.seenAt) c.unlocated++
    }
    return c
  }, [plant])

  const locations = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of plant) if (i.status !== 'disposed') m.set(i.location || '', (m.get(i.location || '') ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [plant])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const t = Date.now()
    return plant.filter((i) => {
      if (show === 'active' && i.status === 'disposed') return false
      if ((PLANT_STATUSES as string[]).includes(show) && i.status !== show) return false
      if (show === 'stale' && !isStale(i, t)) return false
      if (show === 'tag_due' && (i.status === 'disposed' || !testTagDue(i, t)?.overdue)) return false
      if (show === 'unlabelled' && (i.status === 'disposed' || i.labelPrintedAt)) return false
      if (show === 'unlocated' && (i.status === 'disposed' || i.seenAt)) return false
      if (where && (i.location || '') !== (where === '(none)' ? '' : where)) return false
      if (!q) return true
      return [i.plantNo, i.axisNo, i.type, i.brandModel, i.serial, i.location, i.notes].join(' ').toLowerCase().includes(q)
    })
  }, [plant, query, show, where])

  useEffect(() => setLimit(PAGE), [query, show, where, scope])

  if (!scope) return <Empty title="Choose your state first" hint="Settings → your state." />

  const exportCsv = () => {
    const byId = new Map(projects.map((p) => [p.id, p]))
    downloadBlob(new Blob([plantCsv(filtered, byId)], { type: 'text/csv' }), `Plant register ${scope} ${todayIso()}.csv`)
  }
  const exportList = () => {
    const title = where ? `Location: ${where === '(none)' ? 'not recorded' : where}` : SHOW_LABEL[show]
    const entity = scope === 'all' ? 'Axis' : entityFor(scope)
    downloadBlob(plantListPdf(filtered, { title, entity, subtitle: scope === 'all' ? 'All states' : STATE_NAMES[scope] }), `Plant list ${scope}${where ? ` ${where}` : ''} ${todayIso()}.pdf`)
  }

  return (
    <>
      <div className="section-title">
        <h2>Plant register</h2>
        <span>{counts.active} in service</span>
        <span className="spacer" />
        {national ? (
          <select aria-label="State" value={scope} onChange={(e) => setChosen(e.target.value as StateCode | 'all')} style={{ width: 'auto', minHeight: 36 }}>
            <option value="all">All states</option>
            {STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="card">
        <div className="card__body">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => setPanel('scan')}>
              <IconQr />
              Scan QR
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setPanel('stocktake')}>
              Stocktake
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setPanel('add')}>
              <IconPlus />
              Add item
            </button>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
            <Stat value={counts.available} label="Available" onClick={() => setShow('available')} />
            <Stat value={counts.on_site} label="On site" onClick={() => setShow('on_site')} />
            <Stat value={counts.out_of_service} label="Out of service" onClick={() => setShow('out_of_service')} />
            <Stat value={counts.missing} label="Missing" tone="hold" onClick={() => setShow('missing')} />
            <Stat value={counts.stale} label={`Not seen ${STALE_DAYS}+ days`} tone="warn" onClick={() => setShow('stale')} />
            <Stat value={counts.tag_due} label="Test & tag overdue" tone="warn" onClick={() => setShow('tag_due')} />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setPanel('import')} disabled={scope === 'all'} title={scope === 'all' ? 'Choose a state to import into' : undefined}>
              Import register (Excel)
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setPanel('labels')} disabled={!plant.length}>
              QR labels
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={exportList} disabled={!filtered.length}>
              <IconDownload />
              Plant list PDF
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={exportCsv} disabled={!filtered.length}>
              <IconDownload />
              Excel (CSV)
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setPanel('depots')}>
              Yards & offices
            </button>
          </div>
          {depots.some((d) => d.source === 'seed') ? (
            <div className="banner banner--info" style={{ marginTop: 12 }}>
              <IconWarn />
              <span>
                {depots
                  .filter((d) => d.source === 'seed')
                  .map((d) => d.name)
                  .join(', ')}{' '}
                is placed from its suburb only, so anything within {Math.round(depotReach(depots.find((d) => d.source === 'seed')!) / 100) / 10} km counts as there.{' '}
                <button className="linkbtn" type="button" onClick={() => setPanel('depots')}>
                  Set it exactly
                </button>{' '}
                — the address is looked up when there is signal, or stand there and use your location.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="searchbar" style={{ marginTop: 12 }}>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plant no., type, brand, serial, Axis no." />
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as Show)} style={{ flex: 1 }}>
          {(Object.keys(SHOW_LABEL) as Show[]).map((k) => (
            <option key={k} value={k}>
              {SHOW_LABEL[k]} ({counts[k]})
            </option>
          ))}
        </select>
        <select aria-label="Location" value={where} onChange={(e) => setWhere(e.target.value)} style={{ flex: 1 }}>
          <option value="">Every location</option>
          {locations.map(([l, n]) => (
            <option key={l || '(none)'} value={l || '(none)'}>
              {l || 'Not recorded'} ({n})
            </option>
          ))}
        </select>
      </div>

      <div className="card card__body--flush">
        {plant.length === 0 ? (
          <Empty
            title="No plant on the register yet"
            hint={scope === 'all' ? 'Choose a state to import its register.' : 'Import the plant register (AXIMSRG-03, Excel), or add items one at a time.'}
          />
        ) : filtered.length === 0 ? (
          <Empty title="Nothing matches" />
        ) : (
          <>
            {filtered.slice(0, limit).map((i) => (
              <PlantRow key={i.id} item={i} onOpen={() => setOpen({ id: i.id })} />
            ))}
            {filtered.length > limit ? (
              <div className="card__body">
                <button className="btn btn--ghost btn--block" type="button" onClick={() => setLimit(limit + PAGE * 2)}>
                  Show more ({filtered.length - limit} more)
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <p className="small muted" style={{ textAlign: 'center' }}>
        {filtered.length} of {plant.length} items
      </p>

      {open ? <PlantSheet id={open.id} via={open.via} projects={projects} depots={depots} onClose={() => setOpen(null)} onToast={showToast} entity={entityFor} /> : null}
      {panel === 'scan' || panel === 'stocktake' ? (
        <ScanSheet
          initialMode={panel === 'stocktake' ? 'stocktake' : 'single'}
          states={states}
          onClose={() => setPanel('')}
          onFound={(item) => {
            setPanel('')
            setOpen({ id: item.id, via: 'scan' })
          }}
          onUnknown={(no) => {
            setPanel('')
            setUnknown(no)
          }}
        />
      ) : null}
      {unknown ? (
        <Sheet title="Not on the register" onClose={() => setUnknown(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>
              <strong className="mono">{unknown}</strong> is not on the {scope === 'all' ? '' : `${scope} `}register{national ? '' : ' for your state'}.
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              If it is on another device that has not synced yet, sync and scan again. If the label is new, add the item under this number.
            </p>
            <div className="row row--end">
              <button className="btn btn--ghost" type="button" onClick={() => setUnknown(null)}>
                Close
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setAddNo(unknown)
                  setUnknown(null)
                  setPanel('add')
                }}
              >
                Add {unknown}
              </button>
            </div>
          </div>
        </Sheet>
      ) : null}
      {panel === 'add' ? (
        <AddPlantSheet
          scope={scope}
          plantNo={addNo}
          depots={depots}
          projects={projects}
          types={[...new Set(plant.map((p) => p.type))].sort()}
          onClose={() => {
            setPanel('')
            setAddNo('')
          }}
          onAdded={(item) => {
            setPanel('')
            setAddNo('')
            setOpen({ id: item.id })
            showToast(`${item.plantNo} added — photograph it to record where it is`)
          }}
        />
      ) : null}
      {panel === 'import' && scope !== 'all' ? (
        <ImportSheet
          state={scope}
          depots={depots}
          projects={projects}
          existing={plant.length}
          onClose={() => setPanel('')}
          onDone={(m) => {
            setPanel('')
            showToast(m)
          }}
        />
      ) : null}
      {panel === 'labels' ? <LabelsSheet items={filtered} all={plant} filterLabel={where || SHOW_LABEL[show]} entity={entityFor} onClose={() => setPanel('')} onDone={showToast} /> : null}
      {panel === 'depots' ? <DepotsSheet scope={scope} depots={depots} onClose={() => setPanel('')} onToast={showToast} /> : null}
      <Toast message={toast} />
    </>
  )
}

function Stat({ value, label, tone, onClick }: { value: number; label: string; tone?: 'hold' | 'warn'; onClick?: () => void }) {
  const colour = value && tone === 'hold' ? 'var(--hold)' : value && tone === 'warn' ? 'var(--warn, #b45309)' : 'var(--ink)'
  return (
    <button type="button" className="stat" onClick={onClick}>
      <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: colour }}>{value}</span>
      <span className="small muted">{label}</span>
    </button>
  )
}

function PlantRow({ item, onOpen }: { item: PlantItem; onOpen: () => void }) {
  const tag = testTagDue(item)
  return (
    <button className="listitem" type="button" onClick={onOpen}>
      <span className="listitem__num listitem__num--wide">
        {item.plantNo}
      </span>
      <span className="listitem__main">
        <strong>
          {item.type}
          {item.brandModel ? ` · ${item.brandModel}` : ''}
        </strong>
        <span>{[item.axisNo ? `Axis no. ${item.axisNo}` : '', item.serial ? `S/N ${item.serial}` : ''].filter(Boolean).join(' · ') || 'No tool number or serial'}</span>
        <span className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
          <span className={`chip ${STATUS_CLASS[item.status]}`}>{PLANT_STATUS_LABEL[item.status]}</span>
          {item.location ? <span className="chip">{item.location}</span> : null}
          {item.seenAt ? <span className="chip chip--ok">Seen {relativeTime(item.seenAt)}</span> : <span className="chip">Not located yet</span>}
          {isStale(item) ? <span className="chip chip--warn">Not seen {STALE_DAYS}+ days</span> : null}
          {tag?.overdue && item.status !== 'disposed' ? <span className="chip chip--hold">Test & tag due {formatDate(tag.due)}</span> : null}
        </span>
      </span>
    </button>
  )
}

/* -------------------------------------------------------------- detail */

function PlantSheet({
  id,
  via,
  projects,
  depots,
  onClose,
  onToast,
  entity,
}: {
  id: string
  via?: 'scan'
  projects: Project[]
  depots: Depot[]
  onClose: () => void
  onToast: (m: string) => void
  entity: (s: StateCode) => string
}) {
  const item = usePlantItem(id)
  const settings = useSettings()
  const photos = useRecordPhotos('plantId', id)
  const [viewing, setViewing] = useState<Photo | null>(null)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<{ text: string; tone: 'ok' | 'info' | 'warn'; geo?: Sighting; via: PlantMove['via']; photoId?: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const [editing, setEditing] = useState(false)
  const cameraRef = useRef<HTMLInputElement | null>(null)
  const galleryRef = useRef<HTMLInputElement | null>(null)
  const scanned = useRef(false)

  const stateDepots = depots.filter((d) => d.state === item?.state)
  const stateProjects = projects.filter((p) => p.state === item?.state)

  const sight = async (geo: Sighting, how: PlantMove['via'], photoId?: string) => {
    const r = await recordSighting(id, geo, { via: how, by: settings.userName || undefined, photoId })
    if (!r) return
    const t = placementText(r.placement, r.item)
    setResult({ ...t, geo, via: how, photoId })
    if (r.placement.kind !== 'unknown') onToast(`${r.item.plantNo}: ${PLANT_STATUS_LABEL[r.item.status]} · ${r.item.location}`)
  }

  const fix = async (): Promise<Sighting | null> => {
    const pos = await currentPosition(12000, 0)
    return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() } : null
  }

  // Scanning a label is seeing the item: record where, straight away.
  useEffect(() => {
    if (via !== 'scan' || scanned.current || !item) return
    scanned.current = true
    setBusy('Locating…')
    void fix().then(async (geo) => {
      if (geo) await sight(geo, 'scan')
      else setResult({ text: 'Scanned, but the phone could not give a location — so where it is has not changed. Photograph it, or set the place by hand.', tone: 'warn', via: 'scan' })
      setBusy('')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [via, item?.id])

  if (!item) return null

  const photograph = async (files: FileList | null) => {
    const file = files?.[0]
    if (cameraRef.current) cameraRef.current.value = ''
    if (galleryRef.current) galleryRef.current.value = ''
    if (!file) return
    setBusy('Saving photo…')
    try {
      const photo = await capturePhoto(file, {
        plantId: item.id,
        category: 'other',
        caption: `${item.plantNo} ${item.type}`,
        settings: { ...settings, captureGps: true },
        freshGps: true,
        contextLines: [`${item.plantNo} — ${item.type}${item.brandModel ? ` · ${item.brandModel}` : ''}`],
      })
      await addPhoto(photo)
      let geo: Sighting | null = photo.lat !== undefined && photo.lng !== undefined ? { lat: photo.lat, lng: photo.lng, accuracy: photo.accuracy, at: photo.takenAt } : null
      if (!geo) {
        setBusy('Locating…')
        geo = await fix()
      }
      if (geo) await sight(geo, 'photo', photo.id)
      else setResult({ text: 'Photo saved, but it has no location and the phone could not give one — where the item is has not changed. Allow location for this site and try again, or set the place by hand.', tone: 'warn', via: 'photo', photoId: photo.id })
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not add that photo.')
    } finally {
      setBusy('')
    }
  }

  const tag = testTagDue(item)
  const qr = qrSvg(plantLink(item.plantNo))
  const history = [...item.history].reverse()

  return (
    <Sheet title={`${item.plantNo} · ${item.type}`} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className={`chip ${STATUS_CLASS[item.status]}`}>{PLANT_STATUS_LABEL[item.status]}</span>
          <span className="chip">{item.location || 'Location not recorded'}</span>
          {item.axisNo ? <span className="chip">Axis no. {item.axisNo}</span> : null}
          {isStale(item) ? <span className="chip chip--warn">Not seen {STALE_DAYS}+ days</span> : null}
          {tag && item.status !== 'disposed' ? <span className={`chip ${tag.overdue ? 'chip--hold' : ''}`}>Test & tag {tag.overdue ? 'overdue' : 'due'} {formatDate(tag.due)}</span> : null}
        </div>

        <p className="small" style={{ margin: 0 }}>
          {item.seenAt ? (
            <>
              Last seen {formatDateTime(item.seenAt)}
              {item.seenBy ? ` by ${item.seenBy}` : ''}
              {item.lat !== undefined && item.lng !== undefined ? (
                <>
                  {' '}
                  · <span className="mono">{formatCoords(item.lat, item.lng)}</span>
                  {item.accuracy ? ` ±${Math.round(item.accuracy)} m` : ''} ·{' '}
                  <a href={mapsUrl(item.lat, item.lng)} target="_blank" rel="noreferrer">
                    Open in maps
                  </a>
                </>
              ) : null}
            </>
          ) : (
            <span className="muted">Not photographed or scanned yet — the place above is from the register.</span>
          )}
        </p>

        {/* The one thing people do most: photograph it where it stands. */}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input ref={cameraRef} className="visually-hidden" type="file" accept="image/*" capture="environment" aria-label="Photograph item" onChange={(e) => photograph(e.target.files)} />
          <input ref={galleryRef} className="visually-hidden" type="file" accept="image/*" aria-label="Photo from gallery" onChange={(e) => photograph(e.target.files)} />
          <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => cameraRef.current?.click()}>
            <IconCamera />
            {busy || 'Photo & locate'}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" disabled={Boolean(busy)} onClick={() => galleryRef.current?.click()}>
            From gallery
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setMoving(!moving)}>
            Move / change status
          </button>
        </div>

        {result ? (
          <div className={`banner ${result.tone === 'ok' ? 'banner--ok' : result.tone === 'warn' ? 'banner--warn' : 'banner--info'}`}>
            <span style={{ flex: 1 }}>{result.text}</span>
          </div>
        ) : null}

        {moving || (result?.tone === 'warn' && result.geo) ? (
          <MovePanel
            item={item}
            depots={stateDepots}
            projects={stateProjects}
            prompt={result?.tone === 'warn' && result.geo ? 'on_site' : undefined}
            onCancel={() => {
              setMoving(false)
              if (result?.tone === 'warn') setResult(null)
            }}
            onSave={async (move) => {
              const geo = result?.tone === 'warn' ? result.geo : undefined
              await movePlant(item.id, {
                ...move,
                via: geo ? result!.via : 'manual',
                by: settings.userName || undefined,
                geo,
                photoId: geo ? result!.photoId : undefined,
                seen: Boolean(geo),
              })
              setMoving(false)
              setResult(null)
              onToast(`${item.plantNo}: ${PLANT_STATUS_LABEL[move.status]}${move.location ? ` · ${move.location}` : ''}`)
            }}
          />
        ) : null}

        <PhotoGrid photos={photos} onOpen={setViewing} />

        {/* Details from the register */}
        {editing ? (
          <DetailsForm item={item} onDone={() => setEditing(false)} />
        ) : (
          <div className="card" style={{ margin: 0 }}>
            <div className="card__body">
              <dl className="kv">
                <dt>Equipment type</dt>
                <dd>{item.type}</dd>
                <dt>Brand and model</dt>
                <dd>{item.brandModel || '—'}</dd>
                <dt>Serial #</dt>
                <dd className="mono">{item.serial || '—'}</dd>
                <dt>Axis no.</dt>
                <dd>{item.axisNo || '—'}</dd>
                <dt>Calibration</dt>
                <dd>{item.calibratedAt ? formatDate(item.calibratedAt) : item.calibration || '—'}</dd>
                <dt>Last service / test & tag</dt>
                <dd>{item.lastTestAt ? formatDate(item.lastTestAt) : item.lastTestNote || '—'}</dd>
                {item.dateOffSite ? (
                  <>
                    <dt>Date off site</dt>
                    <dd>{formatDate(item.dateOffSite)}</dd>
                  </>
                ) : null}
                {item.enteredAt ? (
                  <>
                    <dt>Date of entry</dt>
                    <dd>{formatDate(item.enteredAt)}</dd>
                  </>
                ) : null}
                {item.notes ? (
                  <>
                    <dt>Notes</dt>
                    <dd>{item.notes}</dd>
                  </>
                ) : null}
              </dl>
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditing(true)}>
                Edit details
              </button>
            </div>
          </div>
        )}

        {/* The label */}
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <svg className="qrbox" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`QR code for ${item.plantNo}`} shapeRendering="crispEdges">
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.path} fill="#000" />
          </svg>
          <div className="stack" style={{ gap: 6, flex: 1, minWidth: 160 }}>
            <span className="small muted">
              {item.labelPrintedAt ? `Label printed ${formatDate(item.labelPrintedAt)}.` : 'No label printed yet.'} Any phone camera opens this item from the label.
            </span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={async () => {
                  downloadBlob(plantLabelsPdf([item], { entity: entity(item.state), outlines: true }), `Label ${item.plantNo}.pdf`)
                  await updatePlantItem(item.id, { labelPrintedAt: Date.now() })
                }}
              >
                <IconDownload />
                Label PDF
              </button>
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(plantLink(item.plantNo)).then(
                    () => onToast('Link copied'),
                    () => onToast(plantLink(item.plantNo)),
                  )
                }}
              >
                Copy link
              </button>
            </div>
          </div>
        </div>

        {/* Movements */}
        <div>
          <span className="field-label">History</span>
          <ol className="history">
            {history.map((m, i) => (
              <li key={`${m.at}-${i}`}>
                <span className="small muted">
                  {formatDateTime(m.at)} · {VIA_LABEL[m.via]}
                  {m.by ? ` by ${m.by}` : ''}
                </span>
                <span>
                  <strong>{PLANT_STATUS_LABEL[m.status]}</strong>
                  {m.location ? ` · ${m.location}` : ''}
                  {m.lat !== undefined && m.lng !== undefined ? (
                    <>
                      {' '}
                      ·{' '}
                      <a href={mapsUrl(m.lat, m.lng)} target="_blank" rel="noreferrer" className="mono small">
                        {formatCoords(m.lat, m.lng)}
                      </a>
                    </>
                  ) : null}
                </span>
                {m.note ? <span className="small muted">{m.note}</span> : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="row row--end">
          <ConfirmButton
            label="Delete from register"
            confirmLabel="Tap again to delete"
            onConfirm={async () => {
              await deletePlantItem(item.id)
              onToast(`${item.plantNo} deleted`)
              onClose()
            }}
          />
        </div>
      </div>
      {viewing ? <PhotoViewer photo={viewing} onClose={() => setViewing(null)} onChanged={() => undefined} onDeleted={() => setViewing(null)} /> : null}
    </Sheet>
  )
}

/** Sets where an item is by hand: back at a yard, out to a job, broken, missing, gone. */
function MovePanel({
  item,
  depots,
  projects,
  prompt,
  onSave,
  onCancel,
}: {
  item: PlantItem
  depots: Depot[]
  projects: Project[]
  prompt?: 'on_site'
  onSave: (m: { status: PlantStatus; location: string; depotId?: string; projectId?: string; note?: string }) => Promise<void>
  onCancel: () => void
}) {
  const [status, setStatus] = useState<PlantStatus>(prompt ?? (item.status === 'available' ? 'on_site' : 'available'))
  const [depotId, setDepotId] = useState(item.depotId ?? depots[0]?.id ?? '')
  const [area, setArea] = useState(item.depotId ? item.location : (depots[0]?.defaultArea ?? 'Yard'))
  const [projectId, setProjectId] = useState(item.projectId ?? '')
  const [other, setOther] = useState(item.projectId || item.depotId ? '' : item.location)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const atDepot = status === 'available'
  const onJob = status === 'on_site'
  const save = async () => {
    setSaving(true)
    try {
      if (atDepot) {
        const depot = depots.find((d) => d.id === depotId)
        await onSave({ status, location: area.trim() || depot?.defaultArea || 'Yard', depotId: depot?.id, note: note.trim() || undefined })
      } else if (onJob) {
        const project = projects.find((p) => p.id === projectId)
        await onSave({ status, location: project?.name ?? other.trim(), projectId: project?.id, note: note.trim() || undefined })
      } else {
        await onSave({ status, location: other.trim(), note: note.trim() || undefined })
      }
    } finally {
      setSaving(false)
    }
  }
  const canSave = atDepot ? Boolean(area.trim() || depotId) : onJob ? Boolean(projectId || other.trim()) : true

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card__body stack">
        {prompt ? <span className="small">Record it on a job:</span> : null}
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as PlantStatus)}>
            {PLANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'available' ? 'Available — at a yard or office' : s === 'on_site' ? 'On site — on a job' : PLANT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        {atDepot ? (
          <div className="field-grid">
            <Field label="Yard / office">
              <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                {depots.length === 0 ? <option value="">No yards set up</option> : null}
              </select>
            </Field>
            <Field label="Where there">
              <input type="text" list="plant-areas" value={area} onChange={(e) => setArea(e.target.value)} />
              <datalist id="plant-areas">
                <option value="Yard" />
                <option value="Office" />
                <option value="Container" />
                <option value="Workshop" />
              </datalist>
            </Field>
          </div>
        ) : onJob ? (
          <div className="field-grid">
            <Field label="Job">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Another job (type it)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {!projectId ? (
              <Field label="Job name">
                <input type="text" value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. NWCH" />
              </Field>
            ) : null}
          </div>
        ) : (
          <Field label="Where it is (if known)">
            <input type="text" value={other} onChange={(e) => setOther(e.target.value)} placeholder={status === 'out_of_service' ? 'e.g. Repairer, Yard' : ''} />
          </Field>
        )}
        <Field label="Note">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={status === 'out_of_service' ? 'What is wrong with it' : 'Optional'} />
        </Field>
        <div className="row row--end">
          <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--sm" type="button" disabled={!canSave || saving} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailsForm({ item, onDone }: { item: PlantItem; onDone: () => void }) {
  const [d, setD] = useState({
    type: item.type,
    brandModel: item.brandModel,
    serial: item.serial,
    axisNo: item.axisNo ?? '',
    calibration: item.calibration ?? '',
    calibratedAt: item.calibratedAt ?? '',
    lastTestAt: item.lastTestAt ?? '',
    lastTestNote: item.lastTestNote ?? '',
    notes: item.notes ?? '',
  })
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card__body stack">
        <div className="field-grid">
          <Field label="Equipment type">
            <input type="text" value={d.type} onChange={set('type')} />
          </Field>
          <Field label="Brand and model">
            <input type="text" value={d.brandModel} onChange={set('brandModel')} />
          </Field>
          <Field label="Serial #">
            <input type="text" value={d.serial} onChange={set('serial')} />
          </Field>
          <Field label="Axis no. (on the tool)">
            <input type="text" value={d.axisNo} onChange={set('axisNo')} />
          </Field>
          <Field label="Calibration">
            <select value={d.calibration} onChange={set('calibration')}>
              <option value="">—</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </Field>
          <Field label="Calibrated on">
            <input type="date" value={d.calibratedAt} onChange={set('calibratedAt')} />
          </Field>
          <Field label="Last service / test & tag">
            <input type="date" value={d.lastTestAt} onChange={set('lastTestAt')} />
          </Field>
          <Field label="Tested by / note">
            <input type="text" value={d.lastTestNote} onChange={set('lastTestNote')} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={d.notes} onChange={set('notes')} rows={2} />
        </Field>
        <div className="row row--end">
          <button className="btn btn--ghost btn--sm" type="button" onClick={onDone}>
            Cancel
          </button>
          <button
            className="btn btn--sm"
            type="button"
            disabled={!d.type.trim()}
            onClick={async () => {
              await updatePlantItem(item.id, {
                type: d.type.trim(),
                brandModel: d.brandModel.trim(),
                serial: d.serial.trim(),
                axisNo: d.axisNo.trim() || undefined,
                calibration: d.calibration || undefined,
                calibratedAt: d.calibratedAt || undefined,
                lastTestAt: d.lastTestAt || undefined,
                lastTestNote: d.lastTestNote.trim() || undefined,
                notes: d.notes.trim() || undefined,
              })
              onDone()
            }}
          >
            Save details
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- scan */

interface StocktakeLine {
  code: string
  text: string
  tone: 'ok' | 'info' | 'warn'
}

function ScanSheet({
  initialMode,
  states,
  onClose,
  onFound,
  onUnknown,
}: {
  initialMode: 'single' | 'stocktake'
  states: StateCode[]
  onClose: () => void
  onFound: (item: PlantItem) => void
  onUnknown: (plantNo: string) => void
}) {
  const settings = useSettings()
  const [mode, setMode] = useState<'single' | 'stocktake'>(initialMode)
  const [message, setMessage] = useState('')
  const [lines, setLines] = useState<StocktakeLine[]>([])
  const [paused, setPaused] = useState(false)
  const [depotId, setDepotId] = useState<string>('')
  const seen = useRef(new Set<string>())
  const fixRef = useRef<Sighting | null>(null)
  const last = useRef({ code: '', at: 0 })
  const depots = useDepots(states.length === 1 ? states[0] : 'all')

  const getFix = async (): Promise<Sighting | null> => {
    // One fix serves a run of scans in the same spot.
    if (fixRef.current && Date.now() - fixRef.current.at < 60000) return { ...fixRef.current, at: Date.now() }
    const pos = await currentPosition(12000, 0)
    fixRef.current = pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() } : null
    return fixRef.current
  }

  const onCode = async (text: string) => {
    const t = Date.now()
    if (text === last.current.code && t - last.current.at < 2500) return
    last.current = { code: text, at: t }
    const plantNo = plantNoFromCode(text)
    if (!plantNo) {
      setMessage(`That code is not a plant label: “${text.slice(0, 60)}”`)
      return
    }
    const item = await findPlantByNo(plantNo, states)
    if (mode === 'single') {
      if (item) onFound(item)
      else onUnknown(plantNo)
      return
    }
    if (seen.current.has(plantNo)) return
    seen.current.add(plantNo)
    if (!item) {
      setLines((l) => [{ code: plantNo, text: `${plantNo} — not on the register`, tone: 'warn' }, ...l])
      return
    }
    setPaused(true)
    try {
      const geo = await getFix()
      if (!geo) {
        setLines((l) => [{ code: plantNo, text: `${plantNo} ${item.type} — no location from the phone, not moved`, tone: 'warn' }, ...l])
        return
      }
      const r = await recordSighting(item.id, geo, { via: 'stocktake', by: settings.userName || undefined })
      if (!r) return
      if (r.placement.kind === 'depot') setDepotId(r.placement.depot.id)
      const where = r.placement.kind === 'unknown' ? 'away from the yard and known jobs' : `${PLANT_STATUS_LABEL[r.item.status]} · ${r.item.location}`
      setLines((l) => [{ code: plantNo, text: `${plantNo} ${item.type} — ${where}`, tone: r.placement.kind === 'unknown' ? 'warn' : 'ok' }, ...l])
    } finally {
      setPaused(false)
    }
  }

  // Stocktake at a yard: what the register says is here but was not scanned.
  const notScanned = useLive(
    async () => {
      if (mode !== 'stocktake' || !depotId) return [] as PlantItem[]
      const here = await db.plant.where('depotId').equals(depotId).toArray()
      return here.filter((i) => i.status === 'available' && !seen.current.has(i.plantNo.toUpperCase()))
    },
    [mode, depotId, lines.length],
    [] as PlantItem[],
  )
  const depot = depots.find((d) => d.id === depotId)

  return (
    <Sheet title={mode === 'stocktake' ? 'Stocktake' : 'Scan a plant label'} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 0 }}>
          <button className={`btn btn--sm ${mode === 'single' ? '' : 'btn--ghost'}`} type="button" onClick={() => setMode('single')}>
            Scan one
          </button>
          <button className={`btn btn--sm ${mode === 'stocktake' ? '' : 'btn--ghost'}`} type="button" onClick={() => setMode('stocktake')}>
            Stocktake
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {mode === 'single'
            ? 'Point the camera at the label. The item opens and where you are is recorded against it.'
            : 'Scan each item in turn — every one is recorded where you stand. At a yard, what the register says should be here but you have not scanned is listed below.'}
        </p>
        <QrScanner onCode={(t) => void onCode(t)} paused={paused} />
        {message ? <div className="banner banner--warn">{message}</div> : null}
        {mode === 'stocktake' ? (
          <>
            <span className="field-label">
              Scanned: {lines.filter((l) => l.tone === 'ok').length}
              {lines.some((l) => l.tone === 'warn') ? ` · ${lines.filter((l) => l.tone === 'warn').length} to check` : ''}
            </span>
            <ul className="stocklist">
              {lines.map((l) => (
                <li key={l.code} className={l.tone === 'warn' ? 'is-warn' : ''}>
                  {l.text}
                </li>
              ))}
            </ul>
            {depot && notScanned.length ? (
              <div className="banner banner--info">
                <span style={{ flex: 1 }}>
                  {notScanned.length} item{notScanned.length === 1 ? '' : 's'} the register has at {depot.name} not scanned yet
                  {notScanned.length <= 6 ? `: ${notScanned.map((i) => `${i.plantNo} ${i.type}`).join(', ')}` : ''}.
                </span>
                <ConfirmButton
                  className="btn btn--ghost btn--sm"
                  label="Mark them missing"
                  confirmLabel={`Mark ${notScanned.length} missing?`}
                  onConfirm={async () => {
                    for (const i of notScanned) {
                      await movePlant(i.id, { status: 'missing', location: i.location, depotId: i.depotId, via: 'stocktake', by: settings.userName || undefined, note: `Not found in the ${depot.name} stocktake` })
                    }
                  }}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Sheet>
  )
}

/* ----------------------------------------------------------------- add */

function AddPlantSheet({
  scope,
  plantNo,
  depots,
  projects,
  types,
  onClose,
  onAdded,
}: {
  scope: StateCode | 'all'
  plantNo: string
  depots: Depot[]
  projects: Project[]
  types: string[]
  onClose: () => void
  onAdded: (item: PlantItem) => void
}) {
  const settings = useSettings()
  const fromLabel = /^([A-Z]{2,3})-\d+$/.exec(plantNo)?.[1] as StateCode | undefined
  const [state, setState] = useState<StateCode | ''>(scope !== 'all' ? scope : fromLabel && STATE_CODES.includes(fromLabel) ? fromLabel : settings.state ?? '')
  const [type, setType] = useState('')
  const [brandModel, setBrandModel] = useState('')
  const [serial, setSerial] = useState('')
  const [axisNo, setAxisNo] = useState('')
  const [lastTestAt, setLastTestAt] = useState('')
  const [calibration, setCalibration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const stateDepots = depots.filter((d) => d.state === state)
  const statesWithProjects = projects.filter((p) => p.state === state)

  const add = async () => {
    if (!state || !type.trim()) return
    setSaving(true)
    setError('')
    try {
      if (plantNo && (await findPlantByNo(plantNo, [state]))) throw new Error(`${plantNo} is already on the register.`)
      const depot = stateDepots[0]
      const item = await createPlantItem(
        {
          state,
          plantNo: plantNo || undefined,
          type: type.trim(),
          brandModel: brandModel.trim(),
          serial: serial.trim(),
          axisNo: axisNo.trim() || undefined,
          status: 'available',
          location: depot?.defaultArea ?? 'Yard',
          depotId: depot?.id,
          calibration: calibration || undefined,
          lastTestAt: lastTestAt || undefined,
          enteredAt: todayIso(),
          labelPrintedAt: plantNo ? Date.now() : undefined,
        },
        settings.userName || undefined,
      )
      onAdded(item)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the item.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet title={plantNo ? `Add ${plantNo}` : 'Add plant'} onClose={onClose}>
      <div className="stack">
        {scope === 'all' ? (
          <Field label="State">
            <select value={state} onChange={(e) => setState(e.target.value as StateCode)}>
              <option value="">Choose…</option>
              {STATE_CODES.map((s) => (
                <option key={s} value={s}>
                  {STATE_NAMES[s]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="field-grid">
          <Field label="Equipment type">
            <input type="text" list="plant-types" value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. Hammer Drill" autoFocus />
            <datalist id="plant-types">
              {types.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="Brand and model">
            <input type="text" value={brandModel} onChange={(e) => setBrandModel(e.target.value)} placeholder="e.g. Hilti TE 30" />
          </Field>
          <Field label="Serial #">
            <input type="text" value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Field>
          <Field label="Axis no. (on the tool)">
            <input type="text" value={axisNo} onChange={(e) => setAxisNo(e.target.value)} placeholder="e.g. AXP 181" />
          </Field>
          <Field label="Last service / test & tag">
            <input type="date" value={lastTestAt} onChange={(e) => setLastTestAt(e.target.value)} />
          </Field>
          <Field label="Needs calibration">
            <select value={calibration} onChange={(e) => setCalibration(e.target.value)}>
              <option value="">—</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {plantNo ? `It keeps the number on its label, ${plantNo}.` : 'It gets the next plant number for the state.'} It starts at{' '}
          {stateDepots[0]?.name ?? 'the yard'}; photograph it to record where it really is
          {statesWithProjects.length ? ', or move it to a job' : ''}.
        </p>
        {error ? <div className="banner banner--hold">{error}</div> : null}
        <div className="row row--end">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="button" disabled={!state || !type.trim() || saving} onClick={add}>
            Add to register
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/* -------------------------------------------------------------- import */

function ImportSheet({
  state,
  depots,
  projects,
  existing,
  onClose,
  onDone,
}: {
  state: StateCode
  depots: Depot[]
  projects: Project[]
  existing: number
  onClose: () => void
  onDone: (message: string) => void
}) {
  const settings = useSettings()
  const [parsed, setParsed] = useState<(ParsedRegister & { file: string }) | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const depot = depots.find((d) => d.state === state)
  const stateProjects = projects.filter((p) => p.state === state)

  const read = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setParsed(null)
    try {
      const reg = parsePlantRegister(await readRegisterFile(file))
      setParsed({ ...reg, file: file.name })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  const byStatus = useMemo(() => {
    const m = new Map<PlantStatus, number>()
    for (const r of parsed?.rows ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1)
    return m
  }, [parsed])

  const describe = (label: string): string => {
    const row = parsed?.rows.find((r) => (r.place === 'site' ? r.location : r.locationText || '(blank)') === label)
    if (!row) return ''
    if (row.place === 'depot') return `Available · ${row.location} at ${depot?.name ?? 'the yard'}`
    if (row.place === 'site') {
      const p = matchProject(row.location, stateProjects)
      return p ? `On site · project ${p.name}` : 'On site'
    }
    return PLANT_STATUS_LABEL[row.status]
  }

  return (
    <Sheet title={`Import plant register · ${state}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          The AXIMSRG-03 Plant & Equipment Register (Excel), or a CSV exported from here. Items already on the register are updated in place — matched on type,
          brand, serial and Axis no. — so importing a newer copy never duplicates them, and anything photographed or scanned since keeps the place that sighting
          gave it.
        </p>
        <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" aria-label="Plant register file" onChange={(e) => read(e.target.files?.[0])} />
        {error ? <div className="banner banner--hold">{error}</div> : null}
        {parsed ? (
          <>
            <div className="banner banner--info">
              <span>
                {parsed.rows.length} items read from “{parsed.sheet}” —{' '}
                {PLANT_STATUSES.filter((s) => byStatus.get(s))
                  .map((s) => `${byStatus.get(s)} ${PLANT_STATUS_LABEL[s].toLowerCase()}`)
                  .join(', ')}
                .{existing ? ` ${existing} already on the ${state} register.` : ''}
              </span>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Location on the register</th>
                  <th style={{ textAlign: 'right' }}>Items</th>
                  <th>Becomes</th>
                </tr>
              </thead>
              <tbody>
                {parsed.locations.map(([label, n]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td style={{ textAlign: 'right' }}>{n}</td>
                    <td>{describe(label)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row row--end">
              <button className="btn btn--ghost" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await importPlantRows(state, parsed.rows, settings.userName || undefined)
                    onDone(
                      [`${r.added} added`, r.updated ? `${r.updated} updated` : '', r.keptPlace ? `${r.keptPlace} kept where they were last seen` : ''].filter(Boolean).join(' · '),
                    )
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Import failed.')
                    setBusy(false)
                  }
                }}
              >
                {busy ? 'Importing…' : `Import ${parsed.rows.length} items`}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}

/* -------------------------------------------------------------- labels */

function LabelsSheet({
  items,
  all,
  filterLabel,
  entity,
  onClose,
  onDone,
}: {
  items: PlantItem[]
  all: PlantItem[]
  filterLabel: string
  entity: (s: StateCode) => string
  onClose: () => void
  onDone: (m: string) => void
}) {
  const unlabelled = all.filter((i) => i.status !== 'disposed' && !i.labelPrintedAt)
  const [which, setWhich] = useState<'unlabelled' | 'filtered'>(unlabelled.length ? 'unlabelled' : 'filtered')
  const [skip, setSkip] = useState(0)
  const [outlines, setOutlines] = useState(false)
  const chosen = which === 'unlabelled' ? unlabelled : items
  const sheets = Math.ceil((chosen.length + skip) / 21)

  return (
    <Sheet title="QR labels" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          A4 sheets of 21 labels, 63.5 × 38.1 mm — Avery L7160 / J8160 or any 3 × 7 sheet. Each carries the plant number, the item and a QR code any phone
          camera opens. Print at 100% (“actual size”), not “fit to page”.
        </p>
        <Field label="Labels for">
          <select value={which} onChange={(e) => setWhich(e.target.value as 'unlabelled' | 'filtered')}>
            <option value="unlabelled">Items with no label printed yet ({unlabelled.length})</option>
            <option value="filtered">
              The list as filtered — {filterLabel} ({items.length})
            </option>
          </select>
        </Field>
        <div className="field-grid">
          <Field label="Skip labels already used" hint="On a part-used sheet, start after these.">
            <input type="number" min={0} max={20} value={skip} onChange={(e) => setSkip(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
          </Field>
          <label className="check" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} />
            Draw label outlines (plain paper)
          </label>
        </div>
        <div className="row row--end">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            disabled={!chosen.length}
            onClick={async () => {
              const byState = new Map<StateCode, number>()
              for (const i of chosen) byState.set(i.state, (byState.get(i.state) ?? 0) + 1)
              const main = [...byState].sort((a, b) => b[1] - a[1])[0]?.[0]
              const blob = plantLabelsPdf(chosen, { entity: main ? entity(main) : 'Axis', skip, outlines })
              downloadBlob(blob, `Plant labels ${todayIso()}.pdf`)
              const t = Date.now()
              await db.transaction('rw', db.plant, async () => {
                for (const i of chosen) await db.plant.update(i.id, { labelPrintedAt: t, updatedAt: t })
              })
              onDone(`${chosen.length} labels on ${sheets} sheet${sheets === 1 ? '' : 's'}`)
              onClose()
            }}
          >
            <IconDownload />
            {chosen.length} labels · {sheets} sheet{sheets === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/* -------------------------------------------------------------- depots */

function DepotsSheet({ scope, depots, onClose, onToast }: { scope: StateCode | 'all'; depots: Depot[]; onClose: () => void; onToast: (m: string) => void }) {
  const [adding, setAdding] = useState(false)
  return (
    <Sheet title="Yards & offices" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          An item photographed or scanned within the distance of one of these is back at the yard and available. Anywhere else, it is on the job whose records
          are nearest (within {600} m), or you are asked which job.
        </p>
        {depots.map((d) => (
          <DepotCard key={d.id} depot={d} onToast={onToast} />
        ))}
        {depots.length === 0 ? <Empty title="No yards or offices yet" /> : null}
        {adding ? (
          <DepotCard
            depot={{ id: '', state: scope === 'all' ? 'NSW' : scope, name: '', address: '', radius: 200, defaultArea: 'Yard', createdAt: 0, updatedAt: 0 }}
            chooseState={scope === 'all'}
            onToast={onToast}
            onSaved={() => setAdding(false)}
          />
        ) : (
          <button className="btn btn--ghost" type="button" onClick={() => setAdding(true)}>
            <IconPlus />
            Add a yard or office
          </button>
        )}
      </div>
    </Sheet>
  )
}

function DepotCard({ depot, chooseState, onToast, onSaved }: { depot: Depot; chooseState?: boolean; onToast: (m: string) => void; onSaved?: () => void }) {
  const [d, setD] = useState(depot)
  const [busy, setBusy] = useState('')
  useEffect(() => setD(depot), [depot])
  const isNew = !depot.id
  const dirty = isNew || d.name !== depot.name || d.address !== depot.address || d.radius !== depot.radius || d.defaultArea !== depot.defaultArea || d.state !== depot.state

  const save = async (patch: Partial<Depot> = {}) => {
    const next = { ...d, ...patch }
    if (!next.name.trim()) return
    if (isNew) {
      await createDepot({ state: next.state, name: next.name.trim(), address: next.address.trim(), radius: next.radius, defaultArea: next.defaultArea, lat: next.lat, lng: next.lng, source: next.source })
      onSaved?.()
    } else {
      await updateDepot(depot.id, { ...patch, name: next.name.trim(), address: next.address.trim(), radius: next.radius, defaultArea: next.defaultArea, state: next.state })
    }
  }

  const findAddress = async () => {
    setBusy('Looking up…')
    const hit = await geocodeAddress(d.address)
    setBusy('')
    if (!hit) return onToast('Address not found — check it, or stand there and use your location')
    setD({ ...d, ...hit, source: 'address' })
    if (!isNew) await updateDepot(depot.id, { lat: hit.lat, lng: hit.lng, source: 'address' })
    onToast(`Found: ${formatCoords(hit.lat, hit.lng)}`)
  }
  const here = async () => {
    setBusy('Locating…')
    const pos = await currentPosition(12000, 0)
    setBusy('')
    if (!pos) return onToast('Location unavailable')
    const patch = { lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'device' as const }
    setD({ ...d, ...patch })
    if (!isNew) await updateDepot(depot.id, patch)
    onToast(`Set to where you are (±${Math.round(pos.coords.accuracy)} m)`)
  }

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card__body stack">
        <div className="field-grid">
          <Field label="Name">
            <input type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Beverley office & yard" />
          </Field>
          {chooseState ? (
            <Field label="State">
              <select value={d.state} onChange={(e) => setD({ ...d, state: e.target.value as StateCode })}>
                {STATE_CODES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Address">
            <input type="text" value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} />
          </Field>
          <Field label="Counts as here within (m)">
            <input type="number" min={50} max={5000} step={50} value={d.radius} onChange={(e) => setD({ ...d, radius: Math.max(50, Number(e.target.value) || 200) })} />
          </Field>
          <Field label="Items checked in here are at">
            <input type="text" value={d.defaultArea ?? ''} onChange={(e) => setD({ ...d, defaultArea: e.target.value })} placeholder="Yard" />
          </Field>
        </div>
        <p className="small" style={{ margin: 0 }}>
          {d.lat !== undefined && d.lng !== undefined ? (
            <>
              <span className="mono">{formatCoords(d.lat, d.lng)}</span> —{' '}
              {d.source === 'seed'
                ? `suburb only, matched within ${depotReach(d) / 1000} km until set`
                : d.source === 'address'
                  ? 'from the address'
                  : d.source === 'device'
                    ? 'set on site'
                    : 'set by hand'}{' '}
              ·{' '}
              <a href={mapsUrl(d.lat, d.lng)} target="_blank" rel="noreferrer">
                Open in maps
              </a>
            </>
          ) : (
            <span className="muted">No position yet.</span>
          )}
        </p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn--ghost btn--sm" type="button" disabled={Boolean(busy) || !d.address.trim()} onClick={findAddress}>
            {busy === 'Looking up…' ? busy : 'Find address'}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" disabled={Boolean(busy)} onClick={here}>
            {busy === 'Locating…' ? busy : "I'm here — use my location"}
          </button>
          <span className="spacer" />
          {!isNew ? (
            <ConfirmButton
              className="btn btn--ghost btn--sm"
              label="Remove"
              confirmLabel="Tap again to remove"
              onConfirm={async () => {
                await deleteDepot(depot.id)
                onToast(`${depot.name} removed`)
              }}
            />
          ) : null}
          <button className="btn btn--sm" type="button" disabled={!dirty || !d.name.trim()} onClick={() => save()}>
            {isNew ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const IconQr = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2h-2" />
  </svg>
)
