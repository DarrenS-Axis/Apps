import { useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { createDrawing, db } from '../data/db'
import { useDrawings, useFfeTypes, useProject, useRoomItems, useRooms, useSettings, useSubmissions, useBusinessUnit } from '../data/store'
import {
  REVIEW_STATUS_LABEL,
  SUBMISSION_REVIEWERS,
  SUBMISSION_STATUS_LABEL,
  submissionStatus,
  type Drawing,
  type FfeType,
  type Room,
  type RoomItem,
  type Submission,
  type SubmissionReviewer,
} from '../data/types'
import { PlanViewer } from '../components/PlanViewer'
import { useFetchIfMissing } from '../components/useFetchIfMissing'
import { ConfirmButton, Empty, Field, IconCheck, IconDownload, IconPin, IconPlus, IconTrash, IconWarn, Sheet, Toast, useToast } from '../components/ui'
import { downloadBlob, slug, todayIso } from '../lib/format'
import { guessDrawingDetails, importPlanFile, type PlanPage } from '../lib/planImport'
import { readRegisterFile } from '../lib/xlsx'
import {
  addRoomItem,
  buildSchedule,
  checks,
  companions,
  createRoom,
  deleteFfeType,
  deleteRoom,
  deleteRoomItem,
  deleteSubmission,
  importFfe,
  locationsOf,
  nextSubmissionNo,
  parseFfeWorkbook,
  saveFfeType,
  saveSubmission,
  totals,
  updateRoom,
  updateRoomItem,
  type ParsedWorkbook,
} from '../lib/roomData'
import { scanRoomPlan, type RoomScanPage, type ScannedFfeTag } from '../lib/roomScan'
import { writeXlsx } from '../lib/xlsxWrite'
import { roomDataPdf, reviewSummary, submissionPdf } from '../lib/roomPdf'
import { withAxisLogo } from '../lib/brand'

/**
 * Room data for one project: the FF&E schedule, the rooms off the
 * architectural drawings and what is in each, the schedule the office issues
 * (PDF and Excel), and the tech data submissions for each item.
 */

type View = 'rooms' | 'plan' | 'schedule' | 'submissions'

const CHECK_COLOUR = '#d97706'

export function RoomsPage() {
  const { projectId } = useParams()
  const [search] = useSearchParams()
  const project = useProject(projectId)
  const types = useFfeTypes(projectId)
  const rooms = useRooms(projectId)
  const items = useRoomItems(projectId)
  const subs = useSubmissions(projectId)
  const drawings = useDrawings(projectId)
  const [toast, showToast] = useToast()
  const [view, setView] = useState<View>(() => (search.get('view') as View) || 'rooms')
  const [panel, setPanel] = useState<'' | 'import' | 'scan' | 'room-new' | 'type-new'>('')
  const [openRoom, setOpenRoom] = useState<string | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [openType, setOpenType] = useState<string | null>(null)
  const [openSub, setOpenSub] = useState<string | null>(search.get('open'))
  const [newSubFor, setNewSubFor] = useState<string[] | null>(null)
  const [planId, setPlanId] = useState('')
  const [dropping, setDropping] = useState(false)
  const [dropAt, setDropAt] = useState<{ x: number; y: number } | null>(null)

  const list = useMemo(() => checks(types, rooms, items), [types, rooms, items])
  const itemsByRoom = useMemo(() => {
    const m = new Map<string, RoomItem[]>()
    for (const it of items) m.set(it.roomId ?? '', [...(m.get(it.roomId ?? '') ?? []), it])
    return m
  }, [items])
  const planDrawings = useMemo(() => {
    const ids = new Set([...items.map((i) => i.drawingId), ...rooms.map((r) => r.drawingId)].filter(Boolean))
    return drawings.filter((d) => ids.has(d.id))
  }, [items, rooms, drawings])
  const activePlan = drawings.find((d) => d.id === (planId || planDrawings[0]?.id))
  const fetching = useFetchIfMissing(!project)

  if (!project) return fetching ? <Empty title="Fetching from SharePoint…" /> : <Empty title="Project not found" />

  const exportPdf = async () => {
    const blob = roomDataPdf({ project: await withAxisLogo(project), types, rooms, items, plans: planDrawings })
    downloadBlob(blob, `${slug(project.name)}_Room_Data_Schedule.pdf`)
  }
  const exportXlsx = () => {
    downloadBlob(scheduleWorkbook(project.name, types, rooms, items), `${slug(project.name)}_Room_Data_Schedule.xlsx`)
  }

  const fixtures = types.filter((t) => t.kind !== 'tapware')
  const roomById = new Map(rooms.map((r) => [r.id, r]))

  return (
    <>
      <div className="section-title">
        <h2>Room data</h2>
        <span>
          {rooms.length} rooms · {items.reduce((n, i) => n + i.qty, 0)} fixtures
        </span>
      </div>

      <div className="card">
        <div className="card__body">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => setPanel('scan')} disabled={!fixtures.length} title={fixtures.length ? undefined : 'Import the FF&E schedule first'}>
              <IconPin />
              Scan architectural plan
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setPanel('import')}>
              Import FF&amp;E schedule
            </button>
          </div>
          {!fixtures.length ? (
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              Start with the FF&amp;E schedule (the Sanitary &amp; Tapware Schedule, Excel): it says which tags to look for on the drawings — HB1, WC2, SK1 — and
              what each one is.
            </p>
          ) : null}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn--ghost btn--sm" type="button" onClick={exportPdf} disabled={!items.length}>
              <IconDownload />
              Room data schedule PDF
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={exportXlsx} disabled={!types.length}>
              <IconDownload />
              Excel
            </button>
          </div>
          {list.length ? (
            <div className="banner banner--warn" style={{ marginTop: 12 }}>
              <IconWarn />
              <span>
                {list.length} thing{list.length === 1 ? '' : 's'} to check before issue — {checkSummary(list)}.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="row segmented" style={{ margin: '12px 0 10px' }}>
        {(
          [
            ['rooms', 'Rooms'],
            ['plan', 'Plan'],
            ['schedule', 'Schedule'],
            ['submissions', `Submissions (${subs.length})`],
          ] as [View, string][]
        ).map(([k, label]) => (
          <button key={k} className={`btn btn--sm ${view === k ? '' : 'btn--ghost'}`} type="button" onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'rooms' ? (
        <>
          {list.some((c) => c.kind === 'room') ? (
            <div className="card card__body--flush">
              <div className="card__body" style={{ paddingBottom: 4 }}>
                <span className="field-label">Rooms to confirm</span>
              </div>
              {list
                .filter((c) => c.kind === 'room')
                .map((c) => (
                  <button key={c.itemId} className="listitem" type="button" onClick={() => setOpenItem(c.itemId!)}>
                    <span className="listitem__main">
                      <span className="row" style={{ gap: 6 }}>
                        <span className="chip chip--warn">Confirm</span>
                      </span>
                      <span style={{ whiteSpace: 'normal' }}>{c.text}</span>
                    </span>
                  </button>
                ))}
            </div>
          ) : null}
          <div className="card card__body--flush">
            {itemsByRoom.get('')?.length ? (
              <RoomRow title="Project wide / no room" number="" roomItems={itemsByRoom.get('') ?? []} onOpen={() => setOpenRoom('')} />
            ) : null}
            {rooms.length === 0 ? (
              <Empty title="No rooms yet" hint="Scan the architectural plan to read its rooms and fixture tags, import them from a room data schedule, or add rooms by hand." />
            ) : (
              rooms.map((r) => <RoomRow key={r.id} title={r.name} number={r.number} roomItems={itemsByRoom.get(r.id) ?? []} onOpen={() => setOpenRoom(r.id)} />)
            )}
          </div>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setPanel('room-new')}>
            <IconPlus />
            Add room
          </button>
        </>
      ) : null}

      {view === 'plan' ? (
        activePlan ? (
          <div className="card">
            <div className="card__body stack">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {planDrawings.length > 1 ? (
                  <select value={activePlan.id} onChange={(e) => setPlanId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                    {planDrawings.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.number} {d.revision} — {d.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="small" style={{ flex: 1 }}>
                    {activePlan.number} {activePlan.revision} — {activePlan.title}
                  </span>
                )}
                <button className={`btn btn--sm ${dropping ? '' : 'btn--ghost'}`} type="button" onClick={() => setDropping(!dropping)}>
                  <IconPlus />
                  {dropping ? 'Tap the plan…' : 'Add fixture on plan'}
                </button>
              </div>
              <PlanViewer
                drawing={activePlan}
                mode={dropping ? 'pin' : 'view'}
                onDropPin={(x, y) => {
                  setDropping(false)
                  setDropAt({ x, y })
                }}
                pins={items
                  .filter((i) => i.drawingId === activePlan.id && i.x !== undefined && i.y !== undefined)
                  .map((i) => ({
                    id: i.id,
                    drawingId: activePlan.id,
                    x: i.x!,
                    y: i.y!,
                    label: `${i.code}${i.roomId ? ` · ${roomById.get(i.roomId)?.number ?? ''}` : ''}`,
                    note: i.check ?? '',
                    createdAt: i.createdAt,
                  }))}
                pinColours={Object.fromEntries(items.filter((i) => i.check).map((i) => [i.id, CHECK_COLOUR]))}
                onSelectPin={(p) => setOpenItem(p.id)}
                selectedPinId={openItem ?? undefined}
                height={520}
              />
              <span className="small muted">Blue: placed. Amber: room to confirm. Tap a pin to change its room.</span>
            </div>
          </div>
        ) : (
          <Empty title="No plan yet" hint="Scan the architectural plan to place the fixtures on it." />
        )
      ) : null}

      {view === 'schedule' ? (
        <>
          <div className="card card__body--flush">
            {types.length === 0 ? (
              <Empty title="No FF&E schedule yet" hint="Import it from Excel, or add lines one at a time." />
            ) : (
              totals(types, items).map((t) => (
                <button key={t.type.id} className="listitem" type="button" onClick={() => setOpenType(t.type.id)}>
                  <span className="listitem__num listitem__num--wide">{t.type.kind === 'tapware' ? '↳' : t.type.code}</span>
                  <span className="listitem__main">
                    <strong>{t.type.kind === 'tapware' ? `${t.type.code} — ${t.type.name}` : t.type.name}</strong>
                    <span>{t.type.description.split('\n')[0]}</span>
                    <span className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                      {t.type.sampleRef ? <span className="chip">{t.type.sampleRef}</span> : null}
                      <span className={`chip ${t.scheduled !== undefined && t.scheduled !== t.placed ? 'chip--warn' : 'chip--ok'}`}>
                        {t.placed} in rooms{t.scheduled !== undefined ? ` · schedule ${t.scheduled}` : ''}
                      </span>
                      {subs.some((s) => s.ffeTypeIds.includes(t.type.id)) ? <span className="chip chip--accent">Submitted</span> : null}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setPanel('type-new')}>
            <IconPlus />
            Add schedule line
          </button>
        </>
      ) : null}

      {view === 'submissions' ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn btn--sm" type="button" onClick={() => setNewSubFor([])} disabled={!types.length}>
              <IconPlus />
              New submission
            </button>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={!types.length}
              onClick={async () => {
                const n = await createSubmissionsForAll(project.id, project.name, types, rooms, items, subs, await supplierFor(project.businessUnitId))
                showToast(n ? `${n} submission${n === 1 ? '' : 's'} drafted — one per sample reference` : 'Every schedule line already has a submission')
              }}
            >
              Draft one per sample ref
            </button>
          </div>
          <div className="card card__body--flush">
            {subs.length === 0 ? (
              <Empty title="No submissions yet" hint="Tech data / sample submission forms, filled from the schedule and the rooms." />
            ) : (
              subs.map((s) => {
                const st = submissionStatus(s)
                return (
                  <button key={s.id} className="listitem" type="button" onClick={() => setOpenSub(s.id)}>
                    <span className="listitem__main">
                      <strong>
                        {s.number} · {s.title || 'Untitled'}
                      </strong>
                      <span>{s.description.split('\n')[0]}</span>
                      <span className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                        <span className={`chip ${st === 'approved' ? 'chip--ok' : st === 'rejected' ? 'chip--hold' : st === 'approved_comments' ? 'chip--warn' : st === 'submitted' ? 'chip--surv' : ''}`}>
                          {SUBMISSION_STATUS_LABEL[st]}
                        </span>
                        {s.dateSubmitted ? <span className="chip">Submitted {s.dateSubmitted}</span> : null}
                        <span className="chip">{s.attachments.length} tech data file{s.attachments.length === 1 ? '' : 's'}</span>
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </>
      ) : null}

      {panel === 'import' ? <ImportSheet projectId={project.id} onClose={() => setPanel('')} onDone={(m) => (setPanel(''), showToast(m))} /> : null}
      {panel === 'scan' ? (
        <ScanSheet
          projectId={project.id}
          types={types}
          rooms={rooms}
          items={items}
          drawings={drawings}
          onClose={() => setPanel('')}
          onDone={(m, drawingId) => {
            setPanel('')
            setPlanId(drawingId)
            setView('plan')
            showToast(m)
          }}
        />
      ) : null}
      {panel === 'room-new' ? <RoomEditSheet projectId={project.id} onClose={() => setPanel('')} /> : null}
      {panel === 'type-new' ? <TypeSheet projectId={project.id} types={types} onClose={() => setPanel('')} onSubmission={() => undefined} /> : null}
      {openRoom !== null ? (
        <RoomSheet
          room={openRoom ? roomById.get(openRoom) : undefined}
          projectId={project.id}
          types={types}
          rooms={rooms}
          roomItems={itemsByRoom.get(openRoom) ?? []}
          onOpenItem={(id) => setOpenItem(id)}
          onClose={() => setOpenRoom(null)}
        />
      ) : null}
      {openItem ? <ItemSheet item={items.find((i) => i.id === openItem)} types={types} rooms={rooms} onClose={() => setOpenItem(null)} onToast={showToast} /> : null}
      {dropAt && activePlan ? (
        <DropSheet projectId={project.id} drawing={activePlan} at={dropAt} fixtures={fixtures} rooms={rooms} onClose={() => setDropAt(null)} onToast={showToast} />
      ) : null}
      {openType ? (
        <TypeSheet
          projectId={project.id}
          type={types.find((t) => t.id === openType)}
          types={types}
          onClose={() => setOpenType(null)}
          onSubmission={(t) => {
            setOpenType(null)
            setView('submissions')
            const existing = subs.find((s) => s.ffeTypeIds.includes(t.id))
            if (existing) setOpenSub(existing.id)
            else setNewSubFor([t.id])
          }}
        />
      ) : null}
      {newSubFor ? (
        <SubmissionSheet
          projectId={project.id}
          initialTypeIds={newSubFor}
          types={types}
          rooms={rooms}
          items={items}
          subs={subs}
          onClose={() => setNewSubFor(null)}
          onToast={showToast}
        />
      ) : null}
      {openSub ? (
        <SubmissionSheet
          projectId={project.id}
          sub={subs.find((s) => s.id === openSub)}
          types={types}
          rooms={rooms}
          items={items}
          subs={subs}
          onClose={() => setOpenSub(null)}
          onToast={showToast}
        />
      ) : null}
      <Toast message={toast} />
    </>
  )
}

function RoomRow({ title, number, roomItems, onOpen }: { title: string; number: string; roomItems: RoomItem[]; onOpen: () => void }) {
  const byCode = new Map<string, number>()
  for (const i of roomItems) byCode.set(i.code, (byCode.get(i.code) ?? 0) + i.qty)
  const toCheck = roomItems.filter((i) => i.check).length
  return (
    <button className="listitem" type="button" onClick={onOpen}>
      {number ? <span className="listitem__num listitem__num--wide">{number}</span> : null}
      <span className="listitem__main">
        <strong>{title}</strong>
        <span className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
          {[...byCode].map(([code, n]) => (
            <span key={code} className="chip chip--surv">
              {code}
              {n > 1 ? ` × ${n}` : ''}
            </span>
          ))}
          {roomItems.length === 0 ? <span className="chip">No fixtures</span> : null}
          {toCheck ? <span className="chip chip--warn">{toCheck} to confirm</span> : null}
        </span>
      </span>
    </button>
  )
}

/** "2 rooms to confirm, 1 quantity not matching" — only what there is. */
function checkSummary(list: { kind: string }[]): string {
  const n = (k: string) => list.filter((c) => c.kind === k).length
  const parts: [number, string, string][] = [
    [n('room'), 'room to confirm', 'rooms to confirm'],
    [n('missing'), 'schedule item not placed', 'schedule items not placed'],
    [n('quantity'), 'quantity not matching', 'quantities not matching'],
    [n('unknown'), 'code not on the schedule', 'codes not on the schedule'],
    [n('unassigned'), 'fixture not in a room', 'fixtures not in a room'],
  ]
  return parts
    .filter(([c]) => c)
    .map(([c, one, many]) => `${c} ${c === 1 ? one : many}`)
    .join(', ')
}

/* -------------------------------------------------------------- import */

function ImportSheet({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [parsed, setParsed] = useState<(ParsedWorkbook & { file: string }) | null>(null)
  const [error, setError] = useState('')
  const [withRooms, setWithRooms] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <Sheet title="Import FF&E schedule" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          The Sanitary &amp; Tapware Schedule — Sample Ref · Sanitary Code · Tapware Code · Quantity · Selection / Description · Colour / Finish. A workbook with
          a room data sheet (Room Type / Area · Room No. · Code …) brings its rooms and fixtures in too. Codes already here are updated, not duplicated.
        </p>
        <input
          type="file"
          accept=".xlsx,.csv"
          aria-label="FF&E schedule file"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setError('')
            try {
              setParsed({ ...parseFfeWorkbook(await readRegisterFile(f)), file: f.name })
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not read that file.')
            }
          }}
        />
        {error ? <div className="banner banner--hold">{error}</div> : null}
        {parsed ? (
          <>
            <div className="banner banner--info">
              <span>
                {parsed.types.filter((t) => t.kind === 'fixture').length} fixtures and {parsed.types.filter((t) => t.kind === 'tapware').length} tapware lines
                {parsed.roomData ? `, and ${parsed.roomData.rooms.length} rooms holding ${parsed.roomData.items.length} fixtures` : ''} — from {parsed.sheets.join(', ')}.
              </span>
            </div>
            <div className="chips-wrap">
              {parsed.types.map((t) => (
                <span key={t.code} className={`chip ${t.kind === 'tapware' ? '' : 'chip--surv'}`} title={t.name}>
                  {t.code}
                </span>
              ))}
            </div>
            {parsed.roomData ? (
              <label className="check">
                <input type="checkbox" checked={withRooms} onChange={(e) => setWithRooms(e.target.checked)} />
                Bring in its rooms and room fixtures too
              </label>
            ) : null}
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
                  const r = await importFfe(projectId, parsed, withRooms)
                  onDone(`${r.types} schedule lines${r.rooms || r.items ? `, ${r.rooms} rooms, ${r.items} room fixtures` : ''} imported`)
                }}
              >
                Import
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}

/* ---------------------------------------------------------------- scan */

interface ScanResult {
  plan: PlanPage
  scan: RoomScanPage
  number: string
  title: string
  revision: string
}

function ScanSheet({
  projectId,
  types,
  rooms,
  items,
  drawings,
  onClose,
  onDone,
}: {
  projectId: string
  types: FfeType[]
  rooms: Room[]
  items: RoomItem[]
  drawings: Drawing[]
  onClose: () => void
  onDone: (m: string, drawingId: string) => void
}) {
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [choice, setChoice] = useState<Record<number, string>>({})
  // Tags someone has answered — the scan's guess alone stays flagged.
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const codes = types.filter((t) => t.kind !== 'tapware').map((t) => t.code)

  const read = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setResult(null)
    try {
      setProgress('Reading the drawing…')
      const scans = await scanRoomPlan(file, {
        codes,
        onProgress: (p) => setProgress(p.stage === 'walls' ? `Tracing the walls on sheet ${p.page}…` : `Reading rooms and tags on sheet ${p.page} of ${p.total}…`),
      })
      const best = [...scans].sort((a, b) => b.tags.length + b.rooms.length / 10 - (a.tags.length + a.rooms.length / 10))[0]
      if (!best || (!best.tags.length && !best.rooms.length)) {
        setError(`No rooms or schedule tags (${codes.join(', ')}) found. The drawing needs its text searchable — a scanned image cannot be read.`)
        return
      }
      setProgress('Rendering the sheet…')
      const plan = await importPlanFile(file)
      const page = plan.pages.find((p) => p.page === best.page) ?? plan.pages[0]
      const guess = guessDrawingDetails(page, file.name)
      setResult({ plan: page, scan: best, number: guess.number ?? file.name.replace(/\.pdf$/i, ''), title: guess.title ?? 'FF&E plan', revision: guess.revision ?? '' })
      setChoice(Object.fromEntries(best.tags.map((t, i) => [i, t.roomNumber ?? ''])))
      setPicked(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that drawing.')
    } finally {
      setProgress('')
    }
  }

  const byCode = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of result?.scan.tags ?? []) m.set(t.code, (m.get(t.code) ?? 0) + 1)
    return [...m]
  }, [result])

  const preview: Drawing | undefined = result
    ? {
        id: 'preview',
        projectId,
        number: result.number,
        title: result.title,
        revision: result.revision,
        discipline: 'Architectural',
        imageData: result.plan.data,
        imageWidth: result.plan.width,
        imageHeight: result.plan.height,
        createdAt: 0,
        updatedAt: 0,
      }
    : undefined
  const roomName = (no: string) => result?.scan.rooms.find((r) => r.number === no)?.name ?? rooms.find((r) => r.number === no)?.name ?? ''
  const flagged = result?.scan.tags.map((t, i) => ({ t, i })).filter(({ t }) => t.check) ?? []

  const create = async () => {
    if (!result) return
    setBusy(true)
    try {
      // The same sheet scanned again lands on the same drawing and adds nothing twice.
      const same = drawings.find((d) => d.number === result.number.trim() && (d.revision ?? '') === result.revision.trim())
      const drawing =
        same ??
        (await createDrawing({
          projectId,
          number: result.number.trim(),
          title: result.title.trim(),
          revision: result.revision.trim(),
          discipline: 'Architectural — FF&E',
          imageData: result.plan.data,
          imageWidth: result.plan.width,
          imageHeight: result.plan.height,
          thumbData: result.plan.thumb,
        }))
      const byNo = new Map(rooms.map((r) => [r.number.toUpperCase(), r]))
      let roomsAdded = 0
      for (const r of result.scan.rooms) {
        const had = byNo.get(r.number.toUpperCase())
        if (had) {
          if (had.drawingId === undefined) await updateRoom(had.id, { drawingId: drawing.id, x: r.x, y: r.y })
          continue
        }
        const room = await createRoom(projectId, { number: r.number, name: r.name })
        await updateRoom(room.id, { drawingId: drawing.id, x: r.x, y: r.y })
        byNo.set(r.number.toUpperCase(), { ...room, drawingId: drawing.id, x: r.x, y: r.y })
        roomsAdded++
      }
      const onSheet = items.filter((i) => i.drawingId === drawing.id && i.x !== undefined)
      const unplaced = items.filter((i) => i.x === undefined).map((i) => ({ ...i }))
      let added = 0
      let skipped = 0
      for (const [i, t] of result.scan.tags.entries()) {
        if (onSheet.some((p) => p.code.toUpperCase() === t.code.toUpperCase() && Math.hypot(p.x! - t.x, p.y! - t.y) < 0.006)) {
          skipped++
          continue
        }
        const chosen = choice[i] ?? t.roomNumber ?? ''
        const room = chosen ? byNo.get(chosen.toUpperCase()) : undefined
        const alt = t.altRoomNumber ? byNo.get(t.altRoomNumber.toUpperCase()) : undefined
        // A room someone picked in the preview is confirmed; a guess stays flagged.
        const confirmed = Boolean(t.check) && picked.has(i)
        // A fixture the room data already lists for this room (imported, not
        // yet on a plan) is the same fixture: pin it rather than count it twice.
        const listed = room ? unplaced.find((u) => u.roomId === room.id && u.code.toUpperCase() === t.code.toUpperCase() && u.qty > 0) : undefined
        if (listed) {
          const pin = { drawingId: drawing.id, x: t.x, y: t.y, check: confirmed ? undefined : t.check, altRoomId: alt?.id }
          if (listed.qty === 1) {
            await updateRoomItem(listed.id, pin)
            unplaced.splice(unplaced.indexOf(listed), 1)
          } else {
            listed.qty -= 1
            await updateRoomItem(listed.id, { qty: listed.qty })
            await addRoomItem(projectId, { roomId: room!.id, code: listed.code, qty: 1, source: 'plan', note: listed.note, ...pin })
          }
          added++
          continue
        }
        await addRoomItem(projectId, {
          roomId: room?.id,
          code: t.code,
          qty: 1,
          drawingId: drawing.id,
          x: t.x,
          y: t.y,
          source: 'plan',
          check: confirmed ? undefined : t.check,
          altRoomId: alt?.id,
        })
        added++
      }
      onDone(
        [`${added} fixtures placed in rooms`, roomsAdded ? `${roomsAdded} rooms added` : '', skipped ? `${skipped} already on this sheet` : ''].filter(Boolean).join(' · '),
        drawing.id,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Scan architectural plan" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          The FF&amp;E plan as a PDF. Rooms are read from their name and number, and every tag on the FF&amp;E schedule ({codes.slice(0, 8).join(', ')}
          {codes.length > 8 ? '…' : ''}) is pinned and put in the room it sits in — decided by the walls, and by the nearest room label for small rooms
          labelled outside. Where the two disagree you are asked. Repeated enlargements (a 1:50 of a room already on the 1:100) are not counted twice.
        </p>
        <input type="file" accept="application/pdf,.pdf" aria-label="Architectural plan PDF" onChange={(e) => read(e.target.files?.[0])} />
        {progress ? <div className="banner banner--info">{progress}</div> : null}
        {error ? <div className="banner banner--hold">{error}</div> : null}
        {result && preview ? (
          <>
            <div className="banner banner--ok">
              <span>
                {result.scan.tags.length} schedule tags in {new Set(result.scan.tags.map((t) => t.roomNumber)).size} rooms, of {result.scan.rooms.length} rooms on the
                sheet — {result.scan.tags.length - flagged.length} placed, {flagged.length} to confirm below.
                {result.scan.repeated.length ? ` ${result.scan.repeated.length} more in a repeated enlargement, not counted.` : ''}
              </span>
            </div>
            <div className="chips-wrap">
              {byCode.map(([c, n]) => (
                <span key={c} className="chip chip--surv">
                  {c} × {n}
                </span>
              ))}
            </div>
            {result.scan.otherTags.length ? (
              <p className="small muted" style={{ margin: 0 }}>
                Other trades&apos; tags on the sheet, not on the schedule: {result.scan.otherTags.slice(0, 10).map(([c, n]) => `${c} × ${n}`).join(', ')}
                {result.scan.otherTags.length > 10 ? '…' : ''}
              </p>
            ) : null}
            <PlanViewer
              drawing={preview}
              pins={result.scan.tags.map((t, i) => ({ id: `t${i}`, drawingId: 'preview', x: t.x, y: t.y, label: `${t.code} · ${choice[i] || '?'}`, note: t.check ?? '', createdAt: 0 }))}
              pinColours={Object.fromEntries(flagged.map(({ i }) => [`t${i}`, CHECK_COLOUR]))}
              height={380}
            />
            {flagged.length ? (
              <div className="stack" style={{ gap: 8 }}>
                <span className="field-label">Which room? ({flagged.length})</span>
                {flagged.map(({ t, i }) => (
                  <FlaggedTag
                    key={i}
                    tag={t}
                    value={choice[i] ?? ''}
                    picked={picked.has(i)}
                    rooms={result.scan.rooms}
                    roomName={roomName}
                    onChange={(v) => {
                      setChoice({ ...choice, [i]: v })
                      setPicked(new Set(picked).add(i))
                    }}
                  />
                ))}
                <span className="small muted">Tap the right room for each. One left on its best guess goes in that room but stays flagged in the room data until someone confirms it.</span>
              </div>
            ) : null}
            <div className="field-grid">
              <Field label="Drawing number">
                <input type="text" value={result.number} onChange={(e) => setResult({ ...result, number: e.target.value })} />
              </Field>
              <Field label="Revision">
                <input type="text" value={result.revision} onChange={(e) => setResult({ ...result, revision: e.target.value })} />
              </Field>
            </div>
            <div className="row row--end">
              <button className="btn btn--ghost" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="btn" type="button" disabled={busy} onClick={create}>
                <IconCheck />
                Place {result.scan.tags.length} fixtures
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}

function FlaggedTag({
  tag,
  value,
  picked,
  rooms,
  roomName,
  onChange,
}: {
  tag: ScannedFfeTag
  value: string
  picked: boolean
  rooms: { number: string; name: string }[]
  roomName: (no: string) => string
  onChange: (v: string) => void
}) {
  const options = [tag.roomNumber, tag.altRoomNumber].filter(Boolean) as string[]
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card__body stack" style={{ gap: 6 }}>
        <span className="small">
          <strong>{tag.code}</strong> — {tag.check}
        </span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {options.map((no) => (
            <button
              key={no}
              className={`btn btn--sm ${picked && value === no ? '' : 'btn--ghost'}`}
              type="button"
              aria-pressed={picked && value === no}
              onClick={() => onChange(no)}
            >
              {roomName(no)} {no}
              {!picked && value === no ? ' · best guess' : ''}
            </button>
          ))}
          <select aria-label={`Room for ${tag.code}`} value={options.includes(value) ? '' : value} onChange={(e) => e.target.value && onChange(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
            <option value="">Another room…</option>
            {rooms.map((r) => (
              <option key={r.number} value={r.number}>
                {r.number} {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- rooms */

function RoomEditSheet({ projectId, room, onClose }: { projectId: string; room?: Room; onClose: () => void }) {
  const [number, setNumber] = useState(room?.number ?? '')
  const [name, setName] = useState(room?.name ?? '')
  const [level, setLevel] = useState(room?.level ?? '')
  return (
    <Sheet title={room ? `Room ${room.number}` : 'Add room'} onClose={onClose}>
      <div className="stack">
        <div className="field-grid">
          <Field label="Room no.">
            <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="04A.G.03" />
          </Field>
          <Field label="Room type / area">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="HOT LAB" />
          </Field>
          <Field label="Level">
            <input type="text" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Ground Floor" />
          </Field>
        </div>
        <div className="row row--end">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            disabled={!number.trim() || !name.trim()}
            onClick={async () => {
              if (room) await updateRoom(room.id, { number: number.trim(), name: name.trim(), level: level.trim() || undefined })
              else await createRoom(projectId, { number, name, level: level.trim() || undefined })
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

function RoomSheet({
  room,
  projectId,
  types,
  rooms,
  roomItems,
  onOpenItem,
  onClose,
}: {
  room?: Room
  projectId: string
  types: FfeType[]
  rooms: Room[]
  roomItems: RoomItem[]
  onOpenItem: (id: string) => void
  onClose: () => void
}) {
  const [adding, setAdding] = useState('')
  const [qty, setQty] = useState(1)
  const [editing, setEditing] = useState(false)
  const fixtures = types.filter((t) => t.kind !== 'tapware')
  const typeOf = (code: string) => types.find((t) => t.code.toUpperCase() === code.toUpperCase())
  if (editing && room) return <RoomEditSheet projectId={projectId} room={room} onClose={() => setEditing(false)} />
  return (
    <Sheet
      title={room ? `${room.name} ${room.number}` : 'Project wide / no room'}
      onClose={onClose}
      footer={
        room ? (
          <div className="row" style={{ gap: 8 }}>
            <ConfirmButton
              className="btn btn--ghost btn--sm recordfoot__delete"
              label={
                <>
                  <IconTrash />
                  Delete room
                </>
              }
              confirmLabel="Tap again — its fixtures become unassigned"
              onConfirm={async () => {
                await deleteRoom(room.id)
                onClose()
              }}
            />
            <span className="spacer" />
            <button className="btn btn--ghost" type="button" onClick={() => setEditing(true)}>
              Rename
            </button>
            <button className="btn" type="button" onClick={onClose}>
              <IconCheck />
              Done
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="stack">
        {roomItems.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No fixtures in this room yet.</p> : null}
        {roomItems.map((it) => {
          const t = typeOf(it.code)
          return (
            <div key={it.id} className="card" style={{ margin: 0 }}>
              <div className="card__body stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="chip chip--surv">{it.code}</span>
                  <strong className="small" style={{ flex: 1 }}>
                    {t?.name ?? 'Not in the FF&E schedule'}
                  </strong>
                  <input
                    type="number"
                    min={0}
                    aria-label={`Quantity of ${it.code}`}
                    value={it.qty}
                    onChange={(e) => void updateRoomItem(it.id, { qty: Math.max(0, Number(e.target.value) || 0) })}
                    style={{ width: 64 }}
                  />
                </div>
                {companions(types, it.code).map((c) => (
                  <span key={c.id} className="small muted">
                    ↳ {c.code} — {c.name}
                  </span>
                ))}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {it.check ? <span className="chip chip--warn">Room to confirm</span> : null}
                  {it.drawingId ? <span className="chip">On the plan</span> : <span className="chip">Added by hand</span>}
                  {it.note ? <span className="chip">{it.note}</span> : null}
                  <span className="spacer" />
                  <button className="btn btn--ghost btn--sm" type="button" onClick={() => onOpenItem(it.id)}>
                    Move / details
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="Fixture to add" value={adding} onChange={(e) => setAdding(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
            <option value="">Add a fixture…</option>
            {fixtures.map((t) => (
              <option key={t.id} value={t.code}>
                {t.code} — {t.name}
              </option>
            ))}
          </select>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64 }} aria-label="Quantity to add" />
          <button
            className="btn btn--sm"
            type="button"
            disabled={!adding}
            onClick={async () => {
              await addRoomItem(projectId, { roomId: room?.id, code: adding, qty, source: 'manual' })
              setAdding('')
              setQty(1)
            }}
          >
            <IconPlus />
            Add
          </button>
        </div>
        {rooms.length === 0 ? null : null}
      </div>
    </Sheet>
  )
}

function ItemSheet({ item, types, rooms, onClose, onToast }: { item?: RoomItem; types: FfeType[]; rooms: Room[]; onClose: () => void; onToast: (m: string) => void }) {
  if (!item) return null
  const alt = rooms.find((r) => r.id === item.altRoomId)
  const current = rooms.find((r) => r.id === item.roomId)
  const setRoom = async (roomId: string) => {
    await updateRoomItem(item.id, { roomId: roomId || undefined, check: undefined })
    const r = rooms.find((x) => x.id === roomId)
    onToast(`${item.code} → ${r ? `${r.name} ${r.number}` : 'no room'}`)
  }
  return (
    <Sheet
      title={`${item.code}${current ? ` · ${current.name} ${current.number}` : ''}`}
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 8 }}>
          <ConfirmButton
            className="btn btn--ghost btn--sm recordfoot__delete"
            label={
              <>
                <IconTrash />
                Remove
              </>
            }
            confirmLabel="Tap again to remove"
            onConfirm={async () => {
              await deleteRoomItem(item.id)
              onClose()
            }}
          />
          <span className="spacer" />
          {item.check ? (
            <button
              className="btn"
              type="button"
              onClick={async () => {
                await updateRoomItem(item.id, { check: undefined })
                onToast(`${item.code} confirmed in ${current ? `${current.name} ${current.number}` : 'no room'}`)
                onClose()
              }}
            >
              <IconCheck />
              Room is right
            </button>
          ) : (
            <button className="btn" type="button" onClick={onClose}>
              <IconCheck />
              Done
            </button>
          )}
        </div>
      }
    >
      <div className="stack">
        {item.check ? <div className="banner banner--warn">{item.check}</div> : null}
        {alt && alt.id !== item.roomId ? (
          <button className="btn btn--ghost" type="button" onClick={() => void setRoom(alt.id).then(onClose)}>
            Move to {alt.name} {alt.number}
          </button>
        ) : null}
        <Field label="Room">
          <select value={item.roomId ?? ''} onChange={(e) => void setRoom(e.target.value)}>
            <option value="">Project wide / no room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number} {r.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-grid">
          <Field label="Fixture">
            <select value={item.code} onChange={(e) => void updateRoomItem(item.id, { code: e.target.value })}>
              {types
                .filter((t) => t.kind !== 'tapware')
                .map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.code} — {t.name}
                  </option>
                ))}
              {types.some((t) => t.code === item.code) ? null : <option value={item.code}>{item.code}</option>}
            </select>
          </Field>
          <Field label="Quantity">
            <input type="number" min={0} value={item.qty} onChange={(e) => void updateRoomItem(item.id, { qty: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
        </div>
        <Field label="Note">
          <input type="text" value={item.note ?? ''} onChange={(e) => void updateRoomItem(item.id, { note: e.target.value || undefined })} placeholder="e.g. handing to suit, confirm with architect" />
        </Field>
      </div>
    </Sheet>
  )
}

/** A fixture added on the plan by tapping: its room defaults to the nearest room label. */
function DropSheet({
  projectId,
  drawing,
  at,
  fixtures,
  rooms,
  onClose,
  onToast,
}: {
  projectId: string
  drawing: Drawing
  at: { x: number; y: number }
  fixtures: FfeType[]
  rooms: Room[]
  onClose: () => void
  onToast: (m: string) => void
}) {
  const aspect = (drawing.imageWidth ?? 1) / (drawing.imageHeight ?? 1)
  const nearest = rooms
    .filter((r) => r.drawingId === drawing.id && r.x !== undefined && r.y !== undefined)
    .map((r) => ({ r, d: Math.hypot((r.x! - at.x) * aspect, r.y! - at.y) }))
    .sort((a, b) => a.d - b.d)[0]?.r
  const [code, setCode] = useState(fixtures[0]?.code ?? '')
  const [roomId, setRoomId] = useState(nearest?.id ?? '')
  return (
    <Sheet title="Add fixture here" onClose={onClose}>
      <div className="stack">
        <div className="field-grid">
          <Field label="Fixture">
            <select value={code} onChange={(e) => setCode(e.target.value)}>
              {fixtures.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room" hint={nearest ? 'Nearest room label — change it if the fixture is in another room.' : undefined}>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Project wide / no room</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} {r.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row row--end">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            disabled={!code}
            onClick={async () => {
              await addRoomItem(projectId, { roomId: roomId || undefined, code, qty: 1, drawingId: drawing.id, x: at.x, y: at.y, source: 'manual' })
              onToast(`${code} added`)
              onClose()
            }}
          >
            Add
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------ schedule */

function TypeSheet({ projectId, type, types, onClose, onSubmission }: { projectId: string; type?: FfeType; types: FfeType[]; onClose: () => void; onSubmission: (t: FfeType) => void }) {
  const [t, setT] = useState({
    code: type?.code ?? '',
    kind: type?.kind ?? ('fixture' as FfeType['kind']),
    goesWith: type?.goesWith.join(', ') ?? '',
    name: type?.name ?? '',
    description: type?.description ?? '',
    finish: type?.finish ?? '',
    sampleRef: type?.sampleRef ?? '',
    scheduledQty: type?.scheduledQty !== undefined ? String(type.scheduledQty) : '',
    inWall: type?.inWall ?? '',
  })
  const save = async () => {
    await saveFfeType(projectId, {
      id: type?.id,
      code: t.code.trim(),
      kind: t.kind,
      goesWith: t.goesWith.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      name: t.name.trim(),
      description: t.description.trim(),
      finish: t.finish.trim(),
      sampleRef: t.sampleRef.trim(),
      scheduledQty: t.scheduledQty ? Number(t.scheduledQty) : undefined,
      inWall: t.inWall.trim() || undefined,
    })
    onClose()
  }
  return (
    <Sheet
      title={type ? `${type.code} — ${type.name}` : 'Add schedule line'}
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 8 }}>
          {type ? (
            <ConfirmButton
              className="btn btn--ghost btn--sm recordfoot__delete"
              label={
                <>
                  <IconTrash />
                  Delete
                </>
              }
              confirmLabel="Tap again to delete"
              onConfirm={async () => {
                await deleteFfeType(type.id)
                onClose()
              }}
            />
          ) : null}
          <span className="spacer" />
          {type ? (
            <button className="btn btn--ghost" type="button" onClick={() => onSubmission(type)}>
              Submission
            </button>
          ) : null}
          <button className="btn" type="button" disabled={!t.code.trim()} onClick={save}>
            <IconCheck />
            Save
          </button>
        </div>
      }
    >
      <div className="stack">
        <div className="field-grid">
          <Field label="Code (as tagged)">
            <input type="text" value={t.code} onChange={(e) => setT({ ...t, code: e.target.value })} placeholder="HB1, or HB1 - Basin Mixer" />
          </Field>
          <Field label="Kind">
            <select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value as FfeType['kind'] })}>
              <option value="fixture">Fixture (tagged on the plan)</option>
              <option value="tapware">Tapware / goes with a fixture</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Goes with" hint="Fixture codes this comes with — e.g. HB2, HB3 for a bottle trap.">
            <input type="text" value={t.goesWith} onChange={(e) => setT({ ...t, goesWith: e.target.value })} placeholder="HB1" />
          </Field>
          <Field label="Sample ref.">
            <input type="text" value={t.sampleRef} onChange={(e) => setT({ ...t, sampleRef: e.target.value })} placeholder="SAF-HYD102" />
          </Field>
          <Field label="Fixture / item">
            <input type="text" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="Hand Basin - Clinical" />
          </Field>
          <Field label="Colour / finish">
            <input type="text" value={t.finish} onChange={(e) => setT({ ...t, finish: e.target.value })} />
          </Field>
          <Field label="Schedule quantity">
            <input type="number" min={0} value={t.scheduledQty} onChange={(e) => setT({ ...t, scheduledQty: e.target.value })} />
          </Field>
          <Field label="In wall items">
            <input type="text" value={t.inWall} onChange={(e) => setT({ ...t, inWall: e.target.value })} />
          </Field>
        </div>
        <Field label="Selection / description">
          <textarea rows={4} value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} />
        </Field>
        {types.length ? null : null}
      </div>
    </Sheet>
  )
}

/* --------------------------------------------------------- submissions */

async function supplierFor(businessUnitId: string): Promise<string> {
  const unit = await db.businessUnits.get(businessUnitId)
  return unit ? `${unit.entity} PTY LTD` : 'Axis'
}

function draftSubmission(projectId: string, number: string, picked: FfeType[], types: FfeType[], rooms: Room[], items: RoomItem[], supplier: string, madeBy?: string): Submission {
  const codes = picked.map((t) => t.code)
  return {
    id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    projectId,
    number,
    discipline: 'HYDRAULICS',
    specified: 'YES',
    supplier,
    photoAttached: 'Refer Tech Data',
    location: locationsOf(codes, types, rooms, items),
    techDataIncluded: true,
    title: codes.join(', '),
    description: picked
      .map((t) => [t.name, t.description.split('\n').filter((l) => !/^refer|^\(/i.test(l)).join(' '), t.finish ? `Finish: ${t.finish}` : ''].filter(Boolean).join(' — '))
      .join('\n'),
    ffeTypeIds: picked.map((t) => t.id),
    attachments: [],
    reviews: {},
    madeBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/** One draft per sample reference not yet covered — how the sample register runs. */
async function createSubmissionsForAll(projectId: string, _name: string, types: FfeType[], rooms: Room[], items: RoomItem[], subs: Submission[], supplier: string): Promise<number> {
  const covered = new Set(subs.flatMap((s) => s.ffeTypeIds))
  const groups = new Map<string, FfeType[]>()
  for (const t of types) {
    if (covered.has(t.id) || !/\d/.test(t.sampleRef)) continue
    groups.set(t.sampleRef, [...(groups.get(t.sampleRef) ?? []), t])
  }
  const all = [...subs]
  for (const picked of groups.values()) {
    const sub = draftSubmission(projectId, nextSubmissionNo(all), picked, types, rooms, items, supplier)
    all.push(sub)
    await saveSubmission(sub)
  }
  return groups.size
}

function SubmissionSheet({
  projectId,
  sub,
  initialTypeIds,
  types,
  rooms,
  items,
  subs,
  onClose,
  onToast,
}: {
  projectId: string
  sub?: Submission
  initialTypeIds?: string[]
  types: FfeType[]
  rooms: Room[]
  items: RoomItem[]
  subs: Submission[]
  onClose: () => void
  onToast: (m: string) => void
}) {
  const settings = useSettings()
  const project = useProject(projectId)
  const unit = useBusinessUnit(project?.businessUnitId)
  const [s, setS] = useState<Submission | null>(() => {
    if (sub) return sub
    const picked = types.filter((t) => initialTypeIds?.includes(t.id))
    return draftSubmission(projectId, nextSubmissionNo(subs), picked, types, rooms, items, unit ? `${unit.entity} PTY LTD` : '', settings.userName || undefined)
  })
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  if (!s) return null
  const set = (patch: Partial<Submission>) => setS({ ...s, ...patch })
  const setReview = (k: SubmissionReviewer, patch: Partial<NonNullable<Submission['reviews'][SubmissionReviewer]>>) =>
    set({ reviews: { ...s.reviews, [k]: { status: '', ...s.reviews[k], ...patch } } })
  const pickTypes = (ids: string[]) => {
    const picked = types.filter((t) => ids.includes(t.id))
    const codes = picked.map((t) => t.code)
    set({ ffeTypeIds: ids, title: codes.join(', '), location: locationsOf(codes, types, rooms, items) })
  }
  const save = async (then?: 'close') => {
    await saveSubmission(s)
    onToast(`${s.number} saved`)
    if (then === 'close') onClose()
  }
  const st = submissionStatus(s)

  return (
    <Sheet
      title={`Submission ${s.number}`}
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {sub ? (
            <ConfirmButton
              className="btn btn--ghost btn--sm recordfoot__delete"
              label={
                <>
                  <IconTrash />
                  Delete
                </>
              }
              confirmLabel="Tap again to delete"
              onConfirm={async () => {
                await deleteSubmission(sub.id)
                onClose()
              }}
            />
          ) : null}
          <span className="spacer" />
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy || !project}
            onClick={async () => {
              if (!project) return
              setBusy(true)
              try {
                await saveSubmission(s)
                downloadBlob(await submissionPdf({ project: await withAxisLogo(project), sub: s }), `${s.number}.pdf`)
              } finally {
                setBusy(false)
              }
            }}
          >
            <IconDownload />
            {busy ? 'Building…' : 'PDF'}
          </button>
          <button className="btn" type="button" onClick={() => void save('close')}>
            <IconCheck />
            Save
          </button>
        </div>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="chip">{SUBMISSION_STATUS_LABEL[st]}</span>
          {reviewSummary(s) ? <span className="small muted">{reviewSummary(s)}</span> : null}
        </div>
        <div>
          <span className="field-label">Schedule items it covers</span>
          <div className="chips-wrap">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`chip chip-toggle ${s.ffeTypeIds.includes(t.id) ? 'chip--accent' : ''}`}
                aria-pressed={s.ffeTypeIds.includes(t.id)}
                onClick={() => pickTypes(s.ffeTypeIds.includes(t.id) ? s.ffeTypeIds.filter((x) => x !== t.id) : [...s.ffeTypeIds, t.id])}
              >
                {t.code}
              </button>
            ))}
          </div>
        </div>
        <div className="field-grid">
          <Field label="SC / ALA sample no.">
            <input type="text" value={s.number} onChange={(e) => set({ number: e.target.value })} />
          </Field>
          <Field label={`${project?.client || 'Builder'} sample no.`}>
            <input type="text" value={s.builderNo ?? ''} onChange={(e) => set({ builderNo: e.target.value })} placeholder="001" />
          </Field>
          <Field label="Date submitted">
            <input type="date" value={s.dateSubmitted ?? ''} onChange={(e) => set({ dateSubmitted: e.target.value || undefined, submittedAt: e.target.value ? Date.now() : undefined })} />
          </Field>
          <Field label="Discipline">
            <input type="text" value={s.discipline} onChange={(e) => set({ discipline: e.target.value })} />
          </Field>
          <Field label="Specified">
            <select value={s.specified} onChange={(e) => set({ specified: e.target.value as Submission['specified'] })}>
              <option value="YES">YES</option>
              <option value="NO">NO</option>
              <option value="ALTERNATIVE">ALTERNATIVE</option>
            </select>
          </Field>
          <Field label="Subcontractor / supplier">
            <input type="text" value={s.supplier} onChange={(e) => set({ supplier: e.target.value })} />
          </Field>
          <Field label="Photo attached">
            <input type="text" value={s.photoAttached} onChange={(e) => set({ photoAttached: e.target.value })} />
          </Field>
          <Field label="Sample title">
            <input type="text" value={s.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
        </div>
        <Field label="Location" hint="Filled from the room data.">
          <textarea rows={2} value={s.location} onChange={(e) => set({ location: e.target.value })} />
        </Field>
        <Field label="Description of submission">
          <textarea rows={4} value={s.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>

        <div>
          <span className="field-label">Tech data ({s.attachments.length})</span>
          <div className="stack" style={{ gap: 6 }}>
            {s.attachments.map((a) => (
              <div key={a.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="chip">{/pdf/i.test(a.mime ?? a.name) ? 'PDF' : 'Image'}</span>
                <span className="small" style={{ flex: 1, overflowWrap: 'anywhere' }}>
                  {a.name}
                </span>
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => set({ attachments: s.attachments.filter((x) => x.id !== a.id) })}>
                  Remove
                </button>
              </div>
            ))}
            <input
              ref={fileRef}
              className="visually-hidden"
              type="file"
              multiple
              accept="application/pdf,image/*"
              aria-label="Tech data files"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? [])
                const added = await Promise.all(
                  files.map(
                    (f) =>
                      new Promise<Submission['attachments'][number]>((resolve, reject) => {
                        const r = new FileReader()
                        r.onload = () => resolve({ id: `att_${Math.random().toString(36).slice(2, 9)}`, name: f.name, data: r.result as string, size: f.size, mime: f.type, addedAt: Date.now() })
                        r.onerror = () => reject(r.error)
                        r.readAsDataURL(f)
                      }),
                  ),
                )
                set({ attachments: [...s.attachments, ...added], techDataIncluded: true })
                if (fileRef.current) fileRef.current.value = ''
              }}
            />
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => fileRef.current?.click()} style={{ alignSelf: 'flex-start' }}>
              <IconPlus />
              Add tech data (PDF or image)
            </button>
            <span className="small muted">The data sheets print behind the form, page for page.</span>
          </div>
        </div>

        <div>
          <span className="field-label">Approval / response</span>
          <div className="stack" style={{ gap: 8 }}>
            {SUBMISSION_REVIEWERS.map(({ key, label }) => {
              const r = s.reviews[key] ?? { status: '' as const }
              return (
                <div key={key} className="card" style={{ margin: 0 }}>
                  <div className="card__body stack" style={{ gap: 8 }}>
                    <strong className="small">{label}</strong>
                    <div className="field-grid">
                      <Field label="Name">
                        <input type="text" value={r.name ?? ''} onChange={(e) => setReview(key, { name: e.target.value })} />
                      </Field>
                      <Field label="Company">
                        <input type="text" value={r.company ?? ''} onChange={(e) => setReview(key, { company: e.target.value })} />
                      </Field>
                      <Field label="Date">
                        <input type="date" value={r.date ?? ''} onChange={(e) => setReview(key, { date: e.target.value })} />
                      </Field>
                      <Field label="Status">
                        <select aria-label={`${label} status`} value={r.status} onChange={(e) => setReview(key, { status: e.target.value as typeof r.status, date: r.date || todayIso() })}>
                          {Object.entries(REVIEW_STATUS_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Comments">
                      <input type="text" value={r.comments ?? ''} onChange={(e) => setReview(key, { comments: e.target.value })} />
                    </Field>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <Field label="General comments">
          <textarea rows={2} value={s.generalComments ?? ''} onChange={(e) => set({ generalComments: e.target.value })} />
        </Field>
        <div className="field-grid">
          <Field label="Made by">
            <input type="text" value={s.madeBy ?? ''} onChange={(e) => set({ madeBy: e.target.value })} />
          </Field>
          <Field label="Date">
            <input type="date" value={s.madeDate ?? ''} onChange={(e) => set({ madeDate: e.target.value })} />
          </Field>
        </div>
      </div>
    </Sheet>
  )
}

/* -------------------------------------------------------------- export */

/** The room data schedule as the office keeps it in Excel: room data, then the sanitary & tapware schedule, then the checks. */
function scheduleWorkbook(projectName: string, types: FfeType[], rooms: Room[], items: RoomItem[]): Blob {
  const roomRows: (string | number)[][] = [[`${projectName}\nHydraulic Fixture Schedule - Room Data`], [], ['Sample Ref.', 'Room Type /Area', 'Room No.', 'Fixture', 'Code', 'Tapware Code', 'Quantity', 'In wall Items', 'Description', 'Colour /Finish']]
  const bold = [0, 2]
  const shaded: number[] = []
  let level = ''
  for (const g of buildSchedule(types, rooms, items)) {
    if (g.room?.level && g.room.level !== level) {
      level = g.room.level
      bold.push(roomRows.length)
      roomRows.push(['', level])
    }
    shaded.push(roomRows.length)
    roomRows.push(['', g.room ? g.room.name : g.heading, g.room?.number ?? ''])
    for (const l of g.lines) roomRows.push([l.sampleRef, '', '', l.fixture, l.code, l.tapwareCode, l.qty, l.inWall, l.description, l.finish + (l.flag ? ` — CHECK: ${l.flag}` : '')])
  }
  const tot = totals(types, items)
  const totRows: (string | number)[][] = [[`${projectName} - Sanitary & Tapware Schedule`], [], ['Sample Ref.', 'Sanitary Code', 'Tapware Code', 'Item/Quantity', 'Selection / Description', 'Colour /Finish', 'Schedule quantity']]
  for (const t of tot) totRows.push([t.type.sampleRef, t.type.kind === 'tapware' ? '' : t.type.code, t.type.kind === 'tapware' ? t.type.code : '', t.placed, [t.type.name, t.type.description].filter(Boolean).join('\n'), t.type.finish, t.scheduled ?? ''])
  totRows.push(['', '', 'TOTAL ITEMS', tot.reduce((n, t) => n + t.placed, 0)])
  const checkRows: string[][] = [[`${projectName} - Checks before issue`], [], ['Ref.', 'Kind', 'Item']]
  checks(types, rooms, items).forEach((c, i) => checkRows.push([String(i + 1), c.kind, c.text]))
  return writeXlsx([
    { name: 'Room data', rows: roomRows, widths: [16, 22, 12, 30, 9, 18, 9, 24, 60, 22], bold, shaded },
    { name: 'Sanitary tapware schedule', rows: totRows, widths: [16, 12, 18, 10, 70, 22, 12], bold: [0, 2, totRows.length - 1] },
    { name: 'Checks', rows: checkRows, widths: [6, 14, 100], bold: [0, 2] },
  ])
}
