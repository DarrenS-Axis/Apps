import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createProject } from '../data/db'
import { useActiveProjectId, useItps, useProjects } from '../data/store'
import { Empty, Field, IconFolder, IconPlus, Sheet } from '../components/ui'
import { relativeTime } from '../lib/format'

function ProjectRow({ id, name, meta, onOpen }: { id: string; name: string; meta: string; onOpen: (id: string) => void }) {
  const itps = useItps(id)
  return (
    <button className="listitem" onClick={() => onOpen(id)} type="button">
      <span className="listitem__num">{itps.length}</span>
      <span className="listitem__main">
        <strong>{name}</strong>
        <span>{meta}</span>
      </span>
    </button>
  )
}

export function ProjectsPage() {
  const projects = useProjects()
  const navigate = useNavigate()
  const [, setActive] = useActiveProjectId()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    projectNumber: '',
    client: '',
    contractor: '',
    approvedBy: '',
    stage: '',
    address: '',
  })

  const open = (id: string) => {
    setActive(id)
    navigate(`/project/${id}`)
  }

  const submit = async () => {
    const p = await createProject(form)
    setCreating(false)
    setForm({ name: '', projectNumber: '', client: '', contractor: '', approvedBy: '', stage: '', address: '' })
    open(p.id)
  }

  return (
    <>
      <div className="section-title">
        <h2>Jobs</h2>
        <span>{projects.length} on this device</span>
        <span className="spacer" />
        <button className="btn btn--sm" onClick={() => setCreating(true)} type="button">
          <IconPlus />
          New job
        </button>
      </div>

      <div className="card card__body--flush">
        {projects.length === 0 ? (
          <Empty
            icon={<IconFolder />}
            title="No jobs yet"
            hint="Create a job to raise ITPs, load plans and start capturing evidence."
          />
        ) : (
          projects.map((p) => (
            <ProjectRow
              key={p.id}
              id={p.id}
              name={p.name}
              meta={[p.projectNumber, p.client, `updated ${relativeTime(p.updatedAt)}`].filter(Boolean).join(' · ')}
              onOpen={open}
            />
          ))
        )}
      </div>

      {creating ? (
        <Sheet title="New job" onClose={() => setCreating(false)}>
          <div className="stack">
            <Field label="Job name">
              <input
                type="text"
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Minus 1 — Adelaide"
              />
            </Field>
            <div className="field-grid">
              <Field label="Job number">
                <input
                  type="text"
                  value={form.projectNumber}
                  onChange={(e) => setForm({ ...form, projectNumber: e.target.value })}
                />
              </Field>
              <Field label="Stage / level">
                <input
                  type="text"
                  value={form.stage}
                  onChange={(e) => setForm({ ...form, stage: e.target.value })}
                  placeholder="e.g. MINUS 1"
                />
              </Field>
            </div>
            <div className="field-grid">
              <Field label="Client / head contractor">
                <input type="text" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
              </Field>
              <Field label="Your company">
                <input
                  type="text"
                  value={form.contractor}
                  onChange={(e) => setForm({ ...form, contractor: e.target.value })}
                  placeholder="Printed top-left on the ITP"
                />
              </Field>
            </div>
            <Field label="Approved for use by" hint="The person who signs off the ITP for use — usually the project manager.">
              <input type="text" value={form.approvedBy} onChange={(e) => setForm({ ...form, approvedBy: e.target.value })} />
            </Field>
            <Field label="Site address">
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <div className="row row--end">
              <button className="btn btn--ghost" onClick={() => setCreating(false)} type="button">
                Cancel
              </button>
              <button className="btn" onClick={submit} disabled={!form.name.trim()} type="button">
                Create job
              </button>
            </div>
          </div>
        </Sheet>
      ) : null}
    </>
  )
}
