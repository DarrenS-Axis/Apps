// Axis MEP Design — calculation engine.
//
// Pure functions only: given a project it returns results, and never touches
// the page, so it can be unit-tested in Node (tests/mep-calc.mjs).
//
// Each system is solved as a tree grown out from its root — the water source,
// the drainage connection or the air handler. Loads accumulate from the
// outlets back to the root, each link is sized for what it carries, and
// pressures are then walked back out from the root to every outlet.

import { MATERIALS, SYSTEMS, GASES, AIR_RHO } from './data.js'

const G = 9.81

/** Density (kg/m³) and kinematic viscosity (m²/s) of water at a temperature. */
export function waterProps(tempC) {
  const t = tempC
  const rho = 1000 * (1 - ((t + 288.9414) / (508929.2 * (t + 68.12963))) * (t - 3.9863) ** 2)
  // Vogel equation for dynamic viscosity, Pa·s
  const mu = 0.02939e-3 * Math.exp(507.88 / (t + 273.15 - 149.3))
  return { rho, nu: mu / rho }
}

export const AIR = { rho: 1.2, nu: 1.5e-5 }

/** Darcy friction factor: laminar below Re 2300, Swamee–Jain above. */
export function frictionFactor(re, roughnessM, diaM) {
  if (re <= 0) return 0
  if (re < 2300) return 64 / re
  const a = roughnessM / (3.7 * diaM) + 5.74 / re ** 0.9
  return 0.25 / Math.log10(a) ** 2
}

/** Full-bore flow: velocity (m/s), Reynolds, friction factor and loss (Pa/m). */
export function pipeFlow(qLs, diaMm, roughnessMm, fluid) {
  const d = diaMm / 1000
  const area = (Math.PI * d * d) / 4
  const v = qLs / 1000 / area
  const re = (v * d) / fluid.nu
  const f = frictionFactor(re, roughnessMm / 1000, d)
  const paPerM = d > 0 ? ((f / d) * fluid.rho * v * v) / 2 : 0
  return { v, re, f, paPerM }
}

/**
 * Capacity of a graded drain running part full (Prandtl–Colebrook, as used by
 * EN 12056-2). Returns { q: L/s, v: m/s }.
 */
export function drainCapacity(diaMm, gradePct, fill, roughnessMm, nu = 1.31e-6) {
  const d = diaMm / 1000
  const s = gradePct / 100
  if (s <= 0) return { q: 0, v: 0 }
  const theta = 2 * Math.acos(1 - 2 * fill)
  const area = ((d * d) / 8) * (theta - Math.sin(theta))
  const wetted = (d * theta) / 2
  const dh = (4 * area) / wetted
  const root = Math.sqrt(2 * G * dh * s)
  const v = -2 * Math.log10(roughnessMm / 1000 / (3.71 * dh) + (2.51 * nu) / (dh * root)) * root
  return { q: area * v * 1000, v }
}

/** Huebscher equivalent diameter of a rectangular duct (mm). */
export function equivalentDiameter(a, b) {
  return (1.3 * (a * b) ** 0.625) / (a + b) ** 0.25
}

/** Smallest rectangle, at most `depth` deep, matching a round duct. */
export function rectangleFor(diaMm, depth) {
  const h = Math.min(depth, Math.ceil(diaMm / 50) * 50)
  let w = 50
  while (equivalentDiameter(w, h) < diaMm && w < 5000) w += 50
  return { w, h }
}

export function linkLength(link, nodes, metresPerPx) {
  if (link.length != null && link.length !== '' && !Number.isNaN(+link.length)) return +link.length
  const a = nodes.get(link.a)
  const b = nodes.get(link.b)
  if (!a || !b) return 0
  const plan = Math.hypot(a.x - b.x, a.y - b.y) * metresPerPx
  return plan + Math.abs((+a.z || 0) - (+b.z || 0))
}

function isRoot(node, sysKey) {
  const kind = SYSTEMS[sysKey].kind
  if (node.system !== sysKey) return false
  if (kind === 'water' || kind === 'gas') return node.kind === 'source'
  if (kind === 'drain') return node.kind === 'outlet'
  return node.kind === 'ahu'
}

/** The load one node puts on a system. */
function nodeLoad(node, sysKey, fixtures, warnings) {
  const load = { lu: 0, qSum: 0, qMax: 0, du: 0, duMax: 0, dnMin: 0, air: 0, mj: 0, mjMax: 0, outlets: 0 }
  const kind = SYSTEMS[sysKey].kind
  if (kind === 'air') {
    if (node.kind === 'terminal') {
      load.air = +node.airflow || 0
      load.outlets = 1
    }
    return load
  }
  if (node.kind !== 'fixture') return load
  const fx = fixtures[node.fixture]
  if (!fx) {
    warnings.push({ level: 'error', msg: `Unknown fixture type "${node.fixture}"`, ref: node.id })
    return load
  }
  load.outlets = 1
  if (kind === 'gas') {
    if (!(+fx.mj > 0)) warnings.push({ level: 'warn', msg: `${fx.name} ${node.label || node.id} is on ${SYSTEMS[sysKey].name} but has no gas rating`, ref: node.id })
    load.mj = +fx.mj || 0
    load.mjMax = load.mj
  } else if (kind === 'water') {
    if (sysKey === 'HW' && !fx.hot) {
      warnings.push({ level: 'warn', msg: `${fx.name} ${node.label || node.id} has no hot connection but is on heated water`, ref: node.id })
      return load
    }
    load.lu = +fx.lu || 0
    load.qSum = +fx.q || 0
    load.qMax = +fx.q || 0
  } else {
    load.du = +fx.du || 0
    load.duMax = +fx.du || 0
    load.dnMin = +fx.dnMin || 0
  }
  return load
}

function addLoad(into, from) {
  into.lu += from.lu
  into.qSum += from.qSum
  into.qMax = Math.max(into.qMax, from.qMax)
  into.du += from.du
  into.duMax = Math.max(into.duMax, from.duMax)
  into.dnMin = Math.max(into.dnMin, from.dnMin)
  into.air += from.air
  into.mj += from.mj
  into.mjMax = Math.max(into.mjMax, from.mjMax)
  into.outlets += from.outlets
}

/** Probable simultaneous water demand (L/s). */
export function waterDemand(load, ws) {
  if (load.qSum <= 0) return 0
  if (ws.method === 'sum') return load.qSum
  const probable = (+ws.kLU || 0.1) * Math.sqrt(load.lu)
  return Math.min(load.qSum, Math.max(load.qMax, probable))
}

/** Drainage design flow Qww = K·√ΣDU, never less than the largest single DU. */
export function drainFlow(load, ds) {
  if (load.du <= 0) return 0
  return Math.max(load.duMax, (+ds.K || 0.5) * Math.sqrt(load.du))
}

/** Fluid properties of a fuel gas, in the shape pipeFlow() takes. */
export function gasProps(gasKey) {
  const g = GASES[gasKey]
  return { rho: g.rho, nu: g.mu / g.rho }
}

/**
 * Design gas load (MJ/h): the connected load times the diversity, but never
 * less than the largest single appliance.
 */
export function gasLoad(load, gs) {
  if (load.mj <= 0) return 0
  return Math.max(load.mjMax, (load.mj * (gs.diversity ?? 100)) / 100)
}

/** MJ/h to L/s of gas. */
export const gasFlowLs = (mjh, gasKey) => ((mjh / GASES[gasKey].hv) * 1000) / 3600

function pickSize(sizes, ok, locked, bump = 0) {
  if (locked) {
    const s = sizes.find((x) => x.dn === +locked)
    if (s) return { size: s, locked: true }
  }
  let i = sizes.findIndex(ok)
  if (i < 0) return { size: sizes[sizes.length - 1], locked: false, oversized: true, atMax: true }
  i = Math.min(sizes.length - 1, i + bump)
  return { size: sizes[i], locked: false, atMax: i === sizes.length - 1 }
}

/**
 * Solve the whole project. Water pipes are first sized for velocity; then,
 * while any outlet is short of pressure, the unlocked pipe with the largest
 * loss on that outlet's path is stepped up one size and the network re-solved.
 */
export function calculate(project) {
  const bumps = {}
  let res = solve(project, bumps)
  for (let iter = 0; iter < 500; iter++) {
    const byChild = new Map(Object.values(res.links).map((l) => [`${l.system}|${l.to}`, l]))
    let grew = false
    for (const [nid, perSys] of Object.entries(res.nodes)) {
      for (const [sysKey, r] of Object.entries(perSys)) {
        if (r.ok !== false) continue
        let best = null
        for (let l = byChild.get(`${sysKey}|${nid}`); l; l = byChild.get(`${sysKey}|${l.from}`)) {
          if (!l.locked && !l.atMax && (!best || l.loss > best.loss)) best = l
        }
        if (best) {
          bumps[best.id] = (bumps[best.id] || 0) + 1
          grew = true
        }
      }
    }
    if (!grew) break
    res = solve(project, bumps)
  }
  res.upsized = Object.keys(bumps).length
  return res
}

/** One pass over every system. `bumps` holds extra size steps per link. */
function solve(project, bumps) {
  const settings = project.settings
  const fixtures = project.fixtures
  const nodes = new Map(project.nodes.map((n) => [n.id, n]))
  const out = { links: {}, nodes: {}, warnings: [], summary: {}, bom: [] }
  const W = out.warnings

  for (const link of project.links) {
    if (!nodes.has(link.a) || !nodes.has(link.b)) W.push({ level: 'error', msg: `Link ${link.id} has a missing end`, ref: link.id })
  }

  for (const sysKey of Object.keys(SYSTEMS)) {
    const sys = SYSTEMS[sysKey]
    const links = project.links.filter((l) => l.system === sysKey && nodes.has(l.a) && nodes.has(l.b))
    if (!links.length) continue
    const adj = new Map()
    for (const l of links) {
      if (!adj.has(l.a)) adj.set(l.a, [])
      if (!adj.has(l.b)) adj.set(l.b, [])
      adj.get(l.a).push(l)
      adj.get(l.b).push(l)
    }
    const roots = project.nodes.filter((n) => isRoot(n, sysKey) && adj.has(n.id))
    if (!roots.length) {
      W.push({ level: 'error', msg: `${sys.name}: no ${sys.kind === 'water' || sys.kind === 'gas' ? 'source' : sys.kind === 'drain' ? 'drainage connection' : 'air handler'} connected` })
      continue
    }

    const visited = new Set()
    const usedLinks = new Set()
    const summary = { system: sysKey, name: sys.name, roots: [] }

    for (const root of roots) {
      if (visited.has(root.id)) {
        W.push({ level: 'error', msg: `${sys.name}: two roots are connected to each other`, ref: root.id })
        continue
      }
      // Grow the tree breadth-first; order[] is root-first.
      const order = [root.id]
      const parentLink = new Map()
      visited.add(root.id)
      for (let i = 0; i < order.length; i++) {
        const nid = order[i]
        for (const l of adj.get(nid) || []) {
          if (usedLinks.has(l.id)) continue
          const other = l.a === nid ? l.b : l.a
          usedLinks.add(l.id)
          if (visited.has(other)) {
            W.push({ level: 'error', msg: `${sys.name}: link ${l.id} closes a loop — ring mains are not solved yet`, ref: l.id })
            continue
          }
          visited.add(other)
          parentLink.set(other, { link: l, parent: nid })
          order.push(other)
        }
      }

      // Loads, outlets back to root.
      const load = new Map()
      for (const nid of order) load.set(nid, nodeLoad(nodes.get(nid), sysKey, fixtures, W))
      const children = new Map()
      for (const [child, { parent }] of parentLink) {
        if (!children.has(parent)) children.set(parent, [])
        children.get(parent).push(child)
      }
      const subtree = new Map()
      const material = (l) => MATERIALS[l.material] || MATERIALS[sys.material]
      for (let i = order.length - 1; i >= 0; i--) {
        const nid = order[i]
        const total = { ...load.get(nid) }
        for (const c of children.get(nid) || []) addLoad(total, subtree.get(c))
        subtree.set(nid, total)
        const pl = parentLink.get(nid)
        if (!pl) continue
        const l = pl.link
        const mat = material(l)
        const length = linkLength(l, nodes, settings.metresPerPx)
        const res = { id: l.id, system: sysKey, from: pl.parent, to: nid, length, material: mat.name, materialKey: l.material || sys.material, outlets: total.outlets }

        if (sys.kind === 'water') {
          const fluid = waterProps(sys.tempC)
          const q = waterDemand(total, settings.water)
          const vMax = +settings.water.vMax || 3
          const pick = pickSize(mat.sizes, (s) => pipeFlow(q, s.id, mat.roughness, fluid).v <= vMax, l.size, bumps[l.id])
          const flow = pipeFlow(q, pick.size.id, mat.roughness, fluid)
          const loss = (flow.paPerM * length * (1 + (+settings.water.fittingsPct || 0) / 100)) / 1000
          Object.assign(res, { lu: total.lu, q, dn: pick.size.dn, bore: pick.size.id, v: flow.v, paPerM: flow.paPerM, loss, locked: pick.locked, atMax: pick.atMax, upsized: bumps[l.id] || 0 })
          if (flow.v > vMax + 1e-9) W.push({ level: pick.locked ? 'warn' : 'error', msg: `${l.id}: ${flow.v.toFixed(2)} m/s exceeds ${vMax} m/s`, ref: l.id })
          res.label = `DN${res.dn} · ${q.toFixed(2)} L/s`
        } else if (sys.kind === 'gas') {
          const gs = settings.gas
          const fluid = gasProps(sys.gas)
          const mj = gasLoad(total, gs)
          const q = gasFlowLs(mj, sys.gas)
          const vMax = +gs.vMax || 10
          const pick = pickSize(mat.sizes, (s) => pipeFlow(q, s.id, mat.roughness, fluid).v <= vMax, l.size, bumps[l.id])
          const flow = pipeFlow(q, pick.size.id, mat.roughness, fluid)
          const loss = (flow.paPerM * length * (1 + (+gs.fittingsPct || 0) / 100)) / 1000
          Object.assign(res, { mj, mjConnected: total.mj, q, m3h: q * 3.6, dn: pick.size.dn, bore: pick.size.id, v: flow.v, paPerM: flow.paPerM, loss, locked: pick.locked, atMax: pick.atMax, upsized: bumps[l.id] || 0 })
          res.label = `DN${res.dn} · ${mj.toFixed(0)} MJ/h`
        } else if (sys.kind === 'drain') {
          const q = drainFlow(total, settings.drain)
          const grade = l.grade != null && l.grade !== '' ? +l.grade : +settings.drain.grade
          const fill = +settings.drain.fill || 0.5
          const upstreamDn = Math.max(0, ...(children.get(nid) || []).map((c) => out.links[parentLink.get(c).link.id]?.dn || 0))
          const dnFloor = Math.max(total.dnMin, upstreamDn)
          const pick = pickSize(mat.sizes, (s) => s.dn >= dnFloor && drainCapacity(s.id, grade, fill, mat.roughness).q >= q, l.size)
          const cap = drainCapacity(pick.size.id, grade, fill, mat.roughness)
          Object.assign(res, { du: total.du, q, dn: pick.size.dn, bore: pick.size.id, grade, cap: cap.q, v: cap.v, util: cap.q > 0 ? q / cap.q : Infinity, locked: pick.locked })
          if (q > cap.q) W.push({ level: 'error', msg: `${l.id}: ${q.toFixed(2)} L/s exceeds DN${pick.size.dn} capacity ${cap.q.toFixed(2)} L/s at ${grade}%`, ref: l.id })
          if (pick.size.dn < dnFloor) W.push({ level: 'error', msg: `${l.id}: DN${pick.size.dn} is smaller than DN${dnFloor} upstream`, ref: l.id })
          if (q > 0 && cap.v < 0.6) W.push({ level: 'warn', msg: `${l.id}: ${cap.v.toFixed(2)} m/s is below 0.6 m/s self-cleansing — steepen the grade`, ref: l.id })
          res.label = `DN${res.dn} @ ${grade}% · ${q.toFixed(2)} L/s`
        } else {
          const q = total.air
          const as = settings.air
          const pick = pickSize(mat.sizes, (s) => {
            const f = pipeFlow(q, s.id, mat.roughness, AIR)
            return f.paPerM <= +as.friction && f.v <= +as.vMax
          }, l.size)
          const flow = pipeFlow(q, pick.size.id, mat.roughness, AIR)
          const loss = flow.paPerM * length * (1 + (+as.fittingsPct || 0) / 100)
          const rect = rectangleFor(pick.size.id, +as.rectDepth || 300)
          Object.assign(res, { q, dn: pick.size.dn, bore: pick.size.id, v: flow.v, paPerM: flow.paPerM, loss, rect, locked: pick.locked })
          if (flow.v > +as.vMax + 1e-9) W.push({ level: 'warn', msg: `${l.id}: ${flow.v.toFixed(1)} m/s exceeds ${as.vMax} m/s`, ref: l.id })
          res.label = `Ø${res.dn} (${rect.w}×${rect.h}) · ${q.toFixed(0)} L/s`
        }
        out.links[l.id] = res
      }

      // Pressures, root back out to outlets.
      const rootSummary = { root: root.id, label: root.label || root.id }
      if (sys.kind === 'water') {
        const { rho } = waterProps(sys.tempC)
        const p = new Map([[root.id, +root.pressure || 0]])
        let critical = null
        for (const nid of order) {
          const n = nodes.get(nid)
          const pl = parentLink.get(nid)
          if (pl) {
            const parent = nodes.get(pl.parent)
            const dz = (+n.z || 0) - (+parent.z || 0)
            p.set(nid, p.get(pl.parent) - out.links[pl.link.id].loss - (rho * G * dz) / 1000)
          }
          const res = { system: sysKey, pressure: p.get(nid) }
          if (n.kind === 'fixture' && fixtures[n.fixture]) {
            const pmin = +fixtures[n.fixture].pmin || 0
            res.required = pmin
            res.margin = res.pressure - pmin
            res.ok = res.margin >= 0
            if (!res.ok) W.push({ level: 'error', msg: `${sys.name}: ${fixtures[n.fixture].name} ${n.label || n.id} has ${res.pressure.toFixed(0)} kPa, needs ${pmin} kPa`, ref: nid })
            if (res.pressure > +settings.water.pMax) W.push({ level: 'warn', msg: `${sys.name}: ${n.label || n.id} at ${res.pressure.toFixed(0)} kPa is above ${settings.water.pMax} kPa — fit a PLV`, ref: nid })
            if (!critical || res.margin < critical.margin) critical = { node: nid, margin: res.margin, pressure: res.pressure }
          }
          ;(out.nodes[nid] ||= {})[sysKey] = res
        }
        const top = subtree.get(root.id)
        Object.assign(rootSummary, { lu: top.lu, q: waterDemand(top, settings.water), critical })
      } else if (sys.kind === 'gas') {
        const gas = GASES[sys.gas]
        const pMin = +settings.gas[sys.gas]?.pMin || 0
        const p = new Map([[root.id, +root.pressure || 0]])
        let critical = null
        for (const nid of order) {
          const n = nodes.get(nid)
          const pl = parentLink.get(nid)
          if (pl) {
            const dz = (+n.z || 0) - (+nodes.get(pl.parent).z || 0)
            // Lighter-than-air gas gains pressure as it rises; LPG loses it.
            p.set(nid, p.get(pl.parent) - out.links[pl.link.id].loss + ((AIR_RHO - gas.rho) * G * dz) / 1000)
          }
          const res = { system: sysKey, pressure: p.get(nid) }
          const fx = n.kind === 'fixture' && fixtures[n.fixture]
          if (fx && +fx.mj > 0) {
            res.required = pMin
            res.margin = res.pressure - pMin
            res.ok = res.margin >= -1e-9
            if (!res.ok) W.push({ level: 'error', msg: `${sys.name}: ${fx.name} ${n.label || n.id} has ${res.pressure.toFixed(2)} kPa, needs ${pMin} kPa`, ref: nid })
            if (!critical || res.margin < critical.margin) critical = { node: nid, margin: res.margin, pressure: res.pressure }
          }
          ;(out.nodes[nid] ||= {})[sysKey] = res
        }
        const top = subtree.get(root.id)
        const mj = gasLoad(top, settings.gas)
        Object.assign(rootSummary, { mj, mjConnected: top.mj, m3h: gasFlowLs(mj, sys.gas) * 3.6, critical })
      } else if (sys.kind === 'air') {
        const p = new Map([[root.id, 0]])
        let index = null
        for (const nid of order) {
          const pl = parentLink.get(nid)
          if (pl) p.set(nid, p.get(pl.parent) + out.links[pl.link.id].loss)
          const n = nodes.get(nid)
          const res = { system: sysKey, pathLoss: p.get(nid) }
          if (n.kind === 'terminal') {
            res.total = res.pathLoss + (+settings.air.terminalPa || 0)
            if (!index || res.total > index.total) index = { node: nid, total: res.total }
          }
          ;(out.nodes[nid] ||= {})[sysKey] = res
        }
        Object.assign(rootSummary, { q: subtree.get(root.id).air, esp: index ? index.total : 0, index })
      } else {
        const top = subtree.get(root.id)
        Object.assign(rootSummary, { du: top.du, q: drainFlow(top, settings.drain) })
        for (const nid of order) (out.nodes[nid] ||= {})[sysKey] = { system: sysKey }
      }
      summary.roots.push(rootSummary)
    }

    for (const l of links) {
      if (!usedLinks.has(l.id)) W.push({ level: 'warn', msg: `${sys.name}: link ${l.id} is not connected to a root`, ref: l.id })
    }
    out.summary[sysKey] = summary
  }

  // Bill of materials: length per system / material / size, plus tees.
  const bom = new Map()
  for (const r of Object.values(out.links)) {
    const key = `${r.system}|${r.material}|${r.dn}`
    const row = bom.get(key) || { system: r.system, material: r.material, dn: r.dn, length: 0, count: 0 }
    row.length += r.length
    row.count += 1
    bom.set(key, row)
  }
  out.bom = [...bom.values()].sort((a, b) => a.system.localeCompare(b.system) || a.material.localeCompare(b.material) || a.dn - b.dn)
  const tees = {}
  for (const sysKey of Object.keys(SYSTEMS)) {
    const deg = new Map()
    for (const l of project.links) if (l.system === sysKey) for (const e of [l.a, l.b]) deg.set(e, (deg.get(e) || 0) + 1)
    tees[sysKey] = [...deg.values()].filter((d) => d >= 3).reduce((s, d) => s + (d - 2), 0)
  }
  out.tees = tees
  return out
}
