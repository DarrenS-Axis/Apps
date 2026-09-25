import { useEffect, useRef, useState } from 'react'
import { PeopleAdmin } from '../components/PeopleAdmin'
import { createBusinessUnit, exportBackup, importBackup, saveOrg, saveSettings, storageEstimate, updateBusinessUnit } from '../data/db'
import { useBusinessUnits, useFlowUrl, useOutboxCount, useSettings } from '../data/store'
import { TEMPLATES } from '../data/templates'
import { FIRE_PROFILES, SCHEDULE_REVISION } from '../data/libraries/fireProfiles'
import { Field, IconDownload, SignaturePad, Toast, useToast } from '../components/ui'
import { downloadBlob, formatDateTime } from '../lib/format'
import { formatBytes } from '../lib/images'
import { STATE_CODES, STATE_NAMES, USER_ROLE_LABEL, type StateCode, type SyncConfig, type UserRole } from '../data/types'
import { isConfigured, provisionSharePoint, refreshAccount, signIn, signOut, syncNow, type SyncReport } from '../sync'
import { EVENT_SCHEMA } from '../sync/events'

export function SettingsPage() {
  const settings = useSettings()
  const [toast, showToast] = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [signing, setSigning] = useState(false)

  useEffect(() => {
    void storageEstimate().then(setStorage)
  }, [settings.updatedAt])

  const patch = async (changes: Parameters<typeof saveSettings>[0]) => {
    await saveSettings(changes)
  }

  const restore = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const result = await importBackup(JSON.parse(await file.text()))
      showToast(`Restored ${result.projects} projects, ${result.itps} ITPs, ${result.penetrations} penetrations, ${result.defects} defects`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read that backup file.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <div className="section-title">
        <h2>Your details</h2>
        <span>Used when signing steps and sign-off blocks</span>
      </div>
      <div className="card">
        <div className="card__body">
          <div className="stack">
            <div className="field-grid">
              <Field label="Name">
                <input type="text" value={settings.userName} onChange={(e) => void patch({ userName: e.target.value })} placeholder="e.g. Murtaza Bahloli" />
              </Field>
              <Field label="Initials" hint="Stamped against every step you sign.">
                <input type="text" value={settings.userInitials} onChange={(e) => void patch({ userInitials: e.target.value.toUpperCase().slice(0, 4) })} placeholder="e.g. MB" />
              </Field>
            </div>
            <div className="field-grid">
              <Field label="Role on site">
                <input type="text" value={settings.userRole} onChange={(e) => void patch({ userRole: e.target.value })} />
              </Field>
              <Field label="Company">
                <input type="text" value={settings.userCompany} onChange={(e) => void patch({ userCompany: e.target.value })} placeholder="Axis Plumbing NSW" />
              </Field>
            </div>
            <div>
              <span className="field-label">Saved signature</span>
              <p className="small muted" style={{ margin: '0 0 8px' }}>
                Pre-fills the Axis sign-off. You can always re-sign on the ITP itself.
              </p>
              {settings.userSignature && !signing ? (
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="sigshow" style={{ flex: 1 }}>
                    <img src={settings.userSignature} alt="Saved signature" />
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => setSigning(true)} type="button">
                    Replace
                  </button>
                </div>
              ) : (
                <SignaturePad
                  value={undefined}
                  onChange={(v) => {
                    void patch({ userSignature: v })
                    if (v) setSigning(false)
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h2>State and access</h2>
      </div>
      <div className="card">
        <div className="card__body stack">
          <div className="field-grid">
            <Field label="State" hint="Only this state's projects are shown and synced.">
              <select value={settings.state ?? ''} onChange={(e) => void patch({ state: (e.target.value || undefined) as StateCode | undefined, businessUnitIds: [] })}>
                <option value="">Not set</option>
                {STATE_CODES.map((s) => (
                  <option key={s} value={s}>
                    {s} — {STATE_NAMES[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Access" hint="National QA sees every state, for reporting.">
              <select value={settings.role} onChange={(e) => void patch({ role: e.target.value as UserRole })}>
                {(Object.keys(USER_ROLE_LABEL) as UserRole[]).map((r) => (
                  <option key={r} value={r}>
                    {USER_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <BusinessUnitsAdmin state={settings.state} />
        </div>
      </div>

      <PeopleAdmin onToast={showToast} />

      <SharePointSection config={settings.sync} onToast={showToast} />

      <div className="section-title">
        <h2>Photo capture</h2>
      </div>
      <div className="card">
        <div className="card__body">
          <div className="stack">
            <label className="row" style={{ gap: 10 }}>
              <input type="checkbox" style={{ width: 20, height: 20, minHeight: 0 }} checked={settings.stampPhotos} onChange={(e) => void patch({ stampPhotos: e.target.checked })} />
              <span>
                <strong className="small">Burn the timestamp into the photo</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  Date, time, ITP and area are drawn across the bottom of every photo, so the evidence survives being copied out of the app.
                </span>
              </span>
            </label>
            <label className="row" style={{ gap: 10 }}>
              <input type="checkbox" style={{ width: 20, height: 20, minHeight: 0 }} checked={settings.captureGps} onChange={(e) => void patch({ captureGps: e.target.checked })} />
              <span>
                <strong className="small">Record GPS coordinates</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  Uses the photo's own EXIF location when present, otherwise asks the device. Capture is never blocked if location is unavailable.
                </span>
              </span>
            </label>
            <Field label="Stored photo size (long edge, px)" hint="Smaller keeps more photos on the device; 1600 px is plenty for a QA record.">
              <select value={settings.photoMaxEdge} onChange={(e) => void patch({ photoMaxEdge: Number(e.target.value) })}>
                <option value={1200}>1200 px — smallest</option>
                <option value={1600}>1600 px — recommended</option>
                <option value={2048}>2048 px — detailed</option>
                <option value={2600}>2600 px — largest</option>
              </select>
            </Field>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h2>Data</h2>
      </div>
      <div className="card">
        <div className="card__body">
          <p className="small muted" style={{ marginTop: 0 }}>
            Records live on this device{settings.sync.mode === 'sharepoint' ? ' and in SharePoint' : ''}. Back up before clearing site data.
          </p>
          {storage ? (
            <div style={{ margin: '10px 0 14px' }}>
              <div className="row small muted" style={{ marginBottom: 5 }}>
                <span>On-device storage used</span>
                <span className="spacer" />
                <span className="mono">
                  {formatBytes(storage.usage)} of {formatBytes(storage.quota)}
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.min(100, (storage.usage / Math.max(1, storage.quota)) * 100)}%` }} />
              </div>
            </div>
          ) : null}
          <input ref={fileRef} className="visually-hidden" type="file" accept="application/json" onChange={(e) => restore(e.target.files)} />
          <div className="row">
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={async () => {
                const backup = await exportBackup()
                downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `axis_qa_backup_${new Date().toISOString().slice(0, 10)}.json`)
                showToast('Backup downloaded')
              }}
            >
              <IconDownload />
              Back up everything
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()} type="button">
              Restore from backup
            </button>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h2>Troubleshooting</h2>
      </div>
      <div className="card">
        <div className="card__body">
          <label className="row" style={{ gap: 10 }}>
            <input type="checkbox" style={{ width: 20, height: 20, minHeight: 0 }} checked={Boolean(settings.showGestureDebug)} onChange={(e) => void patch({ showGestureDebug: e.target.checked })} />
            <span>
              <strong className="small">Show plan gesture readout</strong>
              <span className="small muted" style={{ display: 'block' }}>
                Overlays live pan and pinch state on the plan. Turn this on only if the plan misbehaves on your device.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="section-title">
        <h2>About</h2>
      </div>
      <div className="card">
        <div className="card__body">
          <p className="small" style={{ marginTop: 0 }}>
            <strong>Axis QA</strong> — Controldoc, Firedoc and Reviewdoc. {TEMPLATES.length} ITPs from the Controldoc library; {FIRE_PROFILES.length} profiles from the
            Passive Fire Rating Schedule {SCHEDULE_REVISION}.
          </p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Every raised ITP owns its own copy of the checklist, so step wording, acceptance criteria and inspection keys can be edited to suit the project
            specification.
          </p>
        </div>
      </div>

      <Toast message={toast} />
    </>
  )
}

/* ------------------------------------------------------ business units */

function BusinessUnitsAdmin({ state }: { state?: StateCode }) {
  const units = useBusinessUnits(state)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [entity, setEntity] = useState('')
  if (!state) return null
  return (
    <div>
      <span className="field-label">Business units in {state}</span>
      <div className="stack" style={{ gap: 6 }}>
        {units.map((u) => (
          <div key={u.id} className="row" style={{ gap: 8 }}>
            <input type="text" value={u.name} onChange={(e) => void updateBusinessUnit(u.id, { name: e.target.value })} style={{ flex: 1 }} aria-label="Business unit name" />
            <input type="text" value={u.entity} onChange={(e) => void updateBusinessUnit(u.id, { entity: e.target.value })} style={{ flex: 1 }} aria-label="Trading entity" />
          </div>
        ))}
        {adding ? (
          <div className="row" style={{ gap: 8 }}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Unit name" style={{ flex: 1 }} />
            <input type="text" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Trading entity" style={{ flex: 1 }} />
            <button
              className="btn btn--sm"
              type="button"
              disabled={!name.trim()}
              onClick={async () => {
                await createBusinessUnit({ state, name: name.trim(), entity: entity.trim() || `Axis Plumbing ${state}` })
                setName('')
                setEntity('')
                setAdding(false)
              }}
            >
              Add
            </button>
          </div>
        ) : (
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setAdding(true)} style={{ alignSelf: 'flex-start' }}>
            Add business unit
          </button>
        )}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- sharepoint */

function SharePointSection({ config, onToast }: { config: SyncConfig; onToast: (m: string) => void }) {
  const pending = useOutboxCount()
  const flow = useFlowUrl()
  const [busy, setBusy] = useState<'' | 'signin' | 'provision' | 'sync'>('')
  const [report, setReport] = useState<SyncReport | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(Boolean(config.graphBaseUrl || config.devToken))
  const [showSchema, setShowSchema] = useState(false)

  useEffect(() => {
    void refreshAccount()
  }, [])

  const set = (changes: Partial<SyncConfig>) => saveSettings({ sync: { ...config, ...changes } })
  const run = async (what: 'signin' | 'provision' | 'sync') => {
    setBusy(what)
    try {
      if (what === 'signin') {
        await signIn()
        onToast('Signed in to Microsoft 365')
      } else if (what === 'provision') {
        const r = await provisionSharePoint()
        onToast(`SharePoint ready — ${r.created.length} created, ${r.existing.length} already there${r.columnsAdded ? `, ${r.columnsAdded} columns added` : ''}`)
      } else {
        const r = await syncNow()
        setReport(r)
        onToast(r.errors.length ? `Sync: ${r.errors[0]}` : `Synced — ${r.pushed} sent, ${r.pulled} received`)
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const ready = isConfigured(config)

  return (
    <>
      <div className="section-title">
        <h2>Microsoft 365</h2>
        <span>SharePoint lists and Power Automate</span>
      </div>
      <div className="card">
        <div className="card__body stack">
          {config.managed ? (
            <div className="banner banner--ok">
              <span>
                <strong>Connected for the whole organisation</strong> — {config.siteUrl?.replace(/^https:\/\//, '')}. Everyone who signs in sees the same data;
                changes go up within seconds and others&apos; arrive every {config.pollSeconds ?? 30} seconds while the app is open.
              </span>
            </div>
          ) : null}
          <label className="row" style={{ gap: 10 }} hidden={config.managed}>
            <input type="checkbox" style={{ width: 20, height: 20, minHeight: 0 }} checked={config.mode === 'sharepoint'} onChange={(e) => void set({ mode: e.target.checked ? 'sharepoint' : 'local' })} />
            <span>
              <strong className="small">Sync to SharePoint</strong>
              <span className="small muted" style={{ display: 'block' }}>
                Every record is written to this device first and queued for SharePoint, so the app works the same with no signal. Each state pulls only
                its own records; national QA pulls all of them.
              </span>
            </span>
          </label>
          {/* Notifications work with or without SharePoint sync. */}
          <Field
            label="Power Automate flow URL (notifications)"
            hint='The "When an HTTP request is received" URL. The app posts an event — with the people to email — when work is allocated, a hold point is reached, an ITP or penetration is completed or defected, a defect is raised or closed, or plant goes missing.'
          >
            <input
              type="url"
              value={flow ?? ''}
              onChange={async (e) => {
                // Shared: kept in SharePoint for everyone, not on this device.
                await saveOrg({ powerAutomateUrl: e.target.value.trim() || undefined })
                if (config.powerAutomateUrl) await set({ powerAutomateUrl: undefined })
              }}
              placeholder="https://prod-….logic.azure.com/workflows/…"
            />
          </Field>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setShowSchema(!showSchema)} style={{ alignSelf: 'flex-start' }}>
            {showSchema ? 'Hide' : 'Show'} the request body JSON schema for the flow
          </button>
          {showSchema ? <pre className="small mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(EVENT_SCHEMA, null, 2)}</pre> : null}
          {config.mode === 'sharepoint' ? (
            <>
              {config.managed ? null : (
              <>
              <Field label="SharePoint site URL" hint="The site the QA lists live in, e.g. https://axisplumbing.sharepoint.com/sites/QA">
                <input type="url" value={config.siteUrl ?? ''} onChange={(e) => void set({ siteUrl: e.target.value.trim() })} placeholder="https://…sharepoint.com/sites/QA" />
              </Field>
              <div className="field-grid">
                <Field label="Entra tenant ID" hint="From the app registration's Overview page.">
                  <input type="text" value={config.tenantId ?? ''} onChange={(e) => void set({ tenantId: e.target.value.trim() })} placeholder="00000000-0000-…" />
                </Field>
                <Field label="Application (client) ID" hint="A public client (SPA) registration — no secret.">
                  <input type="text" value={config.clientId ?? ''} onChange={(e) => void set({ clientId: e.target.value.trim() })} placeholder="00000000-0000-…" />
                </Field>
              </div>
              </>
              )}
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {config.account ? (
                  <>
                    <span className="chip chip--ok">Signed in as {config.account.name}</span>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => void signOut().then(() => onToast('Signed out'))}>
                      Sign out
                    </button>
                  </>
                ) : (
                  <button className="btn btn--sm" type="button" disabled={busy !== '' || !config.tenantId || !config.clientId} onClick={() => void run('signin')}>
                    {busy === 'signin' ? 'Signing in…' : 'Sign in with Microsoft'}
                  </button>
                )}
                <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== '' || !ready} onClick={() => void run('provision')}>
                  {busy === 'provision' ? 'Creating lists…' : config.provisionedAt ? 'Re-check SharePoint lists' : 'Provision SharePoint lists'}
                </button>
                <button className="btn btn--ghost btn--sm" type="button" disabled={busy !== '' || !ready || (!config.siteId && !config.managed)} onClick={() => void run('sync')}>
                  {busy === 'sync' ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
              <div className="small muted">
                {config.provisionedAt ? `Lists provisioned ${formatDateTime(config.provisionedAt)}. ` : 'Lists not provisioned yet. '}
                {config.lastSyncAt ? `Last sync ${formatDateTime(config.lastSyncAt)}. ` : ''}
                {pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to go up.` : 'Nothing waiting.'}
              </div>
              {report?.errors.length ? (
                <div className="banner banner--warn">
                  <div>
                    {report.errors.slice(0, 4).map((e) => (
                      <div key={e}>{e}</div>
                    ))}
                  </div>
                </div>
              ) : null}
              <button className="btn btn--ghost btn--sm" type="button" hidden={config.managed} onClick={() => setShowAdvanced(!showAdvanced)} style={{ alignSelf: 'flex-start' }}>
                {showAdvanced ? 'Hide' : 'Show'} advanced
              </button>
              {showAdvanced && !config.managed ? (
                <div className="field-grid">
                  <Field label="Graph endpoint override" hint="Leave blank for graph.microsoft.com.">
                    <input type="url" value={config.graphBaseUrl ?? ''} onChange={(e) => void set({ graphBaseUrl: e.target.value.trim() || undefined })} />
                  </Field>
                  <Field label="Fixed bearer token" hint="For a test server only. Never a real token.">
                    <input type="text" value={config.devToken ?? ''} onChange={(e) => void set({ devToken: e.target.value.trim() || undefined })} />
                  </Field>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  )
}
