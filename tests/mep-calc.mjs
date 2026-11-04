// Unit checks for the MEP design calculation engine (public/mep/calc.js).
// Run: node tests/mep-calc.mjs
import assert from 'node:assert/strict'
import { calculate, pipeFlow, drainCapacity, waterProps, AIR, waterDemand, drainFlow, equivalentDiameter } from '../public/mep/calc.js'
import { demoProject, newProject } from '../public/mep/project.js'

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

console.log(`mep-calc: ${passed} passed`)
