// What the app knows about the workbook's layout: which rows and columns are
// headings, which column is which day, and how each entry is coloured.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function monthIndex(v) {
  if (typeof v !== 'string') return -1
  return MONTHS.indexOf(v.trim().slice(0, 3).toLowerCase())
}

/**
 * The layout of one sheet. The labour sheet has a month / day / weekday
 * header in rows 1–3, a notes row (shutdowns, public holidays) in row 4, and
 * names in columns A–C; anything else is shown as a plain grid with its first
 * row and column frozen.
 */
export function describe(name, data, narrow = false) {
  const dates = findDates(data)
  if (dates.firstCol >= 0) {
    const nameCol = Math.max(0, dates.firstCol - 1)
    return {
      kind: 'roster',
      frozenRows: 4,
      frozenCols: dates.firstCol,
      nameCol,
      dates: dates.byCol,
      widths: Array.from({ length: data.cols }, (_, c) =>
        c === nameCol ? (narrow ? 150 : 300) : c < dates.firstCol ? (narrow ? 24 : 42) : (narrow ? 70 : 84)),
    }
  }
  return {
    kind: 'plain',
    frozenRows: 1,
    frozenCols: 1,
    nameCol: 0,
    dates: [],
    widths: Array.from({ length: data.cols }, (_, c) => (c === 0 ? (narrow ? 150 : 220) : 92)),
  }
}

/**
 * Turns the month / day header into real dates. The year isn't written in
 * the sheet, so it's worked out from the weekday row: the year in which the
 * first column's day falls on the weekday shown. Years then roll over at
 * each December → January.
 */
export function findDates(data) {
  const { values, cols } = data
  const byCol = new Array(cols).fill(null)
  if (values.length < 3) return { firstCol: -1, byCol }
  let firstCol = -1
  for (let c = 0; c < cols; c++) {
    if (monthIndex(values[0][c]) >= 0 && Number(values[1][c]) >= 1) { firstCol = c; break }
  }
  if (firstCol < 0) return { firstCol, byCol }
  const m0 = monthIndex(values[0][firstCol])
  const d0 = Number(values[1][firstCol])
  const wd = DAYS.indexOf(String(values[2][firstCol] || '').trim().slice(0, 3).toLowerCase())
  const now = new Date().getFullYear()
  let year = now
  for (const y of [now, now - 1, now + 1, now - 2, now + 2, now - 3]) {
    if (wd < 0 || new Date(y, m0, d0).getDay() === wd) { year = y; break }
  }
  let prevM = m0
  for (let c = firstCol; c < cols; c++) {
    const m = monthIndex(values[0][c])
    const d = Number(values[1][c])
    if (m < 0 || !(d >= 1)) continue
    if (m < prevM) year++
    prevM = m
    byCol[c] = new Date(year, m, d)
  }
  return { firstCol, byCol }
}

export function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function fmtDate(d, long) {
  return d.toLocaleDateString('en-AU', long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short' })
}

export function display(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

/** One spelling for an entry, so "A/LEAVE", "ALEAVE" and "SA1043'" group. */
export function normalise(v) {
  return display(v).toUpperCase().replace(/['’`]+$/, '').replace(/\s+/g, ' ').trim()
}

// Leave and the like get fixed colours; projects get one from their name.
const FIXED = [
  [/^(PH|P\/H|PUBLIC HOL)/, '#f6c9c4', '#7a1c14', 'Public holiday'],
  [/^(A\s*\/?\s*LEAVE|ANNUAL|AL$)/, '#c9e8cb', '#1b5e20', 'Annual leave'],
  [/^RDO/, '#e2d7f6', '#4a2a82', 'RDO'],
  [/^(SICK|PERSONAL|CARER)/, '#ffd9b3', '#8a4500', 'Sick / personal'],
  [/^(SHUT|OFF$|CLOSED|LWOP)/, '#dadfe3', '#37474f', 'Shutdown / off'],
  [/(TRAIN|TEST|TAFE|COURSE|INDUCT|SCHOOL|MPA|TAPS)/, '#fff1a8', '#665300', 'Training / TAFE'],
]

export const LEGEND = FIXED.map(([, bg, fg, label]) => ({ bg, fg, label }))

const cache = new Map()
export function colourFor(v) {
  const key = normalise(v)
  if (!key) return null
  let c = cache.get(key)
  if (c) return c
  const fixed = FIXED.find(([re]) => re.test(key))
  if (fixed) {
    c = { bg: fixed[1], fg: fixed[2], kind: 'leave' }
  } else {
    let h = 0
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const hue = (h * 137.508) % 360
    c = { bg: `hsl(${hue.toFixed(0)} 62% 86%)`, fg: `hsl(${hue.toFixed(0)} 55% 22%)`, kind: 'project' }
  }
  cache.set(key, c)
  return c
}

export function isLeave(v) {
  const c = colourFor(v)
  return !!c && c.kind === 'leave'
}
