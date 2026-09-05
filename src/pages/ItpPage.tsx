import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteItp, deletePin, duplicateItp, updateItp, uid } from '../data/db'
import { useDrawings, useItp, usePhotos, usePhotosByItem, useProject, useSettings } from '../data/store'
import type { Itp, ItpItem, PlanPin, PlanRegion, Photo, PointType, RegionColour, Settings } from '../data/types'
import { POINT_TYPES, ITP_STATUS_LABEL, REGION_COLOURS } from '../data/types'
import {
  ConfirmButton,
  Empty,
  Field,
  IconBack,
  IconCheck,
  IconArea,
  IconCopy,
  IconHand,
  IconHighlight,
  IconPdf,
  IconPin,
  IconSign,
  IconTrash,
  IconWarn,
  PointChip,
  Sheet,
  SignaturePad,
  Toast,
  useToast,
} from '../components/ui'
import { PhotoCaptureButtons, PhotoGrid, PhotoViewer } from '../components/PhotoCapture'
import { PlanViewer, type PlanMode } from '../components/PlanViewer'
import { blockingHoldFor, deriveStatus, formatDate, formatDateTime, itpProgress, slug, statusChipClass, todayIso } from '../lib/format'
import { exportItpPdf } from '../lib/pdf'

type Tab = 'schedule' | 'materials' | 'plans' | 'signoff'

export function ItpPage() {
  const { projectId, itpId } = useParams()
  const itp = useItp(itpId)
  const project = useProject(projectId)
  const settings = useSettings()
  const drawings = useDrawings(projectId)
  const photos = usePhotos(itpId)
  const photosByItem = usePhotosByItem(itpId)
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('schedule')
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Photo | null>(null)
  const [editingHeader, setEditingHeader] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, showToast] = useToast()

  const progress = useMemo(() => (itp ? itpProgress(itp) : null), [itp])

  if (!itp || !project || !progress) {
    return <Empty title="ITP not found" hint="It may have been deleted on this device." />
  }

  const status = deriveStatus(itp)

  const patchItem = async (no: string, patch: Partial<ItpItem>) => {
    const items = itp.items.map((i) => (i.no === no ? { ...i, ...patch } : i))
    await updateItp(itp.id, { items })
  }

  const signItem = async (item: ItpItem) => {
    await patchItem(item.no, {
      status: 'pass',
      initials: settings.userInitials || settings.userName.slice(0, 3).toUpperCase(),
      date: todayIso(),
      signedAt: Date.now(),
      signedBy: settings.userName,
    })
    showToast(`Item ${item.no} signed`)
  }

  const exportPdf = async () => {
    setExporting(true)
    try {
      const blob = await exportItpPdf({ itp, project, drawings: drawings.filter((d) => itp.drawingIds.includes(d.id)), photos })
      const a = document.createElement('a')
      const url = URL.createObjectURL(blob)
      a.href = url
      a.download = `ITP${itp.itpNumber}_${slug(itp.title)}_${slug(itp.area)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 3000)
      showToast('PDF exported')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <Link className="iconbtn" to={`/project/${projectId}/itps`} aria-label="Back to register">
          <IconBack />
        </Link>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={exportPdf} disabled={exporting} type="button">
          <IconPdf />
          {exporting ? 'Building…' : 'Export PDF'}
        </button>
      </div>

      <div className="card">
        <div className="card__body">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="chip chip--accent mono">ITP {itp.itpNumber}</span>
                <span className={`chip ${statusChipClass(status)}`}>{ITP_STATUS_LABEL[status]}</span>
              </div>
              <h2 style={{ fontSize: 17, marginTop: 8 }}>{itp.title}</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {itp.area}
                {itp.location ? ` · ${itp.location}` : ''} · Rev {itp.revision} of {formatDate(itp.revisionDate)}
              </p>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditingHeader(true)} type="button">
              Edit
            </button>
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="row small muted" style={{ marginBottom: 5 }}>
              <span>
                {progress.signed} of {progress.applicable} signed
                {progress.na ? ` · ${progress.na} N/A` : ''}
                {progress.failed ? ` · ${progress.failed} failed` : ''}
              </span>
              <span className="spacer" />
              <span className="mono">{progress.percent}%</span>
            </div>
            <div className={`bar${progress.percent === 100 ? ' bar--ok' : ''}`}>
              <i style={{ width: `${progress.percent}%` }} />
            </div>
          </div>

          {progress.blockingHold ? (
            <div className="banner banner--hold" style={{ marginTop: 12 }}>
              <IconWarn />
              <div>
                <strong>Hold point {progress.blockingHold.no} is not released.</strong> Work must not proceed past this item.
                {progress.blockingHold.releasedBy ? ` Release by: ${progress.blockingHold.releasedBy}.` : ''}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="row" style={{ margin: '14px 0 12px' }}>
        {(
          [
            ['schedule', `Schedule (${itp.items.length})`],
            ['materials', `Materials (${itp.materials.length})`],
            ['plans', `Plans (${itp.pins.length + (itp.regions?.length ?? 0)})`],
            ['signoff', 'Sign-off'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`btn btn--sm ${tab === key ? '' : 'btn--ghost'}`}
            onClick={() => setTab(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'schedule' ? (
        <div className="card card__body--flush">
          {itp.items.map((item, index) => (
            <ScheduleItem
              key={item.no}
              itp={itp}
              item={item}
              index={index}
              open={openItem === item.no}
              photos={photosByItem.get(item.no) ?? []}
              onToggle={() => setOpenItem(openItem === item.no ? null : item.no)}
              onPatch={(patch) => patchItem(item.no, patch)}
              onSign={() => signItem(item)}
              onOpenPhoto={setViewing}
              onToast={showToast}
            />
          ))}
        </div>
      ) : null}

      {tab === 'materials' ? <MaterialsTab itp={itp} onToast={showToast} /> : null}
      {tab === 'plans' ? (
        <PlansTab itp={itp} projectId={projectId!} onToast={showToast} onOpenPhoto={setViewing} />
      ) : null}
      {tab === 'signoff' ? <SignOffTab itp={itp} onToast={showToast} /> : null}

      <div className="section-title">
        <h2>General photographic record</h2>
        <span>{(photosByItem.get('') ?? []).length}</span>
      </div>
      <div className="card">
        <div className="card__body">
          <PhotoCaptureButtons
            itp={itp}
            settings={settings}
            defaultCategory="installation"
            onCaptured={() => showToast('Photo added')}
            onError={showToast}
            label="Add record photo"
          />
          <div style={{ marginTop: 12 }}>
            {(photosByItem.get('') ?? []).length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                Photos not tied to a specific item — whiteboard shots, plan extracts and general progress.
              </p>
            ) : (
              <PhotoGrid photos={photosByItem.get('') ?? []} onOpen={setViewing} />
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__body row">
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={async () => {
              const area = window.prompt('Area for the copy', `${itp.area} (copy)`)
              if (!area) return
              const copy = await duplicateItp(itp.id, area)
              navigate(`/project/${projectId}/itp/${copy.id}`)
            }}
          >
            <IconCopy />
            Duplicate to another area
          </button>
          <span className="spacer" />
          <ConfirmButton
            label={
              <>
                <IconTrash />
                Delete ITP
              </>
            }
            confirmLabel="Tap again to delete"
            onConfirm={async () => {
              await deleteItp(itp.id)
              navigate(`/project/${projectId}/itps`)
            }}
          />
        </div>
      </div>

      {viewing ? (
        <PhotoViewer
          photo={viewing}
          itp={itp}
          onClose={() => setViewing(null)}
          onChanged={() => showToast('Photo updated')}
          onDeleted={() => {
            setViewing(null)
            showToast('Photo deleted')
          }}
        />
      ) : null}

      {editingHeader ? <HeaderSheet itp={itp} projectId={projectId!} onClose={() => setEditingHeader(false)} /> : null}
      <Toast message={toast} />
    </>
  )
}

/* ------------------------------------------------------------- schedule */

function ScheduleItem({
  itp,
  item,
  index,
  open,
  photos,
  onToggle,
  onPatch,
  onSign,
  onOpenPhoto,
  onToast,
}: {
  itp: Itp
  item: ItpItem
  index: number
  open: boolean
  photos: Photo[]
  onToggle: () => void
  onPatch: (patch: Partial<ItpItem>) => Promise<void>
  onSign: () => Promise<void>
  onOpenPhoto: (photo: Photo) => void
  onToast: (message: string) => void
}) {
  const settings = useSettings()
  const [releasing, setReleasing] = useState(false)
  const blockedBy = blockingHoldFor(itp, index)

  const cls = [
    'itpitem',
    item.status === 'pass' ? 'itpitem--done' : '',
    item.status === 'na' ? 'itpitem--na' : '',
    blockedBy && item.status === 'pending' ? 'itpitem--blocked' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls}>
      <div className="itpitem__head" onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span className="itpitem__no">{item.no}</span>
        <div className="itpitem__body">
          <p>{item.installation}</p>
          <p className="itpitem__crit">{item.acceptance}</p>
          <div className="itpitem__meta">
            <PointChip point={item.point} />
            {item.status === 'pass' ? (
              <span className="chip chip--ok">
                <IconCheck /> {item.initials || 'signed'} {item.date ? formatDate(item.date) : ''}
              </span>
            ) : null}
            {item.status === 'fail' ? <span className="chip chip--bad">Non-conforming</span> : null}
            {item.status === 'na' ? <span className="chip">N/A</span> : null}
            {item.release ? <span className="chip chip--accent">Released {formatDate(item.release.at)}</span> : null}
            {item.recordValue ? (
              <span className="chip mono">
                {item.recordLabel}: {item.recordValue} {item.recordUnit ?? ''}
              </span>
            ) : null}
            {photos.length ? <span className="chip">{photos.length} photo{photos.length > 1 ? 's' : ''}</span> : null}
            {blockedBy && item.status === 'pending' ? (
              <span className="chip chip--hold">Blocked by hold {blockedBy.no}</span>
            ) : null}
          </div>
        </div>
      </div>

      {open ? (
        <div className="itpitem__detail">
          <div className="stack">
            {item.point === 'H' && item.status !== 'pass' ? (
              <div className="banner banner--hold">
                <IconWarn />
                <div>
                  <strong>Hold point.</strong> {POINT_TYPES.H.help}
                  {item.releasedBy ? ` Nominated releasing party: ${item.releasedBy}.` : ''}
                </div>
              </div>
            ) : null}
            {item.point === 'W' && item.status !== 'pass' ? (
              <div className="banner banner--info">
                <div>
                  <strong>Witness point.</strong> {POINT_TYPES.W.help}
                  {item.releasedBy ? ` Notify: ${item.releasedBy}.` : ''}
                </div>
              </div>
            ) : null}
            {blockedBy && item.status === 'pending' ? (
              <div className="banner banner--warn">
                <IconWarn />
                <div>
                  Hold point {blockedBy.no} above this item has not been released. Release it before signing this item off.
                </div>
              </div>
            ) : null}

            <div>
              <span className="field-label">Result</span>
              <div className="statebtns">
                {(
                  [
                    ['pass', 'Conforms'],
                    ['fail', 'Non-conforming'],
                    ['na', 'N/A'],
                    ['pending', 'Clear'],
                  ] as [ItpItem['status'], string][]
                ).map(([s, label]) => (
                  <button
                    key={s}
                    type="button"
                    data-s={s}
                    className={`statebtn ${item.status === s ? 'is-on' : ''}`}
                    onClick={() => {
                      if (s === 'pass') return void onSign()
                      void onPatch(
                        s === 'pending'
                          ? { status: 'pending', initials: undefined, date: undefined, signedAt: undefined, signedBy: undefined }
                          : {
                              status: s,
                              initials: settings.userInitials || settings.userName.slice(0, 3).toUpperCase(),
                              date: todayIso(),
                              signedAt: Date.now(),
                              signedBy: settings.userName,
                            },
                      )
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {item.recordLabel ? (
              <div className="field-grid">
                <Field label={`${item.recordLabel}${item.recordUnit ? ` (${item.recordUnit})` : ''}`}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={item.recordValue ?? ''}
                    onChange={(e) => void onPatch({ recordValue: e.target.value })}
                    placeholder="Measured / recorded result"
                  />
                </Field>
              </div>
            ) : null}

            <Field label="Comment / non-conformance detail">
              <textarea
                value={item.comment ?? ''}
                onChange={(e) => void onPatch({ comment: e.target.value })}
                placeholder={item.status === 'fail' ? 'What is non-conforming and what corrective action is proposed?' : 'Optional note'}
              />
            </Field>

            <div className="field-grid">
              <Field label="Inspection point type">
                <select value={item.point} onChange={(e) => void onPatch({ point: e.target.value as PointType })}>
                  {(Object.keys(POINT_TYPES) as PointType[]).map((p) => (
                    <option key={p} value={p}>
                      {p} — {POINT_TYPES[p].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Released / witnessed by">
                <input
                  type="text"
                  value={item.releasedBy ?? ''}
                  onChange={(e) => void onPatch({ releasedBy: e.target.value })}
                  placeholder="e.g. Superintendent"
                />
              </Field>
            </div>

            {item.point === 'H' || item.point === 'W' ? (
              <div className="card">
                <div className="card__body">
                  {item.release ? (
                    <>
                      <div className="row">
                        <div style={{ flex: 1 }}>
                          <strong className="small">
                            Released by {item.release.releasedBy}
                            {item.release.company ? `, ${item.release.company}` : ''}
                          </strong>
                          <div className="small muted">
                            {formatDateTime(item.release.at)}
                            {item.release.reference ? ` · ref ${item.release.reference}` : ''}
                          </div>
                          {item.release.note ? <div className="small" style={{ marginTop: 4 }}>{item.release.note}</div> : null}
                        </div>
                        {item.release.signature ? (
                          <div className="sigshow" style={{ width: 150 }}>
                            <img src={item.release.signature} alt="Release signature" />
                          </div>
                        ) : null}
                      </div>
                      <div className="row row--end" style={{ marginTop: 8 }}>
                        <button className="btn btn--ghost btn--sm" onClick={() => void onPatch({ release: undefined })} type="button">
                          Remove release
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="small muted" style={{ margin: '0 0 10px' }}>
                        {item.point === 'H'
                          ? 'Record the release so the schedule shows work may proceed.'
                          : 'Record attendance / notice for this witness point.'}
                      </p>
                      <div className="row">
                        <button className="btn btn--sm" onClick={() => setReleasing(true)} type="button">
                          <IconSign />
                          Record {item.point === 'H' ? 'release' : 'witness'}
                        </button>
                        {!item.notice ? (
                          <button
                            className="btn btn--ghost btn--sm"
                            type="button"
                            onClick={() => {
                              void onPatch({
                                notice: { notifiedAt: Date.now(), notifiedBy: settings.userName, to: item.releasedBy },
                              })
                              onToast('Notice recorded')
                            }}
                          >
                            Record notice given
                          </button>
                        ) : (
                          <span className="chip chip--accent">Notice given {formatDateTime(item.notice.notifiedAt)}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            <div>
              <span className="field-label">Photographic evidence</span>
              {item.photoHint ? (
                <p className="small muted" style={{ margin: '0 0 8px' }}>
                  Suggested: {item.photoHint}
                </p>
              ) : null}
              <PhotoCaptureButtons
                itp={itp}
                settings={settings}
                itemNo={item.no}
                defaultCategory={item.recordLabel ? 'test' : 'installation'}
                onCaptured={() => onToast(`Photo added to item ${item.no}`)}
                onError={onToast}
              />
              {photos.length ? (
                <div style={{ marginTop: 10 }}>
                  <PhotoGrid photos={photos} onOpen={onOpenPhoto} />
                </div>
              ) : null}
            </div>

            {item.signedAt ? (
              <p className="small muted" style={{ margin: 0 }}>
                Recorded {formatDateTime(item.signedAt)}
                {item.signedBy ? ` by ${item.signedBy}` : ''}.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {releasing ? (
        <ReleaseSheet
          item={item}
          onClose={() => setReleasing(false)}
          onSave={async (release) => {
            await onPatch({ release, status: 'pass', initials: release.releasedBy.slice(0, 3).toUpperCase(), date: todayIso(), signedAt: Date.now() })
            setReleasing(false)
            onToast(`${item.point === 'H' ? 'Hold point' : 'Witness point'} ${item.no} released`)
          }}
        />
      ) : null}
    </div>
  )
}

function ReleaseSheet({
  item,
  onClose,
  onSave,
}: {
  item: ItpItem
  onClose: () => void
  onSave: (release: NonNullable<ItpItem['release']>) => Promise<void>
}) {
  const [form, setForm] = useState({
    releasedBy: item.releasedBy ?? '',
    company: '',
    role: '',
    reference: '',
    note: '',
  })
  const [signature, setSignature] = useState<string | undefined>()

  return (
    <Sheet title={`${item.point === 'H' ? 'Release hold point' : 'Witness point'} ${item.no}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {item.installation}
        </p>
        <div className="field-grid">
          <Field label="Released / witnessed by">
            <input
              type="text"
              autoFocus
              value={form.releasedBy}
              onChange={(e) => setForm({ ...form, releasedBy: e.target.value })}
              placeholder="Name"
            />
          </Field>
          <Field label="Company">
            <input type="text" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Role">
            <input type="text" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </Field>
          <Field label="Reference no." hint="Inspection number, consent number or permit reference.">
            <input type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
        </div>
        <Field label="Note">
          <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <div>
          <span className="field-label">Signature</span>
          <SignaturePad value={signature} onChange={setSignature} />
        </div>
        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn btn--ok"
            disabled={!form.releasedBy.trim()}
            type="button"
            onClick={() => void onSave({ ...form, at: Date.now(), signature })}
          >
            <IconCheck />
            Record release
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------- materials */

function MaterialsTab({ itp, onToast }: { itp: Itp; onToast: (m: string) => void }) {
  const settings = useSettings()

  const patch = async (index: number, changes: Partial<Itp['materials'][number]>) => {
    const materials = itp.materials.map((m, i) => (i === index ? { ...m, ...changes } : m))
    await updateItp(itp.id, { materials })
  }

  return (
    <div className="card">
      <div className="card__body">
        <p className="small muted" style={{ marginTop: 0 }}>
          Verify each material against its requirement before it goes in the ground. Record the batch, lot or certificate number so
          the installation stays traceable.
        </p>
        <div className="stack">
          {itp.materials.map((m, i) => (
            <div key={`${m.item}-${i}`} className="card">
              <div className="card__body">
                <strong className="small">{m.item}</strong>
                <p className="small muted" style={{ margin: '4px 0 10px' }}>
                  {m.requirement}
                </p>
                <div className="row">
                  <button
                    type="button"
                    className={`btn btn--sm ${m.compliant === true ? 'btn--ok' : 'btn--ghost'}`}
                    onClick={() => {
                      void patch(i, {
                        compliant: m.compliant === true ? null : true,
                        initials: settings.userInitials,
                        checkedAt: Date.now(),
                      })
                      onToast(m.compliant === true ? 'Check cleared' : 'Material verified')
                    }}
                  >
                    <IconCheck />
                    Complies
                  </button>
                  <button
                    type="button"
                    className={`btn btn--sm ${m.compliant === false ? 'btn--danger' : 'btn--ghost'}`}
                    onClick={() => void patch(i, { compliant: m.compliant === false ? null : false, checkedAt: Date.now() })}
                  >
                    Does not comply
                  </button>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Field label="Batch / lot / certificate reference">
                    <input
                      type="text"
                      value={m.reference ?? ''}
                      onChange={(e) => void patch(i, { reference: e.target.value })}
                      placeholder="e.g. Batch 24-0917, WM-021234"
                    />
                  </Field>
                </div>
                {m.checkedAt ? (
                  <p className="small muted" style={{ margin: '8px 0 0' }}>
                    Checked {formatDateTime(m.checkedAt)}
                    {m.initials ? ` by ${m.initials}` : ''}.
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- plans */

function PlansTab({
  itp,
  projectId,
  onToast,
  onOpenPhoto,
}: {
  itp: Itp
  projectId: string
  onToast: (m: string) => void
  onOpenPhoto: (photo: Photo) => void
}) {
  const drawings = useDrawings(projectId)
  const settings = useSettings()
  const photos = usePhotos(itp.id)
  const linked = drawings.filter((d) => itp.drawingIds.includes(d.id))
  const [activeId, setActiveId] = useState<string | undefined>(linked[0]?.id)
  const [mode, setMode] = useState<PlanMode>('view')
  const [colour, setColour] = useState<RegionColour>('yellow')
  const [pendingRegion, setPendingRegion] = useState<{
    kind: 'highlight' | 'area'
    points: { x: number; y: number }[]
  } | null>(null)
  const [selectedPin, setSelectedPin] = useState<PlanPin | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<PlanRegion | null>(null)

  const active = linked.find((d) => d.id === activeId) ?? linked[0]
  const pins = itp.pins.filter((p) => p.drawingId === active?.id)
  const allRegions = itp.regions ?? []
  const regions = allRegions.filter((r) => r.drawingId === active?.id)

  const savePins = (next: PlanPin[]) => updateItp(itp.id, { pins: next })
  const saveRegions = (next: PlanRegion[]) => updateItp(itp.id, { regions: next })

  const photosByPin = useMemo(() => {
    const map: Record<string, Photo[]> = {}
    for (const p of photos) {
      if (!p.pinId) continue
      ;(map[p.pinId] ??= []).push(p)
    }
    for (const list of Object.values(map)) list.sort((a, b) => a.takenAt - b.takenAt)
    return map
  }, [photos])

  const photoCounts = useMemo(
    () => Object.fromEntries(Object.entries(photosByPin).map(([id, list]) => [id, list.length])),
    [photosByPin],
  )

  /**
   * A tap in pin mode is deliberate, so the pin is created straight away and its
   * detail sheet opens — label, item, note and the camera are all in there, and
   * taking a photo at the pin you just dropped is the usual next step. A pin
   * added by mistake is removed from the same sheet.
   */
  const dropPin = async (x: number, y: number) => {
    if (!active) return
    const pin: PlanPin = {
      id: uid('pin'),
      drawingId: active.id,
      x,
      y,
      label: String(itp.pins.length + 1),
      createdAt: Date.now(),
    }
    await savePins([...itp.pins, pin])
    setMode('view')
    setSelectedPin(pin)
    onToast('Pin dropped — add a note or photos')
  }

  if (drawings.length === 0) {
    return (
      <div className="card">
        <div className="card__body">
          <Empty
            icon={<IconPin />}
            title="No drawings on this job"
            hint="Add drawings on the Plans tab, then link them here to highlight the section this ITP covers."
          />
          <div className="row row--end">
            <Link className="btn btn--sm" to={`/project/${projectId}/drawings`}>
              Go to Plans
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const modeHint: Record<PlanMode, string> = {
    view: 'Drag to pan, pinch or scroll to zoom.',
    pin: 'Tap the plan where the work was inspected.',
    highlight: 'Drag along the run to highlight it, as you would with a highlighter on a paper plan.',
    area: 'Drag a box around the area this ITP covers.',
  }

  return (
    <>
      <div className="card">
        <div className="card__body">
          <span className="field-label">Drawings this ITP is inspected against</span>
          <div className="stack" style={{ gap: 6 }}>
            {drawings.map((d) => (
              <label key={d.id} className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 18, height: 18, minHeight: 0 }}
                  checked={itp.drawingIds.includes(d.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...itp.drawingIds, d.id]
                      : itp.drawingIds.filter((x) => x !== d.id)
                    void updateItp(itp.id, { drawingIds: next })
                  }}
                />
                <span className="small">
                  <strong>{d.number}</strong> {d.revision ? `(${d.revision})` : ''} {d.title}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {active ? (
        <div className="card">
          <div className="card__head">
            <h3>
              {active.number} {active.revision ? `· ${active.revision}` : ''}
            </h3>
            {linked.length > 1 ? (
              <select value={active.id} onChange={(e) => setActiveId(e.target.value)} style={{ width: 'auto', minHeight: 34 }}>
                {linked.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="card__body" style={{ paddingBottom: 10 }}>
            <div className="row">
              {(
                [
                  ['view', 'Pan / zoom', <IconHand key="i" />],
                  ['highlight', 'Highlight run', <IconHighlight key="i" />],
                  ['area', 'Box area', <IconArea key="i" />],
                  ['pin', 'Drop pin', <IconPin key="i" />],
                ] as [PlanMode, string, React.ReactNode][]
              ).map(([m, label, icon]) => (
                <button
                  key={m}
                  type="button"
                  className={`btn btn--sm ${mode === m ? '' : 'btn--ghost'}`}
                  onClick={() => setMode(m)}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            {mode === 'highlight' || mode === 'area' ? (
              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                <span className="small muted">Colour</span>
                {(Object.keys(REGION_COLOURS) as RegionColour[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={REGION_COLOURS[c].label}
                    onClick={() => setColour(c)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      cursor: 'pointer',
                      background: REGION_COLOURS[c].fill,
                      border: `2px solid ${colour === c ? REGION_COLOURS[c].stroke : 'var(--line-strong)'}`,
                      outline: colour === c ? `2px solid ${REGION_COLOURS[c].stroke}` : 'none',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            ) : null}

            <p className="small muted" style={{ margin: '10px 0 0' }}>
              {modeHint[mode]}
            </p>
          </div>

          <div className="card__body card__body--flush">
            <PlanViewer
              drawing={active}
              pins={pins}
              photoCounts={photoCounts}
              regions={regions}
              mode={mode}
              drawColour={colour}
              selectedPinId={selectedPin?.id}
              selectedRegionId={selectedRegion?.id}
              onDropPin={(x, y) => void dropPin(x, y)}
              onDrawRegion={(kind, points) => setPendingRegion({ kind, points })}
              onSelectPin={(p) => {
                setSelectedPin(p)
                setSelectedRegion(null)
              }}
              onSelectRegion={(r) => {
                setSelectedRegion(r)
                setSelectedPin(null)
              }}
            />
          </div>

          <div className="card__body">
            {regions.length === 0 && pins.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                Nothing marked on this drawing yet. Use <strong>Highlight run</strong> to trace the extent this ITP covers, or
                <strong> Drop pin</strong> for a single location.
              </p>
            ) : null}

            {regions.length ? (
              <>
                <span className="field-label">Highlighted extents ({regions.length})</span>
                <div className="tablewrap" style={{ marginBottom: 14 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Type</th>
                        <th>Item</th>
                        <th>Note</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {regions.map((r) => (
                        <tr
                          key={r.id}
                          style={{ background: r.id === selectedRegion?.id ? 'var(--surface-2)' : undefined }}
                        >
                          <td>
                            <span
                              className="chip"
                              style={{ background: REGION_COLOURS[r.colour].fill, color: REGION_COLOURS[r.colour].stroke }}
                            >
                              {r.label || '—'}
                            </span>
                          </td>
                          <td>{r.kind === 'area' ? 'Area' : 'Run'}</td>
                          <td>{r.itemNo ? `Item ${r.itemNo}` : '—'}</td>
                          <td>{r.note || '—'}</td>
                          <td>
                            <button
                              className="btn btn--ghost btn--sm"
                              type="button"
                              onClick={() => {
                                void saveRegions(allRegions.filter((x) => x.id !== r.id))
                                setSelectedRegion(null)
                                onToast('Highlight removed')
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {pins.length ? (
              <>
                <span className="field-label">Pinned locations ({pins.length})</span>
                <div className="tablewrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Pin</th>
                        <th>Item</th>
                        <th>Note</th>
                        <th>Photos</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pins.map((p) => (
                        <tr key={p.id} style={{ background: p.id === selectedPin?.id ? 'var(--surface-2)' : undefined }}>
                          <td className="mono">{p.label}</td>
                          <td>{p.itemNo ? `Item ${p.itemNo}` : '—'}</td>
                          <td>{p.note || '—'}</td>
                          <td>
                            {photoCounts[p.id] ? (
                              <span className="chip chip--ok">
                                {photoCounts[p.id]} photo{photoCounts[p.id] > 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="muted small">none</span>
                            )}
                          </td>
                          <td>
                            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setSelectedPin(p)}>
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card__body">
            <Empty title="No drawing linked" hint="Tick a drawing above to view it and mark the section this ITP covers." />
          </div>
        </div>
      )}

      {selectedPin ? (
        <PinDetailSheet
          itp={itp}
          pin={itp.pins.find((p) => p.id === selectedPin.id) ?? selectedPin}
          settings={settings}
          photos={photosByPin[selectedPin.id] ?? []}
          onClose={() => setSelectedPin(null)}
          onOpenPhoto={onOpenPhoto}
          onToast={onToast}
          onRemoved={() => setSelectedPin(null)}
        />
      ) : null}

      {pendingRegion && active ? (
        <RegionSheet
          itp={itp}
          kind={pendingRegion.kind}
          defaultLabel={String(allRegions.length + 1)}
          onClose={() => setPendingRegion(null)}
          onSave={async (label, itemNo, note) => {
            const region: PlanRegion = {
              id: uid('rgn'),
              drawingId: active.id,
              kind: pendingRegion.kind,
              points: pendingRegion.points,
              colour,
              label,
              itemNo,
              note,
              createdAt: Date.now(),
            }
            await saveRegions([...allRegions, region])
            setPendingRegion(null)
            onToast(pendingRegion.kind === 'area' ? 'Area highlighted' : 'Run highlighted')
          }}
        />
      ) : null}
    </>
  )
}

function RegionSheet({
  itp,
  kind,
  defaultLabel,
  onClose,
  onSave,
}: {
  itp: Itp
  kind: 'highlight' | 'area'
  defaultLabel: string
  onClose: () => void
  onSave: (label: string, itemNo: string | undefined, note: string) => Promise<void>
}) {
  const [label, setLabel] = useState(defaultLabel)
  const [itemNo, setItemNo] = useState('')
  const [note, setNote] = useState('')

  return (
    <Sheet title={kind === 'area' ? 'Highlighted area' : 'Highlighted run'} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          This marks the section of the drawing the ITP covers. It is drawn onto the plan extract in the exported PDF, so the
          inspector can see exactly what was signed off.
        </p>
        <div className="field-grid">
          <Field label="Reference" hint="Shown on the plan and in the schedule. Keep it short.">
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 6))} />
          </Field>
          <Field label="Relates to item">
            <select value={itemNo} onChange={(e) => setItemNo(e.target.value)}>
              <option value="">Whole ITP extent</option>
              {itp.items.map((i) => (
                <option key={i.no} value={i.no}>
                  {i.no} — {i.installation.slice(0, 50)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Note">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              kind === 'area'
                ? 'e.g. Southern driveway, grid 10-12'
                : 'e.g. 110 HDPE run from IO at grid 3 to boundary trap'
            }
          />
        </Field>
        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Discard
          </button>
          <button className="btn" onClick={() => void onSave(label, itemNo || undefined, note)} type="button">
            Save highlight
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/**
 * Everything recorded at one pin: what it is, and the photographic evidence
 * captured there. Photos taken from here are stamped with the pin reference, so
 * a print of the photo still says where it was taken.
 */
function PinDetailSheet({
  itp,
  pin,
  settings,
  photos,
  onClose,
  onOpenPhoto,
  onToast,
  onRemoved,
}: {
  itp: Itp
  pin: PlanPin
  settings: Settings
  photos: Photo[]
  onClose: () => void
  onOpenPhoto: (photo: Photo) => void
  onToast: (m: string) => void
  onRemoved: () => void
}) {
  const [label, setLabel] = useState(pin.label)
  const [itemNo, setItemNo] = useState(pin.itemNo ?? '')
  const [note, setNote] = useState(pin.note ?? '')

  const savePin = async (changes: Partial<PlanPin>) => {
    const known = itp.pins.some((p) => p.id === pin.id)
    await updateItp(itp.id, {
      pins: known
        ? itp.pins.map((p) => (p.id === pin.id ? { ...p, ...changes } : p))
        : // The pin was created moments ago and this render has not seen it yet.
          [...itp.pins, { ...pin, ...changes }],
    })
  }

  return (
    <Sheet title={`Pin ${pin.label}`} onClose={onClose}>
      <div className="stack">
        <div className="field-grid">
          <Field label="Pin label">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 4))}
              onBlur={() => void savePin({ label: label || pin.label })}
            />
          </Field>
          <Field label="Relates to item">
            <select
              value={itemNo}
              onChange={(e) => {
                setItemNo(e.target.value)
                void savePin({ itemNo: e.target.value || undefined })
              }}
            >
              <option value="">General location</option>
              {itp.items.map((i) => (
                <option key={i.no} value={i.no}>
                  {i.no} — {i.installation.slice(0, 50)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Note">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void savePin({ note })}
            placeholder="e.g. IO at grid 12, IL 21.30"
          />
        </Field>

        <div>
          <span className="field-label">Photos taken here ({photos.length})</span>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            Photos captured from this pin are tied to it, so the exported plan shows which locations carry evidence.
          </p>
          <PhotoCaptureButtons
            itp={itp}
            settings={settings}
            itemNo={pin.itemNo}
            pinId={pin.id}
            defaultCategory="installation"
            onCaptured={() => onToast(`Photo added at pin ${pin.label}`)}
            onError={onToast}
            label="Take photo here"
          />
          {photos.length ? (
            <div style={{ marginTop: 10 }}>
              <PhotoGrid photos={photos} onOpen={onOpenPhoto} />
            </div>
          ) : null}
        </div>

        <div className="hr" />

        <div className="row">
          <span className="spacer" />
          <ConfirmButton
            label={
              <>
                <IconTrash />
                Remove pin
              </>
            }
            confirmLabel="Tap again to remove"
            onConfirm={async () => {
              await deletePin(itp.id, pin.id)
              onToast(
                photos.length
                  ? `Pin removed — ${photos.length} photo${photos.length > 1 ? 's' : ''} kept in the record`
                  : 'Pin removed',
              )
              onRemoved()
            }}
          />
        </div>
        {photos.length ? (
          <p className="small muted" style={{ margin: 0 }}>
            Removing the pin keeps its photos on the ITP; they simply stop being located on the plan.
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}

/* --------------------------------------------------------------- signoff */

function SignOffTab({ itp, onToast }: { itp: Itp; onToast: (m: string) => void }) {
  const settings = useSettings()
  const progress = itpProgress(itp)
  const [name, setName] = useState(itp.signOff?.name ?? '')
  const [licence, setLicence] = useState(itp.signOff?.licence ?? '')
  const [dateCompleted, setDateCompleted] = useState(itp.dateCompleted ?? todayIso())
  const [signature, setSignature] = useState<string | undefined>(itp.signOff?.signature)

  // Settings are read from IndexedDB after the first render, so the defaults
  // above cannot see them. Fill the blanks once they arrive, without ever
  // overwriting something already signed or typed.
  useEffect(() => {
    setName((current) => current || itp.signOff?.name || settings.userName)
    setSignature((current) => current ?? itp.signOff?.signature ?? settings.userSignature)
  }, [settings.userName, settings.userSignature, itp.signOff])

  const [clientName, setClientName] = useState(itp.clientSignOff?.name ?? '')
  const [clientCompany, setClientCompany] = useState(itp.clientSignOff?.company ?? '')
  const [clientSignature, setClientSignature] = useState<string | undefined>(itp.clientSignOff?.signature)

  const outstanding = progress.applicable - progress.signed
  const canComplete = outstanding === 0 && progress.failed === 0

  return (
    <>
      {!canComplete ? (
        <div className="banner banner--warn" style={{ marginBottom: 12 }}>
          <IconWarn />
          <div>
            {outstanding > 0 ? `${outstanding} item${outstanding > 1 ? 's' : ''} still to be signed. ` : ''}
            {progress.failed > 0 ? `${progress.failed} item${progress.failed > 1 ? 's are' : ' is'} non-conforming. ` : ''}
            You can still sign, but the ITP will not read as complete until these are resolved.
          </div>
        </div>
      ) : (
        <div className="banner banner--ok" style={{ marginBottom: 12 }}>
          <IconCheck />
          <div>All applicable items are signed with no outstanding non-conformances.</div>
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <h3>Installer sign-off</h3>
        </div>
        <div className="card__body">
          <div className="stack">
            <div className="field-grid">
              <Field label="Name">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Licence / CP number">
                <input type="text" value={licence} onChange={(e) => setLicence(e.target.value)} />
              </Field>
              <Field label="Date completed">
                <input type="date" value={dateCompleted} onChange={(e) => setDateCompleted(e.target.value)} />
              </Field>
            </div>
            <div>
              <span className="field-label">Signature</span>
              {itp.signOff?.signature && signature === itp.signOff.signature ? (
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="sigshow" style={{ flex: 1 }}>
                    <img src={itp.signOff.signature} alt="Signature" />
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => setSignature(undefined)} type="button">
                    Re-sign
                  </button>
                </div>
              ) : (
                <SignaturePad value={signature} onChange={setSignature} />
              )}
            </div>
            <div className="row row--end">
              <button
                className="btn btn--ok"
                type="button"
                disabled={!name.trim() || !signature}
                onClick={async () => {
                  await updateItp(itp.id, {
                    signOff: { name, licence, signature, at: Date.now(), role: settings.userRole, company: settings.userCompany },
                    dateCompleted,
                    status: canComplete ? 'complete' : itp.status,
                  })
                  onToast('ITP signed off')
                }}
              >
                <IconSign />
                Sign off ITP
              </button>
            </div>
            {itp.signOff?.at ? (
              <p className="small muted" style={{ margin: 0 }}>
                Signed {formatDateTime(itp.signOff.at)}.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h3>Client / superintendent acceptance</h3>
        </div>
        <div className="card__body">
          <div className="stack">
            <div className="field-grid">
              <Field label="Name">
                <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </Field>
              <Field label="Company">
                <input type="text" value={clientCompany} onChange={(e) => setClientCompany(e.target.value)} />
              </Field>
            </div>
            <div>
              <span className="field-label">Signature</span>
              {itp.clientSignOff?.signature && clientSignature === itp.clientSignOff.signature ? (
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="sigshow" style={{ flex: 1 }}>
                    <img src={itp.clientSignOff.signature} alt="Client signature" />
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => setClientSignature(undefined)} type="button">
                    Re-sign
                  </button>
                </div>
              ) : (
                <SignaturePad value={clientSignature} onChange={setClientSignature} />
              )}
            </div>
            <div className="row row--end">
              <button
                className="btn"
                type="button"
                disabled={!clientName.trim() || !clientSignature}
                onClick={async () => {
                  await updateItp(itp.id, {
                    clientSignOff: { name: clientName, company: clientCompany, signature: clientSignature, at: Date.now() },
                    status: 'closed',
                  })
                  onToast('ITP accepted and closed out')
                }}
              >
                <IconCheck />
                Accept and close out
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- header */

function HeaderSheet({ itp, projectId, onClose }: { itp: Itp; projectId: string; onClose: () => void }) {
  const drawings = useDrawings(projectId)
  const [form, setForm] = useState({
    itpNumber: itp.itpNumber,
    title: itp.title,
    area: itp.area,
    location: itp.location,
    revision: itp.revision,
    revisionDate: itp.revisionDate,
    documentNo: itp.documentNo,
    notes: itp.notes ?? '',
  })
  const [drawingIds, setDrawingIds] = useState(itp.drawingIds)

  return (
    <Sheet title="ITP details" onClose={onClose}>
      <div className="stack">
        <Field label="Title">
          <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Area / location covered">
          <input type="text" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        </Field>
        <div className="field-grid">
          <Field label="ITP number">
            <input type="text" value={form.itpNumber} onChange={(e) => setForm({ ...form, itpNumber: e.target.value })} />
          </Field>
          <Field label="Level / grid reference">
            <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Revision">
            <input type="text" value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} />
          </Field>
          <Field label="Revision date">
            <input type="date" value={form.revisionDate} onChange={(e) => setForm({ ...form, revisionDate: e.target.value })} />
          </Field>
          <Field label="Document no.">
            <input type="text" value={form.documentNo} onChange={(e) => setForm({ ...form, documentNo: e.target.value })} />
          </Field>
        </div>
        <div>
          <span className="field-label">Drawings</span>
          {drawings.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              No drawings on this job yet.
            </p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {drawings.map((d) => (
                <label key={d.id} className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    style={{ width: 18, height: 18, minHeight: 0 }}
                    checked={drawingIds.includes(d.id)}
                    onChange={(e) =>
                      setDrawingIds(e.target.checked ? [...drawingIds, d.id] : drawingIds.filter((x) => x !== d.id))
                    }
                  />
                  <span className="small">
                    <strong>{d.number}</strong> {d.revision ? `(${d.revision})` : ''} {d.title}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              await updateItp(itp.id, { ...form, drawingIds })
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </Sheet>
  )
}
