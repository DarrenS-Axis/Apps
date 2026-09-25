import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { createDrawing, createPenetration, db, deletePenetration, importPenetrations, updatePenetration } from '../data/db'
import { useDrawings, usePenetration, usePenetrations, useProject, useRecordPhotos, useSettings } from '../data/store'
import { PhotoCaptureButtons, PhotoGrid, PhotoViewer } from '../components/PhotoCapture'
import { PlanViewer } from '../components/PlanViewer'
import { LocationLine, PlanImporter, useDeviceLocation, type Geo } from '../components/Locate'
import { RecordFooter } from '../components/RecordFooter'
import { Empty, Field, IconCheck, IconPin, IconPlus, IconWarn, Sheet, Toast, useToast } from '../components/ui'
import { FIRE_ELEMENTS, FIRE_SIZES, fireProfile, matchProfiles, SCHEDULE_REVISION, type FireElement } from '../data/libraries/fireProfiles'
import { QA_STATUS_LABEL, QA_STATUSES, type Drawing, type Penetration, type Photo, type QaStatus } from '../data/types'
import { readingOrder, scanPenetrationPlan, tagKey, type ScannedPage, type ScanProgress } from '../lib/autopin'
import { formatDateTime } from '../lib/format'
import { currentPosition } from '../lib/images'
import { importPlanFile, guessDrawingDetails, type PlanPage } from '../lib/planImport'
import { readRegisterFile, type Sheet as RegisterSheet } from '../lib/xlsx'
import { firedocSummary } from '../lib/reporting'
import { raiseEvent } from '../sync'

const STATUS_CLASS: Record<QaStatus, string> = {
  setup: '',
  in_progress: 'chip--warn',
  completed_by_site: 'chip--ok',
  reviewed_approved: 'chip--accent',
  defected: 'chip--hold',
}

/* ------------------------------------------------------------ register */

/**
 * Firedoc for one project: the penetration register, the plans it is pinned
 * on, and the review workflow.
 */
export function FiredocPage() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const pens = usePenetrations(projectId)
  const drawings = useDrawings(projectId)
  const settings = useSettings()
  const [toast, showToast] = useToast()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<QaStatus | ''>('')
  const [kind, setKind] = useState<'' | 'floor' | 'wall'>('')
  // A link from a notification opens the record: …?open=<id>.
  const [search] = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(() => search.get('open'))
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [view, setView] = useState<'list' | 'plan'>('list')
  const [planId, setPlanId] = useState<string>('')
  const [autopinning, setAutopinning] = useState(false)

  const summary = useMemo(() => firedocSummary(pens), [pens])
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    return pens.filter(
      (p) =>
        (!status || p.status === status) &&
        (!kind || p.kind === kind) &&
        (!q || [p.number, p.ref, p.size, p.material, p.level, p.zone, p.profileId, p.assignedTo].join(' ').toUpperCase().includes(q)),
    )
  }, [pens, query, status, kind])

  const pinnedDrawings = useMemo(() => {
    const ids = new Set(pens.map((p) => p.drawingId).filter(Boolean))
    return drawings.filter((d) => ids.has(d.id))
  }, [pens, drawings])
  const activePlan = drawings.find((d) => d.id === (planId || pinnedDrawings[0]?.id))

  if (!project) return <Empty title="Project not found" />

  return (
    <>
      <div className="section-title">
        <h2>Firedoc</h2>
        <span>{pens.length} penetrations</span>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => setImporting(true)}>
          Import register
        </button>
        <button className="btn btn--sm" type="button" onClick={() => setAdding(true)}>
          <IconPlus />
          Add
        </button>
      </div>

      {/* The report's columns, live. */}
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <Stat value={summary.total} label="Setup" />
            <Stat value={summary.in_progress} label="In progress" />
            <Stat value={summary.completed_by_site} label="Completed by site" />
            <Stat value={summary.reviewed_approved} label="Reviewed & approved" />
            <Stat value={summary.defected} label="Defected" tone={summary.defected ? 'hold' : undefined} />
            <Stat value={summary.outstanding} label="Outstanding" />
          </div>
          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setAutopinning(true)}>
              Autopin from penetration plan (PDF)
            </button>
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
              pins={pens
                .filter((p) => p.drawingId === activePlan.id && p.x !== undefined && p.y !== undefined)
                .map((p) => ({ id: p.id, drawingId: activePlan.id, x: p.x!, y: p.y!, label: p.number, note: `${p.size} ${p.ref} · ${QA_STATUS_LABEL[p.status]}`, createdAt: p.createdAt }))}
              onSelectPin={(pin) => setOpenId(pin.id)}
              selectedPinId={openId ?? undefined}
              height={480}
            />
          </div>
        </div>
      ) : null}

      <div className="searchbar" style={{ marginTop: 12 }}>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search number, size, ref, material, profile, worker" />
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as QaStatus | '')} style={{ flex: 1 }}>
          <option value="">All statuses</option>
          {QA_STATUSES.map((s) => (
            <option key={s} value={s}>
              {QA_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as '' | 'floor' | 'wall')} style={{ flex: 1 }}>
          <option value="">Floor and wall</option>
          <option value="floor">Floor</option>
          <option value="wall">Wall</option>
        </select>
      </div>

      <div className="card card__body--flush">
        {pens.length === 0 ? (
          <Empty
            title="No penetrations yet"
            hint="Import the consultants' Autopin register (Excel or CSV), or add penetrations one at a time."
          />
        ) : filtered.length === 0 ? (
          <Empty title="Nothing matches" />
        ) : (
          filtered.map((p) => {
            const profile = fireProfile(p.profileId)
            return (
              <button key={p.id} className="listitem" type="button" onClick={() => setOpenId(p.id)}>
                <span className="listitem__num" style={{ fontSize: 11 }}>
                  {p.number}
                </span>
                <span className="listitem__main">
                  <strong>
                    {p.size} {p.ref} · {p.material} · {p.kind === 'wall' ? 'Wall' : 'Floor'}
                    {p.level ? ` · ${p.level}` : ''}
                  </strong>
                  <span>{profile ? profile.id : p.profileId ? p.profileId : 'No fire profile allocated'}</span>
                  <span className="row" style={{ marginTop: 6, gap: 6 }}>
                    <span className={`chip ${STATUS_CLASS[p.status]}`}>{QA_STATUS_LABEL[p.status]}</span>
                    {p.frl ? <span className="chip">FRL {p.frl}</span> : null}
                    {p.drawingId && p.x !== undefined ? <span className="chip chip--surv">{p.autoPinned ? 'Autopinned' : 'Pinned'}</span> : <span className="chip chip--warn">Not on a plan</span>}
                    {p.lat !== undefined ? <span className="chip chip--ok">GPS</span> : null}
                    {p.assignedTo ? <span className="chip chip--accent">→ {p.assignedTo}</span> : null}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>

      {openId ? <PenetrationSheet id={openId} onClose={() => setOpenId(null)} onToast={showToast} /> : null}
      {autopinning && projectId ? (
        <AutopinSheet
          projectId={projectId}
          onClose={() => setAutopinning(false)}
          onDone={(message, drawingId) => {
            setAutopinning(false)
            setPlanId(drawingId)
            setView('plan')
            showToast(message)
          }}
        />
      ) : null}
      {importing && projectId ? <ImportSheet projectId={projectId} onClose={() => setImporting(false)} onToast={showToast} /> : null}
      {adding && projectId ? (
        <AddSheet
          projectId={projectId}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false)
            setOpenId(id)
          }}
        />
      ) : null}
      <Toast message={toast} />
      <p className="small muted" style={{ marginTop: 14 }}>
        Profiles from the Axis Passive Fire Rating Schedule {SCHEDULE_REVISION}. Entered by {settings.userName || 'you'}.
      </p>
    </>
  )
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'hold' }) {
  return (
    <div style={{ minWidth: 86 }}>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone === 'hold' && value ? 'var(--hold)' : 'var(--ink)' }}>{value}</div>
      <div className="small muted">{label}</div>
    </div>
  )
}

/* -------------------------------------------------------------- detail */

function PenetrationSheet({ id, onClose, onToast }: { id: string; onClose: () => void; onToast: (m: string) => void }) {
  const pen = usePenetration(id)
  const settings = useSettings()
  const photos = useRecordPhotos('penetrationId', id)
  const [viewing, setViewing] = useState<Photo | null>(null)
  const [pickingProfile, setPickingProfile] = useState(false)
  const [defectNote, setDefectNote] = useState('')
  const drawings = useDrawings(pen?.projectId)
  const [moving, setMoving] = useState(false)
  const [choosingPlan, setChoosingPlan] = useState(false)
  const [importing, setImporting] = useState(false)
  const [locating, setLocating] = useState(false)
  const project = useProject(pen?.projectId)

  if (!pen) return null
  const profile = fireProfile(pen.profileId)
  const drawing = drawings.find((d) => d.id === pen.drawingId)
  const patch = (changes: Partial<Penetration>) => updatePenetration(pen.id, changes)

  const locate = async (quiet = false): Promise<Partial<Penetration> | null> => {
    setLocating(true)
    const pos = await currentPosition(12000)
    setLocating(false)
    if (!pos) {
      if (!quiet) onToast('Location unavailable')
      return null
    }
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, locatedAt: Date.now() }
  }

  const attachPlan = async (d: Drawing) => {
    // A hand-placed pin on a new sheet: the old position meant nothing here.
    await patch({ drawingId: d.id, x: undefined, y: undefined, autoPinned: false })
    setChoosingPlan(false)
    setImporting(false)
    setMoving(true)
  }

  const geo: Geo | null =
    pen.lat !== undefined && pen.lng !== undefined ? { lat: pen.lat, lng: pen.lng, accuracy: pen.accuracy, locatedAt: pen.locatedAt ?? pen.updatedAt } : null

  const setStatus = async (status: QaStatus) => {
    const changes: Partial<Penetration> = { status }
    if (status === 'completed_by_site') {
      Object.assign(changes, { installedBy: settings.userName, installedAt: Date.now() })
      // Signed where it was installed: record the spot if nothing has yet.
      if (pen.lat === undefined && settings.captureGps) Object.assign(changes, (await locate(true)) ?? {})
    }
    if (status === 'reviewed_approved') Object.assign(changes, { reviewedBy: settings.userName, reviewedAt: Date.now(), defect: undefined })
    if (status === 'defected') Object.assign(changes, { reviewedBy: settings.userName, reviewedAt: Date.now(), defect: defectNote })
    if (status === 'in_progress' && pen.status === 'defected') changes.rectifiedAt = Date.now()
    await patch(changes)
    if (status === 'completed_by_site' || status === 'defected') {
      await raiseEvent({
        event: status === 'defected' ? 'penetration.defected' : 'penetration.completed_by_site',
        projectId: pen.projectId,
        link: `/project/${pen.projectId}/firedoc?open=${pen.id}`,
        record: { number: pen.number, size: pen.size, ref: pen.ref, profile: pen.profileId, defect: defectNote || undefined },
        summary: `Penetration ${pen.number} ${QA_STATUS_LABEL[status].toLowerCase()}${defectNote ? ` — ${defectNote}` : ''}`,
      })
    }
    onToast(`${pen.number}: ${QA_STATUS_LABEL[status]}`)
  }

  return (
    <Sheet
      title={`Penetration ${pen.number}`}
      onClose={onClose}
      footer={
        <RecordFooter
          label={pen.number}
          describe={`Penetration ${pen.number} — ${[`${pen.size} ${pen.ref}`.trim(), pen.kind === 'wall' ? 'wall' : 'floor', pen.level, project?.name].filter(Boolean).join(', ')}`}
          link={`/project/${pen.projectId}/firedoc?open=${pen.id}`}
          state={project?.state}
          updatedAt={pen.updatedAt}
          allocation={pen}
          deleteLabel="Delete penetration"
          onDelete={async () => {
            await deletePenetration(pen.id)
            onToast(`${pen.number} deleted`)
            onClose()
          }}
          onSave={() => {
            onToast(`${pen.number} saved`)
            onClose()
          }}
          onAllocate={async (a) => {
            await patch(a ? { ...a, assignedAt: Date.now(), assignedBy: settings.userName || undefined } : { assignedTo: undefined, assignedEmail: undefined, assignedAt: undefined, assignedBy: undefined, assignNote: undefined, assignDue: undefined })
            if (a) {
              await raiseEvent({
                event: 'penetration.allocated',
                projectId: pen.projectId,
                link: `/project/${pen.projectId}/firedoc?open=${pen.id}`,
                record: { number: pen.number, size: pen.size, ref: pen.ref, level: pen.level, assignedTo: a.assignedTo, assignedEmail: a.assignedEmail, due: a.assignDue, note: a.assignNote },
                summary: `Penetration ${pen.number} allocated to ${a.assignedTo}${a.assignDue ? `, due ${a.assignDue}` : ''}`,
              })
            }
            onToast(a ? `${pen.number} allocated to ${a.assignedTo}` : `${pen.number} taken back`)
          }}
        />
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className={`chip ${STATUS_CLASS[pen.status]}`}>{QA_STATUS_LABEL[pen.status]}</span>
          <span className="chip">{pen.kind === 'wall' ? 'Wall' : 'Floor'}</span>
          {pen.frl ? <span className="chip">FRL {pen.frl}</span> : null}
          {pen.autoPinned ? <span className="chip chip--surv">Autopinned</span> : null}
        </div>

        {/* Where on the plan */}
        <div>
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <span className="field-label" style={{ marginBottom: 0 }}>
              On the plan
            </span>
            <span className="spacer" />
            {drawing ? (
              <button className={`btn btn--sm ${moving ? '' : 'btn--ghost'}`} type="button" onClick={() => setMoving(!moving)}>
                <IconPin />
                {moving ? 'Tap the plan…' : pen.x !== undefined ? 'Move pin' : 'Drop pin'}
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
          {importing ? <PlanImporter projectId={pen.projectId} onCancel={() => setImporting(false)} onImported={(d) => void attachPlan(d)} /> : null}
          {drawing ? (
            <div style={{ marginTop: 8 }}>
              <PlanViewer
                drawing={drawing}
                pins={pen.x !== undefined && pen.y !== undefined ? [{ id: pen.id, drawingId: drawing.id, x: pen.x, y: pen.y, label: pen.number, createdAt: pen.createdAt }] : []}
                mode={moving ? 'pin' : 'view'}
                onDropPin={async (x, y) => {
                  await patch({ x, y, autoPinned: false })
                  setMoving(false)
                  onToast('Pin moved')
                }}
                height={260}
              />
              <span className="small muted">
                {drawing.number} {drawing.revision} — {drawing.title}
                {pen.autoPinned ? ' · placed by Autopin' : ''}
              </span>
            </div>
          ) : (
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              Not located on a plan. Choose or import the penetration plan, then drop the pin — or run Autopin from the register.
            </p>
          )}
        </div>

        {/* Where on the earth */}
        <div>
          <span className="field-label">Device location</span>
          <LocationLine
            geo={geo}
            state={locating ? 'locating' : 'idle'}
            onLocate={async () => {
              const g = await locate()
              if (g) {
                await patch(g)
                onToast('Location updated')
              }
            }}
            onClear={geo ? () => void patch({ lat: undefined, lng: undefined, accuracy: undefined, locatedAt: undefined }) : undefined}
          />
        </div>

        <div className="field-grid">
          <Field label="Size">
            <input type="text" value={pen.size} onChange={(e) => void patch({ size: e.target.value, sizeMm: parseInt(e.target.value, 10) || undefined })} />
          </Field>
          <Field label="Reference (FW, SS, WC…)">
            <input type="text" value={pen.ref} onChange={(e) => void patch({ ref: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Material">
            <input type="text" value={pen.material} onChange={(e) => void patch({ material: e.target.value })} />
          </Field>
          <Field label="Building element">
            <input type="text" value={pen.elementMaterial} onChange={(e) => void patch({ elementMaterial: e.target.value })} placeholder="Floor slab, block wall, 128mm FR plasterboard" />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Level">
            <input type="text" value={pen.level ?? ''} onChange={(e) => void patch({ level: e.target.value })} />
          </Field>
          <Field label="Zone">
            <input type="text" value={pen.zone ?? ''} onChange={(e) => void patch({ zone: e.target.value })} />
          </Field>
        </div>

        <div className="card">
          <div className="card__body">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="field-label">Fire profile</span>
                {profile ? (
                  <>
                    <strong className="small">{profile.id}</strong>
                    <div className="small muted">
                      {profile.supplier} {profile.product} · {profile.treatment} · {profile.productFrl}
                    </div>
                    <div className="small muted">{FIRE_ELEMENTS[profile.element]}</div>
                    {profile.installationNotes ? <div className="small" style={{ marginTop: 6 }}>{profile.installationNotes}</div> : null}
                    {profile.reportSummary ? <div className="small muted" style={{ marginTop: 4 }}>{profile.reportSummary}</div> : null}
                  </>
                ) : (
                  <span className="small muted">Not allocated. The profile decides which collar is compliant here.</span>
                )}
              </div>
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => setPickingProfile(true)}>
                {profile ? 'Change' : 'Allocate'}
              </button>
            </div>
          </div>
        </div>

        <Field label="Sticker / label no.">
          <input type="text" value={pen.stickerNo ?? ''} onChange={(e) => void patch({ stickerNo: e.target.value })} />
        </Field>

        <div>
          <span className="field-label">Photos ({photos.length})</span>
          <PhotoCaptureButtons
            settings={settings}
            target={{ penetrationId: pen.id, projectId: pen.projectId, contextLines: [`Firedoc ${pen.number} · ${pen.size} ${pen.ref} ${pen.material}`, profile?.id ?? ''] }}
            defaultCategory="installation"
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
            <span className="field-label">Workflow</span>
            {pen.status === 'setup' || pen.status === 'in_progress' || pen.status === 'defected' ? (
              <button className="btn" type="button" onClick={() => void setStatus('completed_by_site')} disabled={!pen.profileId}>
                <IconCheck />
                Completed by site
              </button>
            ) : null}
            {!pen.profileId ? <span className="small muted">Allocate a fire profile before completing.</span> : null}
            {pen.status === 'completed_by_site' && settings.role !== 'site' ? (
              <>
                <button className="btn btn--ok" type="button" onClick={() => void setStatus('reviewed_approved')}>
                  <IconCheck />
                  Reviewed & approved
                </button>
                <textarea value={defectNote} onChange={(e) => setDefectNote(e.target.value)} placeholder="What is wrong, and what is required" />
                <button className="btn btn--danger" type="button" disabled={!defectNote.trim()} onClick={() => void setStatus('defected')}>
                  <IconWarn />
                  Defect
                </button>
              </>
            ) : null}
            {pen.status === 'completed_by_site' && settings.role === 'site' ? <span className="small muted">Awaiting QA review.</span> : null}
            {pen.status === 'defected' ? (
              <div className="banner banner--warn">
                <IconWarn />
                <div>
                  Defected {pen.reviewedAt ? formatDateTime(pen.reviewedAt) : ''} by {pen.reviewedBy || 'QA'}: {pen.defect}
                </div>
              </div>
            ) : null}
            {pen.status === 'reviewed_approved' ? (
              <span className="small muted">
                Approved {pen.reviewedAt ? formatDateTime(pen.reviewedAt) : ''} by {pen.reviewedBy}. Installed {pen.installedAt ? formatDateTime(pen.installedAt) : ''} by {pen.installedBy}.
              </span>
            ) : null}
          </div>
        </div>

      </div>
      {viewing ? <PhotoViewer photo={viewing} onClose={() => setViewing(null)} onChanged={() => undefined} onDeleted={() => setViewing(null)} /> : null}
      {pickingProfile ? (
        <ProfilePicker
          initialElement={pen.kind === 'wall' ? 'wall2' : 'slab2'}
          sizeMm={pen.sizeMm}
          onClose={() => setPickingProfile(false)}
          onPick={async (id) => {
            await patch({ profileId: id })
            setPickingProfile(false)
          }}
        />
      ) : null}
    </Sheet>
  )
}

/* ----------------------------------------------------------- profiles */

function ProfilePicker({
  initialElement,
  sizeMm,
  onClose,
  onPick,
}: {
  initialElement: FireElement
  sizeMm?: number
  onClose: () => void
  onPick: (id: string) => void
}) {
  const [element, setElement] = useState<FireElement | ''>(initialElement)
  const [size, setSize] = useState<number | ''>(sizeMm && FIRE_SIZES.includes(sizeMm) ? sizeMm : '')
  const [search, setSearch] = useState('')
  const list = matchProfiles({ element: element || undefined, sizeMm: size || undefined, search })
  return (
    <Sheet title="Passive fire rating schedule" onClose={onClose}>
      <div className="stack">
        <div className="field-grid">
          <Field label="Building element">
            <select value={element} onChange={(e) => setElement(e.target.value as FireElement | '')}>
              <option value="">Any</option>
              {(Object.keys(FIRE_ELEMENTS) as FireElement[]).map((k) => (
                <option key={k} value={k}>
                  {FIRE_ELEMENTS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Size">
            <select value={size} onChange={(e) => setSize(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Any</option>
              {FIRE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} mm
                </option>
              ))}
            </select>
          </Field>
        </div>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PVC, HDPE, high top, floor waste…" />
        <div className="card card__body--flush" style={{ maxHeight: '50vh', overflow: 'auto' }}>
          {list.length === 0 ? (
            <Empty title="No profile matches" hint="Widen the element or size." />
          ) : (
            list.map((p) => (
              <button key={p.id} className="listitem" type="button" onClick={() => onPick(p.id)}>
                <span className="listitem__num" style={{ fontSize: 11 }}>
                  {p.no}
                </span>
                <span className="listitem__main">
                  <strong>{p.id}</strong>
                  <span>
                    {p.usage} · {p.supplier} {p.product}
                  </span>
                  <span className="small muted">
                    {p.treatment} · {p.productFrl}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
        <span className="small muted">{list.length} of the schedule's profiles shown.</span>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------ autopin */

interface AutopinPageResult {
  plan: PlanPage
  scan: ScannedPage
  number: string
  title: string
  revision: string
}

/**
 * Autopin in three steps: choose the penetration plan, check what was found
 * on a preview of the sheet, then create. Nothing is written until the last
 * step, so a drawing that reads badly costs nothing.
 */
function AutopinSheet({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: (message: string, drawingId: string) => void }) {
  const pens = usePenetrations(projectId)
  const [progress, setProgress] = useState<string>('')
  const [error, setError] = useState('')
  const [pages, setPages] = useState<AutopinPageResult[] | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [kind, setKind] = useState<'floor' | 'wall'>('floor')
  const [prefix, setPrefix] = useState('F')
  const [digits, setDigits] = useState(4)
  const [level, setLevel] = useState('')
  const [frl, setFrl] = useState('')
  const [element, setElement] = useState('')
  const [includeUntagged, setIncludeUntagged] = useState(true)
  const [busy, setBusy] = useState(false)

  const read = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setPages(null)
    setBusy(true)
    try {
      const plan = await importPlanFile(file, { onProgress: (p) => setProgress(`Rendering sheet ${p.page} of ${p.total}…`) })
      // Read the register straight from the database: the live query may not have loaded yet.
      const register = await db.penetrations.where('projectId').equals(projectId).toArray()
      const scans = await scanPenetrationPlan(file, {
        numbers: register.map((p) => p.number),
        onProgress: (p: ScanProgress) => setProgress(p.stage === 'reading' ? `Reading tags on sheet ${p.page} of ${p.total}…` : `Finding penetration symbols on sheet ${p.page}…`),
      })
      const found: AutopinPageResult[] = []
      for (const scan of scans) {
        if (!scan.tags.length && !scan.untagged.length) continue
        const page = plan.pages.find((pg) => pg.page === scan.page)
        if (!page) continue
        const guess = guessDrawingDetails(page, file.name)
        found.push({
          plan: page,
          scan,
          number: guess.number || `${file.name.replace(/\.pdf$/i, '')}${plan.pages.length > 1 ? ` p${page.page}` : ''}`,
          title: guess.title || 'Penetration plan',
          revision: guess.revision ?? '',
        })
      }
      if (!found.length) {
        setError(
          plan.kind === 'image'
            ? 'That is an image, not a searchable PDF — Autopin needs the drawing as a PDF with a text layer. Add penetrations by hand on this image instead.'
            : 'No penetration tags were found. Autopin reads tags like "100 FW", "ST 100" or a register number such as "F0001-FW-100mm". A scanned drawing has no text to read.',
        )
      } else {
        // A wall plan says so in its title; everything else is taken as floor.
        const text = found.map((f) => `${f.title} ${f.plan.text}`).join(' ').toUpperCase()
        const isWall = /WALL PENETRATION/.test(text) && !/FLOOR PENETRATION|GROUND PENETRATION/.test(text)
        setKind(isWall ? 'wall' : 'floor')
        setPrefix(isWall ? 'W' : 'F')
        const lvl = /\b(LEVEL|LVL|L)\s?(\d{1,2})\b/.exec(text)
        setLevel(/GROUND/.test(text) ? 'GF' : lvl ? `L${lvl[2].padStart(2, '0')}` : '')
      }
      setPages(found)
      setPageIndex(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  /** Tags that will become new penetrations, with the numbers they will get. */
  const plannedNumbers = useMemo(() => {
    const out = new Map<string, string>()
    if (!pages) return out
    const existing = new Set(pens.map((p) => p.number.toUpperCase()))
    let n = 1
    for (const [pi, pg] of pages.entries()) {
      const items = [
        ...pg.scan.tags.map((t, i) => ({ x: t.x, y: t.y, key: `${pi}:${i}`, numbered: Boolean(t.number) })),
        ...(includeUntagged ? pg.scan.untagged.map((u, j) => ({ x: u.x, y: u.y, key: `${pi}:u${j}`, numbered: false })) : []),
      ]
      for (const item of readingOrder(items)) {
        if (item.numbered) continue
        let candidate = ''
        do {
          candidate = `${prefix.toUpperCase()}${String(n).padStart(digits, '0')}`
          n++
        } while (existing.has(candidate))
        out.set(item.key, candidate)
      }
    }
    return out
  }, [pages, pens, prefix, digits, includeUntagged])

  const current = pages?.[pageIndex]
  const preview: Drawing | undefined = current
    ? {
        id: `preview-${pageIndex}`,
        projectId,
        number: current.number,
        title: current.title,
        revision: current.revision,
        discipline: 'Fire penetrations',
        imageData: current.plan.data,
        imageWidth: current.plan.width,
        imageHeight: current.plan.height,
        createdAt: 0,
        updatedAt: 0,
      }
    : undefined

  const totals = useMemo(() => {
    const tags = pages?.flatMap((p) => p.scan.tags) ?? []
    const byType = new Map<string, number>()
    for (const t of tags) if (t.size && t.ref && !t.number) byType.set(`${t.size} ${t.ref}`, (byType.get(`${t.size} ${t.ref}`) ?? 0) + 1)
    const untagged = pages?.reduce((n, p) => n + p.scan.untagged.length, 0) ?? 0
    return {
      tags: tags.length,
      untagged,
      onSymbol: tags.filter((t) => t.onSymbol).length,
      matched: tags.filter((t) => t.number).length,
      created: tags.filter((t) => !t.number).length + (includeUntagged ? untagged : 0),
      byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [pages, includeUntagged])

  const commit = async () => {
    if (!pages) return
    setBusy(true)
    try {
      let created = 0
      let pinned = 0
      let skipped = 0
      let firstDrawing = ''
      const pens = await db.penetrations.where('projectId').equals(projectId).toArray()
      const drawings = await db.drawings.where('projectId').equals(projectId).toArray()
      for (const [pi, pg] of pages.entries()) {
        // Re-running Autopin on the same sheet must not duplicate it or its penetrations.
        const sameSheet = drawings.find((d) => d.number === pg.number.trim() && (d.revision ?? '') === pg.revision.trim())
        const drawing =
          sameSheet ??
          (await createDrawing({
            projectId,
            number: pg.number.trim(),
            title: pg.title.trim(),
            revision: pg.revision.trim(),
            discipline: 'Fire penetrations',
            imageData: pg.plan.data,
            imageWidth: pg.plan.width,
            imageHeight: pg.plan.height,
            thumbData: pg.plan.thumb,
          }))
        firstDrawing ||= drawing.id
        const onSheet = pens.filter((p) => p.drawingId === drawing.id && p.x !== undefined && p.y !== undefined)
        for (const [i, tag] of pg.scan.tags.entries()) {
          if (tag.number) {
            const pen = pens.find((p) => tagKey(p.number) === tagKey(tag.number!))
            if (pen) {
              await updatePenetration(pen.id, { drawingId: drawing.id, x: tag.x, y: tag.y, autoPinned: true })
              pinned++
            }
            continue
          }
          if (onSheet.some((p) => Math.hypot(p.x! - tag.x, p.y! - tag.y) < 0.006)) {
            skipped++
            continue
          }
          const number = plannedNumbers.get(`${pi}:${i}`)
          if (!number || !tag.size || !tag.ref) continue
          await createPenetration({
            projectId,
            number,
            kind,
            level: level || undefined,
            size: `${tag.size}mm`,
            sizeMm: tag.size,
            ref: tag.ref,
            material: '',
            frl,
            elementMaterial: element,
            drawingId: drawing.id,
            x: tag.x,
            y: tag.y,
            autoPinned: true,
          })
          created++
        }
        if (includeUntagged) {
          for (const [j, u] of pg.scan.untagged.entries()) {
            if (onSheet.some((p) => Math.hypot(p.x! - u.x, p.y! - u.y) < 0.006)) {
              skipped++
              continue
            }
            const number = plannedNumbers.get(`${pi}:u${j}`)
            if (!number) continue
            await createPenetration({
              projectId,
              number,
              kind,
              level: level || undefined,
              size: '',
              ref: u.ref ?? '',
              material: '',
              frl,
              elementMaterial: element,
              drawingId: drawing.id,
              x: u.x,
              y: u.y,
              autoPinned: true,
              notes: `Tag on the drawing is incomplete${u.ref ? ` ("${u.ref}", no size)` : ''} — confirm size and type with the consultant.`,
            })
            created++
          }
        }
      }
      const parts = [
        created ? `${created} penetrations created` : '',
        pinned ? `${pinned} register penetrations pinned` : '',
        skipped ? `${skipped} already on this sheet` : '',
      ].filter(Boolean)
      onDone(parts.join(' · ') || 'Nothing new on this sheet', firstDrawing)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Autopin from penetration plan" onClose={onClose}>
      <div className="stack">
        {!pages ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Choose the penetration drawing as a PDF. Autopin reads every tag — size and type such as <strong>100 FW</strong>, <strong>40 B</strong> or{' '}
              <strong>ST 100</strong>, or a register number such as <strong>F0001-FW-100mm</strong> — and places a pin on the penetration symbol it labels.
              You check the result before anything is saved.
            </p>
            <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => void read(e.target.files?.[0])} />
            {busy ? <span className="small muted">{progress || 'Reading…'}</span> : null}
            {error ? <div className="banner banner--warn">{error}</div> : null}
          </>
        ) : (
          <>
            <div className="banner banner--ok">
              <IconCheck />
              <div>
                <strong>{totals.tags} tagged penetrations found</strong> on {pages.length} sheet{pages.length === 1 ? '' : 's'} — {totals.onSymbol} placed on their symbol
                {totals.tags - totals.onSymbol ? `, ${totals.tags - totals.onSymbol} at the tag (no symbol found nearby — check these)` : ''}.
                {totals.matched ? ` ${totals.matched} matched register numbers.` : ''}
              </div>
            </div>
            {totals.untagged ? (
              <label className="banner banner--warn" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={includeUntagged} onChange={(e) => setIncludeUntagged(e.target.checked)} style={{ width: 20, height: 20, minHeight: 0, flex: 'none' }} />
                <div>
                  <strong>
                    {totals.untagged} more symbol{totals.untagged === 1 ? '' : 's'} with no complete tag
                  </strong>{' '}
                  — {pages.flatMap((p) => p.scan.untagged.map((u) => (u.ref ? `"${u.ref}"` : 'no tag'))).join(', ')}. Include them, flagged to confirm size and
                  type with the consultant.
                </div>
              </label>
            ) : null}
            {totals.byType.length ? (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {totals.byType.map(([t, n]) => (
                  <span key={t} className="chip">
                    {t} × {n}
                  </span>
                ))}
              </div>
            ) : null}

            {pages.length > 1 ? (
              <select value={pageIndex} onChange={(e) => setPageIndex(Number(e.target.value))} aria-label="Sheet">
                {pages.map((p, i) => (
                  <option key={p.plan.page} value={i}>
                    Sheet {p.plan.page} — {p.scan.tags.length + p.scan.untagged.length} penetrations
                  </option>
                ))}
              </select>
            ) : null}
            {current && preview ? (
              <>
                <PlanViewer
                  drawing={preview}
                  pins={[
                    ...current.scan.tags.map((t, i) => ({
                      id: `${pageIndex}:${i}`,
                      drawingId: preview.id,
                      x: t.x,
                      y: t.y,
                      label: t.number ?? `${t.size ?? ''}${t.ref ?? ''}`,
                      note: t.onSymbol ? t.text : `${t.text} — at the tag, no symbol found`,
                      createdAt: 0,
                    })),
                    ...(includeUntagged
                      ? current.scan.untagged.map((u, j) => ({
                          id: `${pageIndex}:u${j}`,
                          drawingId: preview.id,
                          x: u.x,
                          y: u.y,
                          label: `?${u.ref ?? ''}`,
                          note: 'Symbol with no complete tag',
                          createdAt: 0,
                        }))
                      : []),
                  ]}
                  height={380}
                />
                <div className="field-grid">
                  <Field label="Drawing number">
                    <input type="text" value={current.number} onChange={(e) => setPages(pages.map((p, i) => (i === pageIndex ? { ...p, number: e.target.value } : p)))} />
                  </Field>
                  <Field label="Revision">
                    <input type="text" value={current.revision} onChange={(e) => setPages(pages.map((p, i) => (i === pageIndex ? { ...p, revision: e.target.value } : p)))} />
                  </Field>
                </div>
                <Field label="Title">
                  <input type="text" value={current.title} onChange={(e) => setPages(pages.map((p, i) => (i === pageIndex ? { ...p, title: e.target.value } : p)))} />
                </Field>
              </>
            ) : null}

            {totals.created ? (
              <div className="card">
                <div className="card__body stack">
                  <span className="field-label">Numbering the {totals.created} new penetrations</span>
                  <p className="small muted" style={{ margin: 0 }}>
                    The drawing gives size and type but no numbers, so each one is numbered here, top to bottom and left to right. Numbers never change once
                    in use.
                  </p>
                  <div className="field-grid">
                    <Field label="Floor or wall">
                      <select
                        value={kind}
                        onChange={(e) => {
                          const k = e.target.value as 'floor' | 'wall'
                          setKind(k)
                          setPrefix(k === 'wall' ? 'W' : 'F')
                        }}
                      >
                        <option value="floor">Floor</option>
                        <option value="wall">Wall</option>
                      </select>
                    </Field>
                    <Field label="Level / zone">
                      <input type="text" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="GF, L07, ZA" />
                    </Field>
                  </div>
                  <div className="field-grid">
                    <Field label="Prefix">
                      <input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(0, 4))} />
                    </Field>
                    <Field label="Digits">
                      <select value={digits} onChange={(e) => setDigits(Number(e.target.value))}>
                        <option value={3}>3 — 001</option>
                        <option value={4}>4 — 0001</option>
                      </select>
                    </Field>
                  </div>
                  <div className="field-grid">
                    <Field label="FRL (optional)">
                      <input type="text" value={frl} onChange={(e) => setFrl(e.target.value)} placeholder="120/120/120" />
                    </Field>
                    <Field label="Building element (optional)">
                      <input type="text" value={element} onChange={(e) => setElement(e.target.value)} placeholder="Floor slab" />
                    </Field>
                  </div>
                  <span className="small muted">
                    Numbered {[...plannedNumbers.values()][0]} to {[...plannedNumbers.values()].at(-1)}.
                  </span>
                </div>
              </div>
            ) : null}

            <div className="row row--end">
              <button className="btn btn--ghost" type="button" onClick={() => setPages(null)} disabled={busy}>
                Choose another
              </button>
              <button className="btn" type="button" onClick={() => void commit()} disabled={busy}>
                {busy ? 'Saving…' : `Create ${totals.created ? `${totals.created} penetrations` : ''}${totals.created && totals.matched ? ' and ' : ''}${totals.matched ? `pin ${totals.matched}` : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------- import */

const HEADER_HINTS: Record<string, RegExp> = {
  number: /^(pen(etration)?\s*(no|number|id|#)?|number|id|tag|call\s*out)$/i,
  size: /size|dia|diameter|dn/i,
  level: /^level|^lvl|^floor$|^storey/i,
  zone: /zone|grid/i,
  ref: /ref|fixture|type|system|service/i,
  material: /material|pipe/i,
  frl: /frl|fire\s*rating|rating/i,
  element: /element|wall\s*\/?\s*floor|building|substrate|construction/i,
}

/** Which column holds which field, from the header row. */
function detectColumns(header: string[]): Record<string, number> {
  const map: Record<string, number> = {}
  header.forEach((h, i) => {
    const t = h.trim()
    if (!t) return
    for (const [field, re] of Object.entries(HEADER_HINTS)) {
      if (map[field] === undefined && re.test(t)) {
        map[field] = i
        break
      }
    }
  })
  return map
}

function ImportSheet({ projectId, onClose, onToast }: { projectId: string; onClose: () => void; onToast: (m: string) => void }) {
  const [sheets, setSheets] = useState<RegisterSheet[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ sheet: string; kind: 'floor' | 'wall'; rows: Omit<Parameters<typeof importPenetrations>[1][number], 'projectId'>[]; skipped: number }[]>([])

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const read = await readRegisterFile(file)
      setSheets(read)
      const out: typeof preview = []
      for (const sheet of read) {
        const headerIdx = sheet.rows.findIndex((r) => detectColumns(r).number !== undefined)
        if (headerIdx < 0) continue
        const cols = detectColumns(sheet.rows[headerIdx])
        const kind: 'floor' | 'wall' = /wall/i.test(sheet.name) ? 'wall' : /floor|slab/i.test(sheet.name) ? 'floor' : 'floor'
        const rows: typeof preview[number]['rows'] = []
        let skipped = 0
        for (const r of sheet.rows.slice(headerIdx + 1)) {
          const number = (r[cols.number] ?? '').trim()
          if (!number) {
            skipped++
            continue
          }
          const size = (cols.size !== undefined ? r[cols.size] : '') ?? ''
          rows.push({
            number: tagKey(number) === number.toUpperCase() ? number.toUpperCase() : number.trim(),
            kind: /^W/i.test(number) && !/^F/i.test(number) ? 'wall' : /^F/i.test(number) ? 'floor' : kind,
            size: /mm/i.test(size) ? size : size ? `${size}mm` : '',
            sizeMm: parseInt(size, 10) || undefined,
            level: cols.level !== undefined ? r[cols.level] : undefined,
            zone: cols.zone !== undefined ? r[cols.zone] : undefined,
            ref: cols.ref !== undefined ? (r[cols.ref] ?? '').toUpperCase() : '',
            material: cols.material !== undefined ? r[cols.material] ?? '' : '',
            frl: cols.frl !== undefined ? r[cols.frl] ?? '' : '',
            elementMaterial: cols.element !== undefined ? r[cols.element] ?? '' : '',
          })
        }
        out.push({ sheet: sheet.name, kind, rows, skipped })
      }
      setPreview(out)
      if (out.length === 0) setError('No sheet with a penetration number column was found. The header needs a column such as "Penetration No".')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    setBusy(true)
    try {
      let added = 0
      let updated = 0
      for (const p of preview) {
        const r = await importPenetrations(projectId, p.rows)
        added += r.added
        updated += r.updated
      }
      onToast(`${added} penetrations added, ${updated} updated`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const total = preview.reduce((n, p) => n + p.rows.length, 0)

  return (
    <Sheet title="Import Autopin register" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          The consultants' Excel register, as set out in the Firedoc requirements: one row per fire-rated penetration with the
          unique number, size, level or zone, reference, material, FRL and building element. Wall and floor tabs are read
          separately. Numbers already on the register are updated, never duplicated.
        </p>
        <input type="file" accept=".xlsx,.csv" onChange={(e) => void pick(e.target.files?.[0])} disabled={busy} />
        {error ? <div className="banner banner--warn">{error}</div> : null}
        {preview.map((p) => (
          <div key={p.sheet} className="card">
            <div className="card__body">
              <strong className="small">{p.sheet}</strong>
              <div className="small muted">
                {p.rows.length} penetrations ({p.kind}) · {p.skipped} blank rows skipped
              </div>
              {p.rows.slice(0, 3).map((r) => (
                <div key={r.number} className="small mono" style={{ marginTop: 4 }}>
                  {r.number} · {r.size} {r.ref} · {r.material} · {r.frl} · {r.elementMaterial}
                </div>
              ))}
            </div>
          </div>
        ))}
        {sheets.length > 0 && preview.length === 0 ? <span className="small muted">Sheets read: {sheets.map((s) => s.name).join(', ')}</span> : null}
        <div className="row row--end">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="button" disabled={!total || busy} onClick={() => void commit()}>
            Import {total || ''} penetrations
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/* ---------------------------------------------------------------- add */

function AddSheet({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: (id: string) => void }) {
  const [form, setForm] = useState({ number: '', kind: 'floor' as 'floor' | 'wall', size: '100mm', ref: 'FW', material: 'PVC', frl: '120/120/120', elementMaterial: '', level: '' })
  const drawings = useDrawings(projectId)
  const settings = useSettings()
  const [drawingId, setDrawingId] = useState('')
  const [importing, setImporting] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const location = useDeviceLocation(settings.captureGps)
  const drawing = drawings.find((d) => d.id === drawingId) ?? (drawingId === 'none' ? undefined : drawings[0])
  return (
    <Sheet title="Add penetration" onClose={onClose}>
      <div className="stack">
        <div className="field-grid">
          <Field label="Penetration number" hint="Must match the call-out tag on the plan exactly.">
            <input type="text" autoFocus value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value.toUpperCase() })} placeholder="F0001" />
          </Field>
          <Field label="Floor or wall">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'floor' | 'wall' })}>
              <option value="floor">Floor</option>
              <option value="wall">Wall</option>
            </select>
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Size">
            <input type="text" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
          </Field>
          <Field label="Reference">
            <input type="text" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Material">
            <input type="text" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} />
          </Field>
          <Field label="FRL">
            <input type="text" value={form.frl} onChange={(e) => setForm({ ...form, frl: e.target.value })} />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Building element">
            <input type="text" value={form.elementMaterial} onChange={(e) => setForm({ ...form, elementMaterial: e.target.value })} />
          </Field>
          <Field label="Level">
            <input type="text" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
          </Field>
        </div>

        <div>
          <span className="field-label">Penetration plan</span>
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
              pins={pos ? [{ id: 'new', drawingId: drawing.id, x: pos.x, y: pos.y, label: form.number || 'NEW', createdAt: 0 }] : []}
              mode="pin"
              onDropPin={(x, y) => setPos({ x, y })}
              height={280}
            />
            <span className="small muted">{pos ? 'Pinned. Tap again to move it.' : 'Tap the plan where the penetration is.'}</span>
          </>
        ) : null}

        <div>
          <span className="field-label">Device location</span>
          <LocationLine geo={location.geo} state={location.state} onLocate={() => void location.locate()} onClear={location.clear} />
        </div>

        <div className="row row--end">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            disabled={!form.number.trim()}
            onClick={async () => {
              const p = await createPenetration({
                projectId,
                ...form,
                sizeMm: parseInt(form.size, 10) || undefined,
                drawingId: drawing?.id,
                x: pos?.x,
                y: pos?.y,
                autoPinned: false,
                lat: location.geo?.lat,
                lng: location.geo?.lng,
                accuracy: location.geo?.accuracy,
                locatedAt: location.geo?.locatedAt,
              })
              onAdded(p.id)
            }}
          >
            Add
          </button>
        </div>
      </div>
    </Sheet>
  )
}
