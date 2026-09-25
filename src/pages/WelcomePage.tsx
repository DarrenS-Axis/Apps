import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { db, saveSettings } from '../data/db'
import { useBusinessUnits, useLive, useSettings } from '../data/store'
import { Field } from '../components/ui'
import { STATE_CODES, STATE_NAMES, USER_ROLE_LABEL, type StateCode, type UserRole } from '../data/types'

/**
 * First run: who you are and which state you work in. The state is the one
 * boundary the app enforces — everything after this screen is that state's.
 */
export function WelcomePage() {
  const settings = useSettings()
  const navigate = useNavigate()
  // A link opened on a new device: go there once the person has said who they are.
  const from = (useLocation().state as { from?: string } | null)?.from
  const target = from && from !== '/' && from !== '/welcome' ? from : '/state'
  const [name, setName] = useState(settings.userName)
  const [initials, setInitials] = useState(settings.userInitials)
  const [company, setCompany] = useState(settings.userCompany)
  const [state, setState] = useState<StateCode | ''>(settings.state ?? '')
  const [role, setRole] = useState<UserRole>(settings.role)
  const units = useBusinessUnits(state || undefined)
  const [unitIds, setUnitIds] = useState<string[]>(settings.businessUnitIds)

  // Signed in with a work account: the name comes from it, and a People
  // profile under that email says which state and what access.
  const account = settings.sync.account
  const profile = useLive(async () => (account?.username ? db.people.where('email').equals(account.username.toLowerCase()).first() : undefined), [account?.username], undefined)
  useEffect(() => {
    if (account?.name && !name) setName(account.name)
    if (profile) {
      if (!state) setState(profile.state)
      if (profile.role === 'National QA' || profile.allStates) setRole('national_qa')
      else if (profile.role === 'State QA') setRole('state_qa')
      if (!company && profile.company) setCompany(profile.company)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.name, profile?.id])

  const ready = name.trim() && (state || role === 'national_qa')
  const [saved, setSaved] = useState(false)

  // The app routes on the stored name, so leave only once the store has it —
  // navigating straight after the write races the live query and bounces back.
  useEffect(() => {
    if (settings.userName && (saved || !name)) navigate(target, { replace: true })
    // Someone who already has a name set does not need this screen; Settings
    // covers changes. Only run this on arrival and on save, not per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, settings.userName])

  const submit = async () => {
    await saveSettings({
      userName: name.trim(),
      userInitials: (initials || name.split(/\s+/).map((w) => w[0] ?? '').join('')).toUpperCase().slice(0, 4),
      userCompany: company.trim() || (units[0]?.entity ?? ''),
      state: state || undefined,
      role,
      businessUnitIds: role === 'national_qa' ? [] : unitIds,
    })
    setSaved(true)
  }

  return (
    <div className="welcome">
      <div className="welcome__brand">
        <span className="wordmark">AXIS</span>
        <span className="wordmark__sub">QA System</span>
      </div>
      <div className="card">
        <div className="card__body stack">
          <p className="small muted" style={{ margin: 0 }}>
            Controldoc, Firedoc and Reviewdoc for every Axis project, and the state's plant register. Choose the state you work
            in — the app shows that state's projects and plant and nothing else.
          </p>
          <Field label="Your name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Murtaza Bahloli" autoFocus />
          </Field>
          <div className="field-grid">
            <Field label="Initials">
              <input type="text" value={initials} onChange={(e) => setInitials(e.target.value.toUpperCase().slice(0, 4))} placeholder="MB" />
            </Field>
            <Field label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {(Object.keys(USER_ROLE_LABEL) as UserRole[]).map((r) => (
                  <option key={r} value={r}>
                    {USER_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="State" hint={role === 'national_qa' ? 'National QA sees every state; pick your home state for new projects.' : undefined}>
            <select value={state} onChange={(e) => { setState(e.target.value as StateCode); setUnitIds([]) }}>
              <option value="">Choose a state…</option>
              {STATE_CODES.map((s) => (
                <option key={s} value={s}>
                  {s} — {STATE_NAMES[s]}
                </option>
              ))}
            </select>
          </Field>
          {state && role !== 'national_qa' && units.length > 1 ? (
            <div>
              <span className="field-label">Business units</span>
              <p className="small muted" style={{ margin: '0 0 8px' }}>
                Leave all unticked to see every unit in {state}.
              </p>
              <div className="stack" style={{ gap: 6 }}>
                {units.map((u) => (
                  <label key={u.id} className="row" style={{ gap: 10 }}>
                    <input
                      type="checkbox"
                      style={{ width: 20, height: 20, minHeight: 0 }}
                      checked={unitIds.includes(u.id)}
                      onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((id) => id !== u.id))}
                    />
                    <span>{u.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <Field label="Company (printed on sign-offs)">
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={units[0]?.entity ?? 'Axis Plumbing'} />
          </Field>
          <button className="btn" type="button" disabled={!ready} onClick={() => void submit()}>
            Open {state ? `${state} projects` : 'projects'}
          </button>
        </div>
      </div>
    </div>
  )
}
