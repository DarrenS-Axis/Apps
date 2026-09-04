import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createItp } from '../data/db'
import { useDrawings, useItps } from '../data/store'
import { TEMPLATES, searchTemplates, templatePointCounts } from '../data/templates'
import { TEMPLATE_GROUPS, ITP_STATUS_LABEL, type ItpTemplate, type TemplateGroup } from '../data/types'
import { Empty, Field, IconList, IconPlus, IconSearch, Sheet, Toast, useToast } from '../components/ui'
import { deriveStatus, itpProgress, relativeTime, statusChipClass, todayIso } from '../lib/format'

type Tab = 'raised' | 'register'

export function RegisterPage() {
  const { projectId } = useParams()
  const itps = useItps(projectId)
  const [tab, setTab] = useState<Tab>(itps.length > 0 ? 'raised' : 'register')
  const [query, setQuery] = useState('')
  const [raising, setRaising] = useState<ItpTemplate | null>(null)
  const [toast, showToast] = useToast()

  const filteredItps = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...itps].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return list
    return list.filter((i) => [i.itpNumber, i.templateCode, i.title, i.area, i.location].join(' ').toLowerCase().includes(q))
  }, [itps, query])

  const templates = useMemo(() => searchTemplates(query), [query])
  const grouped = useMemo(() => {
    const map = new Map<TemplateGroup, ItpTemplate[]>()
    for (const g of TEMPLATE_GROUPS) map.set(g, [])
    for (const t of templates) map.get(t.group)?.push(t)
    return map
  }, [templates])

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button
          className={`btn btn--sm ${tab === 'raised' ? '' : 'btn--ghost'}`}
          onClick={() => setTab('raised')}
          type="button"
        >
          Raised ({itps.length})
        </button>
        <button
          className={`btn btn--sm ${tab === 'register' ? '' : 'btn--ghost'}`}
          onClick={() => setTab('register')}
          type="button"
        >
          ITP register ({TEMPLATES.length})
        </button>
      </div>

      <div className="searchbar">
        <IconSearch />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'raised' ? 'Search raised ITPs by number, title or area' : 'Search the 42 hydraulic ITPs'}
        />
      </div>

      {tab === 'raised' ? (
        <div className="card card__body--flush">
          {filteredItps.length === 0 ? (
            <Empty
              icon={<IconList />}
              title={itps.length === 0 ? 'No ITPs raised yet' : 'No matches'}
              hint={itps.length === 0 ? 'Open the ITP register and raise one for the area you are working in.' : undefined}
            />
          ) : (
            filteredItps.map((itp) => {
              const p = itpProgress(itp)
              const status = deriveStatus(itp)
              return (
                <Link key={itp.id} className="listitem" to={`/project/${projectId}/itp/${itp.id}`}>
                  <span className="listitem__num">{itp.itpNumber}</span>
                  <span className="listitem__main">
                    <strong>{itp.title}</strong>
                    <span>
                      {itp.area || 'No area set'} · Rev {itp.revision} · {relativeTime(itp.updatedAt)}
                    </span>
                    <span className="row" style={{ marginTop: 6, gap: 6 }}>
                      <span className={`chip ${statusChipClass(status)}`}>{ITP_STATUS_LABEL[status]}</span>
                      {p.openHolds.length ? <span className="chip chip--hold">{p.openHolds.length} hold</span> : null}
                      {p.failed ? <span className="chip chip--bad">{p.failed} failed</span> : null}
                      <span className="chip">
                        {p.signed}/{p.applicable}
                      </span>
                    </span>
                  </span>
                </Link>
              )
            })
          )}
        </div>
      ) : (
        TEMPLATE_GROUPS.map((group) => {
          const list = grouped.get(group) ?? []
          if (list.length === 0) return null
          return (
            <div key={group}>
              <div className="section-title">
                <h2>{group}</h2>
                <span>{list.length}</span>
              </div>
              <div className="card card__body--flush">
                {list.map((t) => {
                  const counts = templatePointCounts(t)
                  return (
                    <button key={t.code} className="listitem" onClick={() => setRaising(t)} type="button">
                      <span className="listitem__num">{t.code}</span>
                      <span className="listitem__main">
                        <strong>{t.title}</strong>
                        <span>{t.scope}</span>
                        <span className="row" style={{ marginTop: 6, gap: 6 }}>
                          <span className="chip">{t.items.length} items</span>
                          {counts.H ? <span className="chip chip--hold">{counts.H} hold</span> : null}
                          {counts.W ? <span className="chip chip--witness">{counts.W} witness</span> : null}
                          {counts.S ? <span className="chip chip--surv">{counts.S} surv</span> : null}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      )}

      {raising ? (
        <RaiseSheet
          template={raising}
          projectId={projectId!}
          onClose={() => setRaising(null)}
          onRaised={() => showToast('ITP raised')}
        />
      ) : null}
      <Toast message={toast} />
    </>
  )
}

function RaiseSheet({
  template,
  projectId,
  onClose,
  onRaised,
}: {
  template: ItpTemplate
  projectId: string
  onClose: () => void
  onRaised: () => void
}) {
  const navigate = useNavigate()
  const drawings = useDrawings(projectId)
  const existing = useItps(projectId)
  const [form, setForm] = useState({
    itpNumber: template.code,
    area: '',
    location: '',
    revision: 'A',
    revisionDate: todayIso(),
    documentNo: '',
  })
  const [drawingIds, setDrawingIds] = useState<string[]>([])

  const duplicateArea = existing.some(
    (i) => i.templateCode === template.code && i.area.trim().toLowerCase() === form.area.trim().toLowerCase() && form.area.trim(),
  )

  const submit = async () => {
    const itp = await createItp({ projectId, templateCode: template.code, ...form, drawingIds })
    onRaised()
    onClose()
    navigate(`/project/${projectId}/itp/${itp.id}`)
  }

  return (
    <Sheet title={`Raise ITP ${template.code}`} onClose={onClose}>
      <div className="stack">
        <div className="card">
          <div className="card__body">
            <strong>{template.title}</strong>
            <p className="small muted" style={{ margin: '4px 0 8px' }}>
              {template.scope}
            </p>
            <div className="row" style={{ gap: 6 }}>
              {template.standards.map((s) => (
                <span key={s} className="chip chip--accent">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

        <Field
          label="Area / location covered"
          hint="One ITP per discrete area, the same way the paper form is issued — e.g. “Southern Driveway — Plant Room”."
        >
          <input
            type="text"
            autoFocus
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
            placeholder="e.g. North East Corner — Grid 1-5"
          />
        </Field>
        {duplicateArea ? (
          <div className="banner banner--warn">An ITP {template.code} already exists for that area. Raise it only if this is a separate section.</div>
        ) : null}

        <div className="field-grid">
          <Field label="ITP number">
            <input type="text" value={form.itpNumber} onChange={(e) => setForm({ ...form, itpNumber: e.target.value })} />
          </Field>
          <Field label="Level / grid reference">
            <input
              type="text"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. Minus 1, Grid 10-12"
            />
          </Field>
        </div>

        <div className="field-grid">
          <Field label="Revision">
            <input type="text" value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} />
          </Field>
          <Field label="Revision date">
            <input
              type="date"
              value={form.revisionDate}
              onChange={(e) => setForm({ ...form, revisionDate: e.target.value })}
            />
          </Field>
          <Field label="Document no.">
            <input type="text" value={form.documentNo} onChange={(e) => setForm({ ...form, documentNo: e.target.value })} />
          </Field>
        </div>

        <div>
          <span className="field-label">Drawings inspected against</span>
          {drawings.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              No drawings loaded yet — add them on the Plans tab and link them later.
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

        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn" onClick={submit} disabled={!form.area.trim()} type="button">
            <IconPlus />
            Raise ITP
          </button>
        </div>
      </div>
    </Sheet>
  )
}
