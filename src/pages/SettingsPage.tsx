import { useEffect, useRef, useState } from 'react'
import { exportBackup, importBackup, saveSettings, storageEstimate } from '../data/db'
import { useSettings } from '../data/store'
import { TEMPLATES } from '../data/templates'
import { Field, IconDownload, SignaturePad, Toast, useToast } from '../components/ui'
import { downloadBlob } from '../lib/format'
import { formatBytes } from '../lib/images'

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
      showToast(`Restored ${result.itps} ITPs and ${result.photos} photos`)
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
        <span>Used when signing items and sign-off blocks</span>
      </div>
      <div className="card">
        <div className="card__body">
          <div className="stack">
            <div className="field-grid">
              <Field label="Name">
                <input
                  type="text"
                  value={settings.userName}
                  onChange={(e) => void patch({ userName: e.target.value })}
                  placeholder="e.g. Brett Patman"
                />
              </Field>
              <Field label="Initials" hint="Stamped in the “Initial & Date” column.">
                <input
                  type="text"
                  value={settings.userInitials}
                  onChange={(e) => void patch({ userInitials: e.target.value.toUpperCase().slice(0, 4) })}
                  placeholder="e.g. BP"
                />
              </Field>
            </div>
            <div className="field-grid">
              <Field label="Role">
                <input type="text" value={settings.userRole} onChange={(e) => void patch({ userRole: e.target.value })} />
              </Field>
              <Field label="Company">
                <input type="text" value={settings.userCompany} onChange={(e) => void patch({ userCompany: e.target.value })} />
              </Field>
            </div>
            <div>
              <span className="field-label">Saved signature</span>
              <p className="small muted" style={{ margin: '0 0 8px' }}>
                Pre-fills the sign-off block. You can always re-sign on the ITP itself.
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
        <h2>Photo capture</h2>
      </div>
      <div className="card">
        <div className="card__body">
          <div className="stack">
            <label className="row" style={{ gap: 10 }}>
              <input
                type="checkbox"
                style={{ width: 20, height: 20, minHeight: 0 }}
                checked={settings.stampPhotos}
                onChange={(e) => void patch({ stampPhotos: e.target.checked })}
              />
              <span>
                <strong className="small">Burn the timestamp into the photo</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  Date, time, ITP and area are drawn across the bottom of every photo, so the evidence survives being copied out
                  of the app.
                </span>
              </span>
            </label>
            <label className="row" style={{ gap: 10 }}>
              <input
                type="checkbox"
                style={{ width: 20, height: 20, minHeight: 0 }}
                checked={settings.captureGps}
                onChange={(e) => void patch({ captureGps: e.target.checked })}
              />
              <span>
                <strong className="small">Record GPS coordinates</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  Uses the photo's own EXIF location when present, otherwise asks the device. Capture is never blocked if
                  location is unavailable.
                </span>
              </span>
            </label>
            <Field label="Stored photo size (long edge, px)" hint="Smaller keeps more photos on the device; 1600 px is plenty for an ITP record.">
              <select
                value={settings.photoMaxEdge}
                onChange={(e) => void patch({ photoMaxEdge: Number(e.target.value) })}
              >
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
            All records live in this browser's storage. Back up regularly — clearing site data deletes everything.
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
                downloadBlob(
                  new Blob([JSON.stringify(backup)], { type: 'application/json' }),
                  `hydraulic_itp_backup_${new Date().toISOString().slice(0, 10)}.json`,
                )
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
        <h2>About</h2>
      </div>
      <div className="card">
        <div className="card__body">
          <p className="small" style={{ marginTop: 0 }}>
            <strong>Hydraulic ITP Manager</strong> carries the {TEMPLATES.length} hydraulic services Inspection &amp; Test Plans,
            from inground sanitary drainage through to non-potable water tanks.
          </p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Templates cite the applicable AS/NZS standards as a starting point. Every raised ITP owns its own copy of the
            schedule, so item wording, acceptance criteria and inspection point types can be edited to suit the project
            specification and the approved quality plan.
          </p>
        </div>
      </div>

      <Toast message={toast} />
    </>
  )
}
