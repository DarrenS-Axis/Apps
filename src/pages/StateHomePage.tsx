import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createProject, db } from '../data/db'
import { useActiveProjectId, useBusinessUnits, useLive, useSettings, useVisibleProjects } from '../data/store'
import { Empty, Field, IconFolder, IconPlus, Sheet } from '../components/ui'
import { formatDate, relativeTime } from '../lib/format'
import { MODULE_LABEL, STATE_NAMES, type BusinessUnit, type ModuleKey, type Project } from '../data/types'

/**
 * Work allocated to the person using the app: penetrations, defects and
 * plant with their name on them, soonest due first.
 */
function MyWork({ name }: { name: string }) {
  const work = useLive(
    async () => {
      const me = name.trim().toLowerCase()
      if (!me) return []
      const mine = (a?: string) => a?.trim().toLowerCase() === me
      const projects = new Map((await db.projects.toArray()).map((p) => [p.id, p]))
      const rows: { key: string; to: string; title: string; sub: string; due?: string; at: number }[] = []
      for (const p of await db.penetrations.toArray()) {
        if (!mine(p.assignedTo) || p.status === 'reviewed_approved') continue
        rows.push({ key: p.id, to: `/project/${p.projectId}/firedoc?open=${p.id}`, title: `Penetration ${p.number} · ${p.size} ${p.ref}`.trim(), sub: projects.get(p.projectId)?.name ?? '', due: p.assignDue, at: p.assignedAt ?? 0 })
      }
      for (const d of await db.defects.toArray()) {
        if (!mine(d.assignedTo) || d.status === 'closed') continue
        rows.push({ key: d.id, to: `/project/${d.projectId}/reviewdoc?open=${d.id}`, title: `Defect ${d.number} · ${d.service}`, sub: projects.get(d.projectId)?.name ?? '', due: d.assignDue, at: d.assignedAt ?? 0 })
      }
      for (const i of await db.plant.toArray()) {
        if (!mine(i.assignedTo) || i.status === 'disposed') continue
        rows.push({ key: i.id, to: `/plant/item/${encodeURIComponent(i.plantNo)}`, title: `${i.plantNo} · ${i.type}`, sub: i.location, due: i.assignDue, at: i.assignedAt ?? 0 })
      }
      return rows.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.at - a.at)
    },
    [name],
    [] as { key: string; to: string; title: string; sub: string; due?: string; at: number }[],
  )
  if (!work.length) return null
  const today = new Date().toISOString().slice(0, 10)
  return (
    <>
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Allocated to you</h2>
        <span>{work.length}</span>
      </div>
      <div className="card card__body--flush">
        {work.slice(0, 8).map((w) => (
          <Link key={w.key} className="listitem" to={w.to}>
            <span className="listitem__main">
              <strong>{w.title}</strong>
              <span>{w.sub}</span>
              {w.due ? (
                <span className="row" style={{ marginTop: 6, gap: 6 }}>
                  <span className={`chip ${w.due < today ? 'chip--hold' : 'chip--warn'}`}>
                    {w.due < today ? 'Overdue' : 'Due'} {formatDate(w.due)}
                  </span>
                </span>
              ) : null}
            </span>
          </Link>
        ))}
        {work.length > 8 ? <p className="small muted" style={{ padding: '8px 14px', margin: 0 }}>and {work.length - 8} more</p> : null}
      </div>
    </>
  )
}

/** Live module counts for one project row. */
function ProjectRow({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const counts = useLive(
    async () => ({
      itps: await db.itps.where('projectId').equals(project.id).count(),
      pens: await db.penetrations.where('projectId').equals(project.id).count(),
      defects: await db.defects.where('projectId').equals(project.id).filter((d) => d.status !== 'closed').count(),
    }),
    [project.id],
    { itps: 0, pens: 0, defects: 0 },
  )
  return (
    <button className="listitem" onClick={() => onOpen(project.id)} type="button">
      <span className="listitem__main">
        <strong>{project.name}</strong>
        <span>{[project.projectNumber, project.client, `updated ${relativeTime(project.updatedAt)}`].filter(Boolean).join(' · ')}</span>
        <span className="row" style={{ marginTop: 6, gap: 6 }}>
          {project.modules.controldoc ? <span className="chip">{counts.itps} ITPs</span> : null}
          {project.modules.firedoc ? <span className="chip chip--surv">{counts.pens} penetrations</span> : null}
          {project.modules.reviewdoc ? (
            <span className={`chip ${counts.defects ? 'chip--hold' : ''}`}>{counts.defects} open defects</span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

/**
 * The home page: every project in the person's state, grouped by business
 * unit. National QA sees every state.
 */
export function StateHomePage() {
  const settings = useSettings()
  const projects = useVisibleProjects()
  const units = useBusinessUnits(settings.role === 'national_qa' ? undefined : settings.state)
  const navigate = useNavigate()
  const [, setActive] = useActiveProjectId()
  const [creating, setCreating] = useState<BusinessUnit | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<string, Project[]>()
    for (const p of projects) {
      const list = map.get(p.businessUnitId) ?? []
      list.push(p)
      map.set(p.businessUnitId, list)
    }
    return map
  }, [projects])

  const visibleUnits = units.filter(
    (u) => settings.role === 'national_qa' || settings.businessUnitIds.length === 0 || settings.businessUnitIds.includes(u.id),
  )

  const open = (id: string) => {
    setActive(id)
    navigate(`/project/${id}`)
  }

  const title = settings.role === 'national_qa' ? 'All states' : settings.state ? `${settings.state} — ${STATE_NAMES[settings.state]}` : 'Projects'

  return (
    <>
      <div className="section-title">
        <h2>{title}</h2>
        <span>{projects.length} projects</span>
        <span className="spacer" />
        <Link className="btn btn--ghost btn--sm" to="/reports">
          QA report
        </Link>
      </div>

      <MyWork name={settings.userName} />

      {visibleUnits.length === 0 ? (
        <Empty icon={<IconFolder />} title="No business units" hint="Add one in Settings → Business units." />
      ) : null}

      {visibleUnits.map((unit) => {
        const list = grouped.get(unit.id) ?? []
        return (
          <div key={unit.id}>
            <div className="section-title">
              <h2 style={{ fontSize: 15 }}>{unit.name}</h2>
              <span>{unit.entity}</span>
              <span className="spacer" />
              <button className="btn btn--sm" onClick={() => setCreating(unit)} type="button">
                <IconPlus />
                New project
              </button>
            </div>
            <div className="card card__body--flush">
              {list.length === 0 ? (
                <Empty title="No projects yet" hint={`Create the first ${unit.name} project.`} />
              ) : (
                list.map((p) => <ProjectRow key={p.id} project={p} onOpen={open} />)
              )}
            </div>
          </div>
        )
      })}

      {creating ? <NewProjectSheet unit={creating} units={units} onClose={() => setCreating(null)} onCreated={open} /> : null}
    </>
  )
}

function NewProjectSheet({
  unit,
  units,
  onClose,
  onCreated,
}: {
  unit: BusinessUnit
  units: BusinessUnit[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [form, setForm] = useState({
    businessUnitId: unit.id,
    name: '',
    projectNumber: '',
    client: '',
    address: '',
    approvedBy: '',
    locRefScheme: '',
    modules: { controldoc: true, firedoc: true, reviewdoc: true },
  })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const p = await createProject(form)
      onClose()
      onCreated(p.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="New project" onClose={onClose}>
      <div className="stack">
        <Field label="Business unit">
          <select value={form.businessUnitId} onChange={(e) => setForm({ ...form, businessUnitId: e.target.value })}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project name">
          <input type="text" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Liverpool Hospital" />
        </Field>
        <div className="field-grid">
          <Field label="Project no.">
            <input type="text" value={form.projectNumber} onChange={(e) => setForm({ ...form, projectNumber: e.target.value })} placeholder="21-005FCR" />
          </Field>
          <Field label="Client / head contractor">
            <input type="text" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Lendlease" />
          </Field>
        </div>
        <Field label="Project address">
          <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="ITPs approved for use by">
          <input type="text" value={form.approvedBy} onChange={(e) => setForm({ ...form, approvedBy: e.target.value })} placeholder="Project manager" />
        </Field>
        <Field label="Client document reference scheme" hint="Optional. {n} is replaced with the ITC number, e.g. LHAP-HYS-AXS-ITP-MW-{n}.">
          <input type="text" value={form.locRefScheme} onChange={(e) => setForm({ ...form, locRefScheme: e.target.value })} />
        </Field>
        <div>
          <span className="field-label">Modules</span>
          <div className="row" style={{ gap: 14 }}>
            {(Object.keys(MODULE_LABEL) as ModuleKey[]).map((m) => (
              <label key={m} className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 20, height: 20, minHeight: 0 }}
                  checked={form.modules[m]}
                  onChange={(e) => setForm({ ...form, modules: { ...form.modules, [m]: e.target.checked } })}
                />
                <span>{MODULE_LABEL[m]}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn" type="button" disabled={!form.name.trim() || busy} onClick={() => void submit()}>
            Create project
          </button>
        </div>
      </div>
    </Sheet>
  )
}
