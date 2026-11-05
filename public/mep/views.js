// Orthographic views of the network: plan, front and side elevations, and an
// isometric. Pure functions over the stored plan positions (x, y in drawing
// units, y pointing south on screen) and elevations (z in metres).
//
//   plan       looking down               (x, y)
//   front      from the south, facing N   (x, −z)
//   side       from the east, facing W    (−y, −z)   north is to the right
//   isometric  from the south-east, 30°   ((x − y)·cos30, (x + y)·sin30 − z)
//
// Heights are drawn at the same scale as the plan, so elevations and the
// isometric are true to scale along every axis.

export const VIEWS = { plan: 'Plan', front: 'Front', side: 'Side', iso: 'Isometric' }

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = 0.5

/** Screen position of a point in a view, before any stacking offset. */
export function project(n, mode, metresPerPx) {
  const x = +n.x || 0
  const y = +n.y || 0
  const h = (+n.z || 0) / metresPerPx
  switch (mode) {
    case 'front': return { x, y: -h }
    case 'side': return { x: -y, y: -h }
    case 'iso': return { x: (x - y) * COS30, y: (x + y) * SIN30 - h }
    default: return { x, y }
  }
}

const planKey = (n) => `${Math.round((+n.x || 0) * 100)}|${Math.round((+n.y || 0) * 100)}`

/**
 * Points stacked at one plan position (a riser) would sit on top of each
 * other in plan, so each one up the stack is drawn a little up and to the
 * right — the usual riser tick — and stays clickable. Lowest stays put.
 */
export function stackIndex(nodes) {
  const groups = new Map()
  for (const n of nodes) {
    const k = planKey(n)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(n)
  }
  const index = new Map()
  for (const g of groups.values()) {
    g.sort((a, b) => (+a.z || 0) - (+b.z || 0) || String(a.id).localeCompare(String(b.id)))
    g.forEach((n, i) => index.set(n.id, i))
  }
  return index
}

/** The points sharing a plan position with this one (itself included). */
export function stackOf(nodes, node) {
  const k = planKey(node)
  return nodes.filter((n) => planKey(n) === k)
}

/** Where every point is drawn in a view. */
export function displayPositions(nodes, mode, metresPerPx, stackStep = 12) {
  const stack = mode === 'plan' ? stackIndex(nodes) : null
  const out = new Map()
  for (const n of nodes) {
    const p = project(n, mode, metresPerPx)
    const i = stack?.get(n.id) || 0
    out.set(n.id, i ? { x: p.x + i * stackStep, y: p.y - i * stackStep } : p)
  }
  return out
}

/** The distinct heights in use, lowest first — the level lines on elevations. */
export function levels(nodes) {
  return [...new Set(nodes.map((n) => Math.round((+n.z || 0) * 100) / 100))].sort((a, b) => a - b)
}

/** Bounding box of a set of positions, padded. */
export function bounds(positions, pad = 0) {
  const ps = [...positions.values()]
  if (!ps.length) return null
  const xs = ps.map((p) => p.x)
  const ys = ps.map((p) => p.y)
  const x0 = Math.min(...xs) - pad
  const y0 = Math.min(...ys) - pad
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 }
}
