import { useRef, useState } from 'react'
import { createPerson, deletePerson, isEmail, updatePerson } from '../data/people'
import { usePeople, useSettings } from '../data/store'
import { defaultNotify, NOTIFY_KEYS, NOTIFY_LABEL, PERSON_ROLES, STATE_CODES, type NotifyKey, type Person, type StateCode } from '../data/types'
import { parseCsv } from '../lib/xlsx'
import { raiseEvent } from '../sync'
import { ConfirmButton, Empty, Field, IconPlus, Sheet } from './ui'

/**
 * Settings → People: the profiles work is allocated to, each with a work
 * email and the notifications they want. A notification is an event the app
 * sends to the Power Automate flow with these people as its recipients; the
 * flow does the emailing.
 */
export function PeopleAdmin({ onToast }: { onToast: (m: string) => void }) {
  const settings = useSettings()
  const national = settings.role === 'national_qa'
  const people = usePeople(national ? 'all' : settings.state)
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  const csvRef = useRef<HTMLInputElement | null>(null)

  const importCsv = async (file: File | undefined) => {
    if (!file) return
    const rows = parseCsv(await file.text())
    if (csvRef.current) csvRef.current.value = ''
    const head = rows[0]?.map((h) => h.toLowerCase()) ?? []
    const col = (re: RegExp) => head.findIndex((h) => re.test(h))
    const c = { name: col(/name/), email: col(/mail/), role: col(/role|position|title/), phone: col(/phone|mobile/), state: col(/state/) }
    if (c.name < 0 || c.email < 0) return onToast('The CSV needs Name and Email columns')
    let added = 0
    let updated = 0
    for (const r of rows.slice(1)) {
      const name = r[c.name]?.trim()
      const email = r[c.email]?.trim().toLowerCase()
      if (!name || !email || !isEmail(email)) continue
      const role = c.role >= 0 ? r[c.role]?.trim() || undefined : undefined
      const phone = c.phone >= 0 ? r[c.phone]?.trim() || undefined : undefined
      const rowState = c.state >= 0 ? (r[c.state]?.trim().toUpperCase() as StateCode) : undefined
      const state = rowState && STATE_CODES.includes(rowState) ? rowState : (settings.state ?? 'NSW')
      const existing = people.find((p) => p.email === email)
      if (existing) {
        await updatePerson(existing.id, { name, role: role ?? existing.role, phone: phone ?? existing.phone })
        updated++
      } else {
        await createPerson({ state, name, email, role, phone })
        added++
      }
    }
    onToast(`${added} people added${updated ? `, ${updated} updated` : ''}`)
  }

  return (
    <>
      <div className="section-title">
        <h2>People & notifications</h2>
        <span>{people.length} people</span>
      </div>
      <div className="card card__body--flush">
        <div className="card__body">
          <p className="small muted" style={{ margin: 0 }}>
            Work is allocated to these people, and they are notified at their work email — about work allocated to them and about the events they choose.
            Emails are sent by the Power Automate flow set up under Microsoft 365 below; without one, allocating offers to send the email from your own mail
            app.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn--sm" type="button" onClick={() => setEditing('new')}>
              <IconPlus />
              Add person
            </button>
            <input ref={csvRef} className="visually-hidden" type="file" accept=".csv,text/csv" aria-label="People CSV" onChange={(e) => importCsv(e.target.files?.[0])} />
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => csvRef.current?.click()} title="Columns: Name, Email, Role, Phone, State">
              Import CSV
            </button>
          </div>
        </div>
        {people.length === 0 ? <Empty title="No people yet" hint="Add the crew, supervisors and QA who get work and notifications." /> : null}
        {people.map((p) => (
          <button key={p.id} className="listitem" type="button" onClick={() => setEditing(p)}>
            <span className="listitem__num" style={{ fontSize: 13 }}>
              {p.name
                .split(/\s+/)
                .map((w) => w[0])
                .join('')
                .slice(0, 3)
                .toUpperCase()}
            </span>
            <span className="listitem__main">
              <strong>
                {p.name}
                {p.active ? '' : ' (inactive)'}
              </strong>
              <span>{[p.role, p.email, p.phone].filter(Boolean).join(' · ')}</span>
              <span className="row" style={{ marginTop: 6, gap: 6 }}>
                <span className="chip">{p.allStates ? 'All states' : p.state}</span>
                <span className={`chip ${p.notify.length ? 'chip--accent' : ''}`}>
                  {p.notify.length} notification{p.notify.length === 1 ? '' : 's'}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
      {editing ? <PersonSheet person={editing === 'new' ? null : editing} defaultState={settings.state} onClose={() => setEditing(null)} onToast={onToast} /> : null}
    </>
  )
}

function PersonSheet({ person, defaultState, onClose, onToast }: { person: Person | null; defaultState?: StateCode; onClose: () => void; onToast: (m: string) => void }) {
  const settings = useSettings()
  const [p, setP] = useState({
    name: person?.name ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    role: person?.role ?? '',
    company: person?.company ?? '',
    state: person?.state ?? defaultState ?? ('NSW' as StateCode),
    allStates: person?.allStates ?? false,
    active: person?.active ?? true,
    notify: person?.notify ?? defaultNotify(),
  })
  const [touchedNotify, setTouchedNotify] = useState(Boolean(person))
  const valid = p.name.trim() && isEmail(p.email)

  const toggle = (k: NotifyKey) => {
    setTouchedNotify(true)
    setP({ ...p, notify: p.notify.includes(k) ? p.notify.filter((x) => x !== k) : [...p.notify, k] })
  }

  const save = async () => {
    if (!valid) return
    const fields = { ...p, phone: p.phone.trim() || undefined, role: p.role || undefined, company: p.company.trim() || undefined }
    if (person) await updatePerson(person.id, fields)
    else await createPerson(fields)
    onToast(`${p.name.trim()} saved`)
    onClose()
  }

  return (
    <Sheet
      title={person ? person.name : 'New person'}
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 8 }}>
          {person ? (
            <ConfirmButton
              className="btn btn--ghost btn--sm recordfoot__delete"
              label="Delete"
              confirmLabel="Tap again to delete"
              onConfirm={async () => {
                await deletePerson(person.id)
                onToast(`${person.name} deleted`)
                onClose()
              }}
            />
          ) : null}
          <span className="spacer" />
          {person ? (
            <button
              className="btn btn--ghost"
              type="button"
              disabled={!settings.sync.powerAutomateUrl}
              title={settings.sync.powerAutomateUrl ? undefined : 'Set the Power Automate flow URL under Microsoft 365 first'}
              onClick={async () => {
                await raiseEvent({
                  event: 'notification.test',
                  state: person.state,
                  record: { assignedTo: person.name, assignedEmail: person.email },
                  summary: `Test notification for ${person.name} from Axis QA — if this arrived, notifications reach ${person.email}.`,
                })
                onToast(`Test sent to the flow for ${person.email}`)
              }}
            >
              Send test
            </button>
          ) : null}
          <button className="btn" type="button" disabled={!valid} onClick={save}>
            Save
          </button>
        </div>
      }
    >
      <div className="stack">
        <div className="field-grid">
          <Field label="Name">
            <input type="text" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="e.g. Joe Bloggs" autoFocus={!person} />
          </Field>
          <Field label="Work email" hint={p.email && !isEmail(p.email) ? 'That is not an email address.' : undefined}>
            <input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} placeholder="joe.bloggs@axisplumbing.com.au" />
          </Field>
          <Field label="Role">
            <select
              value={p.role}
              onChange={(e) => {
                const role = e.target.value
                // A new person's notifications follow their role until someone picks them by hand.
                setP({ ...p, role, notify: touchedNotify ? p.notify : defaultNotify(role) })
              }}
            >
              <option value="">—</option>
              {PERSON_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mobile">
            <input type="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} />
          </Field>
          <Field label="Company" hint="For a subcontractor.">
            <input type="text" value={p.company} onChange={(e) => setP({ ...p, company: e.target.value })} />
          </Field>
          <Field label="State">
            <select value={p.state} onChange={(e) => setP({ ...p, state: e.target.value as StateCode })}>
              {STATE_CODES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <span className="field-label">Email them about</span>
          <div className="stack" style={{ gap: 6 }}>
            {NOTIFY_KEYS.map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={p.notify.includes(k)} onChange={() => toggle(k)} />
                {NOTIFY_LABEL[k]}
              </label>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={p.allStates} onChange={(e) => setP({ ...p, allStates: e.target.checked })} />
          Every state's events, not just {p.state}'s (national QA)
        </label>
        <label className="check">
          <input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} />
          Active — offered for work and sent notifications
        </label>
      </div>
    </Sheet>
  )
}
