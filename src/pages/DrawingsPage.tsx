import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createDrawing, deleteDrawing, updateDrawing } from '../data/db'
import { useDrawings, useItps } from '../data/store'
import type { Drawing } from '../data/types'
import { guessDrawingDetails, importPlanFile, type ImportProgress, type PlanImport } from '../lib/planImport'
import { PlanViewer } from '../components/PlanViewer'
import { ConfirmButton, Empty, Field, IconPlan, IconPlus, IconTrash, IconWarn, Sheet, Toast, useToast } from '../components/ui'

export function DrawingsPage() {
  const { projectId } = useParams()
  const drawings = useDrawings(projectId)
  const itps = useItps(projectId)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Drawing | null>(null)
  const [toast, showToast] = useToast()

  const usage = (id: string) => itps.filter((i) => i.drawingIds.includes(id))

  return (
    <>
      <div className="section-title">
        <h2>Drawing register</h2>
        <span>{drawings.length} loaded</span>
        <span className="spacer" />
        <button className="btn btn--sm" onClick={() => setAdding(true)} type="button">
          <IconPlus />
          Add drawing
        </button>
      </div>

      {drawings.length === 0 ? (
        <div className="card">
          <div className="card__body">
            <Empty
              icon={<IconPlan />}
              title="No drawings loaded"
              hint="Add a plan image or screenshot so ITPs can reference the drawing number and pin the exact inspection location."
            />
          </div>
        </div>
      ) : (
        <div className="grid">
          {drawings.map((d) => {
            const used = usage(d.id)
            return (
              <button
                key={d.id}
                className="card"
                onClick={() => setOpen(d)}
                type="button"
                style={{ textAlign: 'left', cursor: 'pointer', padding: 0, border: '1px solid var(--line)' }}
              >
                <div style={{ aspectRatio: '16 / 10', overflow: 'hidden', background: 'var(--surface-2)' }}>
                  {d.thumbData ? (
                    <img
                      src={d.thumbData}
                      alt={`${d.number} thumbnail`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                      <IconPlan />
                    </div>
                  )}
                </div>
                <div className="card__body">
                  <strong>{d.number || 'Untitled drawing'}</strong>
                  <div className="small muted">{d.title || 'No title'}</div>
                  <div className="row" style={{ marginTop: 8, gap: 6 }}>
                    {d.revision ? <span className="chip">{d.revision}</span> : null}
                    <span className="chip">{d.discipline}</span>
                    {used.length ? <span className="chip chip--accent">{used.length} ITP{used.length > 1 ? 's' : ''}</span> : null}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {adding ? (
        <DrawingSheet
          projectId={projectId!}
          onClose={() => setAdding(false)}
          onSaved={() => showToast('Drawing added')}
        />
      ) : null}

      {open ? (
        <DrawingDetail
          drawing={open}
          usedBy={usage(open.id).length}
          onClose={() => setOpen(null)}
          onToast={showToast}
        />
      ) : null}

      <Toast message={toast} />
    </>
  )
}

function DrawingSheet({
  projectId,
  drawing,
  onClose,
  onSaved,
}: {
  projectId: string
  drawing?: Drawing
  onClose: () => void
  onSaved: () => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [form, setForm] = useState({
    number: drawing?.number ?? '',
    title: drawing?.title ?? '',
    revision: drawing?.revision ?? '',
    discipline: drawing?.discipline ?? 'Hydraulic',
    issuedDate: drawing?.issuedDate ?? '',
    notes: drawing?.notes ?? '',
  })
  const [imported, setImported] = useState<PlanImport | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  const chosen = imported?.pages[pageIndex] ?? null

  const ingestRef = useRef<(f: File | Blob | undefined) => void>(() => {})

  // Paste events go to the focused element, so a handler on the drop zone would
  // never fire. Listening on the window lets someone copy a plan in Explorer or
  // Finder and paste it straight into the open sheet.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files?.[0]
      if (file) ingestRef.current(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const ingest = async (file: File | Blob | undefined) => {
    if (!file) return
    setBusy(true)
    setError('')
    setProgress(null)
    try {
      const result = await importPlanFile(file, { onProgress: setProgress })
      setImported(result)
      setPageIndex(0)

      // Pre-fill from the title block where the fields are still empty, so the
      // crew is not retyping what the drawing already says.
      const guess = guessDrawingDetails(result.pages[0], result.fileName)
      setForm((f) => ({
        ...f,
        number: f.number || guess.number || '',
        revision: f.revision || guess.revision || '',
        title: f.title || guess.title || '',
      }))
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not read that file: ${err.message}`
          : 'Could not read that file. Images and PDFs are supported.',
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  ingestRef.current = (f) => void ingest(f)

  // Re-guess when a different sheet of a multi-page set is selected, since each
  // sheet carries its own title block.
  const selectPage = (index: number) => {
    setPageIndex(index)
    if (!imported) return
    const guess = guessDrawingDetails(imported.pages[index], imported.fileName)
    setForm((f) => ({ ...f, number: guess.number || f.number, revision: guess.revision || f.revision }))
  }

  const save = async () => {
    const payload = {
      ...form,
      ...(chosen
        ? { imageData: chosen.data, thumbData: chosen.thumb, imageWidth: chosen.width, imageHeight: chosen.height }
        : {}),
    }
    if (drawing) await updateDrawing(drawing.id, payload)
    else await createDrawing({ projectId, ...payload })
    onSaved()
    onClose()
  }

  const preview = chosen?.thumb ?? drawing?.thumbData

  return (
    <Sheet title={drawing ? 'Edit drawing' : 'Add drawing'} onClose={onClose}>
      <div className="stack">
        <div>
          <span className="field-label">Plan</span>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            Pick a PDF or image of the drawing. The picker opens your device's file browser, so anything you can reach from
            there works — <strong>SharePoint, OneDrive, Google Drive, Dropbox</strong>, Files, or the photo library. Nothing is
            uploaded anywhere: the plan is rendered and stored on this device.
          </p>

          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,image/*,.pdf"
            onChange={(e) => {
              void ingest(e.target.files?.[0])
              e.target.value = ''
            }}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void ingest(e.dataTransfer.files?.[0])
            }}
            style={{
              border: `1px dashed ${dragOver ? 'var(--accent)' : 'var(--line-strong)'}`,
              background: dragOver ? 'var(--accent-soft)' : 'var(--surface)',
              borderRadius: 'var(--r-sm)',
              padding: 14,
              textAlign: 'center',
            }}
          >
            <button className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={busy} type="button">
              <IconPlan />
              {busy ? 'Reading…' : preview ? 'Replace plan' : 'Choose plan (PDF or image)'}
            </button>
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              On a phone, tap <em>Browse</em> in the picker to reach SharePoint and OneDrive. On a computer you can also drag a
              file here or paste one.
            </p>
          </div>

          {busy && progress ? (
            <div style={{ marginTop: 10 }}>
              <div className="row small muted" style={{ marginBottom: 5 }}>
                <span>Rendering sheet {progress.page} of {progress.total}</span>
                <span className="spacer" />
                <span className="mono">{Math.round((progress.page / progress.total) * 100)}%</span>
              </div>
              <div className="bar">
                <i style={{ width: `${(progress.page / progress.total) * 100}%` }} />
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="banner banner--warn" style={{ marginTop: 8 }}>
              <IconWarn />
              <div>{error}</div>
            </div>
          ) : null}

          {imported && imported.pages.length > 1 ? (
            <div style={{ marginTop: 12 }}>
              <span className="field-label">
                Which sheet? ({imported.pages.length} pages in this PDF)
              </span>
              <div className="photos">
                {imported.pages.map((p, i) => (
                  <button
                    key={p.page}
                    type="button"
                    className="photo"
                    onClick={() => selectPage(i)}
                    style={{
                      outline: i === pageIndex ? '3px solid var(--accent)' : 'none',
                      outlineOffset: -3,
                    }}
                  >
                    <img src={p.thumb} alt={`Page ${p.page}`} loading="lazy" />
                    <span className="photo__tag">p{p.page}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {preview ? (
            <img
              src={preview}
              alt="Plan preview"
              style={{ marginTop: 10, width: '100%', borderRadius: 6, border: '1px solid var(--line)' }}
            />
          ) : null}
        </div>

        <div className="hr" />

        <div className="field-grid">
          <Field label="Drawing number">
            <input
              type="text"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              placeholder="e.g. HC-001"
            />
          </Field>
          <Field label="Revision / issue">
            <input
              type="text"
              value={form.revision}
              onChange={(e) => setForm({ ...form, revision: e.target.value })}
              placeholder="e.g. ISSUE 4"
            />
          </Field>
        </div>
        <Field label="Title">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Below ground drainage — Minus 1"
          />
        </Field>
        <div className="field-grid">
          <Field label="Discipline">
            <input type="text" value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value })} />
          </Field>
          <Field label="Issued date">
            <input type="date" value={form.issuedDate} onChange={(e) => setForm({ ...form, issuedDate: e.target.value })} />
          </Field>
        </div>

        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>

        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn" onClick={save} disabled={busy || (!form.number.trim() && !form.title.trim())} type="button">
            Save drawing
          </button>
        </div>
      </div>
    </Sheet>
  )
}

function DrawingDetail({
  drawing,
  usedBy,
  onClose,
  onToast,
}: {
  drawing: Drawing
  usedBy: number
  onClose: () => void
  onToast: (m: string) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <DrawingSheet
        projectId={drawing.projectId}
        drawing={drawing}
        onClose={() => setEditing(false)}
        onSaved={() => onToast('Drawing updated')}
      />
    )
  }

  return (
    <Sheet title={`${drawing.number} ${drawing.revision}`.trim()} onClose={onClose}>
      <div className="stack">
        <PlanViewer drawing={drawing} pins={[]} height={340} />
        <div>
          <strong>{drawing.title || 'No title'}</strong>
          <div className="small muted">
            {drawing.discipline}
            {drawing.issuedDate ? ` · issued ${drawing.issuedDate}` : ''}
            {usedBy ? ` · referenced by ${usedBy} ITP${usedBy > 1 ? 's' : ''}` : ' · not referenced yet'}
          </div>
          {drawing.notes ? <p className="small" style={{ marginBottom: 0 }}>{drawing.notes}</p> : null}
        </div>
        <div className="row">
          <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)} type="button">
            Edit details
          </button>
          <span className="spacer" />
          <ConfirmButton
            label={
              <>
                <IconTrash />
                Delete
              </>
            }
            confirmLabel="Tap again to delete"
            onConfirm={async () => {
              await deleteDrawing(drawing.id)
              onToast('Drawing deleted')
              onClose()
            }}
          />
        </div>
        {usedBy ? (
          <div className="banner banner--warn">
            Deleting this drawing also removes the location pins recorded against it on {usedBy} ITP
            {usedBy > 1 ? 's' : ''}.
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}
