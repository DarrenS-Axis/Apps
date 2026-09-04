import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createDrawing, deleteDrawing, updateDrawing } from '../data/db'
import { useDrawings, useItps } from '../data/store'
import type { Drawing } from '../data/types'
import { processDrawing } from '../lib/images'
import { PlanViewer } from '../components/PlanViewer'
import { ConfirmButton, Empty, Field, IconPlan, IconPlus, IconTrash, Sheet, Toast, useToast } from '../components/ui'

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
  const [image, setImage] = useState<{ data: string; thumb: string; width: number; height: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      setImage(await processDrawing(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const payload = {
      ...form,
      ...(image
        ? { imageData: image.data, thumbData: image.thumb, imageWidth: image.width, imageHeight: image.height }
        : {}),
    }
    if (drawing) await updateDrawing(drawing.id, payload)
    else await createDrawing({ projectId, ...payload })
    onSaved()
    onClose()
  }

  const preview = image?.thumb ?? drawing?.thumbData

  return (
    <Sheet title={drawing ? 'Edit drawing' : 'Add drawing'} onClose={onClose}>
      <div className="stack">
        <div className="field-grid">
          <Field label="Drawing number">
            <input
              type="text"
              autoFocus
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

        <div>
          <span className="field-label">Plan image</span>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            A screenshot or export of the plan. It is stored on the device and used for dropping location pins and for the
            photographic record page of the exported ITP.
          </p>
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            onChange={(e) => pick(e.target.files)}
          />
          <div className="row">
            <button className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()} disabled={busy} type="button">
              {busy ? 'Processing…' : preview ? 'Replace image' : 'Choose image'}
            </button>
          </div>
          {error ? (
            <div className="banner banner--warn" style={{ marginTop: 8 }}>
              {error}
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

        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>

        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn" onClick={save} disabled={!form.number.trim() && !form.title.trim()} type="button">
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
