import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useFetchIfMissing } from '../components/useFetchIfMissing'
import { db, deleteProject, exportBackup, updateProject } from '../data/db'
import { useBusinessUnit, useBusinessUnits, useDefects, useDrawings, useItps, useLive, usePenetrations, useProject } from '../data/store'
import { ConfirmButton, Empty, Field, IconDownload, IconList, IconPdf, IconPlan, IconTrash, Sheet, Toast, useToast } from '../components/ui'
import { deriveStatus, downloadBlob, itpProgress, slug } from '../lib/format'
import { processLogo } from '../lib/images'
import { exportRegisterPdf } from '../lib/pdf'
import { withAxisLogo } from '../lib/brand'
import { aud, controldocSummary, firedocSummary, reviewdocTotals } from '../lib/reporting'
import { MODULE_LABEL, type ModuleKey } from '../data/types'

/** The project hub: the three modules with live numbers, plans and photos. */
export function ProjectPage() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const unit = useBusinessUnit(project?.businessUnitId)
  const itps = useItps(projectId)
  const pens = usePenetrations(projectId)
  const defects = useDefects(projectId)
  const drawings = useDrawings(projectId)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [toast, showToast] = useToast()

  const photoCount = useLive(
    async () => {
      if (!projectId) return 0
      const itpIds = new Set((await db.itps.where('projectId').equals(projectId).primaryKeys()) as string[])
      return (await db.photos.toArray()).filter((p) => p.projectId === projectId || itpIds.has(p.itpId)).length
    },
    [projectId],
    0,
  )

  const roomData = useLive(
    async () => {
      if (!projectId || !project?.modules.roomdata) return { rooms: 0, items: 0, subs: 0 }
      const [rooms, items, subs] = await Promise.all([
        db.rooms.where('projectId').equals(projectId).count(),
        db.roomItems.where('projectId').equals(projectId).toArray(),
        db.submissions.where('projectId').equals(projectId).count(),
      ])
      return { rooms, items: items.reduce((n, i) => n + (i.qty || 0), 0), subs }
    },
    [projectId, project?.modules.roomdata],
    { rooms: 0, items: 0, subs: 0 },
  )

  // Plant the register has on this job.
  const plantHere = useLive(() => (projectId ? db.plant.where('projectId').equals(projectId).filter((p) => p.status === 'on_site').count() : 0), [projectId], 0)

  const control = useMemo(() => controldocSummary(itps), [itps])
  const holds = useMemo(() => itps.reduce((n, i) => n + itpProgress(i).openHolds.length, 0), [itps])
  const fire = useMemo(() => firedocSummary(pens), [pens])
  const review = useMemo(() => reviewdocTotals(defects), [defects])
  const openDefects = defects.filter((d) => d.status !== 'closed').length

  const fetching = useFetchIfMissing(!project)
  if (!project) return fetching ? <Empty title="Fetching from SharePoint…" /> : <Empty title="Project not found" hint="It may have been deleted, or belong to another state." />

  const exportJob = async () => {
    const backup = await exportBackup(project.id)
    downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `${slug(project.name)}_QA_backup_${new Date().toISOString().slice(0, 10)}.json`)
    showToast('Project backup downloaded')
  }

  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 18 }}>{project.name}</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {[project.projectNumber, project.client, project.address].filter(Boolean).join(' · ') || 'No project details yet'}
              </p>
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                {unit ? `${unit.name} · ${unit.entity}` : project.state}
              </p>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)} type="button">
              Edit
            </button>
          </div>
        </div>
      </div>

      <div className="modules">
        {project.modules.controldoc ? (
          <Link className="module" to={`/project/${project.id}/itps`}>
            <span className="module__name">Controldoc</span>
            <span className="module__big">{itps.length}</span>
            <span className="module__sub">ITPs raised</span>
            <span className="module__facts">
              <span>{control.completed_by_site} completed by site</span>
              <span>{control.reviewed_approved} approved</span>
              <span className={holds ? 'is-hold' : undefined}>{holds} open hold points</span>
            </span>
          </Link>
        ) : null}
        {project.modules.firedoc ? (
          <Link className="module" to={`/project/${project.id}/firedoc`}>
            <span className="module__name">Firedoc</span>
            <span className="module__big">{fire.total}</span>
            <span className="module__sub">penetrations</span>
            <span className="module__facts">
              <span>{fire.completed_by_site} completed by site</span>
              <span>{fire.reviewed_approved} approved</span>
              <span className={fire.defected ? 'is-hold' : undefined}>{fire.defected} defected · {fire.outstanding} outstanding</span>
            </span>
          </Link>
        ) : null}
        {project.modules.reviewdoc ? (
          <Link className="module" to={`/project/${project.id}/reviewdoc`}>
            <span className="module__name">Reviewdoc</span>
            <span className="module__big">{openDefects}</span>
            <span className="module__sub">open defects</span>
            <span className="module__facts">
              <span>{review.qty} raised · {aud(review.value)}</span>
              <span>{defects.filter((d) => d.status === 'rectified').length} awaiting review</span>
            </span>
          </Link>
        ) : null}
        {project.modules.roomdata ? (
          <Link className="module" to={`/project/${project.id}/rooms`}>
            <span className="module__name">Room data</span>
            <span className="module__big">{roomData.rooms}</span>
            <span className="module__sub">rooms</span>
            <span className="module__facts">
              <span>{roomData.items} fixtures placed</span>
              <span>{roomData.subs} tech data submissions</span>
            </span>
          </Link>
        ) : null}
        <Link className="module module--quiet" to={`/project/${project.id}/drawings`}>
          <span className="module__name">
            <IconPlan /> Plans
          </span>
          <span className="module__big">{drawings.length}</span>
          <span className="module__sub">drawings</span>
        </Link>
        <Link className="module module--quiet" to={`/project/${project.id}/photos`}>
          <span className="module__name">Photos</span>
          <span className="module__big">{photoCount}</span>
          <span className="module__sub">on record</span>
        </Link>
        {plantHere ? (
          <Link className="module module--quiet" to="/plant" state={{ where: project.name }}>
            <span className="module__name">Plant</span>
            <span className="module__big">{plantHere}</span>
            <span className="module__sub">on this job</span>
          </Link>
        ) : null}
      </div>

      {project.modules.controldoc && itps.length ? (
        <>
          <div className="section-title">
            <h2>Recent ITPs</h2>
            <span className="spacer" />
            <Link className="btn btn--ghost btn--sm" to={`/project/${project.id}/itps`}>
              <IconList />
              All
            </Link>
          </div>
          <div className="card card__body--flush">
            {[...itps]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 5)
              .map((itp) => {
                const p = itpProgress(itp)
                return (
                  <button key={itp.id} className="listitem" type="button" onClick={() => navigate(`/project/${project.id}/itp/${itp.id}`)}>
                    <span className="listitem__num">{itp.itpNumber}</span>
                    <span className="listitem__main">
                      <strong>{itp.title}</strong>
                      <span>
                        {itp.itcNumber ? `ITC ${itp.itcNumber} · ` : ''}
                        {itp.area} · {p.percent}% · {deriveStatus(itp).replace(/_/g, ' ')}
                      </span>
                    </span>
                  </button>
                )
              })}
          </div>
        </>
      ) : null}

      <div className="section-title">
        <h2>Project data</h2>
      </div>
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn--ghost btn--sm" type="button" disabled={itps.length === 0} onClick={async () => { downloadBlob(exportRegisterPdf(await withAxisLogo(project), itps), `${slug(project.name)}_ITP_register.pdf`); showToast('Register exported') }}>
              <IconPdf />
              ITP register
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => void exportJob()}>
              <IconDownload />
              Export project backup
            </button>
            <ConfirmButton
              label={
                <>
                  <IconTrash />
                  Delete project
                </>
              }
              confirmLabel="Delete everything on this project"
              onConfirm={async () => {
                await deleteProject(project.id)
                navigate('/state')
              }}
            />
          </div>
        </div>
      </div>

      {editing ? <EditProject projectId={project.id} onClose={() => setEditing(false)} onSaved={() => showToast('Project updated')} /> : null}
      <Toast message={toast} />
    </>
  )
}

/** Attaches a company logo; it is printed on every exported document. */
function LogoField({ label, hint, value, onChange }: { label: string; hint: string; value?: string; onChange: (value: string | undefined) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState('')
  const pick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      onChange(await processLogo(file))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }
  return (
    <div>
      <span className="field-label">{label}</span>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        {hint}
      </p>
      <input ref={inputRef} className="visually-hidden" type="file" accept="image/*" onChange={(e) => void pick(e.target.files)} />
      <div className="row" style={{ alignItems: 'center' }}>
        {value ? (
          <span className="logoshow">
            <img src={value} alt={`${label} preview`} />
          </span>
        ) : (
          <span className="small muted">None attached</span>
        )}
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => inputRef.current?.click()}>
          {value ? 'Replace' : 'Attach'}
        </button>
        {value ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => onChange(undefined)}>
            Remove
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="small" style={{ color: 'var(--fail)', margin: '6px 0 0' }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function EditProject({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const project = useProject(projectId)
  const units = useBusinessUnits()
  const [form, setForm] = useState(project)
  useEffect(() => {
    if (project && !form) setForm(project)
  }, [project, form])
  if (!form) return null
  return (
    <Sheet title="Project details" onClose={onClose}>
      <div className="stack">
        <Field label="Project name">
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Business unit">
          <select value={form.businessUnitId} onChange={(e) => setForm({ ...form, businessUnitId: e.target.value })}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.state} · {u.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-grid">
          <Field label="Project no.">
            <input type="text" value={form.projectNumber} onChange={(e) => setForm({ ...form, projectNumber: e.target.value })} />
          </Field>
          <Field label="Stage / level">
            <input type="text" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Client / head contractor">
            <input type="text" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
          </Field>
          <Field label="Axis entity">
            <input type="text" value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="ITPs approved for use by">
            <input type="text" value={form.approvedBy} onChange={(e) => setForm({ ...form, approvedBy: e.target.value })} />
          </Field>
          <Field label="Role">
            <input type="text" value={form.approvedByRole} onChange={(e) => setForm({ ...form, approvedByRole: e.target.value })} />
          </Field>
        </div>
        <Field label="Project address">
          <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Client document reference scheme" hint="{n} becomes the ITC number, e.g. SMCSWSPS-AXP-OSN-BS-ITP-{n}.">
          <input type="text" value={form.locRefScheme ?? ''} onChange={(e) => setForm({ ...form, locRefScheme: e.target.value })} />
        </Field>
        <div>
          <span className="field-label">Modules</span>
          <div className="row" style={{ gap: 14 }}>
            {(Object.keys(MODULE_LABEL) as ModuleKey[]).map((m) => (
              <label key={m} className="row" style={{ gap: 8 }}>
                <input type="checkbox" style={{ width: 20, height: 20, minHeight: 0 }} checked={Boolean(form.modules[m])} onChange={(e) => setForm({ ...form, modules: { ...form.modules, [m]: e.target.checked } })} />
                <span>{MODULE_LABEL[m]}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="field-grid">
          <LogoField label="Head contractor logo" hint="Printed at the head of every exported ITP." value={form.clientLogo} onChange={(clientLogo) => setForm({ ...form, clientLogo })} />
          <LogoField label="Axis logo" hint="Leave empty to use the business unit's logo (set in Settings). Printed in the contractor cell and on the QA report." value={form.contractorLogo} onChange={(contractorLogo) => setForm({ ...form, contractorLogo })} />
        </div>
        <Field label="Document marking" hint="Printed at the head and foot of every exported page, e.g. OFFICIAL. Leave blank for none.">
          <input type="text" value={form.marking} onChange={(e) => setForm({ ...form, marking: e.target.value })} />
        </Field>
        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              await updateProject(projectId, form)
              onSaved()
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
