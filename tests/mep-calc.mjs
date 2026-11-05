// Unit checks for the MEP design calculation engine (public/mep/calc.js).
// Run: node tests/mep-calc.mjs
import assert from 'node:assert/strict'
import { calculate, pipeFlow, drainCapacity, waterProps, AIR, waterDemand, drainFlow, equivalentDiameter, gasProps, gasFlowLs, gasLoad } from '../public/mep/calc.js'
import { demoProject, newProject } from '../public/mep/project.js'
import { calculatedGasTable, tableCapacity, gasCapacity } from '../public/mep/calc.js'
import { parseGasTableCsv, gasTableCsv, checkGasTable } from '../public/mep/gastables.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`) }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`)

test('water properties at 20 °C', () => {
  const w = waterProps(20)
  near(w.rho, 998.2, 0.5, 'density')
  near(w.nu, 1.004e-6, 0.02e-6, 'viscosity')
})

test('copper DN20 at 0.3 L/s ≈ 1.3 m/s, ≈ 1.3 kPa/m', () => {
  const f = pipeFlow(0.3, 17.01, 0.0015, waterProps(20))
  near(f.v, 1.32, 0.01, 'velocity')
  near(f.paPerM, 1300, 80, 'friction')
})

test('DN100 drain half full at 1:60 carries ≈ 4 L/s', () => {
  near(drainCapacity(104, 1.65, 0.5, 1.0).q, 4.0, 0.2, 'capacity')
})

test('Huebscher: square duct equivalent is 1.093 × side', () => {
  near(equivalentDiameter(300, 300), 327.9, 0.5, 'De')
})

test('probable demand never exceeds sum of flows nor drops below largest outlet', () => {
  const ws = { method: 'sqrt', kLU: 0.1 }
  assert.equal(waterDemand({ lu: 1, qSum: 0.1, qMax: 0.1 }, ws), 0.1)
  near(waterDemand({ lu: 100, qSum: 10, qMax: 0.3 }, ws), 1.0, 1e-9, '100 LU')
  assert.equal(waterDemand({ lu: 100, qSum: 10, qMax: 0.3 }, { method: 'sum' }), 10)
  near(drainFlow({ du: 16, duMax: 2 }, { K: 0.5 }), 2.0, 1e-9, 'Qww')
})

test('demo solves every system with no errors and every outlet in pressure', () => {
  const r = calculate(demoProject())
  assert.deepEqual(r.warnings.filter((w) => w.level === 'error'), [])
  for (const k of ['CW', 'HW', 'SAN', 'SA']) assert.ok(r.summary[k]?.roots.length, `${k} solved`)
  for (const per of Object.values(r.nodes)) for (const x of Object.values(per)) assert.notEqual(x.ok, false)
})

test('drains never reduce downstream and WCs get DN100', () => {
  const p = demoProject()
  const r = calculate(p)
  const drains = Object.values(r.links).filter((l) => l.system === 'SAN')
  const byTo = new Map(drains.map((l) => [l.to, l]))
  for (const l of drains) {
    const down = byTo.get(l.from)
    if (down) assert.ok(down.dn >= l.dn, `${down.id} DN${down.dn} downstream of ${l.id} DN${l.dn}`)
    if (p.nodes.find((n) => n.id === l.to)?.fixture === 'wc') assert.ok(l.dn >= 100, 'WC branch')
    assert.ok(l.q <= l.cap + 1e-9, `${l.id} within capacity`)
  }
})

test('low supply pressure upsizes pipes until outlets are satisfied', () => {
  const p = demoProject()
  p.nodes.find((n) => n.label === 'Water meter').pressure = 120
  const r = calculate(p)
  assert.ok(r.upsized > 0, 'something was upsized')
  const cw = Object.entries(r.nodes).map(([, v]) => v.CW).filter((x) => x?.ok != null)
  assert.ok(cw.every((x) => x.ok), 'all CW outlets OK after upsizing')
})

test('ducts are sized within the friction rate', () => {
  const r = calculate(demoProject())
  for (const l of Object.values(r.links).filter((x) => x.system === 'SA')) assert.ok(l.paPerM <= 1.0 + 1e-9, l.id)
  assert.equal(r.summary.SA.roots[0].q, 500)
})

test('elevation reduces pressure by ρgh', () => {
  const p = newProject()
  p.nodes = [
    { id: 'S', kind: 'source', system: 'CW', pressure: 300, x: 0, y: 0, z: 0 },
    { id: 'F', kind: 'fixture', fixture: 'basin', x: 0, y: 0, z: 10 },
  ]
  p.links = [{ id: 'L1', a: 'S', b: 'F', system: 'CW', length: 0.0001 }]
  const r = calculate(p)
  near(r.nodes.F.CW.pressure, 300 - 97.9, 0.5, 'pressure at +10 m')
})

test('loops and orphan runs are reported', () => {
  const p = newProject()
  p.nodes = ['S', 'A', 'B', 'X', 'Y'].map((id, i) => ({ id, kind: id === 'S' ? 'source' : 'junction', system: 'CW', x: i * 20, y: 0, z: 0 }))
  p.links = [
    { id: 'L1', a: 'S', b: 'A', system: 'CW' }, { id: 'L2', a: 'A', b: 'B', system: 'CW' }, { id: 'L3', a: 'B', b: 'S', system: 'CW' },
    { id: 'L4', a: 'X', b: 'Y', system: 'CW' },
  ]
  const msgs = calculate(p).warnings.map((w) => w.msg).join('\n')
  assert.match(msgs, /closes a loop/)
  assert.match(msgs, /L4 is not connected/)
})

// ---------- gas ----------

test('gas flow: 38.7 MJ/h of natural gas is 1 m³/h', () => {
  near(gasFlowLs(38.7, 'NG') * 3.6, 1, 1e-9, 'NG')
  near(gasFlowLs(95, 'LPG') * 3.6, 1, 1e-9, 'LPG')
})

test('199 MJ/h NG in DN20 copper ≈ 6.3 m/s, ≈ 28 Pa/m', () => {
  const f = pipeFlow(gasFlowLs(199, 'NG'), 17.01, 0.0015, gasProps('NG'))
  near(f.v, 6.28, 0.05, 'velocity')
  near(f.paPerM, 28, 3, 'friction')
})

test('gas diversity never drops below the largest appliance', () => {
  assert.equal(gasLoad({ mj: 233, mjMax: 199 }, { diversity: 50 }), 199)
  assert.equal(gasLoad({ mj: 400, mjMax: 100 }, { diversity: 70 }), 280)
  assert.equal(gasLoad({ mj: 233, mjMax: 199 }, { diversity: 100 }), 233)
})

function gasRun(system, { pressure = 2.75, z = 0, length = 10, mj = 'hwsInst' } = {}) {
  const p = newProject()
  p.nodes = [
    { id: 'M', kind: 'source', system, pressure, x: 0, y: 0, z: 0 },
    { id: 'A', kind: 'fixture', fixture: mj, x: 0, y: 0, z },
  ]
  p.links = [{ id: 'L1', a: 'M', b: 'A', system, length }]
  return { p, r: calculate(p) }
}

test('gas pipe is upsized until the appliance has its minimum pressure', () => {
  const { r } = gasRun('NG')
  const l = r.links.L1
  assert.ok(l.dn >= 25, `DN${l.dn}`)
  assert.ok(l.upsized > 0, 'upsized for pressure')
  assert.ok(r.nodes.A.NG.ok, 'appliance in pressure')
  assert.ok(r.nodes.A.NG.pressure >= 2.5 - 1e-9)
})

test('stack effect: NG gains and LPG loses pressure going up', () => {
  const ng = gasRun('NG', { z: 10, length: 0.001, mj: 'cooktop' }).r.nodes.A.NG.pressure
  const lpg = gasRun('LPG', { z: 10, length: 0.001, mj: 'cooktop' }).r.nodes.A.LPG.pressure
  near(ng - 2.75, ((1.2 - 0.73) * 9.81 * 10) / 1000, 0.002, 'NG rise')
  near(lpg - 2.75, ((1.2 - 1.87) * 9.81 * 10) / 1000, 0.002, 'LPG rise')
})

test('a supply below the appliance minimum is reported, not hidden', () => {
  const { r } = gasRun('NG', { pressure: 2.0 })
  assert.equal(r.nodes.A.NG.ok, false)
  assert.ok(r.warnings.some((w) => w.level === 'error' && /needs 2.5 kPa/.test(w.msg)))
})

test('demo gas service solves with every appliance in pressure', () => {
  const r = calculate(demoProject())
  const s = r.summary.NG.roots[0]
  assert.equal(s.mjConnected, 199 + 34)
  assert.ok(s.critical.margin >= 0)
  for (const l of Object.values(r.links).filter((x) => x.system === 'NG')) assert.ok(l.dn >= 15)
})

// ---------- gas capacity tables ----------

// A hand-made table (not from the standard) with round numbers to test against.
const TEST_TABLE = {
  id: 'GT1', name: 'Test table', gas: 'NG', material: 'copperB', drop: 0.25, source: 'entered',
  lengths: [5, 10, 20, 40],
  rows: [
    { dn: 15, cap: [150, 100, 70, 45] },
    { dn: 20, cap: [270, 180, 120, 80] },
    { dn: 25, cap: [600, 400, 280, 180] },
    { dn: 32, cap: [1200, 800, 540, 360] },
  ],
}

function tableProject(rule = 'longest') {
  // meter → 4 m → tee → 6 m → HWS (199 MJ/h); tee → 14 m → cooktop (34 MJ/h)
  const p = newProject()
  p.settings.gas = { ...p.settings.gas, method: 'table', lengthRule: rule, tableFittings: false, tables: { NG: 'GT1', LPG: 'calc' } }
  p.gasTables = [structuredClone(TEST_TABLE)]
  p.nodes = [
    { id: 'M', kind: 'source', system: 'NG', pressure: 2.75, x: 0, y: 0, z: 0 },
    { id: 'T', kind: 'junction', x: 0, y: 0, z: 0 },
    { id: 'H', kind: 'fixture', fixture: 'hwsInst', x: 0, y: 0, z: 0 },
    { id: 'C', kind: 'fixture', fixture: 'cooktop', x: 0, y: 0, z: 0 },
  ]
  p.links = [
    { id: 'L1', a: 'M', b: 'T', system: 'NG', length: 4 },
    { id: 'L2', a: 'T', b: 'H', system: 'NG', length: 6 },
    { id: 'L3', a: 'T', b: 'C', system: 'NG', length: 14 },
  ]
  return p
}

test('tables are read at the next longer length, and NaN beyond the last', () => {
  assert.equal(tableCapacity(TEST_TABLE, 20, 5), 270)
  assert.equal(tableCapacity(TEST_TABLE, 20, 5.01), 180)
  assert.equal(tableCapacity(TEST_TABLE, 20, 1), 270)
  assert.ok(Number.isNaN(tableCapacity(TEST_TABLE, 20, 41)))
  assert.equal(tableCapacity(TEST_TABLE, 50, 10), 0)
})

test('calculated tables fall with length and each entry spends the allowed drop', () => {
  const t = calculatedGasTable('NG', 'copperB', 0.25)
  for (const r of t.rows) for (let i = 1; i < r.cap.length; i++) assert.ok(r.cap[i] <= r.cap[i - 1], `DN${r.dn}`)
  const mj = gasCapacity('NG', 22.96, 0.0015, 20, 0.25)
  near(pipeFlow(gasFlowLs(mj, 'NG'), 22.96, 0.0015, gasProps('NG')).paPerM * 20, 250, 0.5, 'loss at capacity')
  assert.equal(checkGasTable(t).errors.length, 0)
})

test('longest-run rule: every section is read at the 18 m longest run', () => {
  const r = calculate(tableProject('longest'))
  // 20 m column: main 233 MJ/h → DN25 (280); HWS 199 → DN25; cooktop 34 → DN15 (70)
  assert.deepEqual(['L1', 'L2', 'L3'].map((id) => r.links[id].dn), [25, 25, 15])
  for (const id of ['L1', 'L2', 'L3']) assert.equal(r.links[id].tableLength, 18)
  assert.equal(r.summary.NG.roots[0].method, 'table')
  assert.equal(r.summary.NG.roots[0].longest, 18)
})

test('branch rule reads each section at the run to its furthest appliance', () => {
  // A 100 MJ/h ducted heater 10 m from the meter: DN15 carries 100 at 10 m
  // but only 70 at the 20 m column the 18 m longest run falls in.
  const size = (rule) => {
    const p = tableProject(rule)
    p.nodes.find((n) => n.id === 'H').fixture = 'ducted'
    const r = calculate(p)
    return [r.links.L2.tableLength, r.links.L2.dn]
  }
  assert.deepEqual(size('branch'), [10, 15])
  assert.deepEqual(size('longest'), [18, 20])
})

test('over capacity is an error on the pipe and the appliance', () => {
  const p = tableProject()
  p.links[1].size = 15 // lock the HWS branch too small
  const r = calculate(p)
  assert.equal(r.links.L2.fail, true)
  assert.equal(r.nodes.H.NG.ok, false)
  assert.equal(r.nodes.C.NG.ok, true)
  assert.ok(r.warnings.some((w) => w.level === 'error' && /L2: 199 MJ\/h exceeds DN15/.test(w.msg)))
})

test('a run longer than the table is an error, not a guess', () => {
  const p = tableProject()
  p.links[2].length = 50
  const r = calculate(p)
  assert.ok(r.warnings.some((w) => /longer than table/.test(w.msg)))
})

test('a broken entered table falls back to the calculated one, loudly', () => {
  const p = tableProject()
  p.gasTables[0].lengths = [5, 20, 10, 40]
  const r = calculate(p)
  assert.ok(r.warnings.some((w) => w.level === 'error' && /cannot be read/.test(w.msg)))
  assert.equal(r.summary.NG.roots[0].tableSource, 'calculated')
})

test('table CSV round-trips and reports bad input by line', () => {
  const back = parseGasTableCsv(gasTableCsv(TEST_TABLE))
  assert.deepEqual(back.lengths, TEST_TABLE.lengths)
  assert.deepEqual(back.rows, TEST_TABLE.rows)
  assert.equal(back.gas, 'NG')
  assert.equal(back.material, 'copperB')
  const t = parseGasTableCsv('name,Mine\ngas,lpg\nmaterial,PE100 SDR11\nDN\t5\t10\n20\t300\t\n', 'x')
  assert.equal(t.gas, 'LPG')
  assert.equal(t.material, 'pe100')
  assert.deepEqual(t.rows[0].cap, [300, null])
  assert.throws(() => parseGasTableCsv('DN,5,10\n15,100,abc'), /line 2/)
  assert.throws(() => parseGasTableCsv('DN,10,5\n15,100,80'), /increase/)
  assert.throws(() => parseGasTableCsv('gas,CO2\nDN,5\n15,1'), /gas must be/)
  assert.match(checkGasTable({ ...TEST_TABLE, rows: [{ dn: 15, cap: [100, 150, 70, 45] }] }).warnings[0], /rises/)
})

console.log(`mep-calc: ${passed} passed`)
