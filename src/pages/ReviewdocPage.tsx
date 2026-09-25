import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useFetchIfMissing } from '../components/useFetchIfMissing'
import { createDefect, db, deleteDefect, updateDefect } from '../data/db'
import { useBusinessUnit, useDefect, useDefects, useDrawings, useLive, useProject, useRecordPhotos, useSettings } from '../data/store'
import { PhotoCaptureButtons, PhotoGrid, PhotoViewer } from '../components/PhotoCapture'
import { PlanViewer } from '../components/PlanViewer'
import { LocationLine, PlanImporter, useDeviceLocation, type Geo } from '../components/Locate'
import { RecordFooter } from '../components/RecordFooter'
import { Empty, Field, IconCheck, IconPdf, IconPin, IconPlus, Sheet, Toast, useToast } from '../components/ui'
import { DEFECT_STATUS_LABEL, SERVICE_TYPES, type Defect, type DefectStatus, type Drawing, type Photo, type ServiceType } from '../data/types'
import { downloadBlob, formatDateTime, slug } from '../lib/format'
import { currentPosition } from '../lib/images'
import { exportQaReportPdf } from '../lib/pdf'
import { aud, reviewdocTotals } from '../lib/reporting'
import { raiseEvent } from '../sync'

const STATUS_CLASS: Record<DefectStatus, string> = { open: 'chip--hold', rectified: 'chip--warn', closed: 'chip--ok' }


/**
 * Reviewdoc for one project: defects found at QA review, each pinned on a
 * plan and located by the device, costed and photographed, and the report
 * that goes to the head contractor.
 */
export function ReviewdocPage() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const unit = useBusinessUnit(project?.businessUnitId)
  const defects = useDefects(projectId)
  const drawings = useDrawings(projectId)
  const [toast, showToast] = useToast()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<DefectStatus | ''>('open')
  // A link from a notification opens the record: …?open=<id>.
  const [search] = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(() => search.get('open'))
  const [raising, setRaising] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<'list' | 'plan'>('list')
  const [planId, setPlanId] = useState('')

  const totals = useMemo(() => reviewdocTotals(defects), [defects])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return defects
      .filter((d) => (!status || d.status === status) && (!q || [d.number, d.service, d.description, d.locationPath, d.assignedTo].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => b.raisedAt - a.raisedAt)
  }, [defects, query, status])

  const pinnedDrawings = useMemo(() => {
    const ids = new Set(defects.map((d) => d.drawingId).filter(Boolean))
    return drawings.filter((d) => ids.has(d.id))
  }, [defects, drawings])
  const activePlan = drawings.find((d) => d.id === (planId || pinnedDrawings[0]?.id))

  const exportReport = async () => {
    if (!project) return
    setExporting(true)
    try {
      const list = status ? defects.filter((d) => d.status === status) : defects
      const photos = await db.photos.where('defectId').anyOf(list.map((d) => d.id)).toArray()
      const blob = await exportQaReportPdf({ project, unit: unit ?? undefined, defects: [...list].sort((a, b) => a.number.localeCompare(b.number)), drawings, photos, to: project.client })
      downloadBlob(blob, `${slug(project.name)}-QA-list-${new Date().toISOString().slice(0, 10)}.pdf`)
      showToast('QA report downloaded')
    } finally {
      setExporting(false)
    }
  }

  const fetching = useFetchIfMissing(!project)
  if (!project) return fetching ? <Empty title="Fetching from SharePoint…" /> : <Empty title="Project not found" />

  return (
    <>
      <div className="section-title">
        <h2>Reviewdoc</h2>
        <span>
          {totals.qty} defects · {aud(totals.value)}
        </span>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => void exportReport()} disabled={exporting || defects.length === 0}>
          <IconPdf />
          QA report
        </button>
        <button className="btn btn--sm" type="button" onClick={() => setRaising(true)}>
          <IconPlus />
          Raise
        </button>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {(['open', 'rectified', 'closed', ''] as (DefectStatus | '')[]).map((s) => (
          <button key={s || 'all'} className={`btn btn--sm ${status === s ? '' : 'btn--ghost'}`} type="button" onClick={() => setStatus(s)}>
            {s ? DEFECT_STATUS_LABEL[s].replace(' — awaiting review', '') : 'All'} ({s ? defects.filter((d) => d.status === s).length : defects.length})
          </button>
        ))}
        <span className="spacer" />
        <div className="row" style={{ gap: 0 }}>
          <button className={`btn btn--sm ${view === 'list' ? '' : 'btn--ghost'}`} type="button" onClick={() => setView('list')}>
            List
          </button>
          <button className={`btn btn--sm ${view === 'plan' ? '' : 'btn--ghost'}`} type="button" onClick={() => setView('plan')} disabled={pinnedDrawings.length === 0}>
            Plan
          </button>
        </div>
      </div>

      {view === 'plan' && activePlan ? (
        <div className="card">
          <div className="card__body">
            {pinnedDrawings.length > 1 ? (
              <select value={activePlan.id} onChange={(e) => setPlanId(e.target.value)} style={{ marginBottom: 10 }}>
                {pinnedDrawings.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number} — {d.title}
                  </option>
                ))}
              </select>
            ) : null}
            <PlanViewer
              drawing={activePlan}
              pins={filtered
                .filter((d) => d.drawingId === activePlan.id && d.x !== undefined && d.y !== undefined)
                .map((d) => ({ id: d.id, drawingId: activePlan.id, x: d.x!, y: d.y!, label: d.number.replace(/^0+/, '') || d.number, note: `${d.service}: ${d.description}`, createdAt: d.createdAt }))}
              onSelectPin={(pin) => setOpenId(pin.id)}
              selectedPinId={openId ?? undefined}
              height={480}
            />
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              {filtered.filter((d) => d.drawingId === activePlan.id).length} of the defects shown are on this sheet. Tap a pin to open it.
            </p>
          </div>
        </div>
      ) : null}

      <div className="searchbar">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search defects" />
      </div>

      <div className="card card__body--flush">
        {defects.length === 0 ? (
          <Empty title="No defects raised" hint="Raise one from a QA walk: pick or import the plan, tap where the defect is, describe it, cost it, photograph it. The device records where it was." />
        ) : filtered.length === 0 ? (
          <Empty title="Nothing here" />
        ) : (
          filtered.map((d) => <DefectRow key={d.id} defect={d} drawings={drawings} onOpen={() => setOpenId(d.id)} />)
        )}
      </div>

      {openId ? <DefectSheet id={openId} onClose={() => setOpenId(null)} onToast={showToast} /> : null}
      {raising && projectId ? (
        <RaiseSheet
          projectId={projectId}
          onClose={() => setRaising(false)}
          onRaised={(id) => {
            setRaising(false)
            setOpenId(id)
            showToast('Defect raised')
          }}
        />
      ) : null}
      <Toast message={toast} />
    </>
  )
}

function DefectRow({ defect, drawings, onOpen }: { defect: Defect; drawings: Drawing[]; onOpen: () => void }) {
  const photo = useLive(() => db.photos.where('defectId').equals(defect.id).first(), [defect.id], undefined)
  const plan = drawings.find((d) => d.id === defect.drawingId)
  return (
    <button className="listitem" type="button" onClick={onOpen}>
      <span className="listitem__num" style={{ fontSize: 11 }}>
        {defect.number}
      </span>
      <span className="listitem__main">
        <strong>
          {defect.service}: {defect.description}
        </strong>
        <span>{[plan ? `${plan.number} ${plan.revision}`.trim() : defect.locationPath, defect.locRef].filter(Boolean).join(' · ') || 'Not located on a plan'}</span>
        <span className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
          <span className={`chip ${STATUS_CLASS[defect.status]}`}>{DEFECT_STATUS_LABEL[defect.status].replace(' — awaiting review', '')}</span>
          {defect.cost ? <span className="chip">{aud(defect.cost)}</span> : null}
          {defect.drawingId && defect.x !== undefined ? <span className="chip chip--surv">Pinned</span> : null}
          {defect.lat !== undefined ? <span className="chip chip--ok">GPS</span> : null}
          {defect.assignedTo ? <span className="chip chip--accent">→ {defect.assignedTo}</span> : null}
        </span>
      </span>
      {photo ? <img src={photo.thumb} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} /> : null}
    </button>
  )
}

/* -------------------------------------------------------------- raise */

function RaiseSheet({ projectId, onClose, onRaised }: { projectId: string; onClose: () => void; onRaised: (id: string) => void }) {
  const drawings = useDrawings(projectId)
  const settings = useSettings()
  const [drawingId, setDrawingId] = useState('')
  const [importing, setImporting] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [service, setService] = useState<ServiceType>('Fire Rating')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const location = useDeviceLocation(settings.captureGps)
  const drawing = drawings.find((d) => d.id === drawingId) ?? (drawingId === 'none' ? undefined : drawings[0])

  const submit = async () => {
    const d = await createDefect({
      projectId,
      drawingId: drawing?.id,
      x: pos?.x,
      y: pos?.y,
      locationPath: drawing ? `Reviewdoc > ${drawing.number} ${drawing.title}`.trim() : undefined,
      service,
      description: description.trim(),
      cost: cost ? Number(cost) : undefined,
      raisedBy: settings.userName,
      assignedTo: assignedTo.trim() || undefined,
      ...(assignedTo.trim() ? { assignedAt: Date.now(), assignedBy: settings.userName || undefined } : {}),
      lat: location.geo?.lat,
      lng: location.geo?.lng,
      accuracy: location.geo?.accuracy,
      locatedAt: location.geo?.locatedAt,
    })
    await raiseEvent({
      event: 'defect.raised',
      projectId,
      link: `/project/${projectId}/reviewdoc?open=${d.id}`,
      record: { number: d.number, service, description: d.description, cost: d.cost, lat: d.lat, lng: d.lng, drawing: drawing?.number },
      summary: `Defect ${d.number} raised — ${service}: ${d.description}${d.cost ? ` (${aud(d.cost)})` : ''}`,
    })
    onRaised(d.id)
  }

  return (
    <Sheet title="Raise defect" onClose={onClose}>
      <div className="stack">
        <div>
          <span className="field-label">Plan</span>
          <div className="row" style={{ gap: 8 }}>
            <select
              value={drawing?.id ?? 'none'}
              onChange={(e) => {
                setDrawingId(e.target.value)
                setPos(null)
              }}
              style={{ flex: 1 }}
              aria-label="Plan"
            >
              {drawings.length === 0 ? <option value="none">No plans on this project yet</option> : <option value="none">Not on a plan</option>}
              {drawings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.number} — {d.title}
                </option>
              ))}
            </select>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setImporting(true)} style={{ flex: 'none' }}>
              Import plan
            </button>
          </div>
        </div>
        {importing ? (
          <PlanImporter
            projectId={projectId}
            onCancel={() => setImporting(false)}
            onImported={(d) => {
              setImporting(false)
              setDrawingId(d.id)
              setPos(null)
            }}
          />
        ) : null}
        {drawing ? (
          <>
            <PlanViewer
              drawing={drawing}
              pins={pos ? [{ id: 'new', drawingId: drawing.id, x: pos.x, y: pos.y, label: '1', createdAt: 0 }] : []}
              mode="pin"
              onDropPin={(x, y) => setPos({ x, y })}
              height={300}
            />
            <span className="small muted">{pos ? 'Pinned. Tap again to move it.' : 'Tap the plan where the defect is. Pinch to zoom in first if it is fiddly.'}</span>
          </>
        ) : null}

        <div>
          <span className="field-label">Device location</span>
          <LocationLine geo={location.geo} state={location.state} onLocate={() => void location.locate()} onClear={location.clear} />
        </div>

        <div className="field-grid">
          <Field label="Service">
            <select value={service} onChange={(e) => setService(e.target.value as ServiceType)}>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estimated cost (AUD)">
            <input type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="500" />
          </Field>
        </div>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="High top installed incorrectly. High top extension pieces required; pipe cannot be used to extend the high top." />
        </Field>
        <Field label="Assigned to (crew / subcontractor)">
          <input type="text" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
        </Field>
        <div className="row row--end">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="button" disabled={!description.trim()} onClick={() => void submit()}>
            Raise defect
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------- detail */

function DefectSheet({ id, onClose, onToast }: { id: string; onClose: () => void; onToast: (m: string) => void }) {
  const defect = useDefect(id)
  const settings = useSettings()
  const photos = useRecordPhotos('defectId', id)
  const drawings = useDrawings(defect?.projectId)
  const [viewing, setViewing] = useState<Photo | null>(null)
  const [moving, setMoving] = useState(false)
  const [choosingPlan, setChoosingPlan] = useState(false)
  const [importing, setImporting] = useState(false)
  const [locating, setLocating] = useState(false)
  const project = useProject(defect?.projectId)
  if (!defect) return null
  const drawing = drawings.find((d) => d.id === defect.drawingId)
  const patch = (changes: Partial<Defect>) => updateDefect(defect.id, changes)

  const setStatus = async (status: DefectStatus) => {
    const changes: Partial<Defect> = { status }
    if (status === 'rectified') Object.assign(changes, { rectifiedAt: Date.now(), rectifiedBy: settings.userName })
    if (status === 'closed') Object.assign(changes, { closedAt: Date.now(), closedBy: settings.userName })
    if (status === 'open') Object.assign(changes, { rectifiedAt: undefined, closedAt: undefined })
    await patch(changes)
    if (status === 'closed') {
      await raiseEvent({ event: 'defect.closed', projectId: defect.projectId, link: `/project/${defect.projectId}/reviewdoc?open=${defect.id}`, record: { number: defect.number, service: defect.service }, summary: `Defect ${defect.number} closed` })
    }
    onToast(`${defect.number}: ${DEFECT_STATUS_LABEL[status]}`)
  }

  const relocate = async () => {
    setLocating(true)
    const pos = await currentPosition(12000)
    setLocating(false)
    if (!pos) {
      onToast('Location unavailable')
      return
    }
    await patch({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, locatedAt: Date.now() })
    onToast('Location updated')
  }

  const attachPlan = async (d: Drawing) => {
    await patch({ drawingId: d.id, x: undefined, y: undefined, locationPath: `Reviewdoc > ${d.number} ${d.title}`.trim() })
    setChoosingPlan(false)
    setImporting(false)
    setMoving(true)
  }

  const geo: Geo | null = defect.lat !== undefined && defect.lng !== undefined ? { lat: defect.lat, lng: defect.lng, accuracy: defect.accuracy, locatedAt: defect.locatedAt ?? defect.raisedAt } : null

  return (
    <Sheet
      title={`Defect ${defect.number}`}
      onClose={onClose}
      footer={
        <RecordFooter
          label={defect.number}
          describe={`Defect ${defect.number} — ${defect.service}: ${defect.description}${project ? ` (${project.name})` : ''}`}
          link={`/project/${defect.projectId}/reviewdoc?open=${defect.id}`}
          state={project?.state}
          updatedAt={defect.updatedAt}
          allocation={defect}
          deleteLabel="Delete defect"
          onDelete={async () => {
            await deleteDefect(defect.id)
            onToast(`Defect ${defect.number} deleted`)
            onClose()
          }}
          onSave={() => {
            onToast(`Defect ${defect.number} saved`)
            onClose()
          }}
          onAllocate={async (a) => {
            await patch(a ? { ...a, assignedAt: Date.now(), assignedBy: settings.userName || undefined } : { assignedTo: undefined, assignedEmail: undefined, assignedAt: undefined, assignedBy: undefined, assignNote: undefined, assignDue: undefined })
            if (a) {
              await raiseEvent({
                event: 'defect.allocated',
                projectId: defect.projectId,
                link: `/project/${defect.projectId}/reviewdoc?open=${defect.id}`,
                record: { number: defect.number, service: defect.service, description: defect.description, assignedTo: a.assignedTo, assignedEmail: a.assignedEmail, due: a.assignDue, note: a.assignNote },
                summary: `Defect ${defect.number} (${defect.service}) allocated to ${a.assignedTo}${a.assignDue ? `, due ${a.assignDue}` : ''}`,
              })
            }
            onToast(a ? `Defect ${defect.number} allocated to ${a.assignedTo}` : `Defect ${defect.number} taken back`)
          }}
        />
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className={`chip ${STATUS_CLASS[defect.status]}`}>{DEFECT_STATUS_LABEL[defect.status]}</span>
          <span className="chip">{defect.service}</span>
          {defect.cost ? <span className="chip">{aud(defect.cost)}</span> : null}
        </div>

        {/* Where on the plan */}
        <div>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="field-label" style={{ marginBottom: 0 }}>
              On the plan
            </span>
            <span className="spacer" />
            {drawing ? (
              <button className={`btn btn--sm ${moving ? '' : 'btn--ghost'}`} type="button" onClick={() => setMoving(!moving)}>
                <IconPin />
                {moving ? 'Tap the plan…' : defect.x !== undefined ? 'Move pin' : 'Drop pin'}
              </button>
            ) : null}
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setChoosingPlan(!choosingPlan)}>
              {drawing ? 'Change plan' : 'Choose plan'}
            </button>
          </div>
          {choosingPlan ? (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <select
                value={drawing?.id ?? ''}
                onChange={(e) => {
                  const d = drawings.find((x) => x.id === e.target.value)
                  if (d) void attachPlan(d)
                }}
                style={{ flex: 1 }}
                aria-label="Plan"
              >
                <option value="">Choose…</option>
                {drawings.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number} — {d.title}
                  </option>
                ))}
              </select>
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => setImporting(true)} style={{ flex: 'none' }}>
                Import plan
              </button>
            </div>
          ) : null}
          {importing ? <PlanImporter projectId={defect.projectId} onCancel={() => setImporting(false)} onImported={(d) => void attachPlan(d)} /> : null}
          {drawing ? (
            <div style={{ marginTop: 8 }}>
              <PlanViewer
                drawing={drawing}
                pins={defect.x !== undefined && defect.y !== undefined ? [{ id: defect.id, drawingId: drawing.id, x: defect.x, y: defect.y, label: defect.number.replace(/^0+/, '') || '1', createdAt: defect.createdAt }] : []}
                mode={moving ? 'pin' : 'view'}
                onDropPin={async (x, y) => {
                  await patch({ x, y })
                  setMoving(false)
                  onToast('Pin moved')
                }}
                height={260}
              />
              <span className="small muted">
                {drawing.number} {drawing.revision} — {drawing.title}
              </span>
            </div>
          ) : (
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              Not located on a plan.
            </p>
          )}
        </div>

        {/* Where on the earth */}
        <div>
          <span className="field-label">Device location</span>
          <LocationLine geo={geo} state={locating ? 'locating' : 'idle'} onLocate={() => void relocate()} onClear={geo ? () => void patch({ lat: undefined, lng: undefined, accuracy: undefined, locatedAt: undefined }) : undefined} />
        </div>

        <Field label="Description">
          <textarea value={defect.description} onChange={(e) => void patch({ description: e.target.value })} />
        </Field>
        <div className="field-grid">
          <Field label="Service">
            <select value={defect.service} onChange={(e) => void patch({ service: e.target.value as ServiceType })}>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estimated cost (AUD)">
            <input type="number" inputMode="decimal" value={defect.cost ?? ''} onChange={(e) => void patch({ cost: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
        </div>
        <Field label="Location note">
          <input type="text" value={defect.locationPath ?? ''} onChange={(e) => void patch({ locationPath: e.target.value })} placeholder="Level 4, grid C7, above ceiling" />
        </Field>
        <div>
          <span className="field-label">Photos ({photos.length})</span>
          <PhotoCaptureButtons
            settings={settings}
            target={{ defectId: defect.id, projectId: defect.projectId, contextLines: [`Reviewdoc ${defect.number} · ${defect.service}`, drawing ? `${drawing.number} ${drawing.revision}`.trim() : ''] }}
            defaultCategory="defect"
            onCaptured={() => onToast('Photo added')}
            onError={onToast}
          />
          {photos.length ? (
            <div style={{ marginTop: 10 }}>
              <PhotoGrid photos={photos} onOpen={setViewing} />
            </div>
          ) : null}
        </div>
        <div className="card">
          <div className="card__body stack">
            <span className="small muted">
              Raised {formatDateTime(defect.raisedAt)}
              {defect.raisedBy ? ` by ${defect.raisedBy}` : ''}
              {defect.rectifiedAt ? ` · rectified ${formatDateTime(defect.rectifiedAt)} by ${defect.rectifiedBy}` : ''}
              {defect.closedAt ? ` · closed ${formatDateTime(defect.closedAt)} by ${defect.closedBy}` : ''}
            </span>
            {defect.status === 'open' ? (
              <button className="btn" type="button" onClick={() => void setStatus('rectified')}>
                <IconCheck />
                Rectified — ready for review
              </button>
            ) : null}
            {defect.status === 'rectified' && settings.role !== 'site' ? (
              <div className="row">
                <button className="btn btn--ok" type="button" onClick={() => void setStatus('closed')}>
                  <IconCheck />
                  Close
                </button>
                <button className="btn btn--ghost" type="button" onClick={() => void setStatus('open')}>
                  Reopen
                </button>
              </div>
            ) : null}
            {defect.status === 'rectified' && settings.role === 'site' ? <span className="small muted">Awaiting QA review.</span> : null}
            {defect.status === 'closed' ? (
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => void setStatus('open')}>
                Reopen
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {viewing ? <PhotoViewer photo={viewing} onClose={() => setViewing(null)} onChanged={() => undefined} onDeleted={() => setViewing(null)} /> : null}
    </Sheet>
  )
}
