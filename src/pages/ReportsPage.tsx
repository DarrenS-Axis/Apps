import { useMemo, useState } from 'react'
import { db } from '../data/db'
import { useBusinessUnits, useLive, useSettings, useVisibleProjects } from '../data/store'
import { Empty } from '../components/ui'
import { STATE_CODES, STATE_NAMES, type StateCode } from '../data/types'
import { aud, buildReport, monthLabel, type StatusCounts } from '../lib/reporting'

const EMPTY: never[] = []

/**
 * The monthly QA report, live: Firedoc summary, Controldoc completed-ITP
 * trend, Reviewdoc value and quantity — per project, per business unit, and
 * for the state or the nation. Site and state QA see their state; national
 * QA can switch between states or see everything.
 */
export function ReportsPage() {
  const settings = useSettings()
  const national = settings.role === 'national_qa'
  const [state, setState] = useState<StateCode | ''>(national ? '' : (settings.state ?? ''))
  const visible = useVisibleProjects()
  const units = useBusinessUnits()

  const projects = useMemo(() => (state ? visible.filter((p) => p.state === state) : visible), [visible, state])
  const ids = useMemo(() => projects.map((p) => p.id), [projects])
  const key = ids.join(',')

  const itps = useLive(() => (ids.length ? db.itps.where('projectId').anyOf(ids).toArray() : []), [key], EMPTY)
  const pens = useLive(() => (ids.length ? db.penetrations.where('projectId').anyOf(ids).toArray() : []), [key], EMPTY)
  const defects = useLive(() => (ids.length ? db.defects.where('projectId').anyOf(ids).toArray() : []), [key], EMPTY)

  const report = useMemo(() => buildReport({ projects, units, itps, penetrations: pens, defects }), [projects, units, itps, pens, defects])
  const scope = state ? `${state} — ${STATE_NAMES[state]}` : national ? 'All states' : 'Your state'

  return (
    <>
      <div className="section-title">
        <h2>QA report</h2>
        <span>{scope}</span>
        <span className="spacer" />
        {national ? (
          <select value={state} onChange={(e) => setState(e.target.value as StateCode | '')} style={{ width: 'auto', minHeight: 36 }}>
            <option value="">All states</option>
            {STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {projects.length === 0 ? <Empty title="No projects to report on" /> : null}

      {/* Firedoc summary */}
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Firedoc summary</h2>
        <span>from project start · total {report.firedoc.total}</span>
      </div>
      <div className="card">
        <div className="card__body" style={{ overflowX: 'auto' }}>
          <table className="report">
            <thead>
              <tr>
                <th>Business unit</th>
                <th>Project</th>
                <th>Setup</th>
                <th>In progress</th>
                <th>Completed by site</th>
                <th>Reviewed &amp; approved</th>
                <th>Defected</th>
                <th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.project.id}>
                  <td>{r.unit?.name ?? '—'}</td>
                  <td>{r.project.name}</td>
                  <Counts c={r.firedoc} />
                </tr>
              ))}
              <tr className="report__total">
                <td colSpan={2}>TOTAL FOR REPORT</td>
                <Counts c={report.firedoc} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Controldoc trend */}
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Controldoc ITPs</h2>
        <span>completed per month · {[...report.trend.values()].reduce((a, b) => a + b, 0)} over three months</span>
      </div>
      <div className="card">
        <div className="card__body" style={{ overflowX: 'auto' }}>
          <table className="report">
            <thead>
              <tr>
                <th>Business unit</th>
                <th>Project</th>
                {report.months.map((m) => (
                  <th key={m}>{monthLabel(m)}</th>
                ))}
                <th>Open holds</th>
                <th>Setup</th>
                <th>In progress</th>
                <th>Completed by site</th>
                <th>Reviewed &amp; approved</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.project.id}>
                  <td>{r.unit?.name ?? '—'}</td>
                  <td>{r.project.name}</td>
                  {report.months.map((m) => (
                    <td key={m}>{r.trend.get(m) ?? 0}</td>
                  ))}
                  <td>{itps.filter((i) => i.projectId === r.project.id).reduce((n, i) => n + i.items.filter((it) => it.point === 'H' && it.status !== 'pass' && it.status !== 'na').length, 0)}</td>
                  <td>{r.controldoc.setup}</td>
                  <td>{r.controldoc.in_progress}</td>
                  <td>{r.controldoc.completed_by_site}</td>
                  <td>{r.controldoc.reviewed_approved}</td>
                </tr>
              ))}
              <tr className="report__total">
                <td colSpan={2}>TOTAL FOR REPORT</td>
                {report.months.map((m) => (
                  <td key={m}>{report.trend.get(m) ?? 0}</td>
                ))}
                <td>{itps.reduce((n, i) => n + i.items.filter((it) => it.point === 'H' && it.status !== 'pass' && it.status !== 'na').length, 0)}</td>
                <td>{report.controldoc.setup}</td>
                <td>{report.controldoc.in_progress}</td>
                <td>{report.controldoc.completed_by_site}</td>
                <td>{report.controldoc.reviewed_approved}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Reviewdoc */}
      <div className="section-title">
        <h2 style={{ fontSize: 15 }}>Reviewdoc defects</h2>
        <span>
          from project start · {report.reviewdoc.qty} items · {aud(report.reviewdoc.value)}
        </span>
      </div>
      <div className="card">
        <div className="card__body" style={{ overflowX: 'auto' }}>
          <table className="report">
            <thead>
              <tr>
                <th>By service type</th>
                <th>Qty</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {[...report.reviewdoc.byService.entries()]
                .sort((a, b) => b[1].value - a[1].value)
                .map(([service, t]) => (
                  <tr key={service}>
                    <td>{service}</td>
                    <td>{t.qty}</td>
                    <td>{aud(t.value)}</td>
                  </tr>
                ))}
              <tr className="report__total">
                <td>TOTAL</td>
                <td>{report.reviewdoc.qty}</td>
                <td>{aud(report.reviewdoc.value)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card__body" style={{ overflowX: 'auto' }}>
          <table className="report">
            <thead>
              <tr>
                <th>By project</th>
                <th>Open</th>
                <th>Qty</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.project.id}>
                  <td>{r.project.name}</td>
                  <td>{defects.filter((d) => d.projectId === r.project.id && d.status !== 'closed').length}</td>
                  <td>{r.reviewdoc.qty}</td>
                  <td>{aud(r.reviewdoc.value)}</td>
                </tr>
              ))}
              <tr className="report__total">
                <td>TOTAL</td>
                <td>{defects.filter((d) => d.status !== 'closed').length}</td>
                <td>{report.reviewdoc.qty}</td>
                <td>{aud(report.reviewdoc.value)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted">
        Setup counts every record on the register; Outstanding is Setup + In progress + Defected, as on the monthly Controldoc report.
      </p>
    </>
  )
}

function Counts({ c }: { c: StatusCounts }) {
  return (
    <>
      <td>{c.total}</td>
      <td>{c.in_progress}</td>
      <td>{c.completed_by_site}</td>
      <td>{c.reviewed_approved}</td>
      <td className={c.defected ? 'report__bad' : undefined}>{c.defected}</td>
      <td>{c.outstanding}</td>
    </>
  )
}
