// Axis MEP Design — the editor.
//
// One project object holds everything (nodes, links, settings, the fixture
// library and the underlay). Every edit goes through commit(), which snapshots
// for undo, re-solves the network and redraws. Networks here are small enough
// (hundreds of elements) that a full redraw on every change is instant.

import { FIXTURES, MATERIALS, SYSTEMS, DRAIN_K } from './data.js'
import { calculate, linkLength } from './calc.js'
import { newProject, demoProject } from './project.js'

const SVG = 'http://www.w3.org/2000/svg'
const STORE_KEY = 'axis-mep-project'
const $ = (s) => document.querySelector(s)
const clone = (o) => JSON.parse(JSON.stringify(o))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const fmt = (n, d = 2) => (n == null || Number.isNaN(n) ? '–' : (+n).toFixed(d))

const ROOT_KIND = { water: 'source', drain: 'outlet', air: 'ahu' }
const ROOT_LABEL = { water: 'Source', drain: 'Drain connection', air: 'Air handler' }
const KIND_NAME = { source: 'Water source', outlet: 'Drain connection', ahu: 'Air handler', fixture: 'Fixture', terminal: 'Air terminal', junction: 'Junction' }

const state = {
  project: load() || newProject(),
  selection: null, // { type: 'node'|'link', id }
  tool: 'select',
  system: 'CW',
  fixtureType: 'basin',
  view: { x: 60, y: 60, k: 1 },
  linkStart: null,
  scalePts: [],
  results: null,
  undo: [],
  redo: [],
  side: 'props',
  res: 'summary',
}

// ---------- persistence ----------

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? migrate(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function migrate(p) {
  const base = newProject(p.name)
  return {
    ...base,
    ...p,
    settings: { ...base.settings, ...p.settings, water: { ...base.settings.water, ...p.settings?.water }, drain: { ...base.settings.drain, ...p.settings?.drain }, air: { ...base.settings.air, ...p.settings?.air } },
    fixtures: { ...base.fixtures, ...p.fixtures },
  }
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.project))
  } catch {
    status('Autosave failed — the underlay may be too large for browser storage. Use Save to keep a copy.')
  }
}

function download(name, text, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const fileSafe = (s) => (s || 'project').replace(/[^\w.-]+/g, '_')

// ---------- model edits ----------

const P = () => state.project
const nodeById = (id) => P().nodes.find((n) => n.id === id)
const linkById = (id) => P().links.find((l) => l.id === id)
const nextId = (prefix) => `${prefix}${++P().seq}`
const sysKind = (k = state.system) => SYSTEMS[k].kind

function snapshot() {
  state.undo.push(JSON.stringify(P()))
  if (state.undo.length > 100) state.undo.shift()
  state.redo = []
}

function commit({ snap = true } = {}) {
  if (snap) snapshot()
  refresh()
}

function refresh() {
  persist()
  state.results = calculate(P())
  render()
}

function addNode(kind, x, y, extra = {}) {
  const n = { id: nextId('N'), kind, x: Math.round(x), y: Math.round(y), z: 0, label: '', ...extra }
  if (kind === 'source') Object.assign(n, { system: state.system, pressure: 350, label: n.label || (state.system === 'HW' ? 'Water heater' : 'Water meter') })
  if (kind === 'outlet') Object.assign(n, { system: state.system, label: n.label || 'Sewer connection' })
  if (kind === 'ahu') Object.assign(n, { system: state.system, label: n.label || 'AHU-1' })
  if (kind === 'fixture') n.fixture = n.fixture || state.fixtureType
  if (kind === 'terminal') n.airflow = n.airflow ?? 100
  P().nodes.push(n)
  return n
}

function addLink(a, b, system = state.system) {
  if (a === b) return null
  if (P().links.some((l) => l.system === system && ((l.a === a && l.b === b) || (l.a === b && l.b === a)))) return null
  const l = { id: nextId('L'), a, b, system }
  P().links.push(l)
  return l
}

/** Split a link at a point, returning the new junction. */
function splitLink(link, x, y) {
  const j = addNode('junction', x, y)
  const tail = { ...clone(link), id: nextId('L'), a: j.id, length: undefined }
  link.b = j.id
  link.length = undefined
  P().links.push(tail)
  return j
}

function deleteSelection() {
  const sel = state.selection
  if (!sel) return
  snapshot()
  if (sel.type === 'node') {
    P().nodes = P().nodes.filter((n) => n.id !== sel.id)
    P().links = P().links.filter((l) => l.a !== sel.id && l.b !== sel.id)
  } else {
    P().links = P().links.filter((l) => l.id !== sel.id)
  }
  state.selection = null
  refresh()
}

function undo() {
  if (!state.undo.length) return
  state.redo.push(JSON.stringify(P()))
  state.project = JSON.parse(state.undo.pop())
  state.selection = null
  refresh()
}

function redo() {
  if (!state.redo.length) return
  state.undo.push(JSON.stringify(P()))
  state.project = JSON.parse(state.redo.pop())
  refresh()
}

// ---------- drawing ----------

const svg = $('#canvas')
const view = $('#view')

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v)
  if (parent) parent.appendChild(e)
  return e
}

function render() {
  const { x, y, k } = state.view
  view.setAttribute('transform', `translate(${x} ${y}) scale(${k})`)
  renderUnderlay()
  renderLinks()
  renderNodes()
  renderGhost()
  renderSide()
  renderResults()
  $('#projectName').value = P().name
  const m = P().settings.metresPerPx
  status(`Scale 1 px = ${fmt(m, 3)} m · grid ${fmt(20 * m, 1)} m · zoom ${fmt(k * 100, 0)}%`)
}

function renderUnderlay() {
  const img = $('#underlay')
  const u = P().underlay
  if (!u) {
    img.removeAttribute('href')
    img.setAttribute('width', 0)
    return
  }
  img.setAttribute('href', u.href)
  img.setAttribute('x', u.x)
  img.setAttribute('y', u.y)
  img.setAttribute('width', u.w)
  img.setAttribute('height', u.h)
  img.setAttribute('opacity', $('#underlayOpacity').value)
}

function renderLinks() {
  const layer = $('#linksLayer')
  const labels = $('#labelsLayer')
  layer.replaceChildren()
  labels.replaceChildren()
  const nodes = new Map(P().nodes.map((n) => [n.id, n]))
  const showLabels = $('#labels').checked
  // Parallel links (CW + HW + SAN on the same route) are offset so all show.
  const pairCount = new Map()
  for (const l of P().links) {
    const a = nodes.get(l.a)
    const b = nodes.get(l.b)
    if (!a || !b) continue
    const key = [l.a, l.b].sort().join('|')
    const i = pairCount.get(key) || 0
    pairCount.set(key, i + 1)
    const off = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 6
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const ox = (-(b.y - a.y) / len) * off
    const oy = ((b.x - a.x) / len) * off
    const sys = SYSTEMS[l.system]
    const sel = state.selection?.type === 'link' && state.selection.id === l.id
    const coords = { x1: a.x + ox, y1: a.y + oy, x2: b.x + ox, y2: b.y + oy }
    el('line', { ...coords, class: `link ${sys.kind}${sel ? ' selected' : ''}`, stroke: sys.color }, layer)
    el('line', { ...coords, class: 'link hit', 'data-link': l.id }, layer)
    const r = state.results?.links[l.id]
    if (showLabels && r) {
      const mx = (a.x + b.x) / 2 + ox
      const my = (a.y + b.y) / 2 + oy
      const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x)
      const t = el('text', vertical
        ? { x: mx - 6, y: my, class: 'lbl', 'text-anchor': 'middle', transform: `rotate(-90 ${mx - 6} ${my})`, fill: sys.color }
        : { x: mx, y: my - 6, class: 'lbl', 'text-anchor': 'middle', fill: sys.color }, labels)
      t.textContent = r.label
    }
  }
}

function nodeFails(n) {
  const r = state.results?.nodes[n.id]
  return r && Object.values(r).some((x) => x.ok === false)
}

function renderNodes() {
  const layer = $('#nodesLayer')
  layer.replaceChildren()
  for (const n of P().nodes) {
    const sel = state.selection?.type === 'node' && state.selection.id === n.id
    const g = el('g', { class: `node${sel ? ' selected' : ''}`, 'data-node': n.id, transform: `translate(${n.x} ${n.y})` }, layer)
    const color = n.system ? SYSTEMS[n.system].color : null
    const fail = nodeFails(n) ? ' fail' : ''
    let caption = n.label
    if (n.kind === 'source') {
      el('circle', { r: 10, class: 'shape', style: `fill:${color}` }, g)
      el('text', { y: 4, 'text-anchor': 'middle', style: 'fill:#fff;stroke:none;font-weight:700' }, g).textContent = 'S'
    } else if (n.kind === 'outlet') {
      el('rect', { x: -9, y: -9, width: 18, height: 18, class: 'shape', style: `fill:${color}` }, g)
    } else if (n.kind === 'ahu') {
      el('rect', { x: -18, y: -11, width: 36, height: 22, rx: 3, class: 'shape', style: `fill:${color}` }, g)
      el('text', { y: 4, 'text-anchor': 'middle', style: 'fill:#fff;stroke:none;font-weight:700' }, g).textContent = 'AHU'
    } else if (n.kind === 'fixture') {
      el('circle', { r: 8, class: `shape${fail}` }, g)
      const fx = P().fixtures[n.fixture]
      caption = n.label || fx?.name || n.fixture
    } else if (n.kind === 'terminal') {
      el('rect', { x: -8, y: -8, width: 16, height: 16, class: 'shape' }, g)
      el('path', { d: 'M-8-8L8 8M8-8L-8 8', class: 'shape' }, g)
      caption = `${n.label ? n.label + ' ' : ''}${n.airflow} L/s`
    } else {
      el('circle', { r: 4, class: 'shape', style: 'fill:var(--ink)' }, g)
    }
    if (caption) el('text', { y: n.kind === 'junction' ? -8 : 22, 'text-anchor': 'middle' }, g).textContent = caption
  }
}

let ghostTo = null
function renderGhost() {
  const layer = $('#ghostLayer')
  layer.replaceChildren()
  if (state.tool === 'link' && state.linkStart && ghostTo) {
    const a = nodeById(state.linkStart)
    if (a) el('line', { x1: a.x, y1: a.y, x2: ghostTo.x, y2: ghostTo.y, class: 'ghost' }, layer)
  }
  if (state.tool === 'scale' && state.scalePts.length === 1 && ghostTo) {
    const a = state.scalePts[0]
    el('line', { x1: a.x, y1: a.y, x2: ghostTo.x, y2: ghostTo.y, class: 'ghost' }, layer)
  }
}

function status(msg) {
  $('#status').textContent = msg
}

// ---------- pointer & keyboard ----------

function toWorld(evt) {
  const r = svg.getBoundingClientRect()
  return { x: (evt.clientX - r.left - state.view.x) / state.view.k, y: (evt.clientY - r.top - state.view.y) / state.view.k }
}

const snap = (v) => Math.round(v / 10) * 10

function placePoint(pt) {
  let p = { x: snap(pt.x), y: snap(pt.y) }
  const start = state.linkStart && nodeById(state.linkStart)
  if (start && $('#ortho').checked) {
    if (Math.abs(p.x - start.x) >= Math.abs(p.y - start.y)) p.y = start.y
    else p.x = start.x
  }
  return p
}

function projectOnto(link, pt) {
  const a = nodeById(link.a)
  const b = nodeById(link.b)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0.05, Math.min(0.95, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return { x: Math.round(a.x + t * dx), y: Math.round(a.y + t * dy) }
}

let drag = null

svg.addEventListener('pointerdown', (e) => {
  svg.focus()
  const pt = toWorld(e)
  const nodeEl = e.target.closest('[data-node]')
  const linkEl = e.target.closest('[data-link]')
  const nodeId = nodeEl?.dataset.node
  const link = linkEl ? linkById(linkEl.dataset.link) : null

  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y }
    svg.setPointerCapture(e.pointerId)
    return
  }
  if (e.button !== 0) return

  switch (state.tool) {
    case 'select':
      if (nodeId) {
        state.selection = { type: 'node', id: nodeId }
        const n = nodeById(nodeId)
        drag = { type: 'node', id: nodeId, ox: pt.x - n.x, oy: pt.y - n.y, moved: false }
      } else if (link) {
        state.selection = { type: 'link', id: link.id }
      } else {
        state.selection = null
        drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y }
      }
      svg.setPointerCapture(e.pointerId)
      state.side = 'props'
      render()
      return
    case 'link': {
      snapshot()
      let target = nodeId
      if (!target && link) target = splitLink(link, ...Object.values(projectOnto(link, pt))).id
      if (!target) {
        const p = placePoint(pt)
        target = addNode('junction', p.x, p.y).id
      }
      if (state.linkStart) {
        const l = addLink(state.linkStart, target)
        if (l) state.selection = { type: 'link', id: l.id }
      }
      state.linkStart = target
      refresh()
      hint()
      return
    }
    case 'root':
    case 'fixture':
    case 'terminal':
    case 'junction': {
      if (nodeId) {
        state.selection = { type: 'node', id: nodeId }
        render()
        return
      }
      snapshot()
      const kind = state.tool === 'root' ? ROOT_KIND[sysKind()] : state.tool
      let n
      if (link && state.tool === 'junction') n = splitLink(link, ...Object.values(projectOnto(link, pt)))
      else n = addNode(kind, snap(pt.x), snap(pt.y))
      state.selection = { type: 'node', id: n.id }
      state.side = 'props'
      refresh()
      return
    }
    case 'scale': {
      state.scalePts.push(pt)
      if (state.scalePts.length === 2) {
        const [a, b] = state.scalePts
        const px = Math.hypot(b.x - a.x, b.y - a.y)
        state.scalePts = []
        const m = parseFloat(prompt('Real distance between the two points, in metres:', ''))
        if (px > 0 && m > 0) {
          snapshot()
          P().settings.metresPerPx = m / px
          refresh()
        }
        setTool('select')
      }
      hint()
      return
    }
  }
})

svg.addEventListener('pointermove', (e) => {
  const pt = toWorld(e)
  ghostTo = state.tool === 'link' ? placePoint(pt) : pt
  if (drag?.type === 'pan') {
    state.view.x = drag.vx + e.clientX - drag.sx
    state.view.y = drag.vy + e.clientY - drag.sy
    view.setAttribute('transform', `translate(${state.view.x} ${state.view.y}) scale(${state.view.k})`)
    return
  }
  if (drag?.type === 'node') {
    const n = nodeById(drag.id)
    if (!drag.moved) snapshot()
    drag.moved = true
    n.x = snap(pt.x - drag.ox)
    n.y = snap(pt.y - drag.oy)
    renderLinks()
    renderNodes()
    return
  }
  if (state.tool === 'link' || state.tool === 'scale') renderGhost()
})

svg.addEventListener('pointerup', () => {
  if (drag?.type === 'node' && drag.moved) refresh()
  drag = null
})

svg.addEventListener('wheel', (e) => {
  e.preventDefault()
  const r = svg.getBoundingClientRect()
  const mx = e.clientX - r.left
  const my = e.clientY - r.top
  const k0 = state.view.k
  const k = Math.min(8, Math.max(0.1, k0 * Math.exp(-e.deltaY * 0.0015)))
  state.view.x = mx - ((mx - state.view.x) * k) / k0
  state.view.y = my - ((my - state.view.y) * k) / k0
  state.view.k = k
  render()
}, { passive: false })

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return
  const key = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
  if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); return }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); return }
  if (e.key === 'Escape') { state.linkStart = null; state.scalePts = []; ghostTo = null; renderGhost(); hint(); return }
  const tools = { v: 'select', p: 'link', s: 'root', f: 'fixture', t: 'terminal', j: 'junction' }
  if (tools[key] && !e.ctrlKey && !e.metaKey) setTool(tools[key])
})

function setTool(tool) {
  state.tool = tool
  state.linkStart = null
  state.scalePts = []
  ghostTo = null
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === tool)
  renderGhost()
  hint()
}

function hint() {
  const h = {
    select: 'Click to select, drag to move. Drag empty space to pan, wheel to zoom. Delete removes, Ctrl+Z undoes.',
    link: state.linkStart
      ? 'Click a node, a pipe (to tee in) or empty space to continue. Esc to finish.'
      : `Click a node or empty space to start a ${SYSTEMS[state.system].name.toLowerCase()} run.`,
    root: `Click to place a ${ROOT_LABEL[sysKind()].toLowerCase()} for ${SYSTEMS[state.system].name.toLowerCase()}.`,
    fixture: 'Click to place the fixture chosen below. Connect it with Pipe / duct for each service it needs.',
    terminal: 'Click to place an air terminal, then set its airflow.',
    junction: 'Click empty space, or a pipe to split it.',
    scale: state.scalePts.length ? 'Click the second point.' : 'Click two points a known distance apart on the underlay.',
  }
  $('#hint').textContent = h[state.tool]
}

// ---------- side panel ----------

function field(label, input) {
  return `<label class="field"><span>${label}</span>${input}</label>`
}
const num = (path, v, step = 'any') => `<input type="number" step="${step}" data-path="${path}" value="${esc(v ?? '')}" />`
const txt = (path, v) => `<input data-path="${path}" value="${esc(v ?? '')}" />`
const sel = (path, v, opts) => `<select data-path="${path}">${opts.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`

function renderSide() {
  for (const b of document.querySelectorAll('[data-side]')) b.classList.toggle('on', b.dataset.side === state.side)
  const panel = $('#sidePanel')
  if (state.side === 'settings') panel.innerHTML = settingsPanel()
  else if (state.side === 'library') panel.innerHTML = libraryPanel()
  else panel.innerHTML = propsPanel()
}

function resultRows(obj) {
  return `<dl class="kv">${obj.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`
}

function propsPanel() {
  const s = state.selection
  if (!s) return projectHelp()
  if (s.type === 'node') {
    const n = nodeById(s.id)
    if (!n) return projectHelp()
    let h = `<h3>${KIND_NAME[n.kind]} ${esc(n.id)}</h3>`
    h += field('Label', txt(`node.${n.id}.label`, n.label))
    h += field('Elevation (m)', num(`node.${n.id}.z`, n.z, 0.1))
    if (n.kind === 'source') {
      h += field('System', sel(`node.${n.id}.system`, n.system, Object.entries(SYSTEMS).filter(([, v]) => v.kind === 'water').map(([k, v]) => [k, v.name])))
      h += field('Pressure (kPa)', num(`node.${n.id}.pressure`, n.pressure, 5))
    }
    if (n.kind === 'fixture') h += field('Type', sel(`node.${n.id}.fixture`, n.fixture, Object.entries(P().fixtures).map(([k, v]) => [k, v.name])))
    if (n.kind === 'terminal') h += field('Airflow (L/s)', num(`node.${n.id}.airflow`, n.airflow, 5))
    const r = state.results?.nodes[n.id] || {}
    for (const [sysKey, res] of Object.entries(r)) {
      const rows = []
      if (res.pressure != null) rows.push(['Pressure', `${fmt(res.pressure, 0)} kPa`])
      if (res.required != null) rows.push(['Required', `${res.required} kPa`], ['Margin', `<span class="${res.ok ? 'ok' : 'err'}">${fmt(res.margin, 0)} kPa</span>`])
      if (res.pathLoss != null) rows.push(['Path loss', `${fmt(res.pathLoss, 1)} Pa`])
      if (res.total != null) rows.push(['Incl. terminal', `${fmt(res.total, 1)} Pa`])
      if (rows.length) h += `<h4>${SYSTEMS[sysKey].name}</h4>${resultRows(rows)}`
    }
    return h + `<p><button data-cmd="delete">Delete</button></p>`
  }
  const l = linkById(s.id)
  if (!l) return projectHelp()
  const sys = SYSTEMS[l.system]
  const matKey = l.material || sys.material
  const mats = Object.entries(MATERIALS).filter(([, m]) => m.kind === (sys.kind === 'water' ? 'pipe' : sys.kind === 'drain' ? 'drain' : 'duct'))
  const auto = linkLength(l, new Map(P().nodes.map((n) => [n.id, n])), P().settings.metresPerPx)
  let h = `<h3>${sys.kind === 'air' ? 'Duct' : 'Pipe'} ${esc(l.id)}</h3>`
  h += field('System', sel(`link.${l.id}.system`, l.system, Object.entries(SYSTEMS).map(([k, v]) => [k, v.name])))
  h += field('Material', sel(`link.${l.id}.material`, matKey, mats.map(([k, m]) => [k, m.name])))
  h += field('Size', sel(`link.${l.id}.size`, l.size || '', [['', 'Auto-size'], ...MATERIALS[matKey].sizes.map((z) => [z.dn, `${sys.kind === 'air' ? 'Ø' : 'DN'}${z.dn} (locked)`])]))
  h += field('Length (m)', `<input type="number" step="0.1" data-path="link.${l.id}.length" value="${esc(l.length ?? '')}" placeholder="${fmt(auto, 2)} from drawing" />`)
  if (sys.kind === 'drain') h += field('Grade (%)', `<input type="number" step="0.05" data-path="link.${l.id}.grade" value="${esc(l.grade ?? '')}" placeholder="${P().settings.drain.grade} default" />`)
  const r = state.results?.links[l.id]
  if (r) {
    const rows = [['Size', r.dn ? `${sys.kind === 'air' ? 'Ø' : 'DN'}${r.dn}${r.locked ? ' (locked)' : ''}` : '–'], ['Bore', `${fmt(r.bore, 1)} mm`], ['Length', `${fmt(r.length)} m`], ['Outlets served', r.outlets]]
    if (sys.kind === 'water') rows.push(['Loading units', fmt(r.lu, 0)], ['Design flow', `${fmt(r.q)} L/s`], ['Velocity', `${fmt(r.v)} m/s`], ['Friction', `${fmt(r.paPerM, 0)} Pa/m`], ['Loss incl. fittings', `${fmt(r.loss)} kPa`], ['Upsized for pressure', r.upsized ? `+${r.upsized} size${r.upsized > 1 ? 's' : ''}` : 'no'])
    if (sys.kind === 'drain') rows.push(['Discharge units', fmt(r.du, 1)], ['Design flow', `${fmt(r.q)} L/s`], ['Capacity', `${fmt(r.cap)} L/s`], ['Utilisation', `${fmt(r.util * 100, 0)} %`], ['Velocity', `${fmt(r.v)} m/s`])
    if (sys.kind === 'air') rows.push(['Airflow', `${fmt(r.q, 0)} L/s`], ['Velocity', `${fmt(r.v)} m/s`], ['Friction', `${fmt(r.paPerM)} Pa/m`], ['Rectangular', `${r.rect.w} × ${r.rect.h} mm`], ['Loss incl. fittings', `${fmt(r.loss, 1)} Pa`])
    h += `<h4>Result</h4>${resultRows(rows)}`
  } else {
    h += `<p class="note">Not solved — connect this run back to a ${ROOT_LABEL[sys.kind].toLowerCase()}.</p>`
  }
  return h + `<p><button data-cmd="delete">Delete</button></p>`
}

function projectHelp() {
  return `<h3>Getting started</h3>
  <ol class="note">
    <li>Optional: <b>Underlay…</b> loads a floor plan image; <b>Set scale</b> calibrates it.</li>
    <li>Pick a <b>System</b>, place its <b>Source</b> (water meter / heater, sewer connection or AHU).</li>
    <li>Place <b>Fixtures</b> or <b>Air terminals</b>.</li>
    <li>Draw runs with <b>Pipe / duct</b>. Click on an existing pipe to tee into it.</li>
    <li>Sizes, pressures and the bill of materials update as you draw.</li>
  </ol>
  <p class="note">Or press <b>Demo</b> to load a worked example. Work autosaves in this browser; use <b>Save</b> to keep a file.</p>
  <p class="note">Results are indicative. Check the design criteria and fixture library against the standard for your project before issuing.</p>`
}

function settingsPanel() {
  const s = P().settings
  return `<h3>Design criteria</h3>
  ${field('Drawing scale (m per px)', num('settings.metresPerPx', s.metresPerPx, 0.001))}
  <h4>Water (cold & heated)</h4>
  ${field('Demand method', sel('settings.water.method', s.water.method, [['sqrt', 'Probable demand k·√ΣLU'], ['sum', 'Sum of flows (no diversity)']]))}
  ${field('k (L/s per √LU)', num('settings.water.kLU', s.water.kLU, 0.01))}
  ${field('Max velocity (m/s)', num('settings.water.vMax', s.water.vMax, 0.1))}
  ${field('Fittings allowance (%)', num('settings.water.fittingsPct', s.water.fittingsPct, 5))}
  ${field('Max outlet pressure (kPa)', num('settings.water.pMax', s.water.pMax, 10))}
  <h4>Sanitary drainage</h4>
  ${field('Frequency factor K', sel('settings.drain.K', s.drain.K, Object.entries(DRAIN_K).map(([k, v]) => [k, `${k} — ${v}`])))}
  ${field('Default grade (%)', num('settings.drain.grade', s.drain.grade, 0.05))}
  ${field('Design filling h/d', num('settings.drain.fill', s.drain.fill, 0.05))}
  <h4>Supply air</h4>
  ${field('Friction rate (Pa/m)', num('settings.air.friction', s.air.friction, 0.1))}
  ${field('Max velocity (m/s)', num('settings.air.vMax', s.air.vMax, 0.5))}
  ${field('Fittings allowance (%)', num('settings.air.fittingsPct', s.air.fittingsPct, 5))}
  ${field('Terminal loss (Pa)', num('settings.air.terminalPa', s.air.terminalPa, 5))}
  ${field('Max rect. depth (mm)', num('settings.air.rectDepth', s.air.rectDepth, 50))}
  <p class="note">Probable demand: Q = max(largest outlet, k·√ΣLU), never more than the sum of outlet flows. Drainage: Qww = K·√ΣDU (EN 12056-2), sized by Colebrook–White part full. Pipe and duct friction by Darcy–Weisbach.</p>`
}

function libraryPanel() {
  const rows = Object.entries(P().fixtures).map(([k, f]) => `<tr>
    <td><input data-path="fx.${k}.name" value="${esc(f.name)}" /></td>
    <td><input type="number" step="0.5" data-path="fx.${k}.lu" value="${f.lu}" /></td>
    <td><input type="number" step="0.01" data-path="fx.${k}.q" value="${f.q}" /></td>
    <td><input type="number" step="5" data-path="fx.${k}.pmin" value="${f.pmin}" /></td>
    <td><input type="checkbox" data-path="fx.${k}.hot" ${f.hot ? 'checked' : ''} /></td>
    <td><input type="number" step="0.1" data-path="fx.${k}.du" value="${f.du}" /></td>
    <td><input type="number" step="5" data-path="fx.${k}.dnMin" value="${f.dnMin}" /></td></tr>`).join('')
  return `<h3>Fixture library (this project)</h3>
  <div class="table lib"><table><thead><tr><th>Name</th><th>LU</th><th>L/s</th><th>kPa</th><th>Hot</th><th>DU</th><th>DN min</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p><button data-cmd="addFixture">Add fixture type</button></p>
  <p class="note">LU loading units · L/s design flow of one outlet · kPa minimum working pressure · DU discharge unit (L/s) · DN min smallest drain it may discharge to. Defaults are typical values — check them against your standard.</p>`
}

$('#sidePanel').addEventListener('change', (e) => {
  const path = e.target.dataset.path
  if (!path) return
  const [scope, id, key] = path.split('.')
  let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
  const numeric = e.target.type === 'number' || (e.target.tagName === 'SELECT' && (key === 'K' || key === 'size'))
  if (numeric) value = value === '' ? undefined : +value
  snapshot()
  if (scope === 'node') nodeById(id)[key] = value
  else if (scope === 'link') {
    const l = linkById(id)
    l[key] = value === '' ? undefined : value
    if (key === 'system' || key === 'material') l.size = undefined
    if (key === 'system') l.material = undefined
  } else if (scope === 'fx') P().fixtures[id][key] = value
  else if (scope === 'settings') {
    if (key) P().settings[id][key] = value
    else P().settings[id] = value
  }
  refresh()
})

// ---------- results ----------

function table(head, rows, refs = []) {
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r, i) => `<tr${refs[i] ? ` class="click" data-ref="${esc(refs[i])}"` : ''}>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`
}

export function linkRows(results) {
  return Object.values(results.links).map((r) => {
    const kind = SYSTEMS[r.system].kind
    return {
      id: r.id, system: SYSTEMS[r.system].name, material: r.material,
      size: `${kind === 'air' ? 'Ø' : 'DN'}${r.dn}${kind === 'air' ? ` / ${r.rect.w}×${r.rect.h}` : ''}${r.locked ? ' (locked)' : ''}`,
      length: fmt(r.length), load: kind === 'water' ? `${fmt(r.lu, 0)} LU` : kind === 'drain' ? `${fmt(r.du, 1)} DU` : '',
      flow: kind === 'air' ? fmt(r.q, 0) : fmt(r.q), velocity: fmt(r.v),
      friction: kind === 'water' ? `${fmt(r.paPerM, 0)} Pa/m` : kind === 'air' ? `${fmt(r.paPerM)} Pa/m` : `${fmt(r.grade)} % grade`,
      loss: kind === 'water' ? `${fmt(r.loss)} kPa` : kind === 'air' ? `${fmt(r.loss, 1)} Pa` : `${fmt(r.util * 100, 0)} % full`,
    }
  })
}

function outletRows(results) {
  const out = []
  for (const n of P().nodes) {
    const r = results.nodes[n.id]
    if (!r || (n.kind !== 'fixture' && n.kind !== 'terminal')) continue
    for (const [sysKey, res] of Object.entries(r)) {
      if (res.pressure == null && res.total == null) continue
      const name = n.kind === 'fixture' ? P().fixtures[n.fixture]?.name : 'Air terminal'
      out.push({
        id: n.id, label: n.label || '', name, system: SYSTEMS[sysKey].name,
        value: res.pressure != null ? `${fmt(res.pressure, 0)} kPa` : `${fmt(res.total, 1)} Pa`,
        required: res.required != null ? `${res.required} kPa` : '',
        status: res.ok == null ? '' : res.ok ? '<span class="ok">OK</span>' : '<span class="err">LOW</span>',
      })
    }
  }
  return out
}

function nodeName(id) {
  const n = nodeById(id)
  if (!n) return id
  return n.label || (n.kind === 'fixture' ? P().fixtures[n.fixture]?.name : KIND_NAME[n.kind]) || id
}

/** Frame the drawing in the window. */
function fitView() {
  const pts = P().nodes
  if (!pts.length) return
  const r = svg.getBoundingClientRect()
  const xs = pts.map((n) => n.x)
  const ys = pts.map((n) => n.y)
  const w = Math.max(...xs) - Math.min(...xs) + 120
  const h = Math.max(...ys) - Math.min(...ys) + 120
  const k = Math.min(2, Math.max(0.1, Math.min(r.width / w, r.height / h)))
  state.view = { k, x: (r.width - (Math.max(...xs) + Math.min(...xs)) * k) / 2, y: (r.height - (Math.max(...ys) + Math.min(...ys)) * k) / 2 }
}

function summaryHtml(results) {
  const blocks = Object.values(results.summary).map((s) => {
    const sys = SYSTEMS[s.system]
    return s.roots.map((r) => {
      let body = ''
      if (sys.kind === 'water') {
        const c = r.critical
        body = `${fmt(r.lu, 0)} LU · ${fmt(r.q)} L/s design flow${c ? ` · critical outlet ${esc(nodeName(c.node))} at ${fmt(c.pressure, 0)} kPa (<span class="${c.margin >= 0 ? 'ok' : 'err'}">${c.margin >= 0 ? '+' : ''}${fmt(c.margin, 0)} kPa</span>)` : ''}`
      } else if (sys.kind === 'drain') body = `${fmt(r.du, 1)} DU · ${fmt(r.q)} L/s at the connection`
      else body = `${fmt(r.q, 0)} L/s · fan external static ≥ ${fmt(r.esp, 0)} Pa (index terminal ${esc(r.index ? nodeName(r.index.node) : '–')})`
      return `<p><b style="color:${sys.color}">${sys.name}</b> — ${esc(r.label)}: ${body}</p>`
    }).join('')
  })
  const e = results.warnings.filter((w) => w.level === 'error').length
  const w = results.warnings.length - e
  return (blocks.join('') || '<p class="note">Nothing solved yet. Place a source and draw a run, or press Demo.</p>') +
    `<p class="note">${e} error${e === 1 ? '' : 's'}, ${w} warning${w === 1 ? '' : 's'}.${results.upsized ? ` ${results.upsized} pipe${results.upsized === 1 ? '' : 's'} upsized to hold outlet pressure.` : ''}</p>`
}

function renderResults() {
  const r = state.results
  for (const b of document.querySelectorAll('[data-res]')) b.classList.toggle('on', b.dataset.res === state.res)
  const errs = r.warnings.filter((w) => w.level === 'error').length
  $('#warnCount').textContent = r.warnings.length ? `(${r.warnings.length})` : ''
  $('#warnCount').className = errs ? 'err' : r.warnings.length ? 'warn' : ''
  const panel = $('#resultsPanel')
  if (state.res === 'summary') panel.innerHTML = summaryHtml(r)
  else if (state.res === 'links') {
    const rows = linkRows(r)
    panel.innerHTML = table(['Ref', 'System', 'Material', 'Size', 'Length m', 'Load', 'Flow L/s', 'Vel m/s', 'Friction / grade', 'Loss / fill'], rows.map((x) => [x.id, x.system, x.material, x.size, x.length, x.load, x.flow, x.velocity, x.friction, x.loss]), rows.map((x) => `link:${x.id}`))
  } else if (state.res === 'outlets') {
    const rows = outletRows(r)
    panel.innerHTML = table(['Ref', 'Label', 'Type', 'System', 'Pressure / path loss', 'Required', 'Status'], rows.map((x) => [x.id, esc(x.label), esc(x.name), x.system, x.value, x.required, x.status]), rows.map((x) => `node:${x.id}`))
  } else if (state.res === 'bom') {
    panel.innerHTML = table(['System', 'Material', 'Size', 'Length m', 'Runs'], r.bom.map((b) => [SYSTEMS[b.system].name, b.material, `${SYSTEMS[b.system].kind === 'air' ? 'Ø' : 'DN'}${b.dn}`, fmt(b.length), b.count])) +
      `<p class="note">Tees: ${Object.entries(r.tees).filter(([, n]) => n).map(([k, n]) => `${SYSTEMS[k].name} ${n}`).join(' · ') || 'none'}. Lengths are measured off the drawing plus rises/drops; add a waste allowance when ordering.</p>`
  } else {
    panel.innerHTML = r.warnings.length
      ? table(['Level', 'Message'], r.warnings.map((w) => [`<span class="${w.level === 'error' ? 'err' : 'warn'}">${w.level}</span>`, esc(w.msg)]), r.warnings.map((w) => (w.ref ? `${w.ref.startsWith('L') ? 'link' : 'node'}:${w.ref}` : null)))
      : '<p class="ok">No warnings.</p>'
  }
}

$('#resultsPanel').addEventListener('click', (e) => {
  const tr = e.target.closest('[data-ref]')
  if (!tr) return
  const [type, id] = tr.dataset.ref.split(':')
  state.selection = { type, id }
  state.side = 'props'
  const n = type === 'node' ? nodeById(id) : nodeById(linkById(id)?.a)
  if (n) {
    const r = svg.getBoundingClientRect()
    state.view.x = r.width / 2 - n.x * state.view.k
    state.view.y = r.height / 2 - n.y * state.view.k
  }
  render()
})

// ---------- commands ----------

function exportCsv() {
  const rows = linkRows(state.results)
  const head = ['Ref', 'System', 'Material', 'Size', 'Length (m)', 'Load', 'Flow (L/s)', 'Velocity (m/s)', 'Friction / grade', 'Loss / fill']
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`
  const csv = [head, ...rows.map((x) => [x.id, x.system, x.material, x.size, x.length, x.load, x.flow, x.velocity, x.friction, x.loss])].map((r) => r.map(q).join(',')).join('\r\n')
  download(`${fileSafe(P().name)}-schedule.csv`, csv, 'text/csv')
}

async function report() {
  const r = state.results
  const css = await fetch('./styles.css').then((x) => x.text()).catch(() => '')
  // A copy of the drawing framed around its contents.
  const xs = P().nodes.map((n) => n.x)
  const ys = P().nodes.map((n) => n.y)
  const pad = 60
  const box = xs.length ? [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad] : [0, 0, 100, 100]
  const drawing = `<svg xmlns="${SVG}" viewBox="${box.join(' ')}" style="width:100%;max-height:520px;border:1px solid #ccc;background:#fff">${$('#linksLayer').outerHTML}${$('#labelsLayer').outerHTML}${$('#nodesLayer').outerHTML}</svg>`
  const links = linkRows(r)
  const outlets = outletRows(r)
  const s = P().settings
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(P().name)} — design report</title>
  <style>${css}
  body{display:block;padding:24px;background:#fff;color:#111;max-width:1100px;margin:auto}
  :root{--ink:#111;--panel:#fff;--canvas:#fff;--line:#ccc;--muted:#555}
  h1{margin:0 0 4px} h2{margin:24px 0 8px;font-size:16px} table{margin-bottom:8px}
  @media print{button{display:none}}</style></head><body class="table">
  <button onclick="print()">Print / save as PDF</button>
  <h1>${esc(P().name)}</h1><p class="note">Hydraulic & mechanical services design report · ${new Date().toLocaleString('en-AU')} · Axis MEP Design</p>
  <h2>Summary</h2>${summaryHtml(r)}
  <h2>Drawing</h2>${drawing}
  <h2>Design criteria</h2>
  <p>Water: ${s.water.method === 'sqrt' ? `probable demand Q = max(largest outlet, ${s.water.kLU}·√ΣLU)` : 'sum of outlet flows'}; max velocity ${s.water.vMax} m/s; fittings +${s.water.fittingsPct}%.<br>
  Drainage: Qww = ${s.drain.K}·√ΣDU; default grade ${s.drain.grade}%; design filling h/d ${s.drain.fill}.<br>
  Supply air: ${s.air.friction} Pa/m friction, max ${s.air.vMax} m/s; fittings +${s.air.fittingsPct}%; terminal ${s.air.terminalPa} Pa.</p>
  <h2>Pipe & duct schedule</h2>${table(['Ref', 'System', 'Material', 'Size', 'Length m', 'Load', 'Flow L/s', 'Vel m/s', 'Friction / grade', 'Loss / fill'], links.map((x) => [x.id, x.system, x.material, x.size, x.length, x.load, x.flow, x.velocity, x.friction, x.loss]))}
  <h2>Outlets</h2>${table(['Ref', 'Label', 'Type', 'System', 'Pressure / path loss', 'Required', 'Status'], outlets.map((x) => [x.id, esc(x.label), esc(x.name), x.system, x.value, x.required, x.status]))}
  <h2>Bill of materials</h2>${table(['System', 'Material', 'Size', 'Length m', 'Runs'], r.bom.map((b) => [SYSTEMS[b.system].name, b.material, `${SYSTEMS[b.system].kind === 'air' ? 'Ø' : 'DN'}${b.dn}`, fmt(b.length), b.count]))}
  <h2>Warnings</h2>${r.warnings.length ? table(['Level', 'Message'], r.warnings.map((w) => [w.level, esc(w.msg)])) : '<p>None.</p>'}
  <p class="note">Calculated results are indicative and must be verified by a competent designer against the applicable standards before construction.</p>
  </body></html>`
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  window.open(url, '_blank')
}

function loadUnderlay(file) {
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      snapshot()
      P().underlay = { href: reader.result, x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
      refresh()
      setTool('scale')
      status('Underlay loaded — click two points a known distance apart to set the scale.')
    }
    img.src = reader.result
  }
  reader.readAsDataURL(file)
}

const commands = {
  new() {
    if (!confirm('Start a new project? Unsaved work in this browser will be replaced.')) return
    snapshot()
    state.project = newProject()
    state.selection = null
    refresh()
  },
  demo() {
    if (P().nodes.length && !confirm('Replace the current drawing with the demo project?')) return
    snapshot()
    state.project = demoProject()
    state.selection = null
    refresh()
    fitView()
    render()
  },
  open: () => $('#openFile').click(),
  save: () => download(`${fileSafe(P().name)}.mep.json`, JSON.stringify(P(), null, 1), 'application/json'),
  underlay: () => $('#underlayFile').click(),
  csv: exportCsv,
  fit() { fitView(); render() },
  report,
  delete: deleteSelection,
  addFixture() {
    const name = prompt('Fixture name:')
    if (!name) return
    snapshot()
    const key = `custom_${++P().seq}`
    P().fixtures[key] = { name, lu: 1, q: 0.1, pmin: 50, hot: false, du: 0.5, dnMin: 40 }
    refresh()
  },
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cmd]')
  if (c) commands[c.dataset.cmd]?.()
  const t = e.target.closest('[data-tool]')
  if (t) setTool(t.dataset.tool)
  const s = e.target.closest('[data-side]')
  if (s) { state.side = s.dataset.side; renderSide() }
  const r = e.target.closest('[data-res]')
  if (r) { state.res = r.dataset.res; renderResults() }
})

$('#openFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]
  e.target.value = ''
  if (!f) return
  try {
    const p = migrate(JSON.parse(await f.text()))
    snapshot()
    state.project = p
    state.selection = null
    refresh()
    fitView()
    render()
  } catch (err) {
    alert(`Could not open that file: ${err.message}`)
  }
})
$('#underlayFile').addEventListener('change', (e) => {
  const f = e.target.files[0]
  e.target.value = ''
  if (f) loadUnderlay(f)
})
$('#underlayOpacity').addEventListener('input', renderUnderlay)
$('#labels').addEventListener('change', renderLinks)
$('#projectName').addEventListener('change', (e) => { P().name = e.target.value; persist() })
$('#system').addEventListener('change', (e) => {
  state.system = e.target.value
  $('#rootTool').textContent = ROOT_LABEL[sysKind()]
  state.linkStart = null
  hint()
})
$('#fixtureType').addEventListener('change', (e) => { state.fixtureType = e.target.value })

function fillPickers() {
  $('#system').innerHTML = Object.entries(SYSTEMS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')
  $('#system').value = state.system
  $('#fixtureType').innerHTML = Object.entries(FIXTURES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')
}

// ---------- start ----------

fillPickers()
setTool('select')
refresh()
// Exposed for tests and the console.
window.mep = { state, commands, calculate }
