// Axis Labour — the SA labour allocation sheet as a live, shared web app.
// The Labour workbook in SharePoint is the master: the app reads it through
// the Excel API, writes each change straight back into it, and checks every
// few seconds for changes made by anyone else (in the app or in Excel).

import { Auth, Graph, GraphError, Workbook, address, colName, locateWorkbook } from './graph.js'
import { Grid } from './grid.js'
import { lastHandle, pickWorkbook, reopen } from './xlsxfile.js'
import { LEGEND, colourFor, describe, display, fmtDate, isLeave, normalise, sameDay } from './sheet.js'

const DEFAULTS = {
  tenantId: 'e52a9a87-78f1-4048-b915-d974ad3d98ac',
  clientId: '7485bf02-3fbf-478b-a4d0-05ddcc3b1c1e',
  fileUrl: 'https://axisplumbingptyltd.sharepoint.com/:x:/s/AXPSA/IQCiKovDe6uiRb4bgFc97yk1AXn0k6gItST2JqupsQ6xcLk',
  fileName: 'Labour',
  pollSeconds: 10,
}
const KEY = 'axis-labour'
const $ = (id) => document.getElementById(id)
const narrowQuery = matchMedia('(max-width: 760px)')
const layoutFor = (name, data) => describe(name, data, narrowQuery.matches)

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
function writePrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...p })) } catch { /* private mode */ }
}

/** Settings: defaults, then the site's axis-config.json, then this device's. */
async function loadConfig() {
  let org = {}
  try {
    const res = await fetch('../axis-config.json', { cache: 'no-store' })
    if (res.ok) {
      const c = await res.json()
      org = { tenantId: c.tenantId, clientId: c.clientId, fileUrl: c.labourFileUrl, fileName: c.labourFileName }
    }
  } catch { /* no org config */ }
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))
  const cfg = { ...DEFAULTS, ...clean(org), ...clean(readPrefs().conn || {}) }
  // Test harness only: a stand-in Graph server, honoured on localhost alone.
  const q = new URLSearchParams(location.search)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && q.get('graph')) {
    cfg.graphBase = q.get('graph')
    cfg.devToken = q.get('token') || 'dev'
  }
  return cfg
}

const state = {
  cfg: null,
  auth: null,
  wb: null,
  sheets: [],
  sheet: '',
  models: new Map(),
  stamp: null,
  lastFull: 0,
  saving: 0,
  undo: [],
  dayCol: -1,
  rowInfo: [],
  error: null,
}

let grid

// ---------------------------------------------------------------- start up

async function start() {
  state.cfg = await loadConfig()
  try {
    state.auth = new Auth(state.cfg)
    const user = await state.auth.init()
    if (!user) return showGate()
    state.user = user
  } catch (err) {
    return showGate(`Sign-in failed: ${err.message || err}`)
  }
  showApp()
  await connect()
}

let appShown = false
function showApp() {
  $('gate').hidden = true
  $('app').hidden = false
  $('userBtn').textContent = state.user.name
  $('saveBtn').hidden = !state.local
  $('menuExcel').hidden = !!state.local
  $('menuSignout').textContent = state.local ? 'Close the file' : 'Sign out'
  if (appShown) return
  appShown = true
  grid = new Grid($('gridHost'), {
    onSelect: showCellInfo,
    onActivate: (r, c) => openEditor(),
    onClickCell: (r, c) => {
      const m = model()
      if (m && r < m.layout.frozenRows && m.layout.dates[c]) openDay(c)
    },
  })
  bindUi()
  renderLegend()
}

// ---------------------------------------------------------------- no sign-in: a file

async function openLocal(getBook) {
  let book
  try {
    book = await getBook()
  } catch (err) {
    if (err.name !== 'AbortError' && err.message !== 'No file chosen') toast(err.message || String(err), true)
    return
  }
  state.cfg ??= await loadConfig()
  state.local = true
  state.user = { name: book.name }
  state.models.clear()
  state.undo = []
  state.wb = book
  book.onChange = () => { updateSave(); scheduleAutosave() }
  showApp()
  try {
    state.stamp = await book.stamp()
    $('fileLink').textContent = book.name
    $('fileLink').removeAttribute('href')
    state.sheets = await book.sheets()
    renderTabs()
    const remembered = readPrefs().sheet
    const first = state.sheets.find((s) => s.name === remembered) || state.sheets[0]
    await openSheet(first.name)
    setLive()
    schedulePoll()
  } catch (err) {
    loading(false)
    fail(err, true)
  }
}

function updateSave() {
  const b = state.wb
  if (!state.local) return
  $('saveBtn').textContent = b.handle ? (b.dirty ? 'Save' : 'Saved') : 'Download .xlsx'
  $('saveBtn').disabled = !b.dirty && !!b.handle
  setLive()
}

let autosaveTimer
function scheduleAutosave() {
  // Saving over the opened file is quick and safe, so do it as people work.
  if (!state.wb.handle) return
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(saveLocal, 1500)
}

async function saveLocal() {
  const b = state.wb
  if (!state.local || (!b.dirty && b.handle)) return
  if (state.saving) return scheduleAutosave()
  clearTimeout(autosaveTimer)
  try {
    setStatus('Saving to the file…', 'saving')
    const how = await b.save()
    state.stamp = await b.stamp()
    if (how === 'downloaded') toast(`Downloaded ${b.name} — save it over the original (or upload it to SharePoint).`)
  } catch (err) {
    fail(err)
  }
  updateSave()
}

window.addEventListener('beforeunload', (e) => {
  if (state.local && state.wb && state.wb.dirty) { e.preventDefault(); e.returnValue = '' }
})

function showGate(msg) {
  $('gate').hidden = false
  $('app').hidden = true
  if (msg) $('gateMsg').textContent = msg
}

async function connect() {
  setStatus('Opening the workbook…')
  loading(true, 'Opening the Labour workbook from SharePoint…')
  try {
    const graph = new Graph(state.auth, state.cfg.graphBase)
    const item = await locateWorkbook(graph, state.cfg.fileUrl, state.cfg.fileName)
    state.wb = new Workbook(graph, item)
    state.stamp = item
    $('fileLink').textContent = item.name
    $('fileLink').href = item.webUrl
    state.sheets = await state.wb.sheets()
    renderTabs()
    const remembered = readPrefs().sheet
    const first = state.sheets.find((s) => s.name === remembered) || state.sheets[0]
    await openSheet(first.name)
    setLive()
    schedulePoll()
  } catch (err) {
    loading(false)
    fail(err, true)
  }
}

function fail(err, fatal) {
  console.error(err)
  let msg = err.message || String(err)
  if (err instanceof GraphError) {
    if (err.status === 401) msg = 'Your Microsoft 365 sign-in has expired — sign in again.'
    else if (err.status === 403) msg = "Your account doesn't have access to the Labour workbook. Ask for edit access to it in SharePoint."
    else if (err.status === 404) msg = "The Labour workbook couldn't be found. Check the link under Connection settings."
    else if (err.status === 0) msg = 'No connection to Microsoft 365 — retrying.'
  }
  setStatus(fatal ? 'Not connected' : 'Problem', 'error')
  toast(msg, true)
  if (fatal && err.status === 401) showGate(msg)
}

// ---------------------------------------------------------------- sheets

function model() {
  return state.models.get(state.sheet)
}

async function openSheet(name) {
  state.sheet = name
  writePrefs({ sheet: name })
  renderTabs()
  let m = state.models.get(name)
  if (!m) {
    loading(true, `Loading ${name}…`)
    m = await loadSheet(name)
  }
  loading(false)
  grid.setModel(m)
  indexRows()
  applyFilter()
  fillSuggestions()
  if (m.layout.kind === 'roster') goToday()
  closeDay()
}

async function loadSheet(name) {
  const data = await state.wb.readSheet(name)
  const m = { data, layout: layoutFor(name, data) }
  state.models.set(name, m)
  state.lastFull = Date.now()
  return m
}

/**
 * Re-reads the open sheet and folds it in: cells someone else changed flash,
 * and cells with a save still in flight keep what this person typed.
 */
async function refresh(quiet) {
  const name = state.sheet
  const old = state.models.get(name)
  // Other sheets are re-read when next opened.
  for (const k of [...state.models.keys()]) if (k !== name) state.models.delete(k)
  const data = await state.wb.readSheet(name)
  if (state.sheet !== name) return
  const m = { data, layout: layoutFor(name, data) }
  if (old) {
    const until = performance.now() + 6000
    const rows = Math.min(old.data.rows, data.rows)
    const cols = Math.min(old.data.cols, data.cols)
    const structural = old.data.rows !== data.rows || old.data.cols !== data.cols
    for (const key of grid.pending) {
      const [r, c] = key.split(',').map(Number)
      if (r < data.rows && c < data.cols) {
        data.values[r][c] = old.data.values[r][c]
        data.formulas[r][c] = old.data.formulas[r][c]
      }
    }
    let changed = 0
    if (!quiet) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (old.data.values[r][c] !== data.values[r][c] && !grid.pending.has(r + ',' + c)) {
            grid.flash.set(r + ',' + c, until)
            changed++
          }
        }
      }
    }
    if (changed && changed < 500) setStatus(`${changed} cell${changed === 1 ? '' : 's'} updated`, 'live')
    if (structural) grid.flash.clear()
  }
  state.models.set(name, m)
  state.lastFull = Date.now()
  grid.setModel(m, true)
  indexRows()
  applyFilter()
  fillSuggestions()
  if (!$('day').hidden) renderDay()
}

// ---------------------------------------------------------------- live updates

let pollTimer
function schedulePoll(delay) {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(poll, delay ?? state.cfg.pollSeconds * 1000)
}

async function poll() {
  if (document.hidden || !state.wb) return schedulePoll()
  try {
    const s = await state.wb.stamp()
    const changed = !state.stamp || s.cTag !== state.stamp.cTag || s.eTag !== state.stamp.eTag
    state.stamp = s
    // A full read every two minutes as well, in case the file's tag lags an
    // edit made in Excel for the web.
    if ((changed || Date.now() - state.lastFull > 120000) && !state.saving) await refresh()
    setLive()
  } catch (err) {
    if (err.status === 401) return fail(err, true)
    setStatus('Offline — retrying', 'error')
  }
  schedulePoll()
}

// Phone turned, or window resized past the phone width: re-lay the columns.
narrowQuery.addEventListener('change', () => {
  const m = model()
  if (!m) return
  m.layout = layoutFor(state.sheet, m.data)
  grid.setModel(m, true)
})

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.wb) schedulePoll(0)
})

function setLive() {
  if (state.saving) return setStatus('Saving to Excel…', 'saving')
  if (state.local) {
    const b = state.wb
    if (b.dirty) setStatus(b.handle ? 'Unsaved changes' : 'Unsaved — download to keep', 'saving')
    else setStatus(b.handle ? 'Saved to the file' : 'File opened', 'live')
    $('status').title = b.handle
      ? 'Changes save straight into the file you opened. If it changes on disk (e.g. via OneDrive) the sheet reloads.'
      : 'This browser can only download the updated workbook — save it over the original.'
    return
  }
  const s = state.stamp
  let who = '', full = ''
  if (s && s.lastModifiedDateTime) {
    const t = new Date(s.lastModifiedDateTime)
    const by = s.lastModifiedBy && s.lastModifiedBy.user && s.lastModifiedBy.user.displayName
    const when = sameDay(t, new Date()) ? t.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : t.toLocaleDateString('en-AU')
    who = ` · ${when}${by ? ' ' + by.split(' ')[0] : ''}`
    full = `Workbook last changed ${t.toLocaleString('en-AU')}${by ? ' by ' + by : ''}`
  }
  setStatus('Live' + who, 'live')
  $('status').title = full
}

function setStatus(text, kind = '') {
  const el = $('status')
  el.textContent = text
  el.className = 'status ' + kind
}

// ---------------------------------------------------------------- rows & filters

/** Per row: which date columns have something in them. */
function indexRows() {
  const m = model()
  const { data, layout } = m
  state.rowInfo = data.values.map((row) => {
    const cols = []
    if (layout.kind === 'roster') {
      for (let c = layout.frozenCols; c < data.cols; c++) if (row[c] !== '' && row[c] !== null) cols.push(c)
    }
    return cols
  })
}

function applyFilter() {
  const m = model()
  if (!m) return
  const q = $('search').value.trim().toLowerCase()
  const active = $('active').checked && m.layout.kind === 'roster'
  const { data, layout } = m
  let from = 0, to = 0
  if (active) {
    const now = new Date()
    const lo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 28)
    const hi = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 62)
    from = layout.dates.findIndex((d) => d && d >= lo)
    to = layout.dates.findLastIndex((d) => d && d <= hi)
  }
  const fn = !q && !active ? null : (r) => {
    const row = data.values[r]
    if (q) {
      let hit = false
      for (let c = 0; c < layout.frozenCols; c++) if (display(row[c]).toLowerCase().includes(q)) { hit = true; break }
      if (!hit) return false
    }
    if (active) {
      const cols = state.rowInfo[r]
      // Headings (names with nothing ever booked) stay, for context.
      if (!cols.length) return display(row[layout.nameCol]).trim() !== '' && !q
      return cols.some((c) => c >= from && c <= to)
    }
    return true
  }
  grid.applyFilter(fn)
  writePrefs({ active: $('active').checked })
}

function fillSuggestions() {
  const m = model()
  const counts = new Map()
  if (m.layout.kind === 'roster') {
    for (let r = m.layout.frozenRows; r < m.data.rows; r++) {
      for (const c of state.rowInfo[r]) {
        const v = display(m.data.values[r][c]).trim()
        if (v) counts.set(v, (counts.get(v) || 0) + 1)
      }
    }
  }
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400)
  $('entries').replaceChildren(...list.map(([v]) => Object.assign(document.createElement('option'), { value: v })))
}

/** Entries booked most in the four weeks either side of a column. */
function nearbyEntries(col, n = 8) {
  const m = model()
  const counts = new Map()
  const lo = col - 28, hi = col + 28
  for (let r = m.layout.frozenRows; r < m.data.rows; r++) {
    for (const c of state.rowInfo[r]) {
      if (c < lo || c > hi) continue
      const v = display(m.data.values[r][c]).trim()
      if (v && !isLeave(v)) counts.set(v, (counts.get(v) || 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => v)
}

function goToday() {
  const m = model()
  if (!m || m.layout.kind !== 'roster') return
  const now = new Date()
  const c = nearestDateCol(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  if (c < 0) return
  grid.scrollToCol(c, 2)
  const first = grid.rows[0] ?? m.layout.frozenRows
  if (!grid.sel) grid.select(first, c)
}

function nearestDateCol(d) {
  const dates = model().layout.dates
  let best = -1, gap = Infinity
  dates.forEach((x, c) => {
    if (!x) return
    const g = Math.abs(x - d)
    if (g < gap) { gap = g; best = c }
  })
  return best
}

// ---------------------------------------------------------------- editing

function editable(r, c) {
  const m = model()
  if (!m) return false
  if (m.layout.kind === 'roster' && r < 3) return false // month / day / weekday header
  const f = m.data.formulas[r][c]
  return !(typeof f === 'string' && f.startsWith('='))
}

function cellLabel(r, c) {
  const m = model()
  const date = m.layout.dates[c]
  const who = r >= m.layout.frozenRows ? display(m.data.values[r][m.layout.nameCol]).trim() : ''
  return [`${colName(c)}${r + 1}`, who, date ? fmtDate(date) : ''].filter(Boolean).join(' · ')
}

function showCellInfo(sel) {
  const m = model()
  if (!sel || !m) return
  const n = grid.selectedRows().length * (sel.c1 - sel.c0 + 1)
  const raw = m.data.formulas[sel.ar][sel.ac]
  $('cellInfo').textContent = cellLabel(sel.ar, sel.ac) + (raw !== '' ? ` — ${raw}` : '') + (n > 1 ? ` (${n} cells)` : '')
  if (!$('day').hidden && m.layout.dates[sel.ac] && state.dayCol !== sel.ac) openDay(sel.ac)
}

function openEditor(initial) {
  const m = model()
  const sel = grid.sel
  if (!m || !sel) return
  if (!editable(sel.ar, sel.ac) && sel.r0 === sel.r1 && sel.c0 === sel.c1) {
    return toast(sel.ar < 3 && m.layout.kind === 'roster' ? 'The date heading comes from Excel.' : 'This cell is a formula — change it in Excel.')
  }
  const ed = $('editor')
  const rows = grid.selectedRows()
  const n = rows.length * (sel.c1 - sel.c0 + 1)
  $('edWhere').textContent = n > 1 ? `${n} cells · ${cellLabel(sel.ar, sel.ac)}` : cellLabel(sel.ar, sel.ac)
  const input = $('edInput')
  input.value = initial ?? display(m.data.formulas[sel.ar][sel.ac])
  const roster = m.layout.kind === 'roster' && !!m.layout.dates[sel.c1]
  $('edRoster').hidden = !roster
  $('edRepeat').value = 0
  // Fill weekends only if the selection was made on one.
  const touchesWeekend = [...Array(sel.c1 - sel.c0 + 1).keys()].some((i) => {
    const d = m.layout.dates[sel.c0 + i]
    return d && (d.getDay() === 0 || d.getDay() === 6)
  })
  $('edWeekdays').checked = !(sel.c0 === sel.c1 && touchesWeekend)

  const chips = roster ? [...nearbyEntries(sel.ac), 'PH', 'A/LEAVE', 'RDO', 'SICK'] : []
  $('edChips').replaceChildren(...chips.map((v) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = v
    const col = colourFor(v)
    b.style.background = col.bg
    b.style.color = col.fg
    b.onclick = () => { input.value = v; applyEditor() }
    return b
  }))

  ed.hidden = false
  const rect = grid.cellRect(sel.ar, sel.ac)
  const host = $('gridHost').getBoundingClientRect()
  if (rect) {
    let left = host.left + rect.x
    let top = host.top + rect.y + rect.h + 4
    const w = ed.offsetWidth, h = ed.offsetHeight
    if (left + w > innerWidth - 8) left = innerWidth - 8 - w
    if (top + h > innerHeight - 8) top = Math.max(8, host.top + rect.y - h - 4)
    ed.style.left = `${Math.max(8, left)}px`
    ed.style.top = `${top}px`
  }
  input.focus()
  if (initial === undefined) input.select()
}

function closeEditor() {
  $('editor').hidden = true
  grid.scroller.focus({ preventScroll: true })
}

function applyEditor(clear) {
  const m = model()
  const sel = grid.sel
  const v = clear ? '' : $('edInput').value
  const weekdaysOnly = !$('edRoster').hidden && $('edWeekdays').checked
  const isWeekend = (c) => { const d = m.layout.dates[c]; return d && (d.getDay() === 0 || d.getDay() === 6) }
  const cols = []
  for (let c = sel.c0; c <= sel.c1; c++) if (!(weekdaysOnly && isWeekend(c))) cols.push(c)
  let extra = $('edRoster').hidden ? 0 : Number($('edRepeat').value) || 0
  for (let c = sel.c1 + 1; extra > 0 && c < m.data.cols; c++) {
    if (!m.layout.dates[c]) break
    if (isWeekend(c)) continue
    cols.push(c)
    extra--
  }
  const cells = []
  for (const r of grid.selectedRows()) for (const c of cols) if (editable(r, c)) cells.push({ r, c, v })
  closeEditor()
  if (cells.length) commit(cells)
}

function parseInput(v) {
  const s = String(v)
  if (/^-?\d+(\.\d+)?$/.test(s.trim()) && s.trim().length < 15) return Number(s.trim())
  return s
}

/**
 * Writes cells into the workbook. Shown at once, saved in the background
 * (one request per run of adjacent cells in a row), and put back if Excel
 * refuses. Before writing, the name column of the rows involved is checked
 * against the workbook, so an edit can't land on the wrong person if someone
 * inserted or deleted rows in Excel since the sheet was loaded.
 */
async function commit(cells, { undoable = true } = {}) {
  const m = model()
  const name = state.sheet
  const { data, layout } = m
  const before = cells.map(({ r, c }) => ({ r, c, v: data.formulas[r][c] === '' ? '' : data.formulas[r][c], value: data.values[r][c] }))
  for (const { r, c, v } of cells) {
    data.formulas[r][c] = v
    data.values[r][c] = parseInput(v)
    grid.pending.add(r + ',' + c)
  }
  if (undoable) {
    state.undo.push({ sheet: name, cells: before.map(({ r, c, v }) => ({ r, c, v })) })
    if (state.undo.length > 100) state.undo.shift()
  }
  indexRows()
  grid.draw()
  state.saving++
  setLive()

  const runs = []
  const byRow = new Map()
  for (const cell of cells) {
    if (!byRow.has(cell.r)) byRow.set(cell.r, [])
    byRow.get(cell.r).push(cell)
  }
  for (const [r, list] of byRow) {
    list.sort((a, b) => a.c - b.c)
    let run = null
    for (const cell of list) {
      if (run && cell.c === run.c1 + 1) { run.c1 = cell.c; run.vals.push(parseInput(cell.v)) }
      else { run = { r, c0: cell.c, c1: cell.c, vals: [parseInput(cell.v)] }; runs.push(run) }
    }
  }

  const revert = (list) => {
    for (const { r, c } of list) {
      const b = before.find((x) => x.r === r && x.c === c)
      data.formulas[r][c] = b.v
      data.values[r][c] = b.value
    }
  }
  try {
    const rowsInvolved = [...byRow.keys()]
    const lo = Math.min(...rowsInvolved), hi = Math.max(...rowsInvolved)
    if (!state.local && hi >= layout.frozenRows) {
      const nc = layout.nameCol
      const live = await state.wb.readRange(name, address(lo, nc, hi, nc))
      const moved = rowsInvolved.some((r) => r >= layout.frozenRows && display(live.values[r - lo][0]) !== display(data.values[r][nc]))
      if (moved) {
        revert(cells)
        if (undoable) state.undo.pop()
        toast('Rows were added or removed in Excel since you loaded the sheet. It has been reloaded — please make the change again.', true)
        state.saving--
        for (const { r, c } of cells) grid.pending.delete(r + ',' + c)
        await refresh(true)
        setLive()
        return
      }
    }
    for (const run of runs) {
      try {
        const res = await state.wb.writeRange(name, address(run.r, run.c0, run.r, run.c1), [run.vals])
        if (res && res.values) {
          res.values[0].forEach((v, i) => { data.values[run.r][run.c0 + i] = v })
        }
      } catch (err) {
        const failed = cells.filter((x) => x.r === run.r && x.c >= run.c0 && x.c <= run.c1)
        revert(failed)
        throw err
      } finally {
        for (let c = run.c0; c <= run.c1; c++) grid.pending.delete(run.r + ',' + c)
        grid.draw()
      }
    }
    const n = cells.length
    if (n > 1 && !state.local) toast(`Saved ${n} cells to Excel`)
  } catch (err) {
    for (const { r, c } of cells) grid.pending.delete(r + ',' + c)
    fail(err)
  } finally {
    state.saving = Math.max(0, state.saving - 1)
    indexRows()
    grid.draw()
    if (!$('day').hidden) renderDay()
    setLive()
    if (!state.saving) schedulePoll(1500)
  }
}

function undo() {
  const last = state.undo.pop()
  if (!last) return toast('Nothing to undo')
  if (last.sheet !== state.sheet) { state.undo.push(last); return toast(`Your last change was on ${last.sheet}`) }
  commit(last.cells, { undoable: false })
}

function clearSelection() {
  const sel = grid.sel
  if (!sel) return
  const cells = []
  for (const r of grid.selectedRows()) for (let c = sel.c0; c <= sel.c1; c++) {
    if (editable(r, c) && model().data.formulas[r][c] !== '') cells.push({ r, c, v: '' })
  }
  if (!cells.length) return
  if (cells.length > 40 && !confirm(`Clear ${cells.length} cells in the workbook?`)) return
  commit(cells)
}

function copySelection(e) {
  const sel = grid.sel
  if (!sel) return
  const m = model()
  const text = grid.selectedRows().map((r) => {
    const out = []
    for (let c = sel.c0; c <= sel.c1; c++) out.push(display(m.data.values[r][c]))
    return out.join('\t')
  }).join('\n')
  e.clipboardData.setData('text/plain', text)
  e.preventDefault()
  toast('Copied')
}

function paste(e) {
  const sel = grid.sel
  if (!sel || !$('editor').hidden) return
  const text = e.clipboardData.getData('text/plain')
  if (!text) return
  e.preventDefault()
  const m = model()
  const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
  const order = [...Array(Math.min(m.layout.frozenRows, m.data.rows)).keys(), ...grid.rows]
  const start = order.indexOf(sel.r0)
  const cells = []
  // A single value pasted over a selection fills it, as in Excel.
  if (lines.length === 1 && lines[0].length === 1 && (sel.r0 !== sel.r1 || sel.c0 !== sel.c1)) {
    for (const r of grid.selectedRows()) for (let c = sel.c0; c <= sel.c1; c++) if (editable(r, c)) cells.push({ r, c, v: lines[0][0] })
  } else {
    lines.forEach((line, i) => {
      const r = order[start + i]
      if (r === undefined) return
      line.forEach((v, j) => {
        const c = sel.c0 + j
        if (c < m.data.cols && editable(r, c)) cells.push({ r, c, v })
      })
    })
  }
  if (cells.length) commit(cells)
}

// ---------------------------------------------------------------- day view

function openDay(col) {
  const m = model()
  if (!m || m.layout.kind !== 'roster') return
  if (col === undefined || !m.layout.dates[col]) col = grid.sel && m.layout.dates[grid.sel.ac] ? grid.sel.ac : grid.todayCol
  state.dayCol = col
  $('day').hidden = false
  renderDay()
}

function closeDay() {
  $('day').hidden = true
}

function stepDay(dir) {
  const m = model()
  let c = state.dayCol + dir
  while (c >= 0 && c < m.data.cols && !m.layout.dates[c]) c += dir
  if (c < 0 || c >= m.data.cols) return
  state.dayCol = c
  grid.reveal(grid.sel ? grid.sel.ar : m.layout.frozenRows, c)
  renderDay()
}

/** Who is where on one day, grouped by job, as the sheet has it. */
function renderDay() {
  const m = model()
  const col = state.dayCol
  const date = m.layout.dates[col]
  if (!date) return
  $('dayTitle').textContent = fmtDate(date, true)
  const groups = new Map()
  const unbooked = []
  const weekend = date.getDay() === 0 || date.getDay() === 6
  for (let r = m.layout.frozenRows; r < m.data.rows; r++) {
    const who = display(m.data.values[r][m.layout.nameCol]).trim()
    const v = m.data.values[r][col]
    if (v === '' || v === null) {
      // Working nearby but nothing on this day.
      if (who && !weekend && state.rowInfo[r].some((c) => Math.abs(c - col) <= 14)) unbooked.push({ r, who })
      continue
    }
    const key = normalise(v)
    if (!groups.has(key)) groups.set(key, { label: display(v).trim(), people: [] })
    groups.get(key).people.push({ r, who: who || `Row ${r + 1}` })
  }
  const list = [...groups.values()].sort((a, b) => (isLeave(a.label) - isLeave(b.label)) || b.people.length - a.people.length)
  const onJobs = list.filter((g) => !isLeave(g.label)).reduce((n, g) => n + g.people.length, 0)
  const away = list.filter((g) => isLeave(g.label)).reduce((n, g) => n + g.people.length, 0)
  const body = $('dayBody')
  body.replaceChildren()
  const total = document.createElement('div')
  total.className = 'day-total'
  total.innerHTML = `<span><b>${onJobs}</b> on jobs</span><span><b>${away}</b> on leave / off</span><span><b>${list.filter((g) => !isLeave(g.label)).length}</b> jobs</span>`
  body.append(total)
  const section = (label, people, col) => {
    const g = document.createElement('div')
    g.className = 'group'
    const h = document.createElement('h3')
    h.style.background = col ? col.bg : '#eef1f3'
    h.style.color = col ? col.fg : '#37474f'
    h.append(label)
    const n = document.createElement('span'); n.className = 'n'; n.textContent = people.length
    h.append(n)
    const ul = document.createElement('ul')
    for (const p of people) {
      const li = document.createElement('li')
      const [, main, rest] = /^([^([{]*)(.*)$/.exec(p.who)
      li.append(main.trim() || p.who)
      if (rest && main.trim()) { const s = document.createElement('small'); s.textContent = ' ' + rest; li.append(s) }
      li.onclick = () => { grid.select(p.r, col === undefined ? state.dayCol : state.dayCol); grid.reveal(p.r, state.dayCol) }
      ul.append(li)
    }
    g.append(h, ul)
    body.append(g)
  }
  for (const g of list) section(g.label, g.people, colourFor(g.label))
  if (unbooked.length) section('Nothing booked', unbooked, null)
  if (!list.length && !unbooked.length) body.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nothing booked on this day.' }))
}

// ---------------------------------------------------------------- chrome

function renderTabs() {
  $('tabs').replaceChildren(...state.sheets.map((s) => {
    const b = document.createElement('button')
    b.textContent = s.name
    b.setAttribute('aria-selected', String(s.name === state.sheet))
    b.onclick = () => { if (s.name !== state.sheet) openSheet(s.name).catch(fail) }
    return b
  }))
}

function renderLegend() {
  $('legend').replaceChildren(...LEGEND.map(({ bg, fg, label }) => {
    const s = document.createElement('span')
    s.style.background = bg
    s.style.color = fg
    s.textContent = label
    return s
  }), Object.assign(document.createElement('span'), { className: 'muted', textContent: 'Jobs are coloured by name · today outlined in orange' }))
}

function loading(on, text) {
  let el = document.querySelector('.loading')
  if (!on) { el?.remove(); return }
  if (!el) {
    el = document.createElement('div')
    el.className = 'loading'
    $('gridHost').append(el)
  }
  el.textContent = text
}

let toastTimer
function toast(msg, error) {
  const t = $('toast')
  t.textContent = msg
  t.className = 'toast' + (error ? ' error' : '')
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, error ? 7000 : 2200)
}

function openSettings() {
  const d = $('settings')
  const f = d.querySelector('form')
  for (const k of ['fileUrl', 'fileName', 'pollSeconds', 'tenantId', 'clientId']) f.elements[k].value = state.cfg[k] ?? ''
  d.returnValue = ''
  d.showModal()
  d.onclose = () => {
    if (d.returnValue === 'save') {
      const conn = {}
      for (const k of ['fileUrl', 'fileName', 'tenantId', 'clientId']) conn[k] = f.elements[k].value.trim()
      conn.pollSeconds = Math.max(5, Number(f.elements.pollSeconds.value) || DEFAULTS.pollSeconds)
      writePrefs({ conn })
      location.reload()
    } else if (d.returnValue === 'reset') {
      writePrefs({ conn: {} })
      location.reload()
    }
  }
}

function bindUi() {
  $('search').addEventListener('input', applyFilter)
  $('active').checked = !!readPrefs().active
  $('active').addEventListener('change', applyFilter)
  $('highlight').addEventListener('input', () => {
    grid.highlight = normalise($('highlight').value)
    grid.draw()
  })
  $('today').onclick = goToday
  $('jump').addEventListener('change', () => {
    const v = $('jump').value
    if (!v || !model()) return
    const [y, mo, d] = v.split('-').map(Number)
    const c = nearestDateCol(new Date(y, mo - 1, d))
    if (c >= 0) { grid.scrollToCol(c, 1); if (grid.sel) grid.select(grid.sel.ar, c) }
  })
  $('dayBtn').onclick = () => ($('day').hidden ? openDay() : closeDay())
  $('dayClose').onclick = closeDay
  $('dayPrev').onclick = () => stepDay(-1)
  $('dayNext').onclick = () => stepDay(1)
  $('refresh').onclick = () => { setStatus('Reloading…', 'saving'); refresh().then(setLive, fail) }
  $('userBtn').onclick = (e) => { e.stopPropagation(); $('userMenu').hidden = !$('userMenu').hidden }
  document.addEventListener('click', () => { $('userMenu').hidden = true })
  $('userMenu').addEventListener('click', (e) => {
    const act = e.target.dataset.act
    if (act === 'excel' && state.wb) window.open(state.wb.webUrl, '_blank', 'noopener')
    if (act === 'settings') openSettings()
    if (act === 'help') $('help').showModal()
    if (act === 'openfile') openLocal(pickWorkbook)
    if (act === 'signout') {
      if (!state.local) return state.auth.signOut()
      if (state.wb.dirty && !confirm('Close without saving your changes?')) return
      state.wb.dirty = false
      location.reload()
    }
  })

  $('edApply').onclick = () => applyEditor()
  $('edClear').onclick = () => applyEditor(true)
  $('edCancel').onclick = closeEditor
  $('edClose').onclick = closeEditor
  $('edInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyEditor() }
    if (e.key === 'Escape') { e.preventDefault(); closeEditor() }
  })

  document.addEventListener('copy', (e) => { if (document.activeElement === grid.scroller) copySelection(e) })
  document.addEventListener('paste', (e) => { if (document.activeElement === grid.scroller) paste(e) })

  grid.scroller.addEventListener('keydown', (e) => {
    if (!grid.sel) return
    const k = e.key
    const mod = e.ctrlKey || e.metaKey
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] }
    if (moves[k]) { e.preventDefault(); grid.move(...moves[k], e.shiftKey && k !== 'Tab'); return }
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return }
    if (mod) return
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); openEditor(); return }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearSelection(); return }
    if (k === 'Escape') { grid.select(grid.sel.ar, grid.sel.ac); return }
    if (k.length === 1 && !e.altKey) {
      // Letters that are also shortcuts only act as shortcuts with Shift off and nothing typed yet.
      e.preventDefault()
      openEditor(k)
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body || e.ctrlKey || e.metaKey) return
    if (e.key === 't') goToday()
    if (e.key === 'd') $('dayBtn').click()
    if (e.key === 'r') $('refresh').click()
  })

  $('signIn').onclick = () => state.auth.signIn()
  $('gateSettings').onclick = openSettings
  $('saveBtn').onclick = saveLocal
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.local) { e.preventDefault(); saveLocal() }
  })
}

$('openFile').onclick = () => openLocal(pickWorkbook)
lastHandle().then((h) => {
  if (!h) return
  const b = $('reopenFile')
  b.textContent = `Reopen ${h.name}`
  b.hidden = false
  $('openFile').classList.remove('primary')
  $('openFile').textContent = 'Open a different Excel file'
  b.onclick = () => openLocal(() => reopen(h))
})
$('signIn').onclick = async () => {
  if (!state.auth) state.cfg = await loadConfig()
  try { (state.auth ??= new Auth(state.cfg)).signIn() } catch (err) { $('gateMsg').textContent = err.message }
}
$('gateSettings').onclick = async () => { state.cfg ??= await loadConfig(); openSettings() }

// This page is also the sign-in popup's return address. In the popup, leave
// the answer in the address bar for the window that opened it to collect.
const inSignInPopup = window.opener && window.opener !== window && /[#&?](code|error)=/.test(location.hash + location.search)
if (inSignInPopup) document.body.replaceChildren(document.createTextNode('Signing in…'))
else start().catch((err) => { console.error(err); showGate(err.message || String(err)) })
