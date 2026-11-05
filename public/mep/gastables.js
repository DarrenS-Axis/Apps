// Gas capacity tables as files: CSV in and out, and checks on what was entered.
//
// The CSV is laid out the way the tables are printed, so a table can be typed
// up in a spreadsheet from a licensed copy of AS/NZS 5601.1 and imported:
//
//   name,NG copper 0.25 kPa (Table F?.?)
//   gas,NG
//   material,copperB
//   drop_kPa,0.25
//   DN,2,5,10,15,20
//   15,250,150,100,80,65
//   20,450,270,180,140,120
//
// Rows above the "DN" header are settings; the header holds run lengths in
// metres; each row below is a size and its capacity in MJ/h at each length.
// A blank cell means the size is not used at that length.

import { MATERIALS, GASES } from './data.js'

function cells(line) {
  const sep = line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ','
  return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
}

function materialKey(v) {
  if (MATERIALS[v]) return v
  const hit = Object.entries(MATERIALS).find(([, m]) => m.name.toLowerCase() === String(v).toLowerCase())
  return hit?.[0]
}

/** Parse a capacity table CSV. Throws an Error naming the line at fault. */
export function parseGasTableCsv(text, fallbackName = 'Imported table') {
  const t = { name: fallbackName, gas: 'NG', material: 'copperB', drop: null, source: 'entered', lengths: [], rows: [] }
  let header = false
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const c = cells(line)
    const where = `line ${i + 1}`
    if (!header) {
      if (/^dn\b/i.test(c[0])) {
        header = true
        t.lengths = c.slice(1).filter((x) => x !== '').map((x) => {
          const n = parseFloat(x)
          if (!(n > 0)) throw new Error(`${where}: "${x}" is not a run length in metres`)
          return n
        })
        return
      }
      const key = c[0].toLowerCase()
      const val = c[1] ?? ''
      if (key === 'name') t.name = val || t.name
      else if (key === 'gas') {
        const g = val.toUpperCase()
        if (!GASES[g]) throw new Error(`${where}: gas must be ${Object.keys(GASES).join(' or ')}`)
        t.gas = g
      } else if (key === 'material') {
        const m = materialKey(val)
        if (!m) throw new Error(`${where}: unknown material "${val}" (use one of ${Object.keys(MATERIALS).join(', ')})`)
        t.material = m
      } else if (key.startsWith('drop')) t.drop = parseFloat(val) || null
      return
    }
    const dn = parseFloat(c[0])
    if (!(dn > 0)) throw new Error(`${where}: "${c[0]}" is not a pipe size`)
    const cap = t.lengths.map((_, j) => {
      const x = c[j + 1]
      if (x == null || x === '' || x === '-') return null
      const n = parseFloat(x)
      if (!(n >= 0)) throw new Error(`${where}: "${x}" is not a capacity in MJ/h`)
      return n
    })
    t.rows.push({ dn, cap })
  })
  if (!header) throw new Error('No header row starting with "DN" was found')
  const { errors } = checkGasTable(t)
  if (errors.length) throw new Error(errors[0])
  return t
}

export function gasTableCsv(t) {
  const out = [
    '# Axis MEP Design gas capacity table (MJ/h at each run length in m)',
    `name,${t.name.replace(/,/g, ' ')}`,
    `gas,${t.gas}`,
    `material,${t.material}`,
    `drop_kPa,${t.drop ?? ''}`,
    `source,${t.source}`,
    ['DN', ...t.lengths].join(','),
    ...t.rows.map((r) => [r.dn, ...r.cap.map((v) => (v == null ? '' : v))].join(',')),
  ]
  return out.join('\r\n')
}

/**
 * Problems with a table. `errors` stop it being used (it cannot be read
 * correctly); `warnings` are likely typing mistakes worth a second look.
 */
export function checkGasTable(t) {
  const errors = []
  const warnings = []
  if (!t.lengths.length) errors.push('The table has no run lengths')
  for (let i = 1; i < t.lengths.length; i++) {
    if (!(+t.lengths[i] > +t.lengths[i - 1])) { errors.push(`Run lengths must increase left to right (${t.lengths[i - 1]} m then ${t.lengths[i]} m)`); break }
  }
  if (!t.rows.length) errors.push('The table has no pipe sizes')
  const mat = MATERIALS[t.material]
  for (const r of t.rows) {
    if (mat && !mat.sizes.some((s) => s.dn === +r.dn)) warnings.push(`DN${r.dn} is not a ${mat.name} size, so it will never be chosen`)
    for (let i = 1; i < r.cap.length; i++) {
      if (r.cap[i] != null && r.cap[i - 1] != null && +r.cap[i] > +r.cap[i - 1]) { warnings.push(`DN${r.dn}: capacity rises from ${r.cap[i - 1]} to ${r.cap[i]} MJ/h at a longer run — check the entry`); break }
    }
  }
  const sizes = t.rows.map((r) => +r.dn)
  if (new Set(sizes).size !== sizes.length) errors.push('A pipe size appears twice')
  return { errors, warnings }
}
