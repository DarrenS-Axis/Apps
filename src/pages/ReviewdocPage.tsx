import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createDefect, db, deleteDefect, updateDefect } from '../data/db'
import { useBusinessUnit, useDefect, useDefects, useDrawings, useLive, useProject, useRecordPhotos, useSettings } from '../data/store'
import { PhotoCaptureButtons, PhotoGrid, PhotoViewer } from '../components/PhotoCapture'
import { PlanViewer } from '../components/PlanViewer'
import { ConfirmButton, Empty, Field, IconCheck, IconPdf, IconPlus, IconTrash, Sheet, Toast, useToast } from '../components/ui'
import { DEFECT_STATUS_LABEL, SERVICE_TYPES, type Defect, type DefectStatus, type Photo, type ServiceType } from '../data/types'
import { downloadBlob, formatDateTime, slug } from '../lib/format'
import { exportQaReportPdf } from '../lib/pdf'
import { aud, reviewdocTotals } from '../lib/reporting'
import { raiseEvent } from '../sync'

const STATUS_CLASS: Record<DefectStatus, string> = { open: 'chip--hold', rectified: 'chip--warn', closed: 'chip--ok' }

/**
 * Reviewdoc for one project: defects found at QA review, each located on a
 * plan, costed and photographed, and the report that goes to the head
 * contractor.
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
  const [openId, setOpenId] = useState<string | null>(null)
  const [raising, setRaising] = useState(false)
  const [exporting, setExporting] = useState(false)

  const totals = useMemo(() => reviewdocTotals(defects), [defects])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return defects
      .filter((d) => (!status || d.status === status) && (!q || [d.number, d.service, d.description, d.locationPath].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => b.raisedAt - a.raisedAt)
  }, [defects, query, status])

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

  if (!project) return <Empty title="Project not found" />

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

      <div className="searchbar">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search defects" />
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        {(['open', 'rectified', 'closed', ''] as (DefectStatus | '')[]).map((s) => (
          <button key={s || 'all'} className={`btn btn--sm ${status === s ? '' : 'btn--ghost'}`} type="button" onClick={() => setStatus(s)}>
            {s ? DEFECT_STATUS_LABEL[s] : 'All'} ({s ? defects.filter((d) => d.status === s).length : defects.length})
          </button>
        ))}
      </div>

      <div className="card card__body--flush">
        {defects.length === 0 ? (
          <Empty title="No defects raised" hint="Raise one from a QA walk: locate it on the plan, describe it, cost it, photograph it." />
        ) : filtered.length === 0 ? (
          <Empty title="Nothing here" />
        ) : (
          filtered.map((d) => <DefectRow key={d.id} defect={d} onOpen={() => setOpenId(d.id)} />)
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

function DefectRow({ defect, onOpen }: { defect: Defect; onOpen: () => void }) {
  const photo = useLive(() => db.photos.where('defectId').equals(defect.id).first(), [defect.id], undefined)
  return (
    <button className="listitem" type="button" onClick={onOpen}>
      <span className="listitem__num" style={{ fontSize: 11 }}>
        {defect.number}
      </span>
      <span className="listitem__main">
        <strong>
          {defect.service}: {defect.description}
        </strong>
        <span>{[defect.locationPath, defect.locRef].filter(Boolean).join(' · ') || 'Not located'}</span>
        <span className="row" style={{ marginTop: 6, gap: 6 }}>
          <span className={`chip ${STATUS_CLASS[defect.status]}`}>{DEFECT_STATUS_LABEL[defect.status]}</span>
          {defect.cost ? <span className="chip">{aud(defect.cost)}</span> : null}
          {defect.drawingId ? <span className="chip chip--surv">On plan</span> : null}
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
  const [drawingId, setDrawingId] = useState(drawings[0]?.id ?? '')
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [service, setService] = useState<ServiceType>('Fire Rating')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const drawing = drawings.find((d) => d.id === (drawingId || drawings[0]?.id))

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
      assignedTo: assignedTo || undefined,
    })
    await raiseEvent({
      event: 'defect.raised',
      projectId,
      record: { number: d.number, service, description: d.description, cost: d.cost },
      summary: `Defect ${d.number} raised — ${service}: ${d.description}${d.cost ? ` (${aud(d.cost)})` : ''}`,
    })
    onRaised(d.id)
  }

  return (
    <Sheet title="Raise defect" onClose={onClose}>
      <div className="stack">
        {drawings.length ? (
          <>
            <Field label="Plan" hint="Tap the plan where the defect is.">
              <select value={drawing?.id ?? ''} onChange={(e) => { setDrawingId(e.target.value); setPos(null) }}>
                {drawings.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number} — {d.title}
                  </option>
                ))}
              </select>
            </Field>
            {drawing ? (
              <PlanViewer
                drawing={drawing}
                pins={pos ? [{ id: 'new', drawingId: drawing.id, x: pos.x, y: pos.y, label: '1', createdAt: 0 }] : []}
                mode="pin"
                onDropPin={(x, y) => setPos({ x, y })}
                height={300}
              />
            ) : null}
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            No plans loaded on this project yet — the defect can be located later.
          </p>
        )}
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
          <textarea autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="High top installed incorrectly. High top extension pieces required; pipe cannot be used to extend the high top." />
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
      await raiseEvent({ event: 'defect.closed', projectId: defect.projectId, record: { number: defect.number, service: defect.service }, summary: `Defect ${defect.number} closed` })
    }
    onToast(`${defect.number}: ${DEFECT_STATUS_LABEL[status]}`)
  }

  return (
    <Sheet title={`Defect ${defect.number}`} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <span className={`chip ${STATUS_CLASS[defect.status]}`}>{DEFECT_STATUS_LABEL[defect.status]}</span>
          <span className="chip">{defect.service}</span>
          {defect.cost ? <span className="chip">{aud(defect.cost)}</span> : null}
        </div>
        {drawing && defect.x !== undefined && defect.y !== undefined ? (
          <PlanViewer drawing={drawing} pins={[{ id: defect.id, drawingId: drawing.id, x: defect.x, y: defect.y, label: '1', createdAt: defect.createdAt }]} height={240} />
        ) : null}
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
        <div className="field-grid">
          <Field label="Location">
            <input type="text" value={defect.locationPath ?? ''} onChange={(e) => void patch({ locationPath: e.target.value })} />
          </Field>
          <Field label="Assigned to">
            <input type="text" value={defect.assignedTo ?? ''} onChange={(e) => void patch({ assignedTo: e.target.value })} />
          </Field>
        </div>
        <div>
          <span className="field-label">Photos ({photos.length})</span>
          <PhotoCaptureButtons
            settings={settings}
            target={{ defectId: defect.id, projectId: defect.projectId, contextLines: [`Reviewdoc ${defect.number} · ${defect.service}`] }}
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
        <div className="row">
          <span className="spacer" />
          <ConfirmButton
            label={
              <>
                <IconTrash />
                Delete defect
              </>
            }
            confirmLabel="Delete for good"
            onConfirm={async () => {
              await deleteDefect(defect.id)
              onClose()
            }}
          />
        </div>
      </div>
      {viewing ? <PhotoViewer photo={viewing} onClose={() => setViewing(null)} onChanged={() => undefined} onDeleted={() => setViewing(null)} /> : null}
    </Sheet>
  )
}
