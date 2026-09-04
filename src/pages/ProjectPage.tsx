import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteProject, exportBackup, updateProject } from '../data/db'
import { useDrawings, useItps, useProject } from '../data/store'
import { db } from '../data/db'
import { useLive } from '../data/store'
import {
  ConfirmButton,
  Empty,
  Field,
  IconDownload,
  IconList,
  IconPdf,
  IconPlus,
  IconTrash,
  Sheet,
  Toast,
  useToast,
} from '../components/ui'
import { deriveStatus, downloadBlob, itpProgress, relativeTime, slug, statusChipClass } from '../lib/format'
import { exportRegisterPdf } from '../lib/pdf'
import { ITP_STATUS_LABEL } from '../data/types'

export function ProjectPage() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const itps = useItps(projectId)
  const drawings = useDrawings(projectId)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [toast, showToast] = useToast()

  const photoCount = useLive(
    async () => {
      if (!projectId) return 0
      const ids = new Set((await db.itps.where('projectId').equals(projectId).toArray()).map((i) => i.id))
      return (await db.photos.toArray()).filter((p) => ids.has(p.itpId)).length
    },
    [projectId],
    0,
  )

  const stats = useMemo(() => {
    let holds = 0
    let witness = 0
    let complete = 0
    let signedItems = 0
    let totalItems = 0
    for (const itp of itps) {
      const p = itpProgress(itp)
      holds += p.openHolds.length
      witness += p.openWitness.length
      signedItems += p.signed
      totalItems += p.applicable
      if (deriveStatus(itp) === 'complete' || itp.status === 'closed') complete += 1
    }
    return {
      holds,
      witness,
      complete,
      percent: totalItems === 0 ? 0 : Math.round((signedItems / totalItems) * 100),
    }
  }, [itps])

  const recent = useMemo(() => [...itps].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6), [itps])

  if (!project) {
    return <Empty title="Job not found" hint="It may have been deleted on this device." />
  }

  const exportJob = async () => {
    const backup = await exportBackup(project.id)
    downloadBlob(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      `${slug(project.name)}_ITP_backup_${new Date().toISOString().slice(0, 10)}.json`,
    )
    showToast('Job backup downloaded')
  }

  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 18 }}>{project.name}</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {[project.projectNumber, project.stage, project.address].filter(Boolean).join(' · ') || 'No job details yet'}
              </p>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)} type="button">
              Edit
            </button>
          </div>

          <div className="hr" />

          <div className="row" style={{ gap: 18 }}>
            <Stat value={String(itps.length)} label="ITPs raised" />
            <Stat value={String(stats.complete)} label="Complete" />
            <Stat value={String(stats.holds)} label="Open holds" tone={stats.holds ? 'hold' : undefined} />
            <Stat value={String(stats.witness)} label="Open witness" />
            <Stat value={String(drawings.length)} label="Drawings" />
            <Stat value={String(photoCount)} label="Photos" />
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="row small muted" style={{ marginBottom: 5 }}>
              <span>Overall inspection progress</span>
              <span className="spacer" />
              <span className="mono">{stats.percent}%</span>
            </div>
            <div className={`bar${stats.percent === 100 ? ' bar--ok' : ''}`}>
              <i style={{ width: `${stats.percent}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h2>Recent ITPs</h2>
        <span className="spacer" />
        <Link className="btn btn--sm" to={`/project/${project.id}/itps`}>
          <IconPlus />
          Raise ITP
        </Link>
      </div>

      <div className="card card__body--flush">
        {recent.length === 0 ? (
          <Empty
            icon={<IconList />}
            title="No ITPs raised yet"
            hint="Raise one from the register of 42 hydraulic ITP templates."
          />
        ) : (
          recent.map((itp) => {
            const p = itpProgress(itp)
            const status = deriveStatus(itp)
            return (
              <Link key={itp.id} className="listitem" to={`/project/${project.id}/itp/${itp.id}`}>
                <span className="listitem__num">{itp.templateCode}</span>
                <span className="listitem__main">
                  <strong>{itp.title}</strong>
                  <span>
                    {itp.area || 'No area set'} · updated {relativeTime(itp.updatedAt)}
                  </span>
                  <span className="row" style={{ marginTop: 6, gap: 6 }}>
                    <span className={`chip ${statusChipClass(status)}`}>{ITP_STATUS_LABEL[status]}</span>
                    {p.openHolds.length ? <span className="chip chip--hold">{p.openHolds.length} hold</span> : null}
                    <span className="chip">{p.percent}%</span>
                  </span>
                </span>
              </Link>
            )
          })
        )}
      </div>

      <div className="section-title">
        <h2>Job data</h2>
      </div>
      <div className="card">
        <div className="card__body">
          <p className="small muted" style={{ marginTop: 0 }}>
            Everything is stored on this device. Export a backup to move the job to another device or hand it to the document
            controller.
          </p>
          <div className="row">
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={itps.length === 0}
              onClick={() => {
                downloadBlob(
                  exportRegisterPdf(project, [...itps].sort((a, b) => a.itpNumber.localeCompare(b.itpNumber))),
                  `${slug(project.name)}_ITP_register.pdf`,
                )
                showToast('Register exported')
              }}
            >
              <IconPdf />
              Export ITP register
            </button>
            <button className="btn btn--ghost btn--sm" onClick={exportJob} type="button">
              <IconDownload />
              Export job backup
            </button>
            <span className="spacer" />
            <ConfirmButton
              label={
                <>
                  <IconTrash />
                  Delete job
                </>
              }
              confirmLabel="Tap again to delete job and all its records"
              onConfirm={async () => {
                await deleteProject(project.id)
                navigate('/projects')
              }}
            />
          </div>
        </div>
      </div>

      {editing ? <EditProject projectId={project.id} onClose={() => setEditing(false)} onSaved={() => showToast('Job updated')} /> : null}
      <Toast message={toast} />
    </>
  )
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'hold' }) {
  return (
    <div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'hold' && value !== '0' ? 'var(--hold)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
      <div className="small muted">{label}</div>
    </div>
  )
}

function EditProject({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const project = useProject(projectId)
  const [form, setForm] = useState(project)

  useEffect(() => {
    if (project && !form) setForm(project)
  }, [project, form])

  if (!form) return null

  return (
    <Sheet title="Job details" onClose={onClose}>
      <div className="stack">
        <Field label="Job name">
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="field-grid">
          <Field label="Job number">
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
          <Field label="Your company">
            <input type="text" value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} />
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Approved for use by">
            <input type="text" value={form.approvedBy} onChange={(e) => setForm({ ...form, approvedBy: e.target.value })} />
          </Field>
          <Field label="Role">
            <input
              type="text"
              value={form.approvedByRole}
              onChange={(e) => setForm({ ...form, approvedByRole: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Site address">
          <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Document marking" hint="Printed at the head and foot of every exported page, e.g. OFFICIAL.">
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
