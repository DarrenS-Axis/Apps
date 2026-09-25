import { useEffect, useState, type ReactNode } from 'react'
import { db } from '../data/db'
import { createPerson, isEmail } from '../data/people'
import { useLive, usePeople, useSettings } from '../data/store'
import type { Allocation, StateCode } from '../data/types'
import { appBase } from '../lib/qr'
import { formatDate, relativeTime, todayIso } from '../lib/format'
import { ConfirmButton, Field, IconCheck, IconTrash } from './ui'

/**
 * The foot of a record's sheet — penetration, defect, piece of plant: Save,
 * Allocate to a worker, and Delete out of the way to one side.
 *
 * Fields in these sheets are written as they are typed, so nothing is lost
 * to a dropped signal or a closed sheet; Save commits anything still held in
 * a form, says so, and closes. The line above the buttons shows when the
 * record last changed and who it is with.
 */

export type AllocationInput = Required<Pick<Allocation, 'assignedTo'>> & Pick<Allocation, 'assignedEmail' | 'assignNote' | 'assignDue'>

/** Everyone the app has seen doing the work, for the allocation box to suggest. */
export function useWorkers(): { name: string; email?: string }[] {
  const settings = useSettings()
  return useLive(
    async () => {
      const found = new Map<string, string | undefined>()
      const add = (name?: string, email?: string) => {
        const n = name?.trim()
        if (!n) return
        const key = n.toLowerCase()
        const existing = [...found.keys()].find((k) => k.toLowerCase() === key)
        if (existing) {
          if (email && !found.get(existing)) found.set(existing, email)
        } else found.set(n, email)
      }
      add(settings.userName)
      for (const i of await db.itps.toArray()) {
        add(i.assignedTo, i.assignedEmail)
        add(i.signOff?.name)
      }
      for (const p of await db.penetrations.toArray()) {
        add(p.assignedTo, p.assignedEmail)
        add(p.installedBy)
      }
      for (const d of await db.defects.toArray()) {
        add(d.assignedTo, d.assignedEmail)
        add(d.rectifiedBy)
        add(d.raisedBy)
      }
      for (const i of await db.plant.toArray()) {
        add(i.assignedTo, i.assignedEmail)
        add(i.seenBy)
      }
      return [...found].map(([name, email]) => ({ name, email })).sort((a, b) => a.name.localeCompare(b.name))
    },
    [settings.userName],
    [] as { name: string; email?: string }[],
  )
}

/** "Allocated to Joe Bloggs · due 01/10/2026 · by Darren 2 hours ago" */
export function allocationText(a: Allocation): string {
  if (!a.assignedTo) return ''
  return [
    `Allocated to ${a.assignedTo}`,
    a.assignDue ? `due ${formatDate(a.assignDue)}` : '',
    a.assignedBy || a.assignedAt ? `by ${a.assignedBy ?? 'someone'}${a.assignedAt ? ` ${relativeTime(a.assignedAt)}` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** A pre-written email in the phone's own mail app — for when no flow is set up to send it. */
export function mailtoFor(to: string, subject: string, lines: string[]): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.filter(Boolean).join('\n'))}`
}

export function RecordFooter({
  label,
  describe,
  link,
  state,
  updatedAt,
  allocation,
  onSave,
  onAllocate,
  onDelete,
  deleteLabel = 'Delete',
  extra,
}: {
  /** What the record is called, for the button names: "F0002". */
  label: string
  /** One line saying what it is, for the email: "Penetration F0002 — 100mm FW, Level 3". */
  describe: string
  /** App route that opens it: "/project/…/firedoc?open=…". */
  link: string
  /** The state the record belongs to — new profiles are filed there. */
  state?: StateCode
  updatedAt: number
  allocation: Allocation
  onSave: () => Promise<void> | void
  /** A worker, or null to take it back. */
  onAllocate: (a: AllocationInput | null) => Promise<void>
  onDelete: () => Promise<void> | void
  deleteLabel?: string
  extra?: ReactNode
}) {
  const settings = useSettings()
  const people = usePeople(state ?? 'all')
  const seen = useWorkers()
  // Profiles first; names seen on records but with no profile after them.
  const workers = [
    ...people.filter((p) => p.active).map((p) => ({ name: p.name, email: p.email, role: p.role, profile: true })),
    ...seen.filter((w) => !people.some((p) => p.name.toLowerCase() === w.name.toLowerCase())).map((w) => ({ ...w, role: undefined, profile: false })),
  ]
  const [open, setOpen] = useState(false)
  const [saveProfile, setSaveProfile] = useState(true)
  const [notice, setNotice] = useState('')
  // The notice has done its job once read; the bar goes back to its usual size.
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 10000)
    return () => window.clearTimeout(t)
  }, [notice])
  const [name, setName] = useState(allocation.assignedTo ?? '')
  const [email, setEmail] = useState(allocation.assignedEmail ?? '')
  const [due, setDue] = useState(allocation.assignDue ?? '')
  const [note, setNote] = useState(allocation.assignNote ?? '')
  const [busy, setBusy] = useState(false)

  const profile = people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
  const pickName = (v: string) => {
    setName(v)
    const known = workers.find((w) => w.name.toLowerCase() === v.trim().toLowerCase())
    if (known?.email) setEmail(known.email)
  }
  const emailOk = !email.trim() || isEmail(email)

  const allocate = async () => {
    if (!name.trim() || !emailOk) return
    setBusy(true)
    try {
      const to = email.trim().toLowerCase() || undefined
      if (!profile && to && saveProfile && state) await createPerson({ state, name: name.trim(), email: to })
      await onAllocate({ assignedTo: profile?.name ?? name.trim(), assignedEmail: to, assignDue: due || undefined, assignNote: note.trim() || undefined })
      setNotice(
        !to
          ? `No email for ${name.trim()} — add one to their profile in Settings → People to notify them.`
          : settings.sync.powerAutomateUrl
            ? `${name.trim()} will be emailed at ${to} by the Power Automate flow.`
            : `No notification flow is set up — use “Email ${name.trim()}” to send it from your mail app.`,
      )
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const mail = allocation.assignedEmail
    ? mailtoFor(allocation.assignedEmail, `Allocated to you: ${describe}`, [
        `Hi ${allocation.assignedTo?.split(' ')[0] ?? ''},`,
        '',
        `${settings.userName || 'Axis QA'} has allocated this to you:`,
        describe,
        allocation.assignDue ? `Wanted by: ${formatDate(allocation.assignDue)}` : '',
        allocation.assignNote ? `Note: ${allocation.assignNote}` : '',
        '',
        `Open it: ${appBase()}#${link}`,
      ])
    : ''

  const save = async () => {
    // A field that commits on blur gets its chance before the sheet goes.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setBusy(true)
    try {
      await onSave()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {open ? (
        <div className="stack" style={{ gap: 8, marginBottom: 10 }}>
          <div className="field-grid">
            <Field label="Allocate to">
              <input type="text" list="workers" value={name} onChange={(e) => pickName(e.target.value)} placeholder="Worker's name" autoFocus />
              <datalist id="workers">
                {workers.map((w) => (
                  <option key={w.name} value={w.name}>
                    {[w.role, w.email].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="Work email (to notify)" hint={!emailOk ? 'That is not an email address.' : profile ? `Profile: ${[profile.role, profile.email].filter(Boolean).join(' · ')}` : undefined}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@axisplumbing.com.au" />
            </Field>
            <Field label="Wanted by">
              <input type="date" value={due} min={todayIso()} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Field label="Note for them">
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
          </div>
          {!profile && name.trim() && email.trim() && emailOk && state ? (
            <label className="check small">
              <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
              Save {name.trim()} as a person, so they are offered next time
            </label>
          ) : null}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {allocation.assignedTo ? (
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                disabled={busy}
                onClick={async () => {
                  await onAllocate(null)
                  setName('')
                  setEmail('')
                  setDue('')
                  setNote('')
                  setNotice('')
                  setOpen(false)
                }}
              >
                Take back from {allocation.assignedTo}
              </button>
            ) : null}
            <span className="spacer" />
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--sm" type="button" disabled={!name.trim() || !emailOk || busy} onClick={allocate}>
              Allocate {label}
            </button>
          </div>
        </div>
      ) : (
        <p className="recordfoot__status">
          <span>
            ✓ Changes save as you type · last change {relativeTime(updatedAt)}
          </span>
          {allocation.assignedTo ? <strong>{allocationText(allocation)}</strong> : null}
          {mail ? (
            <a href={mail} className="recordfoot__mail">
              ✉ Email {allocation.assignedTo}
            </a>
          ) : null}
        </p>
      )}
      {notice && !open ? <p className="recordfoot__notice">{notice}</p> : null}
      {!open ? (
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <ConfirmButton
            className="btn btn--ghost btn--sm recordfoot__delete"
            label={
              <>
                <IconTrash />
                {deleteLabel}
              </>
            }
            confirmLabel="Tap again to delete"
            onConfirm={() => void onDelete()}
          />
          <span className="spacer" />
          {extra}
          <button className="btn btn--ghost" type="button" onClick={() => setOpen(true)}>
            {allocation.assignedTo ? 'Reallocate' : 'Allocate to worker'}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={save}>
            <IconCheck />
            Save
          </button>
        </div>
      ) : null}
    </div>
  )
}
